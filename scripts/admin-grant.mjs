// Grants the site-admin role (ADMIN-1a, docs/specs/ADMIN-site-admin-role.md): sets the custom claim
// `admin: true` on one Auth user, plus `acct: 'approved'` (an admin is always approved). All other
// custom claims are kept. Dry run unless --apply is given. Idempotent.
//
//   pnpm admin:grant --uid <uid>                              dry run against the emulator
//   pnpm admin:grant --uid <uid> --apply                      apply against the emulator
//   pnpm admin:grant --uid <uid> --project atrium-board       dry run against production
//   pnpm admin:grant --uid <uid> --project atrium-board --apply
//
// Never put a real uid in code or docs: pass it on the command line (it stays in
// .private/project-ids.md). A blocked account is refused. The user has to sign in again, or refresh
// its ID token, before the new claim shows up in its token.
// Auth goes over the Identity Toolkit REST API (see scripts/auth-rest.mjs); run through tsx.
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ACCOUNT_CLAIM, ADMIN_CLAIM, mergeAccountClaims } from '@atrium/shared';
import { createAuthClient } from './auth-rest.mjs';
import { SeedError, gcloudAccessToken } from './showcase/seed-showcase.mjs';

const HELP = `Grant the site-admin role: custom claims admin=true and acct=approved. Dry run unless --apply is given.

  --uid <uid>              The Auth user to make an admin (required)
  --project <id>           Production, authenticated with \`gcloud auth print-access-token\`
                           (default: the Auth emulator)
  --apply                  Write the claims
  --no-quota-project       Do not send x-goog-user-project (production only)
  --help
`;

export function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      uid: { type: 'string' },
      project: { type: 'string' },
      apply: { type: 'boolean', default: false },
      'no-quota-project': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  return values;
}

export function resolveOptions(values) {
  if (!values.uid || !/^[A-Za-z0-9_:-]{1,128}$/.test(values.uid)) {
    throw new SeedError('Pass --uid <uid> (letters, digits, "-", "_" or ":", at most 128).');
  }
  if (values.project && !/^[a-z][a-z0-9-]{4,29}$/.test(values.project)) {
    throw new SeedError(`"${values.project}" is not a valid Firebase project id.`);
  }
  const production = Boolean(values.project);
  return {
    uid: values.uid,
    target: production ? 'production' : 'emulator',
    project: values.project ?? 'atrium-board',
    apply: values.apply,
    quotaProject: production && !values['no-quota-project'] ? values.project : undefined,
  };
}

/** Grant admin to one user; returns `{ uid, changed, applied, claims }`. */
export async function runGrant({ auth, uid, apply = false, log = console.log }) {
  log(`${apply ? '' : 'Dry run: '}admin grant -> ${auth.describe}`);
  const user = await auth.getUser(uid);
  if (!user) throw new SeedError(`No Auth user with uid "${uid}" in ${auth.describe}.`);
  if (user.customClaims?.[ACCOUNT_CLAIM] === 'blocked') {
    throw new SeedError(`User "${uid}" is blocked. Unblock the account before making it an admin.`);
  }
  const claims = mergeAccountClaims(user.customClaims, 'approved', true);
  const changed =
    user.customClaims?.[ADMIN_CLAIM] !== true || user.customClaims?.[ACCOUNT_CLAIM] !== 'approved';
  log(`  user       ${uid}`);
  if (!changed) {
    log('  already an approved admin: nothing to do.');
    return { uid, changed: false, applied: false, claims };
  }
  if (!apply) {
    log('Nothing was written. Run again with --apply to grant the admin role.');
    return { uid, changed: true, applied: false, claims };
  }
  await auth.setCustomClaims(uid, claims);
  log('Done: admin role granted. The user must sign in again (or refresh the token) to use it.');
  return { uid, changed: true, applied: true, claims };
}

export async function main(argv = process.argv.slice(2)) {
  const values = parseCliArgs(argv[0] === '--' ? argv.slice(1) : argv);
  if (values.help) {
    console.log(HELP);
    return;
  }
  const options = resolveOptions(values);
  await runGrant({
    auth: createAuthClient(options, { getToken: gcloudAccessToken }),
    uid: options.uid,
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
