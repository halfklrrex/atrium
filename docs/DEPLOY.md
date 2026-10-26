# Deploying Atrium

Merging to `main` deploys to Firebase project `atrium-board` automatically. The workflow is `.github/workflows/deploy.yml`. It re-runs lint, typecheck, unit tests and build, signs in to Google Cloud with **Workload Identity Federation** (no JSON keys anywhere), then runs `pnpm exec firebase deploy --project atrium-board --non-interactive --force`.

Until you finish the one-time setup below, the workflow is harmless: it sees that the repo variable `GCP_WIF_PROVIDER` is empty, prints a notice and exits successfully without deploying.

## What you need

- The `gcloud` CLI, signed in as a project Owner of `atrium-board` (`gcloud auth login`).
- The `gh` CLI, signed in as an admin of `halfklrrex/atrium` (`gh auth login`).
- Known values used below: project `atrium-board`, project number `392437318549`, repo `halfklrrex/atrium`, compute default service account `392437318549-compute@developer.gserviceaccount.com`.

## How to run the commands

Every command below is a single line with the values filled in, so you can paste the blocks unchanged into Windows PowerShell or bash. There are no shell variables and no line continuations. Paste a block and let it finish before pasting the next. If a command fails, stop and read the error; do not carry on.

## 1. Enable the APIs the login needs

Workload Identity Federation uses the Security Token Service and IAM Credentials APIs. The Firebase CLI also calls Resource Manager and IAM while deploying.

```
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com --project=atrium-board
```

## 2. Create the deployer service account

```
gcloud iam service-accounts create github-deployer --display-name="GitHub Actions deployer" --project=atrium-board
```

This creates `github-deployer@atrium-board.iam.gserviceaccount.com`.

## 3. Grant it the roles a full `firebase deploy` needs

Project-level roles:

```
gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:github-deployer@atrium-board.iam.gserviceaccount.com" --role="roles/firebasehosting.admin" --condition=None
gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:github-deployer@atrium-board.iam.gserviceaccount.com" --role="roles/firebaserules.admin" --condition=None
gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:github-deployer@atrium-board.iam.gserviceaccount.com" --role="roles/datastore.indexAdmin" --condition=None
gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:github-deployer@atrium-board.iam.gserviceaccount.com" --role="roles/cloudfunctions.admin" --condition=None
gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:github-deployer@atrium-board.iam.gserviceaccount.com" --role="roles/run.admin" --condition=None
gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:github-deployer@atrium-board.iam.gserviceaccount.com" --role="roles/artifactregistry.admin" --condition=None
gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:github-deployer@atrium-board.iam.gserviceaccount.com" --role="roles/cloudbuild.builds.editor" --condition=None
gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:github-deployer@atrium-board.iam.gserviceaccount.com" --role="roles/serviceusage.serviceUsageConsumer" --condition=None
gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:github-deployer@atrium-board.iam.gserviceaccount.com" --role="roles/firebase.viewer" --condition=None
```

Permission to act as the runtime service account. Gen 2 functions run as the compute default service account, so the deployer must be allowed to "act as" it. This binding is on that one service account, not on the project:

```
gcloud iam service-accounts add-iam-policy-binding 392437318549-compute@developer.gserviceaccount.com --member="serviceAccount:github-deployer@atrium-board.iam.gserviceaccount.com" --role="roles/iam.serviceAccountUser" --project=atrium-board
```

The Firebase CLI also checks `actAs` on the App Engine default service account before deploying functions, even though Atrium's functions don't run as it. Confirmed on the first real deploy (2026-10-24), so this binding is required:

```
gcloud iam service-accounts add-iam-policy-binding atrium-board@appspot.gserviceaccount.com --member="serviceAccount:github-deployer@atrium-board.iam.gserviceaccount.com" --role="roles/iam.serviceAccountUser" --project=atrium-board
```

**Status:** this setup was completed on 2026-10-24 and the first deploy-on-merge run succeeded. The role list above is now verified for Hosting, Firestore rules and indexes, Storage rules and the callable function.

### Why each role

| Role                                             | Used for                                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `roles/firebasehosting.admin`                    | Create Hosting versions, upload files, release to the `atrium-workboards` and `atrium-board` sites                    |
| `roles/firebaserules.admin`                      | Release Firestore and Storage security rules (`firebaserules.*` permissions)                                          |
| `roles/datastore.indexAdmin`                     | Deploy `firestore.indexes.json`                                                                                       |
| `roles/cloudfunctions.admin`                     | Create and update Cloud Functions (including setting the public invoker binding on a new callable)                    |
| `roles/run.admin`                                | 2nd gen functions are Cloud Run services; the deploy updates the service and its IAM policy                           |
| `roles/artifactregistry.admin`                   | Function build images live in Artifact Registry; the `--force` flag also lets the deploy set the image cleanup policy |
| `roles/cloudbuild.builds.editor`                 | Start the Cloud Build job that builds each function                                                                   |
| `roles/serviceusage.serviceUsageConsumer`        | Use the project for API calls and check that required APIs are enabled                                                |
| `roles/firebase.viewer`                          | Read project metadata (default bucket, sites, web apps) that the CLI looks up before releasing                        |
| `roles/iam.serviceAccountUser` on the compute SA | Lets the deployer attach the runtime service account to a function (`iam.serviceAccounts.actAs`)                      |

### Sources and caveats

- Firebase documents that deploying functions needs both Cloud Functions Admin and Service Account User: https://firebase.google.com/docs/functions/manage-functions (delegating deployment).
- Firebase's own permission reference says Hosting access is controlled with Firebase Hosting Admin or Firebase Develop Admin, and lists the `firebaserules.*` permissions used for Firestore and Storage rules: https://firebase.google.com/docs/projects/iam/permissions
- The "acting as the default compute and App Engine service accounts" requirement for CI deploys, and the extra role `roles/cloudscheduler.admin` for scheduled functions, are described in community reports, for example https://github.com/Omega-JS-Stack/omega/issues/878.
- The role set for a Workload Identity Federation deploy (hosting admin, functions admin, Cloud Build editor, Service Account User on the runtime account) matches https://oneuptime.com/blog/post/2026-02-17-how-to-fix-firebase-deploy-failures-caused-by-workload-identity-federation-issues/view.
- Google does not publish one authoritative "minimum roles for `firebase deploy`" list. The list above was built from those sources and from what Atrium deploys today (Hosting, Firestore rules and indexes, Storage rules, one callable function). **It has not been exercised against a real deploy.** If the first run fails with a `403` or `Permission ... denied`, the error names the missing permission. Grant the role that contains it and re-run the workflow (step 7).
- `roles/firebase.admin` would cover most of the gaps in one go, but it is broader than this list, so only use it as a last resort.

### Roles to add later

Add these only when Atrium starts using the matching feature; a deploy that includes it will fail with a permission error until you do:

- Scheduled functions (`onSchedule`): `roles/cloudscheduler.admin`.
- Firestore, Storage or Auth event-triggered functions (Eventarc): `roles/eventarc.admin` plus the project setup in "Firestore-triggered functions" below.
- Functions that use secrets (`defineSecret`): `roles/secretmanager.admin` (or `roles/secretmanager.viewer` plus access on the specific secrets).

#### Firestore-triggered functions (Eventarc)

Needed before the first merge that deploys `onBoardColumnsWritten` (FW1), the first Firestore-triggered function. A 2nd-gen Firestore trigger is an Eventarc trigger on one database; Atrium's is the named database `atrium-1` (the trigger declares `database: FIRESTORE_DATABASE_ID`; without it the trigger would watch `(default)`). The deploy fails until the owner has run this once. All commands are single lines for `gcloud`, run as a project Owner. They are safe to repeat.

What was checked (firebase-tools 15.34.1 in this repo, `lib/deploy/functions/checkIam.js`, `prepare.js` and `services/firestore.js`; Eventarc access-control docs; role contents read with `gcloud iam roles describe`):

- On the first deploy that contains an event-triggered function, `firebase deploy` wants three **project-level** bindings: `roles/iam.serviceAccountTokenCreator` for the Pub/Sub service agent, and `roles/run.invoker` and `roles/eventarc.eventReceiver` for the runtime service account (the compute default one). If any is missing it tries to add it itself, which needs `resourcemanager.projects.setIamPolicy`. The `github-deployer` roles from step 3 don't include that (`roles/firebase.viewer` can read the policy but not set it), so the deploy would stop with "We failed to modify the IAM policy for the project". Granting the three bindings up front makes the deploy find nothing to change.
- Creating the Eventarc trigger runs as the deployer. `roles/eventarc.admin` contains `eventarc.triggers.create`, `eventarc.triggers.update` and `eventarc.triggers.get`. The deployer already has `roles/iam.serviceAccountUser` on the compute service account, which is the trigger's service account.
- The deploy also reads the Firestore database (`datastore.databases.getMetadata`, which `roles/firebase.viewer` has) and refuses a trigger whose region differs from the database. Atrium's database `atrium-1` is in `eur3`, so the Eventarc trigger is created in `eur3` and the function itself runs in `europe-west1` (firebase-tools maps `eur3` to `europe-west1`). Nothing to configure.
- Every 2nd-gen deploy already enables `eventarc.googleapis.com` and `pubsub.googleapis.com` and generates their service identities, so they are probably on already. The deployer can't enable APIs (no `serviceusage.services.enable`), so step 1 makes sure.

1. Enable the APIs (a no-op when they are already on):

```
gcloud services enable eventarc.googleapis.com pubsub.googleapis.com run.googleapis.com --project=atrium-board
```

2. Create the Pub/Sub and Eventarc service agents (a no-op when they exist; the bindings below need the Pub/Sub one to exist). The first command may offer to install the `beta` component of gcloud:

```
gcloud beta services identity create --service=pubsub.googleapis.com --project=atrium-board
gcloud beta services identity create --service=eventarc.googleapis.com --project=atrium-board
```

3. Let the deployer create Eventarc triggers:

```
gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:github-deployer@atrium-board.iam.gserviceaccount.com" --role="roles/eventarc.admin" --condition=None
```

4. Let the Pub/Sub service agent create tokens (`service-<project number>@gcp-sa-pubsub.iam.gserviceaccount.com`; Google grants it by default for projects that enabled Pub/Sub after 2021-04-08, so this is usually already there):

```
gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:service-392437318549@gcp-sa-pubsub.iam.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator" --condition=None
```

5. Let the runtime service account (the compute default one, which receives the events) receive Eventarc events and be invoked by Eventarc:

```
gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:392437318549-compute@developer.gserviceaccount.com" --role="roles/eventarc.eventReceiver" --condition=None
gcloud projects add-iam-policy-binding atrium-board --member="serviceAccount:392437318549-compute@developer.gserviceaccount.com" --role="roles/run.invoker" --condition=None
```

Check the result (read-only; each prints the roles the principal holds on the project, and the five roles above must show up across the three accounts):

```
gcloud projects get-iam-policy atrium-board --flatten="bindings[].members" --filter="bindings.members:github-deployer@atrium-board.iam.gserviceaccount.com AND bindings.role:roles/eventarc.admin" --format="value(bindings.role)"
gcloud projects get-iam-policy atrium-board --flatten="bindings[].members" --filter="bindings.members:gcp-sa-pubsub AND bindings.role:roles/iam.serviceAccountTokenCreator" --format="value(bindings.members)"
gcloud projects get-iam-policy atrium-board --flatten="bindings[].members" --filter="bindings.members:392437318549-compute@developer.gserviceaccount.com AND (bindings.role:roles/eventarc.eventReceiver OR bindings.role:roles/run.invoker)" --format="value(bindings.role)"
```

IAM changes can take a few minutes to propagate, so if the first deploy after this fails with a permission error, wait and re-run the workflow before changing anything. After the first successful deploy, the trigger also backfills `derivedColumnIds` on each board the next time that board is written. The owner runs the one-off backfill of all boards (`scripts/migrations/2026-10-backfill-derived-column-ids.mjs`, see `docs/architecture.md` section 6.2) after the deploy.

## 4. Create the Workload Identity pool and the GitHub provider

```
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions" --project=atrium-board
gcloud iam workload-identity-pools providers create-oidc github-actions --workload-identity-pool=github --location=global --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" --attribute-condition="assertion.repository=='halfklrrex/atrium'" --project=atrium-board
```

The attribute condition (`assertion.repository == "halfklrrex/atrium"`) makes the provider reject tokens from any other repository. It is written with single quotes inside the double quotes so it pastes the same way in PowerShell and bash.

Optional hardening: to also accept tokens only from the `main` branch, replace the condition with `"assertion.repository=='halfklrrex/atrium' && assertion.ref=='refs/heads/main'"` (use `providers update-oidc` instead of `create-oidc`). The workflow already refuses to deploy from any other branch, so this is a second lock, not a requirement.

## 5. Let the repo impersonate the service account

```
gcloud iam service-accounts add-iam-policy-binding github-deployer@atrium-board.iam.gserviceaccount.com --role="roles/iam.workloadIdentityUser" --member="principalSet://iam.googleapis.com/projects/392437318549/locations/global/workloadIdentityPools/github/attribute.repository/halfklrrex/atrium" --project=atrium-board
```

## 6. Set the two repo variables

These are repo **variables**, not secrets: neither value is sensitive.

```
gh variable set GCP_WIF_PROVIDER --repo halfklrrex/atrium --body "projects/392437318549/locations/global/workloadIdentityPools/github/providers/github-actions"
gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --repo halfklrrex/atrium --body "github-deployer@atrium-board.iam.gserviceaccount.com"
```

Check the provider path matches what Google has:

```
gcloud iam workload-identity-pools providers describe github-actions --workload-identity-pool=github --location=global --project=atrium-board --format="value(name)"
```

The printed name must equal the `GCP_WIF_PROVIDER` value above.

## 7. Try it

Run the workflow by hand from `main` and watch it:

```
gh workflow run deploy.yml --repo halfklrrex/atrium --ref main
gh run list --workflow=deploy.yml --repo halfklrrex/atrium --limit 3
gh run watch --repo halfklrrex/atrium
```

IAM changes can take a minute or two to propagate, so if the first run fails on authentication, wait and re-run before changing anything. From then on, every merge to `main` deploys.

## Day to day

- Merge a PR and the deploy starts by itself. Deploys run one at a time and a running deploy is never cancelled; later merges queue behind it.
- A broken `main` (failing lint, typecheck, tests or build) does not deploy.
- To roll back, revert the bad commit on `main` (the revert deploys), or for Hosting alone use the Firebase console's release history.
- A manual `pnpm exec firebase deploy --project atrium-board` from a laptop is for emergencies only, for example when the workflow is down and a fix must ship now. It deploys whatever is in that folder, merged or not, so check `git status` and the branch first.

## Storage & Signed URLs (P2 Files Column)

File access in Atrium is mediated via Cloud Functions generating short-lived V4 signed URLs (`requestFileUpload`, `getFileDownloadUrl`). To generate V4 signed URLs without external service account keys, the Cloud Functions runtime service account (`392437318549-compute@developer.gserviceaccount.com`) requires permission to sign blobs (`roles/iam.serviceAccountTokenCreator` on itself) and object administration on the Firebase Storage bucket only (`roles/storage.objectAdmin` on `gs://atrium-board.firebasestorage.app`, not on the project). Both granted by the owner on 2026-10-25.

```
gcloud iam service-accounts add-iam-policy-binding 392437318549-compute@developer.gserviceaccount.com --member="serviceAccount:392437318549-compute@developer.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator" --project=atrium-board
gcloud storage buckets add-iam-policy-binding gs://atrium-board.firebasestorage.app --member="serviceAccount:392437318549-compute@developer.gserviceaccount.com" --role="roles/storage.objectAdmin"
```

## Troubleshooting

| Symptom                                                                      | Likely cause and fix                                                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Run shows the notice "Deploy skipped ... GCP_WIF_PROVIDER is not set"        | Step 6 not done, or the variable was set on a different repo                                        |
| `Unable to acquire impersonated credentials` or `Permission denied` on login | Step 5 binding missing or the repo name in it is wrong; wait a minute for IAM to propagate          |
| `The given credential is rejected by the attribute condition`                | The token came from another repo or branch than the provider condition allows (step 4)              |
| `403` naming a permission during `firebase deploy`                           | A role is missing (step 3 and the sources above); grant the role that contains the named permission |
| `Caller does not have permission iam.serviceAccounts.actAs`                  | The `roles/iam.serviceAccountUser` binding on the compute service account is missing                |

## The Firestore database (`atrium-1`)

Atrium's data lives in the **named** Firestore database `atrium-1` (`eur3`, scheduled backups on), not in the project's `(default)` database (`nam5`, unused legacy, left untouched). The id comes from `FIRESTORE_DATABASE_ID` in `packages/shared/src/firebase-env.ts`; `firebase.json` repeats it, in the array form of `firestore`.

What a deploy does for it (read from firebase-tools 15.34.1: `firestore/fsConfig.js`, `deploy/functions/services/firestore.js`, `deploy/functions/triggerRegionHelper.js`, `deploy/functions/release/planner.js`):

- **Rules and indexes** are released to `atrium-1` only (`firebase.json` lists that one database). The deployer's roles (`roles/firebaserules.admin`, `roles/datastore.indexAdmin`) are project-level, so they cover named databases too. The database must already exist (the owner created it).
- **`onBoardColumnsWritten`** declares `database: FIRESTORE_DATABASE_ID`. The Cloud Function runs in `europe-west1`. firebase-tools looks the database up (`getDatabase`), takes its `locationId` (`eur3`) as the Eventarc trigger region and sends it to the Functions API as `triggerRegion: eur3`. It only refuses a trigger whose region was set explicitly and differs from the database location, and ours is not set.
- **First deploy after the switch:** the existing trigger was created for `(default)` in `nam5`, so its trigger region changes (`nam5` to `eur3`). `planner.js` (`changedTriggerRegion`) treats that as a change that needs a **delete and re-create** of the function. The deploy does it by itself; there is a short gap without the trigger. The old `(default)` database keeps no live trigger.
- The CI deploy command is unchanged (`firebase deploy --project atrium-board --non-interactive --force`).

`firebase deploy --only firestore --dry-run --project atrium-board` works with the array form: with `--debug` it shows the CLI reading `databases/atrium-1` (location `eur3`, backups on) and compiling `firestore.rules`, and it releases nothing. The function trigger part was confirmed from the source above, not by a deploy.

**Storage rules can't read this database.** `firestore.get()` / `firestore.exists()` in `storage.rules` only reach the `(default)` database; see `docs/architecture.md` section 2.1 for what that means for file uploads.

### Right after the merge (Ophelia, as lead)

The data in `atrium-1` starts empty. Once the deploy (rules, indexes, functions) has finished:

1. The owner signs in again. `bootstrapUser` creates the user and the first workspace in `atrium-1`.
2. Backfill `derivedColumnIds` (dry run first, then `--apply`): `pnpm exec tsx scripts/migrations/2026-10-backfill-derived-column-ids.mjs --project atrium-board`.
3. Re-seed the showcase with the new workspace id and owner uid (dry run first, then `--yes`): `pnpm showcase --project atrium-board --workspace <workspaceId> --owner <ownerUid>`.

Both scripts target `atrium-1` by default; `--database <id>` overrides it.
