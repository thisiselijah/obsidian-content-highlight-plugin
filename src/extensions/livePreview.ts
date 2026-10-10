import { RangeSetBuilder, Extension } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { HighlightrSettings } from "src/settings/settingsData";
import { coloredHighlightRegex } from "src/annotations/syntax";

export const highlightrLivePreviewPlugin = (settings: HighlightrSettings) => {
    const plugin = ViewPlugin.fromClass(class {
        decorations: DecorationSet;
        outerDecorations: DecorationSet;

        constructor(view: EditorView) {
            const result = this.buildDecorations(view);
            this.decorations = result.inner;
            this.outerDecorations = result.outer;
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged || update.selectionSet) {
                const result = this.buildDecorations(update.view);
                this.decorations = result.inner;
                this.outerDecorations = result.outer;
            }
        }

        buildDecorations(view: EditorView) {
            const innerBuilder = new RangeSetBuilder<Decoration>();
            const outerBuilder = new RangeSetBuilder<Decoration>();
            const selection = view.state.selection.main;

            for (let { from, to } of view.visibleRanges) {
                const text = view.state.doc.sliceString(from, to);
                const regex = coloredHighlightRegex();
                let match;
                
                while ((match = regex.exec(text)) !== null) {
                    const start = from + match.index;
                    const end = start + match[0].length;
                    const innerStart = start + 2;
                    const innerEnd = start + 2 + match[1].length;
                    const colorKey = match[2];
                    const note = match[3]?.trim();

                    const color = settings.highlighters[colorKey];
                    if (!color) continue;

                    const hasFocus = selection.from < end && selection.to > start;
                    const className = `hltr hltr-${colorKey.toLowerCase().replace(/ /g, '-')}`;
                    const styleAttr = `--hltr-color: ${color};`;

                    // outerDecorations: a single, unsplit wrapper for the visible content.
                    // This wraps AROUND all native CM6 decorations (cm-highlight, cm-inline-code, etc.)
                    // so the background is one continuous block with no gaps.
                    // data-hltr-* lets the annotation overlay find this highlight and
                    // group its fragments if CM splits the mark across spans.
                    const attributes: Record<string, string> = { style: styleAttr };
                    if (note) {
                        attributes["data-hltr-note"] = note;
                        attributes["data-hltr-id"] = `${start}`;
                    }
                    outerBuilder.add(innerStart, innerEnd, Decoration.mark({
                        class: className,
                        attributes
                    }));

                    if (hasFocus) {
                        // When focused, show the raw markup — no replacements needed.
                        // The outer decoration still provides the background.
                    } else {
                        // When not focused, hide == and =={color} syntax markers.
                        innerBuilder.add(start, innerStart, Decoration.replace({}));
                        innerBuilder.add(innerEnd, end, Decoration.replace({}));
                    }
                }
            }
            return {
                inner: innerBuilder.finish(),
                outer: outerBuilder.finish()
            };
        }
    }, {
        decorations: v => v.decorations,
        provide: (plugin) => {
            const ev = EditorView as unknown as { outerDecorations?: { of: (cb: (view: EditorView) => DecorationSet) => Extension } };
            if (ev.outerDecorations) {
                return ev.outerDecorations.of((view: EditorView) => {
                    return view.plugin(plugin)?.outerDecorations ?? Decoration.none;
                });
            }
            return [];
        }
    });

    return plugin;
};
