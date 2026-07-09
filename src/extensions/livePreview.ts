import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { HighlightrSettings } from "src/settings/settingsData";

export const highlightrLivePreviewPlugin = (settings: HighlightrSettings) => ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = this.buildDecorations(update.view);
        }
    }

    buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const selection = view.state.selection.main;

        for (let { from, to } of view.visibleRanges) {
            const text = view.state.doc.sliceString(from, to);
            const regex = /==(.*?)==\{([a-zA-Z0-9_\-\s]+)\}/g;
            let match;
            
            while ((match = regex.exec(text)) !== null) {
                const start = from + match.index;
                const end = start + match[0].length;
                const innerStart = start + 2;
                const innerEnd = start + 2 + match[1].length;
                const colorKey = match[2];

                const color = settings.highlighters[colorKey];
                if (!color) continue; // Skip if not a registered highlight color

                const hasFocus = selection.from <= end && selection.to >= start;
                const className = `cm-highlight hltr-${colorKey.toLowerCase().replace(/ /g, '-')}`;

                const innerText = match[1];
                const firstCharLen = innerText.length > 0 ? Array.from(innerText)[0].length : 0;

                if (hasFocus) {
                    if (firstCharLen > 0) {
                        builder.add(innerStart, innerStart + firstCharLen, Decoration.mark({ class: className + " hltr-first-char" }));
                        builder.add(innerStart + firstCharLen, innerEnd, Decoration.mark({ class: className }));
                    } else {
                        builder.add(innerStart, innerEnd, Decoration.mark({ class: className }));
                    }
                } else {
                    builder.add(start, innerStart, Decoration.replace({}));
                    if (firstCharLen > 0) {
                        builder.add(innerStart, innerStart + firstCharLen, Decoration.mark({ class: className + " hltr-first-char" }));
                        if (innerStart + firstCharLen < innerEnd) {
                            builder.add(innerStart + firstCharLen, innerEnd, Decoration.mark({ class: className }));
                        }
                    } else {
                        builder.add(innerStart, innerEnd, Decoration.mark({ class: className }));
                    }
                    builder.add(innerEnd, end, Decoration.replace({}));
                }
            }
        }
        return builder.finish();
    }
}, {
    decorations: v => v.decorations
});
