// Backfills `workspaces/{id}/members/{uid}` profile docs for workspaces that existed before P4a.
//
//   Emulator:    pnpm exec tsx scripts/backfill-members.mjs [--workspace <id>] [--yes]
//   Production:  pnpm exec tsx scripts/backfill-members.mjs --project atrium-board [--workspace <id>] --yes
//                (authenticates with `gcloud`; run it from a signed-in terminal, owner or lead only)
//
// DRY RUN BY DEFAULT: without `--yes` nothing is written, the plan is only printed.
//
// For every member of every workspace (the keys of `roles`) it
//   - creates the member doc when it is missing, copying `displayName`, `email` and `photoURL`
//     from `users/{uid}` (`joinedAt` = the workspace's creation time) and the role from `roles`;
//   - fixes the `role` display copy when it differs from `roles[uid]`.
// It never deletes anything and never touches a doc that is already correct, so it is safe to re-run.
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { createClient, emulatorHost, SeedError } from './showcase/seed-showcase.mjs';

const BATCH_SIZE = 400;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

/** The member doc a user's `users/{uid}` profile and workspace role imply. */
export function buildMemberDoc({ user, role, joinedAt, now }) {
  const email = text(user?.email, 320).toLowerCase();
  return {
    displayName: text(user?.displayName, 200) || email,
    photoURL: typeof user?.photoURL === 'string' && user.photoURL ? user.photoURL : null,
    email,
    role,
    joinedAt: joinedAt ?? now,
    updatedAt: now,
  };
}

/**
 * What to write for one workspace: `create` the missing member docs, `fixRole` the ones whose role
 * copy is stale. `users` maps uid -> profile (or undefined when the user doc is gone).
 */
export function planWorkspace({ workspace, members, users, now }) {
  const creates = [];
  const fixes = [];
  for (const [uid, role] of Object.entries(workspace.roles ?? {})) {
    const existing = members.get(uid);
    if (!existing) {
      creates.push({
        uid,
        data: buildMemberDoc({
          user: users.get(uid),
          role,
          joinedAt: workspace.createdAt instanceof Date ? workspace.createdAt : undefined,
          now,
        }),
      });
    } else if (existing.role !== role) {
      fixes.push({ uid, from: existing.role ?? null, to: role });
    }
  }
  return { creates, fixes };
}

export async function runBackfill({
  client,
  workspaceId,
  dryRun = true,
  now = new Date(),
  log = console.log,
}) {
  const workspaces = workspaceId
    ? await client.getDoc(`workspaces/${workspaceId}`).then((data) => {
        if (!data) throw new SeedError(`Workspace "${workspaceId}" does not exist.`);
        return [{ id: workspaceId, data }];
      })
    : await client.listAllDocs('workspaces');

  const summary = { workspaces: 0, created: 0, fixed: 0, unchanged: 0 };
  const writes = [];
  const users = new Map();
  for (const { id, data: workspace } of workspaces) {
    const memberDocs = await client.listAllDocs(`workspaces/${id}/members`);
    const members = new Map(memberDocs.map((d) => [d.id, d.data]));
    for (const uid of Object.keys(workspace.roles ?? {})) {
      if (!members.has(uid) && !users.has(uid)) {
        users.set(uid, (await client.getDoc(`users/${uid}`)) ?? undefined);
      }
    }
    const { creates, fixes } = planWorkspace({ workspace, members, users, now });
    summary.workspaces += 1;
    summary.created += creates.length;
    summary.fixed += fixes.length;
    summary.unchanged += Object.keys(workspace.roles ?? {}).length - creates.length - fixes.length;
    for (const c of creates) {
      log(`  workspaces/${id}/members/${c.uid}: create (${c.data.role})`);
      writes.push({ op: 'set', path: `workspaces/${id}/members/${c.uid}`, data: c.data });
    }
    for (const f of fixes) {
      log(`  workspaces/${id}/members/${f.uid}: role ${f.from ?? 'unset'} -> ${f.to}`);
      writes.push({
        op: 'patch',
        path: `workspaces/${id}/members/${f.uid}`,
        data: { role: f.to, updatedAt: now },
      });
    }
  }

  if (!dryRun) {
    for (let i = 0; i < writes.length; i += BATCH_SIZE) {
      await client.commit(writes.slice(i, i + BATCH_SIZE));
    }
  }
  log(
    `${dryRun ? 'Dry run: would create' : 'Created'} ${summary.created} member docs and fix ` +
      `${summary.fixed} roles in ${summary.workspaces} workspaces ` +
      `(${summary.unchanged} already correct) -> ${client.describe}`,
  );
  return summary;
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv[0] === '--' ? argv.slice(1) : argv,
    options: {
      project: { type: 'string' },
      database: { type: 'string' },
      workspace: { type: 'string' },
      yes: { type: 'boolean', default: false },
      'no-quota-project': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  if (values.workspace !== undefined && !ID_PATTERN.test(values.workspace)) {
    throw new SeedError('--workspace must be a plain id.');
  }
  const production = Boolean(values.project);
  if (production && !/^[a-z][a-z0-9-]{4,29}$/.test(values.project)) {
    throw new SeedError(`"${values.project}" is not a valid Firebase project id.`);
  }
  if (!production) emulatorHost(); // refuses a non-local emulator host
  const client = createClient({
    target: production ? 'production' : 'emulator',
    project: values.project ?? 'atrium-board',
    database: values.database ?? FIRESTORE_DATABASE_ID,
    quotaProject: production && !values['no-quota-project'] ? values.project : undefined,
  });
  const dryRun = !values.yes;
  await runBackfill({ client, workspaceId: values.workspace, dryRun });
  if (dryRun) console.log('\nThis was a dry run. Add --yes to write.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof SeedError ? `Error: ${error.message}` : error);
    process.exit(1);
  });
}
