import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { HighlightrSettings } from "src/settings/settingsData";

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
                const regex = /==((?:(?!==).)*?)==\{([a-zA-Z0-9_\-\s]+)\}/g;
                let match;
                
                while ((match = regex.exec(text)) !== null) {
                    const start = from + match.index;
                    const end = start + match[0].length;
                    const innerStart = start + 2;
                    const innerEnd = start + 2 + match[1].length;
                    const colorKey = match[2];

                    const color = settings.highlighters[colorKey];
                    if (!color) continue;

                    const hasFocus = selection.from <= end && selection.to >= start;
                    const className = `hltr hltr-${colorKey.toLowerCase().replace(/ /g, '-')}`;
                    const styleAttr = `background-color: ${color} !important; --hltr-color: ${color};`;

                    // outerDecorations: a single, unsplit wrapper for the visible content.
                    // This wraps AROUND all native CM6 decorations (cm-highlight, cm-inline-code, etc.)
                    // so the background is one continuous block with no gaps.
                    outerBuilder.add(innerStart, innerEnd, Decoration.mark({
                        class: className,
                        attributes: { style: styleAttr }
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
        provide: (plugin) => (EditorView as any).outerDecorations.of((view: EditorView) => {
            return view.plugin(plugin)?.outerDecorations ?? Decoration.none;
        })
    });

    return plugin;
};
