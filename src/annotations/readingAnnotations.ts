import { MarkdownView, Plugin } from "obsidian";
import { AnnotationOverlay } from "src/annotations/overlay";
import { HighlightrSettings } from "src/settings/settingsData";
import { debounce } from "src/utils/debounce";

interface AttachedOverlay {
  overlay: AnnotationOverlay;
  disconnect: () => void;
}

/**
 * Keeps one annotation overlay per Reading-mode container. Reading mode renders
 * sections lazily and has no CodeMirror update cycle, so re-layout is driven by
 * DOM mutation and resize observers instead.
 */
export class ReadingAnnotations {
  private attached = new Map<HTMLElement, AttachedOverlay>();

  constructor(
    private plugin: Plugin,
    private settings: HighlightrSettings
  ) {}

  sync() {
    const hosts = new Set<HTMLElement>();
    this.plugin.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      if (!(leaf.view instanceof MarkdownView)) return;
      const container = leaf.view.previewMode.containerEl;
      const host = container.hasClass("markdown-preview-view")
        ? container
        : container.querySelector<HTMLElement>(".markdown-preview-view");
      if (host) hosts.add(host);
    });

    for (const [host, attached] of this.attached) {
      if (!hosts.has(host) || !host.isConnected) this.detach(host, attached);
    }
    for (const host of hosts) {
      if (!this.attached.has(host)) this.attach(host);
    }
  }

  destroy() {
    for (const [host, attached] of this.attached) this.detach(host, attached);
  }

  private attach(host: HTMLElement) {
    const overlay: AnnotationOverlay = new AnnotationOverlay(host, this.settings, () => render());
    const render = debounce(() => overlay.render(), 60);

    const mutations = new MutationObserver((records) => {
      if (records.some((r) => !overlay.el.contains(r.target))) render();
    });
    mutations.observe(host, { childList: true, subtree: true, characterData: true });

    const resizes = new ResizeObserver(() => render());
    resizes.observe(host);
    const sizer = host.querySelector(".markdown-preview-sizer");
    if (sizer) resizes.observe(sizer);

    this.attached.set(host, {
      overlay,
      disconnect: () => {
        mutations.disconnect();
        resizes.disconnect();
      },
    });
    render();
  }

  private detach(host: HTMLElement, attached: AttachedOverlay) {
    attached.disconnect();
    attached.overlay.destroy();
    this.attached.delete(host);
  }
}
