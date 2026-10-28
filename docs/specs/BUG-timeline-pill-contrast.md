# BUG: timeline pill label is unreadable past the progress fill

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Roadmap: 🐞 "Timeline pill: label is unreadable past the progress fill" (3315174221) · Branch `claude/fix-timeline-pill-contrast`

## Cause

Found in the live check of PR #25 on the showcase board. With `settings.showProgress`, `.timelinePillProgress` (`apps/web/src/columns/cells.module.css`) paints the unfilled track with `var(--dark-background-color)`. Despite its name, that Vibe token is `#F6F7FB` in the light theme. The label is white (`--atrium-table-on-fill`), so past the group-colour fill the text is about 1.1:1 against the track and disappears ("Oct", "Oct 2").

## Fix

1. Add a named track token to `apps/web/src/theme/table-tokens.css`: `--atrium-timeline-track`, a dark neutral, defined for light **and** dark themes (and any other theme block that file defines). monday's pill shows white text on a dark grey track. Start from `#333333` in light and a mid-dark grey in dark that still reads as a track on the dark table background, and tune until the test in step 3 passes.
2. Use it in `.timelinePillProgress` instead of `--dark-background-color`. Nothing else in the pill changes.
3. Add a contrast test next to the existing theme token tests (follow `editor-tokens.test.ts`): white (`--atrium-table-on-fill`) on `--atrium-timeline-track` is at least 4.5:1 in every theme.

## Verify

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. No visual baselines are expected to change unless a visual screen shows a progress timeline; if one does, say which.
