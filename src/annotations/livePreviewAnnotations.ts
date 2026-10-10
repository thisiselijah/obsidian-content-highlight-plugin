import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { AnnotationOverlay } from "src/annotations/overlay";
import { HighlightrSettings } from "src/settings/settingsData";

// Re-lays out annotations whenever CodeMirror's layout may have changed.
// Rendering goes through requestMeasure so it runs after CM has updated the DOM.
export const annotationLivePreviewPlugin = (settings: HighlightrSettings) =>
  ViewPlugin.fromClass(
    class {
      overlay: AnnotationOverlay;

      constructor(readonly view: EditorView) {
        this.overlay = new AnnotationOverlay(view.scrollDOM, settings, () => this.schedule());
        this.schedule();
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet) {
          this.schedule();
        }
      }

      schedule() {
        this.view.requestMeasure({
          key: this,
          read: () => null,
          write: () => this.overlay.render(),
        });
      }

      destroy() {
        this.overlay.destroy();
      }
    }
  );
