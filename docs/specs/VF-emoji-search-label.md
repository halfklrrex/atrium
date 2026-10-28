# VF: emoji picker search shows its text twice

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Roadmap: VF "emoji picker search shows both a label and a placeholder" (3315259747) · Branch: `claude/fix-emoji-search-label`

- **Cause:** `EmojiPicker.tsx` gives the Vibe `TextField` `title="Search emoji"`. Vibe renders `title` as a visible `FieldLabel`, and the same text is also the placeholder, so it shows twice.
- **Fix:** drop `title`, pass `inputAriaLabel="Search emoji"` (a `TextField` prop in `@vibe/text-inputs`, `TextField.d.ts`; it becomes the input's `aria-label`). Keep the placeholder.
- **Verify:** the picker test finds `getByRole('textbox', { name: 'Search emoji' })`, and there is no `<label>` in the picker and no visible text node "Search emoji".
- **Visual:** `tests/visual` has `item-emoji-picker-{light,dark}`; the label disappears, so the Linux baselines need the "Update visual baselines" workflow on the PR.
