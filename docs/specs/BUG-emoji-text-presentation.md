# BUG: some emoji render as monochrome text glyphs on Windows

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Reported by the owner (relaxed face, frowning face, skull and crossbones, heavy heart exclamation, heart, shamrock, several Travel and Symbols emoji, all flags) · Branch: `claude/fix-emoji-text-presentation`

- **Cause:** `@tiptap/extension-emoji` data holds 170 emoji as one code point without U+FE0F (for example `263a`, `2620`, `2763`, `2764`, `2618`, `2708`, `2693`, `26a0`). They default to text presentation, so Windows draws them as monochrome text glyphs. The picker grid, search and the inserted node all read `emoji-data.ts`.
- **Fix:** `emoji-data.ts` appends U+FE0F to any lone code point that has `\p{Emoji}` but not `\p{Emoji_Presentation}` (`asEmojiPresentation`). Documents store the emoji _name_, so existing descriptions are fixed too.
- **Not fixed here, flags:** Windows ships no flag glyphs, so flags show as two letters. A fix needs picture fallbacks (the extension's `fallbackImage`, a third-party CDN), which `emoji-data.ts` deliberately removes. Owner decision pending.
- **Verify:** unit tests (the five named emoji end in U+FE0F, no bare text-default code point is left, sequences and already-coloured emoji untouched); visual check of the Travel and Symbols tabs on Windows.
- **Visual:** the emoji picker baselines may change; run the "Update visual baselines" workflow on the PR.
