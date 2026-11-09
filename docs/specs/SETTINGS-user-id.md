# SETTINGS: show the user ID in Settings > Profile

**Owner request (2026-11-09):** a small area in Settings that shows the user ID (needed for `ATRIUM_USER_UID` when registering the MCP connector, see `docs/mcp-connector.md`).

## Design

In `apps/web/src/pages/settings/ProfileTab.tsx` add a small section after the profile card, titled "User ID":

- the uid in a read-only, monospace, selectable element (token-only styling, `word-break: break-all`, fits 360 px wide);
- a "Copy" `Button` (kind tertiary) that calls `navigator.clipboard.writeText(uid)` and shows `showToast('User ID copied.')`; on failure `showToast("Couldn't copy. Select the ID and copy it by hand.", { type: 'negative' })`. Follow the existing copy pattern in `ItemView.tsx` (~line 158);
- a one-line hint: "Your account's unique ID. You need it to connect tools such as the Atrium MCP connector. It isn't secret on its own, but there's no reason to post it publicly." Link the hint text to `docs/mcp-connector.md` only if a docs link pattern exists in Settings; otherwise plain text.

No data, rules or schema change. The uid is already in the auth user object (`useAuth().user.uid`).

## Tests

`ProfileTab.test.tsx`: shows the uid, Copy writes it to the clipboard mock and toasts, a failing clipboard toasts the error. Add the section to the existing Settings visual screens only if those baselines already capture the Profile tab (then run the **Update visual baselines** workflow).

## Work split

Tiny: one Sonnet 5.5 subagent (medium), branch `claude/settings-user-id`, own port offset. Can be done together with or before the slug work; no shared files.
