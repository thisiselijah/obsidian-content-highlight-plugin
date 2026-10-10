# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Obsidian plugin "Content Highlight" (plugin id `content-highlight`), a fork of chetachi's Highlightr plugin. It adds multi-color highlighting using native-Markdown-style syntax: `==text=={ColorName}`. A bare `==text==` is Obsidian's native highlight.

## Commands

- `npm run dev`: Rollup watch build
- `npm run build`: one-off build, outputs `main.js` at the repo root

There is no test suite, linter script, or typecheck script. `.stylelintrc.json` exists but stylelint is not a dependency. Run `npx tsc --noEmit` for a typecheck.

If `PLUGIN_DEST` is set (it lives in the git-ignored `.env`; export it in your shell, since Rollup does not load `.env`), Rollup also writes `main.js`, `manifest.json`, and `styles.css` into that vault plugin folder. `.hotreload` is a marker file for the Obsidian Hot Reload plugin.

Releases: pushing a git tag runs `.github/workflows/release.yml`, which builds and attaches `main.js`, `manifest.json`, and `styles.css` to a GitHub release. Keep the version in `manifest.json`, `package.json`, and `versions.json` in sync.

## Architecture

Entry point: `src/plugin/main.ts` (`HighlightrPlugin`). Imports use `src/...` paths, resolved through `baseUrl: "."`.

**Syntax and rendering.** The full syntax is `==text=={Color}` or `==text=={Color|annotation}`. The suffix regex lives in `src/annotations/syntax.ts` (`COLOR_SUFFIX_SOURCE`); the eraser in `main.ts` still has its own literal. Three places parse highlights and must stay consistent:
1. **Live Preview / editor**: `src/extensions/livePreview.ts`, a CodeMirror 6 `ViewPlugin`. It produces two decoration sets:
   - The colored `span.hltr` mark goes through `EditorView.outerDecorations` (accessed via a cast, since the typings lack it). This lets it wrap Obsidian's own `cm-highlight` / `cm-inline-code` spans as one unbroken block.
   - Replace decorations hide the `==` / `=={Color}` markers unless the selection overlaps the highlight.
2. **Reading mode**: a `registerMarkdownPostProcessor` in `main.ts`. Obsidian renders `==text==` as `<mark>`, which leaves a trailing `{Color}` text node. The post-processor strips that text node and adds `hltr` / `hltr-<color>` classes to the `<mark>`.
3. **Editing commands**: in `main.ts`.
   - `applyColorToLine` tokenizes a line into per-character colors, recolors or toggles the selected range, and re-serializes it. It honors `colorChangeMode`: `entire` recolors any overlapping highlight, while `subsegment` recolors only the selection.
   - `eraseHighlight` strips `<mark>`, `==..=={X}`, and `==..==` that intersect the selection.

**Margin annotations** (`src/annotations/`). Highlights with an annotation carry `data-hltr-note` (plus `data-hltr-id` in Live Preview, to group fragments). `AnnotationOverlay` finds them inside a scroll host and collects every on-screen text line fragment and non-text block as an obstacle. It then runs the pure `layoutAnnotations`, a small force simulation where every length is measured in line heights (`FORCES` in `layout.ts`). Each note is pulled toward its highlight by a spring with a rest gap, and pushed out of text, off its highlight's own line, away from other notes, and off other annotations' connectors. Crossed connectors get untangled by swapping. Layout is only re-decided when an annotation is new or changed. Sources are keyed by content (highlighted text, note, and color), not by position. `LayoutMemory` stores each placement (note offset and size, plus the arrow path) relative to its highlight. While every visible annotation is in memory, `followMemory` just replays it as the text reflows (clicking into a highlight reveals its markup in Live Preview, typing elsewhere, scrolling), re-pinning the arrow tip; no obstacles are collected and no routing is done. Memory is cleared when the pane width or an annotation setting changes, or when a note's rendered size drifts. During a full layout, notes with a still-free remembered spot start out settled. Highlights near the left or right edge of the text column get an `edgeLean` toward that margin. It shows up as a seed beside them, a horizontal pull, and a score bonus, so it is a preference, not a rule. Forces don't know what the arrow will look like, so a `refine` pass then judges each note by its arrow. It compares the current spot (with a small stickiness bonus) against mirrored spots and the margins level with the highlight's line, and moves to a clearly cleaner one. A route that A* can't find even in a widened region is `blocked`, and that spot scores Infinity. Routes that double back (U-turns) are penalized by their backtracking distance. After routing, `uncross` checks the actual paths for crossings and tries moving one note of each crossing pair to an alternative spot. Leftover overlaps fall back to the nearest free spot, or to a hover marker. Arrows are routed by `routeArrow`, which runs A* on a cost grid of about L/5 cells around the note and highlight. Blank space is cheap, text is expensive, and notes are walls. Arrows are routed one after another, and each one's path is rasterized as a costly band for the ones after it, so arrows don't run along or across each other. Turning costs extra, and the heuristic is weighted 1.5× for speed. Text may never be traveled along horizontally, since that reads as a strikethrough; it is only crossed vertically or at a slant, and only one way: the search state includes the vertical direction of the first text crossing, so a stroke that climbs through a paragraph can never cut back down through text. The overlay's bow and jitter keep the control polygon y-monotone wherever the route climbs or descends; a quadratic B-spline follows its control points' ups and downs, so the drawn curve can't double back either. The search starts anywhere around the note and ends anywhere along the highlight's edge, and the cell path is simplified (RDP) to its big turns. The refine pass ranks spots with a straight-line estimate (`straightRoute`) and only A*-routes a shortlist. The overlay draws the route as a clamped quadratic B-spline, which cuts corners so right-angle grid paths become sweeping strokes.

**Annotation randomness** (`annotationRandomness`, 0–1). Each annotation gets a seed hashed from its highlighted text and note, never its document position, so typing elsewhere doesn't reshuffle it. `seededRandom` (mulberry32) turns that seed into stable variation:
- Layout: per-note rest gap, which corner is tried first, and a small scoring nudge in `refine`.
- Drawing: bow and turn jitter, arrowhead size, stroke width and roughness, and note tilt.

The drift observer compares `offsetWidth/offsetHeight`, because the tilt transform changes `getBoundingClientRect`. Changing an annotation setting clears `LayoutMemory`. The overlay draws Rough.js arrows into an absolutely positioned layer that scrolls with the content, and re-renders if a note's real size drifts from its measured size (late CSS or fonts). Live Preview drives re-renders from a CM6 ViewPlugin via `requestMeasure`; Reading mode uses `ReadingAnnotations`, which attaches one overlay per `.markdown-preview-view` and re-renders on mutation/resize observers. The reading-mode post-processor reads the `{Color|note}` suffix across several sibling nodes, because markdown inside a note splits it.

**Color plumbing.** Each highlight element gets an inline CSS variable, `--hltr-color`, taken from `settings.highlighters[colorKey]`. Unknown color keys are left undecorated. Class names come from `colorKey.toLowerCase().replace(/ /g, '-')`; the same transform builds the per-color icon ids `highlightr-pen-<color>` in `src/icons/customIcons.ts`.

**Commands are per-color.** `generateCommands` registers one command per highlighter, whose id is the color name. The floating toolbar (`src/ui/floatingMenu.ts`), the highlighter menu (`src/ui/highlighterMenu.ts`), and the context menu (`src/plugin/contextMenu.ts`) all trigger highlights by calling `executeCommandById("content-highlight:<ColorName>")` / `"content-highlight:unhighlight"`, so they depend on the manifest id and the color keys.

**Settings → runtime.** `src/settings/settingsTab.ts` (Pickr color picker, SortableJS reordering) saves settings, then fires window events that `main.ts` listens for:
- `Highlightr-NewCommand`: regenerates icons and commands
- `Highlightr-ToggleFloatingMenu`: creates or destroys the floating menu

The highlighter style setting (`none` / `lowlight` / `floating` / `rounded` / `realistic`) is applied as a `body.highlightr-<style>` class by `updateStyle()`.

## Styling

`styles.css` at the repo root is hand-maintained source; most recent fixes live here. No CSS is imported from `src/`, so the Rollup css plugin never regenerates it. `src/ui/floatingMenu.css` is not imported anywhere: the floating-toolbar styles actually used are in `styles.css`.

Highlights draw their color with `text-decoration` (a thick underline with a negative offset), not `background-color`. This keeps the color aligned on one baseline across mixed fonts, such as inline code inside a highlight. Native backgrounds on nested `.cm-highlight` and `.cm-inline-code` are forced transparent. Style variants override `text-decoration-thickness` / `text-underline-offset` under `body.highlightr-<style>`. Rules usually need `.cm-s-obsidian` / `body.` prefixes (and sometimes `!important`) to beat Obsidian's and themes' specificity.
