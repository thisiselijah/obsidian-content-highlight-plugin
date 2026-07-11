import { App, MarkdownView, setIcon } from "obsidian";
import HighlightrPlugin from "../plugin/main";

export class FloatingMenu {
  plugin: HighlightrPlugin;
  app: App;
  toolbar: HTMLElement;

  constructor(plugin: HighlightrPlugin, app: App) {
    this.plugin = plugin;
    this.app = app;
    this.createToolbar();
    this.registerEvents();
  }

  createToolbar() {
    this.toolbar = document.createElement("div");
    this.toolbar.addClass("highlightr-floating-toolbar");
    document.body.appendChild(this.toolbar);

    this.renderButtons();
  }

  renderButtons() {
    this.toolbar.empty();
    this.plugin.settings.highlighterOrder.forEach((highlighter) => {
      const btn = document.createElement("button");
      btn.addClass("highlightr-floating-btn");
      
      const iconName = `highlightr-pen-${highlighter}`.toLowerCase().replace(/ /g, '-');
      setIcon(btn, iconName);
      
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          (this.app as any).commands.executeCommandById(`content-highlight:${highlighter}`);
          setTimeout(() => {
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
    const divider = document.createElement("div");
    divider.addClass("highlightr-floating-divider");
    this.toolbar.appendChild(divider);

    // Add clear highlight button
    const clearBtn = document.createElement("button");
    clearBtn.addClass("highlightr-floating-btn");
    setIcon(clearBtn, "highlightr-eraser");
    
    clearBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) {
        (this.app as any).commands.executeCommandById(`content-highlight:unhighlight`);
        setTimeout(() => {
          view.editor.blur();
        }, 20);
        this.hide();
      }
    };
    
    clearBtn.title = "Remove highlight";
    this.toolbar.appendChild(clearBtn);
  }

  registerEvents() {
    this.plugin.registerDomEvent(document, "mouseup", (evt: MouseEvent) => {
      setTimeout(() => this.checkSelection(), 10);
    });
    
    this.plugin.registerDomEvent(document, "mousedown", (evt: MouseEvent) => {
      if (!this.toolbar.contains(evt.target as Node)) {
        this.hide();
      }
    });

    this.plugin.registerDomEvent(document, "keydown", (evt: KeyboardEvent) => {
      setTimeout(() => this.checkSelection(), 10);
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
      setTimeout(() => {
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
        this.toolbar.setCssStyles({
          "top": `${Math.max(10, top)}px`,
          "left": `${Math.max(10, left)}px`
        });
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
