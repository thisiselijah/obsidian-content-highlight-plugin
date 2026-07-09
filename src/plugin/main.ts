import { Editor, Menu, Plugin, PluginManifest } from "obsidian";
import { wait } from "src/utils/util";
import addIcons from "src/icons/customIcons";
import { HighlightrSettingTab } from "../settings/settingsTab";
import { HighlightrSettings } from "../settings/settingsData";
import DEFAULT_SETTINGS from "../settings/settingsData";
import contextMenu from "src/plugin/contextMenu";
import highlighterMenu from "src/ui/highlighterMenu";
import { createHighlighterIcons } from "src/icons/customIcons";

import { createStyles } from "src/utils/createStyles";
import { EnhancedApp, EnhancedEditor } from "src/settings/types";
import { FloatingMenu } from "src/ui/floatingMenu";

import { highlightrLivePreviewPlugin } from "src/extensions/livePreview";

export default class HighlightrPlugin extends Plugin {
  app: EnhancedApp;
  editor: EnhancedEditor;
  manifest: PluginManifest;
  settings: HighlightrSettings;
  floatingMenu: FloatingMenu;

  async onload() {
    console.log(`Highlightr v${this.manifest.version} loaded`);
    addIcons();

    await this.loadSettings();

    this.registerEditorExtension(highlightrLivePreviewPlugin(this.settings));

    this.registerMarkdownPostProcessor((element, context) => {
      const marks = element.querySelectorAll("mark");
      marks.forEach((mark) => {
        const nextNode = mark.nextSibling;
        if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
          const match = nextNode.textContent?.match(/^\{([a-zA-Z0-9_\-\s]+)\}/);
          if (match) {
            const colorKey = match[1];
            const color = this.settings.highlighters[colorKey];
            if (color) {
              mark.addClass(`hltr-${colorKey.toLowerCase().replace(/ /g, '-')}`);
              // Remove the {color} part from text
              nextNode.textContent = nextNode.textContent!.substring(match[0].length);
            }
          }
        }
      });
    });

    this.app.workspace.onLayoutReady(() => {
      this.reloadStyles(this.settings);
      createHighlighterIcons(this.settings, this);
      
      if (this.settings.enableFloatingMenu) {
        if (!this.floatingMenu) {
          this.floatingMenu = new FloatingMenu(this, this.app);
        }
      }

      this.generateCommands(this.editor);
    });

    this.addSettingTab(new HighlightrSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("editor-menu", this.handleHighlighterInContextMenu)
    );

    this.addCommand({
      id: "highlighter-plugin-menu",
      name: "Open Highlightr",
      icon: "highlightr-pen",
      editorCallback: (editor: EnhancedEditor) => {
        !document.querySelector(".menu.highlighterContainer")
          ? highlighterMenu(this.app, this.settings, editor)
          : true;
      },
    });

    addEventListener("Highlightr-NewCommand", () => {
      this.reloadStyles(this.settings);
      createHighlighterIcons(this.settings, this);
      this.generateCommands(this.editor);
    });
    addEventListener("Highlightr-ToggleFloatingMenu", () => {
      if (this.settings.enableFloatingMenu) {
        if (!this.floatingMenu) {
          this.floatingMenu = new FloatingMenu(this, this.app);
        }
      } else {
        if (this.floatingMenu) {
          this.floatingMenu.destroy();
          this.floatingMenu = null;
        }
      }
    });

    this.refresh();
  }

  
  reloadStyles(settings: HighlightrSettings) {
    let currentSheet = document.querySelector("style#highlightr-styles");
    if (currentSheet) {
      currentSheet.remove();
      createStyles(settings);
    } else {
      createStyles(settings);
    }
  }

  eraseHighlight = (editor: Editor) => {
    const selections = editor.listSelections();
    let changes = [];

    for (const selection of selections) {
      const from = selection.anchor.line < selection.head.line || (selection.anchor.line === selection.head.line && selection.anchor.ch <= selection.head.ch) ? selection.anchor : selection.head;
      const to = selection.anchor.line < selection.head.line || (selection.anchor.line === selection.head.line && selection.anchor.ch <= selection.head.ch) ? selection.head : selection.anchor;
      const lineStart = from.line;
      const lineEnd = to.line;

      for (let i = lineStart; i <= lineEnd; i++) {
        let lineText = editor.getLine(i);
        let newLineText = lineText;

        let selStartCh = (i === from.line) ? from.ch : 0;
        let selEndCh = (i === to.line) ? to.ch : lineText.length;

        let currentSelStart = selStartCh;
        let currentSelEnd = selEndCh;

        const processRegex = (regex: RegExp) => {
            let localDiff = 0;
            newLineText = newLineText.replace(regex, (match, p1, offset) => {
                if (offset <= currentSelEnd && offset + match.length >= currentSelStart) {
                    localDiff -= (match.length - p1.length);
                    return p1;
                }
                return match;
            });
            currentSelStart += localDiff;
            currentSelEnd += localDiff;
        };

        processRegex(/\<mark.*?\>(.*?)\<\/mark\>/g);
        processRegex(/==(.*?)==\{[a-zA-Z0-9_\-\s]+\}/g);
        processRegex(/==(.*?)==/g);

        if (newLineText !== lineText) {
            changes.push({
                from: { line: i, ch: 0 },
                to: { line: i, ch: lineText.length },
                text: newLineText
            });
        }
      }
    }
    
    editor.transaction({
      changes: changes
    });
    
    editor.focus();
  };

  generateCommands(editor: Editor) {
    this.settings.highlighterOrder.forEach((highlighterKey: string) => {
      const applyCommand = (command: CommandPlot, editor: Editor) => {
        const selections = editor.listSelections();
        let changes = [];
        let newSelections = [];

        const prefix = command.prefix;
        const suffix = command.suffix || prefix;

        for (const selection of selections) {
          const from = selection.anchor.line < selection.head.line || (selection.anchor.line === selection.head.line && selection.anchor.ch <= selection.head.ch) ? selection.anchor : selection.head;
          const to = selection.anchor.line < selection.head.line || (selection.anchor.line === selection.head.line && selection.anchor.ch <= selection.head.ch) ? selection.head : selection.anchor;
          
          const selectedText = editor.getRange(from, to);

          const preStart = {
            line: from.line - command.line,
            ch: Math.max(0, from.ch - prefix.length),
          };
          const pre = editor.getRange(preStart, from);

          const sufEnd = {
            line: to.line + command.line,
            ch: to.ch + suffix.length,
          };
          const suf = editor.getRange(to, sufEnd);

          const preLast = pre.slice(-1);
          const prefixLast = prefix.trimStart().slice(-1);

          if (suf === suffix.trimEnd() && preLast === prefixLast && selectedText) {
            changes.push({
              from: preStart,
              to: sufEnd,
              text: selectedText
            });
            const newToCh = from.line === to.line
              ? to.ch - prefix.length
              : to.ch;
            newSelections.push({
              from: { line: to.line, ch: newToCh },
              to: { line: to.line, ch: newToCh }
            });
          } else {
            changes.push({
              from: from,
              to: to,
              text: `${prefix}${selectedText}${suffix}`
            });
            if (selectedText.length === 0) {
              newSelections.push({
                from: { line: from.line, ch: from.ch + prefix.length },
                to: { line: to.line, ch: to.ch + prefix.length }
              });
            } else {
              const newToCh = from.line === to.line 
                ? to.ch + prefix.length + suffix.length 
                : to.ch + suffix.length;
              newSelections.push({
                from: { line: to.line, ch: newToCh },
                to: { line: to.line, ch: newToCh }
              });
            }
          }
        }

        editor.transaction({
          changes: changes,
          selections: newSelections
        });
      };

      type CommandPlot = {
        char: number;
        line: number;
        prefix: string;
        suffix: string;
      };

      type commandsPlot = {
        [key: string]: CommandPlot;
      };

      const commandsMap: commandsPlot = {
        highlight: {
          char: 34,
          line: 0,
          prefix: "==",
          suffix: `=={${highlighterKey}}`,
        },
      };

      Object.keys(commandsMap).forEach((type) => {
        let highlighterpen = `highlightr-pen-${highlighterKey}`.toLowerCase().replace(/ /g, '-');
        this.addCommand({
          id: highlighterKey,
          name: highlighterKey,
          icon: highlighterpen,
          editorCallback: async (editor: Editor) => {
            applyCommand(commandsMap[type], editor);
            await wait(10);
            editor.focus();
          },
        });
      });
    });

    this.addCommand({
      id: "unhighlight",
      name: "Remove highlight",
      icon: "highlightr-eraser",
      editorCallback: async (editor: Editor) => {
        this.eraseHighlight(editor);
        editor.focus();
      },
    });
  }

  refresh = () => {
    this.updateStyle();
  };

  updateStyle = () => {
    document.body.classList.toggle(
      "highlightr-lowlight",
      this.settings.highlighterStyle === "lowlight"
    );
    document.body.classList.toggle(
      "highlightr-floating",
      this.settings.highlighterStyle === "floating"
    );
    document.body.classList.toggle(
      "highlightr-rounded",
      this.settings.highlighterStyle === "rounded"
    );
    document.body.classList.toggle(
      "highlightr-realistic",
      this.settings.highlighterStyle === "realistic"
    );
    document.body.classList.toggle(
      "highlightr-offset",
      this.settings.highlighterStyle === "offset"
    );
  };

  onunload() {
    console.log("Highlightr unloaded");
    if (this.floatingMenu) {
      this.floatingMenu.destroy();
    }
  }

  handleHighlighterInContextMenu = (
    menu: Menu,
    editor: EnhancedEditor
  ): void => {
    contextMenu(this.app, menu, editor, this, this.settings);
  };

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
