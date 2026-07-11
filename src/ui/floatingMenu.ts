import { MarkdownView, setIcon } from "obsidian";
import HighlightrPlugin from "../plugin/main";
import { EnhancedApp } from "../settings/types";

export class FloatingMenu {
  plugin: HighlightrPlugin;
  app: EnhancedApp;
  toolbar: HTMLElement;

  constructor(plugin: HighlightrPlugin, app: EnhancedApp) {
    this.plugin = plugin;
    this.app = app;
    this.createToolbar();
    this.registerEvents();
  }

  createToolbar() {
    this.toolbar = activeDocument.createElement("div");
    this.toolbar.addClass("highlightr-floating-toolbar");
    activeDocument.body.appendChild(this.toolbar);

    this.renderButtons();
  }

  renderButtons() {
    this.toolbar.empty();
    this.plugin.settings.highlighterOrder.forEach((highlighter) => {
      const btn = activeDocument.createElement("button");
      btn.addClass("highlightr-floating-btn");
      
      const iconName = `highlightr-pen-${highlighter}`.toLowerCase().replace(/ /g, '-');
      setIcon(btn, iconName);
      
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          this.app.commands.executeCommandById(`content-highlight:${highlighter}`);
          window.setTimeout(() => {
            view.editor.blur();
          }, 20);
          this.hide();
        }
      };
      
      // Optionally add tooltip
      btn.title = highlighter;
      
      this.toolbar.appendChild(btn);
    });

    // Add divider
    const divider = activeDocument.createElement("div");
    divider.addClass("highlightr-floating-divider");
    this.toolbar.appendChild(divider);

    // Add clear highlight button
    const clearBtn = activeDocument.createElement("button");
    clearBtn.addClass("highlightr-floating-btn");
    setIcon(clearBtn, "highlightr-eraser");
    
    clearBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) {
        this.app.commands.executeCommandById(`content-highlight:unhighlight`);
        window.setTimeout(() => {
          view.editor.blur();
        }, 20);
        this.hide();
      }
    };
    
    clearBtn.title = "Remove highlight";
    this.toolbar.appendChild(clearBtn);
  }

  registerEvents() {
    this.plugin.registerDomEvent(activeDocument, "mouseup", (evt: MouseEvent) => {
      window.setTimeout(() => this.checkSelection(), 10);
    });
    
    this.plugin.registerDomEvent(activeDocument, "mousedown", (evt: MouseEvent) => {
      if (!this.toolbar.contains(evt.target as Node)) {
        this.hide();
      }
    });

    this.plugin.registerDomEvent(activeDocument, "keydown", (evt: KeyboardEvent) => {
      window.setTimeout(() => this.checkSelection(), 10);
    });
  }

  checkSelection() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      this.hide();
      return;
    }

    const editor = view.editor;
    if (editor.somethingSelected()) {
      // Get selection coordinates to position the toolbar
      // Wait for DOM to update
      window.setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
          this.hide();
          return;
        }

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // Calculate position
        const toolbarHeight = 40; // Approx height
        const top = rect.top - toolbarHeight - 10;
        const left = rect.left + (rect.width / 2) - (this.toolbar.offsetWidth / 2);

        this.toolbar.addClass("is-visible");
        this.toolbar.style.top = `${Math.max(10, top)}px`;
        this.toolbar.style.left = `${Math.max(10, left)}px`;
      }, 50);
    } else {
      this.hide();
    }
  }

  hide() {
    this.toolbar.removeClass("is-visible");
  }
  
  destroy() {
    if (this.toolbar && this.toolbar.parentNode) {
      this.toolbar.parentNode.removeChild(this.toolbar);
    }
  }
}
