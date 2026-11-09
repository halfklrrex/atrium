# PRIVACY-1: privacy notice and the complaints channel

Author: Ophelia (Opus 5.5) · Implementers: Sonnet 5.5 (medium effort) · Roadmap: "Privacy page P1: static notice" (plan item 8) · Plan: `docs/plans/2026-11-09-next-steps.md` ("Settings page and data protection") · Owner decisions: 2026-11-09 (below) · Related: `docs/specs/SETTINGS-1-page.md`, `docs/specs/GDPR-2-export-and-deletion.md`, `docs/specs/ADMIN-4-appeals-inbox.md` · Status: spec, nothing built

**Not legal advice.** This is a plain, honest description of what the app does, written for a private app used by the owner, family and friends. If Atrium ever opens to the public, have a lawyer check the notice, the controller question and the retention periods before that.

## Goal

1. A short privacy notice at a **public** route, `/privacy`, linked from the login page, About and Settings → Privacy and data.
2. A way to send a complaint or a data request from inside the app: a new **"Complaint or data request"** category in the Send feedback dialog, which arrives in the Site Admin Inbox with its own filter. The notice points to it.

## Owner decisions (2026-11-09, final)

1. **No named data controller and no contact page.** The owner does not expect outside users. The notice names no person and no email (also required by the privacy rule in `AGENTS.md`: the owner's name and email never go in the repository).
2. **Complaints and data requests go through the Inbox**: a new category in Send feedback, arriving in the Site Admin Inbox with a category filter. The notice stays short and points to it.
3. **Fonts are self-hosted** (done in `20f8d81`: no request goes to Google Fonts, a test enforces it), so the notice can describe the storage Atrium uses instead of showing a cookie banner.

## Facts this design rests on (checked against `main` at `88d648f`)

- **Inbox categories** are defined once, in `packages/shared/src/schemas/inbox.ts`: `inboxCategorySchema = z.enum(['bug', 'idea', 'question', 'other'])`, used by `inboxThreadSchema.category` (nullable; `null` for appeals) and by the `feedback` action of `sendInboxMessageRequestSchema` (`packages/shared/src/inbox.ts`). **The rules do not check `category`**: threads are created only by Functions (`allow create, delete: if false` on `inbox/{threadId}`). So adding a category changes no rules.
- **Labels** are in `apps/web/src/lib/inbox-sender.ts`: `FEEDBACK_CATEGORIES` (the dialog's radio buttons, in order) and `CATEGORY_LABELS` (used by `kindLabel` in `apps/web/src/pages/admin/inbox.ts`: "Feedback · Bug").
- **The dialog** is `apps/web/src/components/dialogs/FeedbackDialog.tsx` (`initialCategory` defaults to `idea`; opened with `openDialog({ type: 'feedback', category?, subject? })`).
- **The admin list** (`apps/web/src/pages/admin/InboxTab.tsx`, filters in `pages/admin/inbox.ts`) has status chips (Open, Answered, Closed, All) and kind chips (`INBOX_KIND_FILTERS`: All, Appeals, Feedback). The queries are in `apps/web/src/data/inbox.ts` (`inboxQueries.list(status, kind, count)`: `kind ==`, `status ==`, `orderBy lastMessageAt desc`). The composite indexes in `firestore.indexes.json` cover `status`, `kind` and `kind + status`, each with `lastMessageAt desc`.
- **Limits** (`functions/src/lib/inbox.ts`, `INBOX_LIMITS`): a feedback thread needs `threadsToday < 5` and fewer than 3 open or answered feedback threads of the sender (`findSenderThreads` with `kind: 'feedback'`); approved people only; 30 messages a day.
- **My feedback** (`/feedback`) lists the sender's threads with `senderUid ==`, `kind == 'feedback'`, so a complaint thread appears there with no change.
- **Routes:** `/login` is the only public route today (`App.tsx`); everything else is inside `RequireAuth`, which sends a signed-out visitor to `/login` with `state.from` and returns them after sign-in.
- **What the app really collects and where** (each line checked in the code):
  - Google sign-in: name, email, photo URL and the Firebase uid (`users/{uid}`, `bootstrapUser`). Firebase Authentication also keeps the account's creation and last sign-in times.
  - Member profiles (`workspaces/{ws}/members/{uid}`): name, photo and **email**, readable by every member of that workspace.
  - Content people create: workspaces, folders, boards, items and their values, updates and replies (with likes and mentions), descriptions, files and images in Cloud Storage, automations, dashboards, forms, templates, saved views.
  - The activity log: who changed what (actor name and photo copied in), kept 90 days (Firestore TTL on `expiresAt`).
  - Settings: theme, time zone, locale, notification switches, favourites, recently visited boards (`users/{uid}` and its subcollections).
  - Notifications (`users/{uid}/notifications`), deleted after 180 days (`NOTIFICATION_LIMITS.retentionDays`, the daily `purgeOldNotifications`).
  - Push (opt-in per device): the FCM token, the browser's user agent (at most 200 characters), the platform, created and last-seen times (`users/{uid}/pushTokens/{sha256}`). The notification text passes through Firebase Cloud Messaging and the browser's push service (Apple, Google, Mozilla or Microsoft, depending on the browser).
  - Inbox messages to the site admins: text, the sender's name, email and photo URL; closed threads are deleted 365 days after closing (`INBOX_LIMITS.retentionDays`, the daily purge).
  - Presence: while a board is open, the viewer's name and photo, expiring after an hour (TTL).
  - Trash: deleted boards and items are purged 30 days after deletion (`purgeTrash`, daily). Column-type backups expire after 30 days, automation run history after 30 days (TTL).
  - **Backups:** Firestore scheduled backups of `atrium-1` run daily and are kept **98 days** (`gcloud firestore backups schedules list --database=atrium-1`: `retention: 8467200s`, checked 2026-11-09).
  - **Logs:** Cloud Logging keeps Functions and request logs (which can include the uid and the IP address) for 30 days by default (the `_Default` bucket).
- **Processors and regions:** Firebase Authentication, Cloud Firestore (`eur3`, the Europe multi-region), Cloud Storage and Cloud Functions (`europe-west1`, Belgium), Firebase Hosting (Google's global CDN), Firebase Cloud Messaging; the browser push services above. **Profile photos load straight from Google's servers** (`lh3.googleusercontent.com`; `UserAvatar` and `Avatar` use the `photoURL` as the image source), so the browser contacts Google when it shows a photo. Google sign-in itself happens on Google's pages.
- **No analytics or tracking in the app.** `apps/web/src/lib/firebase.ts` says "Google Analytics is enabled on the project but deliberately NOT initialised here" (the config carries a `measurementId`, but nothing loads Analytics). See owner step 1.
- **Storage on the device** (all needed for the app to work; none is used for tracking):
  - Firebase Auth keeps the session in IndexedDB.
  - Firestore keeps an offline copy of the data the person opened (`persistentLocalCache` in `lib/firebase.ts`), which stays after sign-out today (SETTINGS-1 lists "clear on sign-out" first among the later settings).
  - localStorage: the theme (`atrium.theme`), the sidebar state, table and UI preferences (`atrium.table`, `atrium.ui`), the last view per board, recent emoji, editor style choices, the push marker.
  - sessionStorage: the one-shot "account was blocked" notice.
  - The service worker caches the app's files (PWA).

## Part 1: the "Complaint or data request" category

### Shared (`packages/shared`)

- `schemas/inbox.ts`: `inboxCategorySchema = z.enum(['bug', 'idea', 'question', 'other', 'complaint'])`. Add a doc comment: "`complaint`: a complaint or a data request (PRIVACY-1); exempt from the open-thread limit."
- `schemas/inbox.test.ts`, `inbox.test.ts`: the new value parses in a thread and in a `feedback` request.
- The notification kinds do not change: a complaint is an `inbox_new` like any feedback.

### Functions (`functions/src/lib/inbox.ts`)

- **A complaint is never blocked by the open-thread limit**: in the `feedback` branch, skip the `findSenderThreads(... 'feedback', OPEN_STATUSES ...)` check when `input.category === 'complaint'`. The daily cap (5 new threads a day), the 30 messages a day, the 200 per thread and approved-only all still apply. Other feedback keeps counting every open feedback thread, complaints included (simple, and complaints are rare).
- No other change: `category` is copied to the thread as today.
- Tests (`inbox.test.ts`): a sender with 3 open feedback threads can still send a complaint; the 6th new thread of the day is refused for a complaint too; a pending or blocked caller cannot send one.

### Web: the dialog

- `lib/inbox-sender.ts`: add `{ value: 'complaint', label: 'Complaint or data request' }` **last** in `FEEDBACK_CATEGORIES`, and `complaint: 'Complaint or data request'` in `CATEGORY_LABELS`. Add a short label map for chips and list rows, `CATEGORY_SHORT_LABELS` (`complaint: 'Complaint'`, the others unchanged), used where space is tight.
- `FeedbackDialog.tsx`: when the category is `complaint`, show a hint under the radio row: "For a complaint about how Atrium handles your data, or a request to see, correct or delete it. Only the site admins read it." and the subject placeholder "For example: Delete my data". The radio row wraps on phones (it already uses `styles.radioRow`; check at 375 px).
- A deep link for the notice: `/feedback?new=complaint` opens the dialog on that category (in `MyFeedbackPage.tsx`: read the parameter once, `openDialog({ type: 'feedback', category: 'complaint' })`, then remove the parameter with `replace`). Signed-out visitors go through the login page and come back (`RequireAuth` keeps `state.from`).
- `notification-filter.ts` and `NotificationCard.tsx`: no change (the card shows the subject).

### Web: the admin filter

- `pages/admin/inbox.ts`: the kind chips become **All, Appeals, Feedback, Complaints** (`INBOX_KIND_FILTERS` gains `'complaint'`, typed as a new `InboxSourceFilter = InboxKind | 'complaint' | 'all'`). `kindLabel` shows "Complaint" for `category == 'complaint'` (instead of "Feedback · Complaint or data request"). `emptyMessage` handles "complaints".
- `data/inbox.ts`: `inboxQueries.list(status, source, count)`: for `complaint`, `where('category', '==', 'complaint')` (plus `status ==` when set), `orderBy lastMessageAt desc`. Feedback keeps `kind == 'feedback'` and so still includes complaints (they are labelled), which keeps one query per chip.
- `InboxTab.tsx`: the new chip; complaint rows get a small "Complaint" label in the warning colour token so they stand out in the All list.
- `firestore.indexes.json` (two composites, `COLLECTION` scope): `inbox`: `category asc, lastMessageAt desc`; `inbox`: `category asc, status asc, lastMessageAt desc`.

## Part 2: the privacy notice

### Route and page

- `App.tsx`: `<Route path="/privacy" element={<PrivacyPage />} />` **outside** `RequireAuth`, next to `/login`. The page reads nothing from Firebase, so it works signed out, pending and blocked, and offline from the service worker cache.
- `apps/web/src/pages/privacy/PrivacyPage.tsx` (+ `Privacy.module.css`, test): the `BrandMark`, the title "Privacy", "Last updated: {date}", the sections below as headings and short paragraphs or lists, and at the bottom "Back to Atrium" (to `/`). Readable width (token), one column with the 16 px gutter on phones, safe-area padding, light and dark. Text in a plain TS module `privacy-content.ts` so it is easy to review and to update from later PRs.
- **Links to it:** the login page footer next to the source link ("Privacy"), the About dialog (a "Privacy" link next to Source code), Settings → Privacy and data (SETTINGS-1), and the public form page footer (`FormPage.tsx`) if it has a footer.
- The service worker's navigation fallback already serves `index.html` for any path; check that `/privacy` loads offline after one visit.

### Draft notice text

Keep it this short. Words in `{braces}` are filled by the implementer; the two sentences marked "after G1/G2" change when GDPR-2 lands.

> **Privacy**
>
> Last updated: {date of merge}
>
> **About Atrium.** Atrium is a private, non-commercial work-management app run by one person for family and friends. It is not a company and it does not sell anything. The people who run it are called "the site admins" below.
>
> **What Atrium stores**
>
> - **From your Google account**, when you sign in: your name, email address, profile photo link and an account id. Google tells us nothing else. We also keep when your account was created and when you last signed in.
> - **What you create**: workspaces, boards, items, updates, replies, likes, mentions, files and images, automations, dashboards, forms and views.
> - **A record of changes** on each board (who changed what), deleted after 90 days.
> - **Your settings**: theme, time zone, notification choices, favourite and recent boards, and the display name you choose.
> - **Notifications** sent to you, deleted after 180 days.
> - **Push notifications**, only if you turn them on for a device: a device token, the browser and device type.
> - **Messages you send to the site admins** (feedback, appeals, complaints): the text, your name, email and photo link. Closed conversations are deleted after a year.
>
> **Who can see it.** The members of a workspace see each other's name, photo and email address, and the boards they have access to. The site admins can see the list of accounts (name, email, status) and the messages you send them. Nobody else.
>
> **What Atrium does not do.** No ads, no analytics, no tracking, no selling or sharing of your data. Atrium sends no email.
>
> **Where it is kept.** On Google Cloud and Firebase, in Europe: the database in Google's Europe region (`eur3`), files and server code in Belgium (`europe-west1`). The app's pages are served from Google's worldwide network. Push notifications pass through Firebase Cloud Messaging and your browser's push service (for example Apple's or Google's). Profile photos load from Google's servers.
>
> **On your device.** Atrium uses your browser's storage only to work: to keep you signed in, to remember settings like the theme, and to keep a copy of the boards you opened so they load fast and work offline. There are no tracking cookies, so there is no cookie banner.
>
> **How long it is kept.** As long as your account exists, except: deleted items and boards are removed after 30 days, the change record after 90 days, notifications after 180 days, closed messages to the admins after a year. Daily backups keep a copy for up to 98 days, and server logs (which can include your account id and IP address) are kept for about 30 days.
>
> **Your choices.** You can see and change your settings in Settings. {Before G1/G2: "To get a copy of your data, or to delete your account,"} {after G1/G2: "Download your data or delete your account in Settings → Privacy and data. For anything else,"} send a message from **Send feedback → Complaint or data request** ({link to `/feedback?new=complaint`}). Only the site admins read it, and they will answer there. You can also complain to your country's data protection authority.
>
> **Changes.** If this notice changes, the date at the top changes too.

Implementation notes for the text:

- Link "Settings" and "Settings → Privacy and data" to `/settings/privacy` (they redirect to the login page for signed-out visitors).
- No person's name or email anywhere (owner decision 1 and `AGENTS.md`). The test below enforces it for the obvious patterns.
- Keep the retention numbers in one place: `privacy-content.ts` imports `NOTIFICATION_LIMITS.retentionDays`, `INBOX_LIMITS.retentionDays` and `ACTIVITY_LIMITS.retentionDays` from `@atrium/shared`, and a unit test fails if the text and the constants disagree. The 30 and 98-day figures are literals with a comment naming their source (`THIRTY_DAYS_MS` in `functions/src/lib/purge.ts`, the backup schedule above).

## Owner steps (production, the owner only; IAM and console settings are the owner's per `CLAUDE.md`)

1. **Unlink Google Analytics from the Firebase project** (Firebase console → Project settings → Integrations → Google Analytics → Unlink), so "no analytics" is true at the project level too, not just in the app. Optional but recommended. Then the `measurementId` line can be removed from `lib/firebase.ts` in a later PR.
2. Read the notice text on the live site once PR 3 is live and say if anything should change.

## Tests

- **Shared:** the category enum and the request schema accept `complaint`.
- **Functions:** the three limit cases above.
- **Web:** `FeedbackDialog.test.tsx` (the fifth radio, the hint, sending with `category: 'complaint'`); `MyFeedbackPage.test.tsx` (`?new=complaint` opens the dialog once and clears the parameter); `inbox.test.ts` in `pages/admin` (`kindLabel`, `emptyMessage`, the new filter); `InboxTab.test.tsx` (the chip calls the `category` query); `PrivacyPage.test.tsx` (renders signed out, every heading present, links to `/settings/privacy` and `/feedback?new=complaint`, retention numbers match the constants, no `@` character except in the link text guard and no email-like string); `LoginPage.test.tsx` and `AboutDialog.test.tsx` (the Privacy link).
- **Visual:** "privacy page" (desktop, light and dark) and `privacy` in `mobile-screens.ts`; the login, About and Feedback dialog baselines change (new link, new radio). Baselines through **Actions → Update visual baselines**.

## PR split and order

Own worktree and `ATRIUM_PORT_OFFSET` per branch (10, 20, 40, ...; not 30).

| #   | Branch                            | What                                                                                                                      | Hot spots                                                          | Depends on             |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------- |
| 1   | `claude/settings-spec`            | This spec                                                                                                                 | none                                                               | none                   |
| 2   | `claude/inbox-complaint-category` | Shared enum, the limit exemption, dialog option and hint, `?new=complaint`, labels, the two indexes                       | `packages/shared/**`, `firestore.indexes.json`, baselines (dialog) | none                   |
| 3   | `claude/privacy-page`             | `/privacy`, the text, links from login and About (and Settings if SETTINGS-1 PR 2 has merged; otherwise that PR links it) | baselines (login, About, new page)                                 | PR 2 deployed          |
| 4   | `claude/inbox-complaint-filter`   | The admin Complaints chip and query                                                                                       | baselines (admin Inbox)                                            | PR 2's indexes `READY` |

- PR 2 touches `packages/shared`: merge it in order with SETTINGS-1 PR 5 and the icon-set build; the later one rebases.
- PR 4 merges only after `gcloud firestore indexes composite list --database=atrium-1` shows the two new indexes `READY` (they deploy with PR 2).
- GDPR-2's PRs update the "Your choices" sentence when G1 and G2 go live (each in its own PR).

## What Ophelia (Opus) reviews

- The notice against the code, line by line (the "Facts" list above): every retention number, every processor, nothing promised that the app does not do.
- No name, email or account URL of the owner anywhere in the diff.
- The complaint exemption cannot be used to skip the daily cap.
- Tokens only, baselines through the workflow, visual QA of the page in light and dark on a phone width.

## Showcase, provenance, docs

- Showcase: no impact.
- Provenance: nothing copied.
- Docs: `docs/architecture.md` §8 ADMIN-4 paragraph mentions the `complaint` category and its exemption (PR 2); `HANDOFF.md` current state gets the privacy page (PR 3).

## Owner checks (production)

1. Signed out, open `https://atrium-workboards.web.app/privacy`: the notice shows without signing in, on a phone too. The login page and About have a "Privacy" link.
2. With the second account: Send feedback → "Complaint or data request" → send. Your bell shows it; `/admin` → Inbox → **Complaints** lists it. Reply; the second account sees the reply in My feedback.
3. With 3 open feedback threads on the second account, a complaint still goes through.

## Out of scope

- A named data controller, a postal address, a contact email or a data protection officer (owner decision 1).
- A cookie or consent banner (only strictly necessary storage).
- Download my data and Delete my account (GDPR-2).
- Translations.

## Risks

- **The notice drifts from the code.** Mitigations: retention numbers tied to the shared constants by a test; GDPR-2 updates the "Your choices" sentence; reviewers check the "Facts" list when a PR adds a collection or a processor.
- **Complaints are only for approved accounts.** A pending or blocked person cannot use Send feedback (see open question 1).

## Open questions (recommended defaults)

1. People still waiting for approval (pending) have no in-app way to send a complaint or a data request, and blocked people only have the appeal box. **Default: accept for now.** Pending accounts hold only their Google profile, the owner sees them in `/admin` and can refuse them; a blocked person can write the request in their appeal. Revisit if the app ever opens to the public.
2. Should complaint threads follow the normal 365-day deletion after closing? **Default: yes** (keeping records of requests longer is a legal question for later, if ever).

## Acceptance checks

- [ ] `inboxCategorySchema` includes `complaint`; the rules are unchanged (no rules diff in PR 2).
- [ ] A complaint is accepted with 3 open feedback threads; the daily cap still refuses the 6th thread.
- [ ] The dialog shows "Complaint or data request" last, with its hint; `/feedback?new=complaint` opens it once.
- [ ] `/admin` → Inbox has a Complaints chip backed by the two new indexes; complaint rows are labelled "Complaint".
- [ ] `/privacy` renders signed out and offline, is linked from login, About and Settings, has no person's name or email, and its retention numbers match the code.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build` pass; baselines updated through the workflow.
