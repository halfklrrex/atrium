# 2026-11-17 · Claude (Sonnet subagent) · Docs editor PR 3: conflicts and presence

Branch `claude/docs-3-conflicts`, spec `docs/specs/P7-docs-editor.md` (PR 3 section).

## Done

- `use-doc-body.ts`: `baseRev`/`dirty` plus a `conflict` state. A newer snapshot while dirty, or a refused save confirmed against the server, stops autosaving and shows `ConflictBanner` (Load their version, Keep mine with a "Their changes will be lost." confirm, Copy my text). Nothing merges automatically; `save` throws `DocConflictError` while the banner is up.
- Robust detection: `isRevConflict` only means "the rules said no". After a refusal the hook re-reads the body with `getDocFromServer` (`docWrites.readBodyFromServer`): a stored rev newer than the save's base is a conflict; otherwise (lost role, trashed doc) a "can't save" toast and autosave stops; an unreachable server gives a plain "Could not save" toast and keeps retrying on the next edit.
- Doc presence: rules `docs/{docId}/presence/{uid}` (same shape as board presence, role from the doc, `exists()` guarded), `tests/rules/src/docs-presence.test.ts`; `data/presence.ts` generalized (`useDocPresence`, `writeDocPresence`, `deleteDocPresence`); `PresenceAvatars` takes `docId`; avatars in the doc page header. Tooltip reads "Here now: ..." (presence doesn't know who is typing).
- `RichDocEditor` gained `onEditor` so the page can read the live content for Keep mine and Copy my text.
- Visual: `doc-conflict-banner-{theme}` (seed `saveDocElsewhere`).

## Gotchas

- Board and doc presence heartbeats are denied with an "evaluation error" in the local emulator sign-in (a token without `name`/`picture` claims); board presence does the same on main. Production Google tokens carry them. Not changed here.
- The 500 KB size refusal was already in `buildDocValue` (PR 2); a DocPage test covers it now.
