// One-off, idempotent migration (ADMIN-1a, docs/specs/ADMIN-site-admin-role.md): approves every
// EXISTING account before the site-admin gate ships, so nobody is locked out.
//
// For every Firebase Auth user it sets the custom claim `acct: 'approved'` (all other custom claims,
// such as `admin`, are kept) and, when `users/{uid}` exists, `accountStatus: 'approved'`,
// `statusChangedAt` (server time) and `statusChangedBy: 'system:backfill'`.
//
//   Dry run (default, writes nothing):
//     Emulator:    pnpm exec tsx scripts/migrations/2026-11-backfill-account-claims.mjs
//     Production:  pnpm exec tsx scripts/migrations/2026-11-backfill-account-claims.mjs --project atrium-board
//   Apply:         add --apply (to either)
//
// Safety:
// - Dry run reports counts and the uids that would change. It never prints emails or names.
// - Idempotent: a user that already has the claim and (if it has a profile) the status is skipped, so
//   the second dry run must report 0 to change.
// - A user whose claim or profile status is `blocked` is never unblocked: it is reported and skipped.
// - A user without a `users/{uid}` document only gets the claim (the document is created, as pending
//   or approved, by `bootstrapUser`; this script never creates documents).
// - Pages through all users (1000 per page).
//
// Auth runs over the Identity Toolkit REST API and Firestore over its REST API, authenticated like
// scripts/showcase: the emulators' bypass token, or `gcloud auth print-access-token` for production
// (with the `x-goog-user-project` quota header). See scripts/auth-rest.mjs for the endpoints.
// Run it through tsx (it imports the TypeScript in @atrium/shared).
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FIRESTORE_DATABASE_ID, isAdminClaims, mergeAccountClaims } from '@atrium/shared';
import { createAuthClient } from '../auth-rest.mjs';
import { SeedError, createClient, gcloudAccessToken } from '../showcase/seed-showcase.mjs';

export const CHANGED_BY = 'system:backfill';
const MAX_ATTEMPTS = 5;

const HELP = `Approve every existing account (ADMIN-1a): custom claim acct=approved and users/{uid}.accountStatus.
Dry run unless --apply is given.

Targets:
  (no flag)                Auth and Firestore emulators: FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST,
                           else this copy's ports
  --project <id>           Production, authenticated with \`gcloud auth print-access-token\`
  --database <id>          Firestore database id (default: Atrium's named database)

Options:
  --apply                  Write the claims and statuses (without it nothing is written)
  --no-quota-project       Do not send x-goog-user-project (production only)
  --help
`;

export function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string' },
      database: { type: 'string' },
      apply: { type: 'boolean', default: false },
      'no-quota-project': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  return values;
}

export function resolveOptions(values) {
  if (values.project && !/^[a-z][a-z0-9-]{4,29}$/.test(values.project)) {
    throw new SeedError(`"${values.project}" is not a valid Firebase project id.`);
  }
  if (values.database !== undefined && !/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(values.database)) {
    throw new SeedError(`"${values.database}" is not a valid Firestore database id.`);
  }
  const production = Boolean(values.project);
  return {
    target: production ? 'production' : 'emulator',
    project: values.project ?? 'atrium-board',
    database: values.database ?? FIRESTORE_DATABASE_ID,
    apply: values.apply,
    quotaProject: production && !values['no-quota-project'] ? values.project : undefined,
  };
}

/**
 * Pure: what one user needs. `profile` is the decoded `users/{uid}` document or `null`.
 * @returns {{ action: 'skip'|'blocked'|'change', claim: boolean, doc: boolean }}
 */
export function planUser(customClaims, profile) {
  const acct = customClaims?.acct;
  if (acct === 'blocked' || profile?.accountStatus === 'blocked') {
    return { action: 'blocked', claim: false, doc: false };
  }
  const claim = acct !== 'approved';
  const doc = profile !== null && profile !== undefined && profile.accountStatus !== 'approved';
  return { action: claim || doc ? 'change' : 'skip', claim, doc };
}

const isConflict = (error) => error?.status === 409 || error?.status === 400;

/** Approve (or, in a dry run, count) every Auth user. */
export async function runBackfill({ auth, db, apply = false, log = console.log }) {
  log(`${apply ? '' : 'Dry run: '}account claims backfill -> ${auth.describe}`);
  const counts = { scanned: 0, toChange: 0, changed: 0, skipped: 0, blocked: 0, noProfile: 0 };
  const toChange = [];
  const blocked = [];

  let pageToken;
  do {
    const page = await auth.listUsers(pageToken);
    for (const user of page.users) {
      counts.scanned += 1;
      let attempt = 0;
      for (;;) {
        attempt += 1;
        const meta = await db.getDocMeta(`users/${user.uid}`);
        const plan = planUser(user.customClaims, meta?.data ?? null);
        if (meta === null) counts.noProfile += 1;
        if (plan.action === 'blocked') {
          counts.blocked += 1;
          blocked.push(user.uid);
        } else if (plan.action === 'skip') {
          counts.skipped += 1;
        } else {
          counts.toChange += 1;
          toChange.push(user.uid);
          if (apply) {
            if (plan.claim) {
              // Keep every other claim (e.g. `admin`); only `acct` is set.
              await auth.setCustomClaims(
                user.uid,
                mergeAccountClaims(user.customClaims, 'approved', isAdminClaims(user.customClaims)),
              );
            }
            if (plan.doc) {
              try {
                await db.commit([
                  {
                    op: 'update',
                    path: `users/${user.uid}`,
                    set: { accountStatus: 'approved', statusChangedBy: CHANGED_BY },
                    serverTimestamp: ['statusChangedAt'],
                    precondition: { updateTime: meta.updateTime },
                  },
                ]);
              } catch (error) {
                if (!isConflict(error) || attempt >= MAX_ATTEMPTS) throw error;
                // The profile changed meanwhile: forget this attempt's count and plan again.
                counts.toChange -= 1;
                toChange.pop();
                if (meta === null) counts.noProfile -= 1;
                continue;
              }
            }
            counts.changed += 1;
          }
        }
        break;
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  log(`  accounts   ${counts.scanned} scanned`);
  log(`  to change  ${counts.toChange}  (already approved: ${counts.skipped})`);
  if (counts.noProfile > 0) {
    log(`  no profile ${counts.noProfile} without a users document (claim only)`);
  }
  if (counts.blocked > 0) {
    log(`  blocked    ${counts.blocked} left alone: ${blocked.join(', ')}`);
  }
  if (!apply) {
    if (toChange.length > 0) {
      log(`  uids       ${toChange.join(', ')}`);
      log('Nothing was written. Run again with --apply to approve these accounts.');
    } else {
      log('Nothing to do.');
    }
    return { ...counts, applied: false, uids: toChange, blockedUids: blocked };
  }
  log(counts.changed === 0 ? 'Nothing to do.' : `Done: approved ${counts.changed} accounts.`);
  return { ...counts, applied: true, uids: toChange, blockedUids: blocked };
}

export async function main(argv = process.argv.slice(2)) {
  const values = parseCliArgs(argv[0] === '--' ? argv.slice(1) : argv);
  if (values.help) {
    console.log(HELP);
    return;
  }
  const options = resolveOptions(values);
  await runBackfill({
    auth: createAuthClient(options, { getToken: gcloudAccessToken }),
    db: createClient(options),
    apply: options.apply,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    if (error instanceof SeedError) console.error(error.message);
    else console.error(error);
    process.exit(1);
  });
}
