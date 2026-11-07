// ADMIN-4 guard: every callable goes through `actorFromRequest`, which refuses accounts that are not
// approved. This fails when a callable file reads `request.auth` itself, does not call
// `actorFromRequest(`, or opts out with an `allow:` option outside the allowlist below.
// Spec: docs/specs/ADMIN-4-appeals-inbox.md, section "Central approved only check for callables".
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CALLABLE_DIR = dirname(fileURLToPath(import.meta.url));

/** Callables that may read `request.auth` directly and skip the default approved-only check. */
const MAY_READ_REQUEST_AUTH: ReadonlySet<string> = new Set(['bootstrapUser.ts']);
/** Callables that may pass an `allow:` option (the opt-outs). `sendInboxMessage.ts` arrives in PR4. */
const MAY_PASS_ALLOW: ReadonlySet<string> = new Set(['bootstrapUser.ts', 'sendInboxMessage.ts']);
/** Callables that need not call `actorFromRequest(` (none: bootstrapUser calls it with `allow`). */
const MAY_SKIP_ACTOR: ReadonlySet<string> = new Set();

const SEE = 'See docs/specs/ADMIN-4-appeals-inbox.md, "Central approved only check for callables".';

/** Removes comments so a mention in prose neither hides nor triggers a violation. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** The problems with one callable file; empty when it follows the rules. */
export function callableViolations(file: string, rawSource: string): string[] {
  const source = stripComments(rawSource);
  const problems: string[] = [];
  if (/\brequest\s*\??\.\s*auth\b/.test(source) && !MAY_READ_REQUEST_AUTH.has(file)) {
    problems.push(`${file} reads request.auth; use actorFromRequest(request) instead.`);
  }
  if (!/\bactorFromRequest\s*\(/.test(source) && !MAY_SKIP_ACTOR.has(file)) {
    problems.push(`${file} does not call actorFromRequest(.`);
  }
  if (/\ballow\s*:/.test(source) && !MAY_PASS_ALLOW.has(file)) {
    problems.push(`${file} passes an allow: option; only ${[...MAY_PASS_ALLOW].join(', ')} may.`);
  }
  return problems;
}

const callableFiles = readdirSync(CALLABLE_DIR).filter(
  (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
);

describe('callables are approved-only by default', () => {
  it('finds the callables', () => {
    expect(callableFiles.length).toBeGreaterThan(30);
    expect(callableFiles).toContain('bootstrapUser.ts');
  });

  it('every callable goes through actorFromRequest and opts out only from the allowlist', () => {
    const problems = callableFiles.flatMap((file) =>
      callableViolations(file, readFileSync(join(CALLABLE_DIR, file), 'utf8')),
    );
    expect(problems, `${problems.join('\n')}\n${SEE}`).toEqual([]);
  });

  it('bootstrapUser stays the only direct request.auth reader and opts out explicitly', () => {
    const source = stripComments(readFileSync(join(CALLABLE_DIR, 'bootstrapUser.ts'), 'utf8'));
    expect(source).toMatch(/actorFromRequest\s*\(\s*request\s*,\s*\{\s*allow\s*:/);
  });

  describe('the checker itself', () => {
    const good = `export const x = onCall(async (request) => { const a = actorFromRequest(request); });`;
    it('accepts a normal callable', () => {
      expect(callableViolations('newThing.ts', good)).toEqual([]);
    });
    it('flags request.auth', () => {
      expect(
        callableViolations('newThing.ts', `${good}\nconst u = request.auth?.uid;`).length,
      ).toBe(1);
      expect(
        callableViolations('newThing.ts', `onCall(async (request) => request.auth.uid)`),
      ).toHaveLength(2);
    });
    it('flags a missing actorFromRequest call', () => {
      expect(callableViolations('newThing.ts', `onCall(async () => 1)`)).toEqual([
        expect.stringContaining('does not call actorFromRequest('),
      ]);
    });
    it('flags an allow option outside the allowlist, but not in comments', () => {
      expect(
        callableViolations('newThing.ts', `actorFromRequest(request, { allow: ['blocked'] });`),
      ).toHaveLength(1);
      expect(
        callableViolations(
          'sendInboxMessage.ts',
          `actorFromRequest(request, { allow: ['blocked'] });`,
        ),
      ).toEqual([]);
      expect(
        callableViolations('newThing.ts', `${good}\n// allow: and request.auth are fine here`),
      ).toEqual([]);
    });
  });
});
