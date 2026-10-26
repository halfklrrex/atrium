// Generates THIRD_PARTY_NOTICES.md from the production dependencies of the workspaces that ship
// code (apps/web, functions, packages/shared), and fails on any licence that is unknown or not
// compatible with AGPL-3.0 (docs/specs/OPS2-agpl-licence-hygiene.md).
//
//   pnpm licenses:notices   regenerate THIRD_PARTY_NOTICES.md
//   pnpm licenses:check     CI: fail if the committed file is stale or a licence is not allowed
//
// The output must be identical on every OS, so it contains no paths or dates, is sorted with plain
// string comparison, and leaves out native binary packages (they declare `os`/`cpu`; they are
// build tooling such as esbuild, rolldown and lightningcss, and carry their parent's licence).

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT_FILE = join(root, 'THIRD_PARTY_NOTICES.md');

/** Workspaces whose production dependencies are shipped (web bundle, Cloud Functions bundle). */
export const WORKSPACES = ['@atrium/web', '@atrium/functions', '@atrium/shared'];

/** SPDX identifiers that may be combined with AGPL-3.0-only code. */
const ALLOWED = new Set(
  [
    'MIT',
    'MIT-0',
    'ISC',
    '0BSD',
    'BSD-1-Clause',
    'BSD-2-Clause',
    'BSD-2-Clause-Patent',
    'BSD-3-Clause',
    'BSD-3-Clause-Clear',
    'Apache-2.0',
    'CC0-1.0',
    'CC-BY-3.0',
    'CC-BY-4.0',
    'Unlicense',
    'WTFPL',
    'MPL-2.0',
    'BlueOak-1.0.0',
    'Python-2.0',
    'PSF-2.0',
    'Zlib',
    'BSL-1.0', // Boost Software License, not the Business Source License (BUSL-1.1)
    'X11',
    'W3C',
    'W3C-20150513',
    'Artistic-2.0',
    'OFL-1.1', // fonts: reserved-name rules apply to the fonts, not to Atrium's code
    'Public Domain',
    // Copyleft licences that are compatible with AGPL-3.0 (LGPL/GPL/AGPL version 3, or "or later").
    'LGPL-2.1-only',
    'LGPL-2.1-or-later',
    'LGPL-3.0-only',
    'LGPL-3.0-or-later',
    'GPL-2.0-or-later',
    'GPL-3.0-only',
    'GPL-3.0-or-later',
    'AGPL-3.0-only',
    'AGPL-3.0-or-later',
  ].map((id) => id.toLowerCase()),
);

/** Licences we recognise but must not combine with AGPL-3.0, with the reason to show. */
const DISALLOWED = [
  [/^(sspl|server-side-public)/i, 'SSPL is not an open-source licence and conflicts with AGPL'],
  [/^(busl|business source)/i, 'Business Source License restricts production use'],
  [/^elastic/i, 'Elastic License restricts use'],
  [/commons[- ]clause/i, 'Commons Clause restricts selling'],
  [/sustainable[- ]use/i, 'Sustainable Use License restricts use'],
  [/hippocratic/i, 'Hippocratic License restricts use'],
  [/^(proprietary|unlicensed|commercial)/i, 'proprietary licence'],
  [/^epl-2\.0/i, 'EPL-2.0 is only allowed together with a secondary GPL licence'],
  [/^epl-1\.0/i, 'EPL-1.0 is not compatible with the GPL'],
  [/^cddl/i, 'CDDL is not compatible with the GPL'],
  [/^gpl-2\.0(-only)?$/i, 'GPL-2.0-only is not compatible with AGPL-3.0'],
  [/^bsd-4-clause/i, 'BSD-4-Clause advertising clause is not compatible with the GPL'],
  [/^apache-1/i, 'Apache-1.x is not compatible with the GPL'],
  [/^cc-by-nc/i, 'non-commercial Creative Commons licence'],
  [/^cc-by-sa-[12]/i, 'CC-BY-SA 1.0/2.x is not compatible with AGPL-3.0'],
];

/**
 * Manual review results for packages whose licence metadata is missing or non-standard. Key is
 * `name@version`. Add an entry only after reading the package's own licence file, and say why.
 * Currently empty: every production dependency declares a recognised SPDX licence.
 * @type {Record<string, { license: string, reason: string }>}
 */
export const REVIEWED_OVERRIDES = {};

// ---------- SPDX expression handling ----------

/** Splits an SPDX expression into tokens: "(", ")", "AND", "OR", "WITH" and licence ids. */
function tokenize(expression) {
  return expression
    .replace(/[()]/g, ' $& ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (/^(and|or|with)$/i.test(t) ? t.toUpperCase() : t));
}

/**
 * Parses an SPDX licence expression into a tree:
 * `{ op: 'OR'|'AND', items }` or `{ id, exception? }`. Throws on malformed input.
 */
export function parseSpdx(expression) {
  const tokens = tokenize(expression);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseOr() {
    const items = [parseAnd()];
    while (peek() === 'OR') {
      next();
      items.push(parseAnd());
    }
    return items.length === 1 ? items[0] : { op: 'OR', items };
  }
  function parseAnd() {
    const items = [parseAtom()];
    while (peek() === 'AND') {
      next();
      items.push(parseAtom());
    }
    return items.length === 1 ? items[0] : { op: 'AND', items };
  }
  function parseAtom() {
    const token = next();
    if (token === undefined) throw new Error('unexpected end of expression');
    if (token === '(') {
      const inner = parseOr();
      if (next() !== ')') throw new Error('missing closing parenthesis');
      return inner;
    }
    if (token === ')' || token === 'AND' || token === 'OR' || token === 'WITH') {
      throw new Error(`unexpected "${token}"`);
    }
    const node = { id: token };
    if (peek() === 'WITH') {
      next();
      node.exception = next();
    }
    return node;
  }

  const tree = parseOr();
  if (pos !== tokens.length) throw new Error(`unexpected "${tokens[pos]}"`);
  return tree;
}

/** Normalises "GPL-2.0+" style ids to their "-or-later" form so lookups work. */
function normaliseId(id) {
  if (id.endsWith('+')) return `${id.slice(0, -1)}-or-later`;
  return id;
}

/** Checks one licence id; returns `{ ok: true }` or `{ ok: false, reason }`. */
function checkId(id) {
  const normal = normaliseId(id);
  for (const [pattern, reason] of DISALLOWED) {
    if (pattern.test(normal)) return { ok: false, reason: `${id}: ${reason}` };
  }
  if (ALLOWED.has(normal.toLowerCase())) return { ok: true };
  return { ok: false, reason: `${id}: unknown licence, review it and add it to the script` };
}

/**
 * Decides whether a licence expression may be combined with AGPL-3.0-only.
 * `OR` is satisfied by any allowed alternative, `AND` needs every part to be allowed, and `WITH`
 * exceptions only loosen a licence so they are ignored. A lone EPL-2.0 is rejected, but
 * "EPL-2.0 OR GPL-2.0-or-later" passes through its GPL alternative.
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function classifyLicense(expression) {
  const text = (expression ?? '').trim();
  if (!text || /^(unknown|none|see license)/i.test(text) || /^see licen[cs]e in/i.test(text)) {
    return { ok: false, reasons: [`${text || '(empty)'}: licence is missing or not an SPDX id`] };
  }
  let tree;
  try {
    tree = parseSpdx(text);
  } catch (error) {
    return { ok: false, reasons: [`${text}: not a valid SPDX expression (${error.message})`] };
  }
  const walk = (node) => {
    if (node.id) return toResult(checkId(node.id));
    const results = node.items.map(walk);
    if (node.op === 'OR') {
      return results.some((r) => r.ok)
        ? { ok: true, reasons: [] }
        : { ok: false, reasons: results.flatMap((r) => r.reasons) };
    }
    return results.every((r) => r.ok)
      ? { ok: true, reasons: [] }
      : { ok: false, reasons: results.flatMap((r) => r.reasons) };
  };
  return walk(tree);
}

function toResult(check) {
  return { ok: check.ok, reasons: check.ok ? [] : [check.reason] };
}

// ---------- reading dependency data ----------

/** Reads `pnpm --filter <workspace> licenses list --prod --json`. */
function pnpmLicenses(workspace) {
  // One command string (not an args array): on Windows pnpm is a .cmd shim that needs a shell.
  const result = spawnSync(`pnpm --filter ${workspace} licenses list --prod --json`, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `pnpm licenses failed for ${workspace} (exit ${result.status}). Run "pnpm install" first.\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout || '{}');
}

const LICENSE_FILE = /^(licen[cs]e|licen[cs]ing|copying|unlicense)(\.|-|$)/i;
const NOTICE_FILE = /^notice(\.|$)/i;

function readText(file) {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

function readTexts(dir, pattern) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((name) => readText(join(dir, name)))
    .filter(Boolean);
}

function repositoryOf(manifest) {
  let url =
    typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  if (!url) return manifest.homepage ?? '';
  url = url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '');
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  return url;
}

/** Legacy `licenses: [{ type }]` and `license: { type }` manifests, as an SPDX-ish string. */
function manifestLicense(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  if (Array.isArray(manifest.licenses) && manifest.licenses.length) {
    return `(${manifest.licenses.map((l) => l.type ?? l).join(' OR ')})`;
  }
  return '';
}

/**
 * Collects the de-duplicated production dependency list.
 * @returns {{ entries: object[] }}
 */
export function collectDependencies(readLicenses = pnpmLicenses, workspaces = WORKSPACES) {
  const byKey = new Map();
  const seenNative = new Set();

  for (const workspace of workspaces) {
    for (const [reportedLicense, packages] of Object.entries(readLicenses(workspace))) {
      for (const pkg of packages) {
        pkg.versions.forEach((version, index) => {
          const key = `${pkg.name}@${version}`;
          if (byKey.has(key) || seenNative.has(key)) return;
          const dir = pkg.paths[index];
          const manifestFile = join(dir, 'package.json');
          const manifest = existsSync(manifestFile)
            ? JSON.parse(readFileSync(manifestFile, 'utf8'))
            : {};
          if (manifest.os || manifest.cpu) {
            seenNative.add(key);
            return;
          }
          const override = REVIEWED_OVERRIDES[key];
          const license =
            override?.license ??
            (/^unknown$/i.test(reportedLicense) ? manifestLicense(manifest) : reportedLicense);
          byKey.set(key, {
            name: pkg.name,
            version,
            license: license || 'UNKNOWN',
            repository: repositoryOf(manifest) || pkg.homepage || '',
            licenseTexts: readTexts(dir, LICENSE_FILE),
            noticeTexts: readTexts(dir, NOTICE_FILE),
            reviewed: override?.reason,
          });
        });
      }
    }
  }

  const entries = [...byKey.values()].sort((a, b) =>
    a.name === b.name ? cmp(a.version, b.version) : cmp(a.name, b.name),
  );
  return { entries };
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Entries whose licence is not allowed, with the reasons. */
export function findDisallowed(entries) {
  return entries
    .map((entry) => ({ entry, result: classifyLicense(entry.license) }))
    .filter(({ result }) => !result.ok)
    .map(({ entry, result }) => ({
      name: entry.name,
      version: entry.version,
      license: entry.license,
      reasons: result.reasons,
    }));
}

// ---------- rendering ----------

const SHARED_TEXT_MIN_LENGTH = 3000;

/** Renders the notices file. Texts that are long and used by several packages are printed once. */
export function renderNotices({ entries }) {
  const hashOf = (text) => createHash('sha256').update(text).digest('hex');
  const usage = new Map();
  for (const entry of entries) {
    for (const text of [...entry.licenseTexts, ...entry.noticeTexts]) {
      const hash = hashOf(text);
      usage.set(hash, { text, count: (usage.get(hash)?.count ?? 0) + 1 });
    }
  }
  const shared = [...usage.entries()]
    .filter(([, { text, count }]) => count > 1 && text.length >= SHARED_TEXT_MIN_LENGTH)
    .sort(([, a], [, b]) => cmp(a.text, b.text));
  const sharedId = new Map(shared.map(([hash], index) => [hash, `T${index + 1}`]));

  const fence = (text) => {
    const longest = Math.max(2, ...[...text.matchAll(/`{3,}/g)].map((m) => m[0].length));
    const ticks = '`'.repeat(longest + 1);
    return `${ticks}text\n${text}\n${ticks}`;
  };

  const out = [];
  out.push('# Third-party notices');
  out.push('');
  out.push(
    '<!-- Generated by `pnpm licenses:notices` (scripts/third-party-notices.mjs). Do not edit by hand. -->',
  );
  out.push('');
  out.push(
    'Atrium is licensed under the GNU Affero General Public License v3.0 only (see `LICENSE` and `NOTICE`). ' +
      'It is built on the open-source packages below, each under its own licence. ' +
      "Atrium's UI uses the MIT-licensed Vibe design system (`@vibe/core`, `@vibe/icons`) published by monday.com; " +
      'Atrium is not affiliated with monday.com.',
  );
  out.push('');
  out.push(
    'The list covers the production dependencies (direct and transitive) of `apps/web`, `functions` and ' +
      '`packages/shared`, as reported by `pnpm licenses list --prod`. That is a superset of what ends up in the ' +
      'built bundles. Platform-specific native binaries of build tools (esbuild, rolldown, lightningcss) are ' +
      'omitted, because they differ per operating system; they carry the licence of their parent package.',
  );
  out.push('');
  out.push(
    `**${entries.length} packages.** Code copied into the repository is tracked in \`docs/PROVENANCE.md\`.`,
  );
  out.push('');

  const counts = new Map();
  for (const entry of entries) counts.set(entry.license, (counts.get(entry.license) ?? 0) + 1);
  out.push('## Licence summary');
  out.push('');
  out.push('| Licence | Packages |');
  out.push('| --- | --- |');
  for (const [license, count] of [...counts.entries()].sort(([a], [b]) => cmp(a, b))) {
    out.push(`| ${license.replace(/\|/g, '\\|')} | ${count} |`);
  }
  out.push('');

  out.push('## Packages');
  for (const entry of entries) {
    out.push('');
    out.push(`### ${entry.name} ${entry.version}`);
    out.push('');
    out.push(`- Licence: ${entry.license}`);
    if (entry.repository) out.push(`- Repository: ${entry.repository}`);
    if (entry.reviewed) out.push(`- Reviewed manually: ${entry.reviewed}`);
    const texts = [
      ...entry.licenseTexts.map((text) => ({ text, label: 'Licence text' })),
      ...entry.noticeTexts.map((text) => ({ text, label: 'Notice' })),
    ];
    if (!texts.length)
      out.push('- Licence text: not shipped inside the package, see the repository above.');
    for (const { text, label } of texts) {
      const id = sharedId.get(hashOf(text));
      out.push('');
      if (id) {
        out.push(`${label}: see [shared text ${id}](#shared-text-${id.toLowerCase()}).`);
      } else {
        out.push(`${label}:`);
        out.push('');
        out.push(fence(text));
      }
    }
  }

  if (shared.length) {
    out.push('');
    out.push('## Shared licence texts');
    for (const [hash, { text }] of shared) {
      const id = sharedId.get(hash);
      const users = entries
        .filter((e) => [...e.licenseTexts, ...e.noticeTexts].some((t) => hashOf(t) === hash))
        .map((e) => `${e.name} ${e.version}`);
      out.push('');
      out.push(`### Shared text ${id}`);
      out.push('');
      out.push(`Used by ${users.length} packages, for example ${users.slice(0, 3).join(', ')}.`);
      out.push('');
      out.push(fence(text));
    }
  }

  return `${out.join('\n')}\n`;
}

// ---------- main ----------

function main(argv) {
  const check = argv.includes('--check');
  const data = collectDependencies();
  const disallowed = findDisallowed(data.entries);
  if (disallowed.length) {
    console.error('Disallowed or unknown dependency licences (not compatible with AGPL-3.0):');
    for (const item of disallowed) {
      console.error(
        `  - ${item.name}@${item.version} [${item.license}]: ${item.reasons.join('; ')}`,
      );
    }
    console.error(
      'Replace the dependency, or, after reading its licence, record it in REVIEWED_OVERRIDES ' +
        'in scripts/third-party-notices.mjs (the owner approves commercial packages).',
    );
    return 1;
  }

  const rendered = renderNotices(data);
  if (check) {
    const committed = existsSync(OUTPUT_FILE) ? readText(OUTPUT_FILE) : '';
    if (committed !== rendered.replace(/\s+$/, '')) {
      console.error(
        'THIRD_PARTY_NOTICES.md is out of date. Run `pnpm licenses:notices` and commit it.',
      );
      return 1;
    }
    console.log(`THIRD_PARTY_NOTICES.md is up to date (${data.entries.length} packages).`);
    return 0;
  }
  writeFileSync(OUTPUT_FILE, rendered);
  console.log(`Wrote THIRD_PARTY_NOTICES.md (${data.entries.length} packages).`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
