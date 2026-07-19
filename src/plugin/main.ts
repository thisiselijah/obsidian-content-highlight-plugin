import { Editor, Menu, Plugin, PluginManifest } from "obsidian";
import { wait } from "src/utils/util";
import addIcons from "src/icons/customIcons";
import { HighlightrSettingTab } from "../settings/settingsTab";
import { HighlightrSettings } from "../settings/settingsData";
import DEFAULT_SETTINGS from "../settings/settingsData";
import contextMenu from "src/plugin/contextMenu";
import highlighterMenu from "src/ui/highlighterMenu";
import { createHighlighterIcons } from "src/icons/customIcons";

import { EnhancedApp, EnhancedEditor } from "src/settings/types";
import { FloatingMenu } from "src/ui/floatingMenu";

import { highlightrLivePreviewPlugin } from "src/extensions/livePreview";

function applyColorToLine(
  lineText: string,
  C1: number,
  C2: number,
  newColor: string | undefined,
  colorChangeMode: "entire" | "subsegment"
): { newLineText: string; handled: boolean; newC1: number; newC2: number } {
  interface Token { type: "text" | "highlight"; text: string; color?: string; start: number; end: number; }
  const tokens: Token[] = [];
  const regex = /==((?:(?!==).)*?)==(?:\{([a-zA-Z0-9_\-\s]+)\})?/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(lineText)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", text: lineText.slice(lastIndex, match.index), start: lastIndex, end: match.index });
    }
    tokens.push({ type: "highlight", text: match[1], color: match[2], start: match.index, end: regex.lastIndex });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < lineText.length) {
    tokens.push({ type: "text", text: lineText.slice(lastIndex), start: lastIndex, end: lineText.length });
  }

  const chars: { char: string; color?: string; rawIndex: number }[] = [];
  for (const token of tokens) {
    if (token.type === "text") {
      for (let i = 0; i < token.text.length; i++) {
        chars.push({ char: token.text[i], color: undefined, rawIndex: token.start + i });
      }
    } else {
      const colorVal = token.color || "native";
      for (let i = 0; i < token.text.length; i++) {
        chars.push({ char: token.text[i], color: colorVal, rawIndex: token.start + 2 + i });
      }
    }
  }

  let charSelStart = chars.findIndex(c => c.rawIndex >= C1);
  if (charSelStart === -1) charSelStart = chars.length;
  let charSelEnd = chars.findIndex(c => c.rawIndex >= C2);
  if (charSelEnd === -1) charSelEnd = chars.length;

  interface Run { start: number; end: number; color: string; }
  const runs: Run[] = [];
  let currentRun: Run | null = null;
  for (let i = 0; i < chars.length; i++) {
    const color = chars[i].color;
    if (color !== undefined) {
      if (currentRun && currentRun.color === color) {
        currentRun.end = i + 1;
      } else {
        currentRun = { start: i, end: i + 1, color };
        runs.push(currentRun);
      }
    } else {
      currentRun = null;
    }
  }

  let shouldToggleOff = false;
  if (newColor !== undefined) {
    if (charSelStart === charSelEnd) {
      const run = runs.find(r => r.start <= charSelStart && charSelStart <= r.end);
      if (run && run.color === newColor) shouldToggleOff = true;
    } else {
      let allSame = true;
      for (let i = charSelStart; i < charSelEnd; i++) {
        if (chars[i].color !== newColor) { allSame = false; break; }
      }
      if (allSame && charSelStart < charSelEnd) shouldToggleOff = true;
    }
  }

  const targetColor = shouldToggleOff ? undefined : newColor;
  let handled = false;

  if (charSelStart === charSelEnd) {
    const run = runs.find(r => r.start <= charSelStart && charSelStart <= r.end);
    if (run) {
      handled = true;
      for (let i = run.start; i < run.end; i++) chars[i].color = targetColor;
    } else {
      return { newLineText: lineText, handled: false, newC1: C1, newC2: C2 };
    }
  } else {
    handled = true;
    if (colorChangeMode === "entire") {
      const overlappingRuns = runs.filter(run => !(run.end <= charSelStart || run.start >= charSelEnd));
      if (overlappingRuns.length > 0) {
        for (const run of overlappingRuns) {
          for (let i = run.start; i < run.end; i++) chars[i].color = targetColor;
        }
        for (let i = charSelStart; i < charSelEnd; i++) chars[i].color = targetColor;
      } else {
        for (let i = charSelStart; i < charSelEnd; i++) chars[i].color = targetColor;
      }
    } else {
      for (let i = charSelStart; i < charSelEnd; i++) chars[i].color = targetColor;
    }
  }

  let newLineText = "";
  let currentColor: string | undefined = undefined;
  let newC1 = C1;
  let newC2 = C2;

  for (let i = 0; i < chars.length; i++) {
    const charColor = chars[i].color;
    if (charColor !== currentColor) {
      if (currentColor !== undefined) {
        if (currentColor === "native") newLineText += "==";
        else newLineText += `=={${currentColor}}`;
      }
      if (charColor !== undefined) newLineText += "==";
      currentColor = charColor;
    }

    if (i === charSelStart) newC1 = newLineText.length;
    if (i === charSelEnd) newC2 = newLineText.length;

    newLineText += chars[i].char;
  }

  if (chars.length === charSelStart) newC1 = newLineText.length;
  if (chars.length === charSelEnd) newC2 = newLineText.length;

  if (currentColor !== undefined) {
    if (currentColor === "native") newLineText += "==";
    else newLineText += `=={${currentColor}}`;
  }

  return { newLineText, handled, newC1, newC2 };
}

export default class HighlightrPlugin extends Plugin {
  app: EnhancedApp;
  editor: EnhancedEditor;
  manifest: PluginManifest;
  settings: HighlightrSettings;
  floatingMenu: FloatingMenu;

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Obsidian Plugin.onload expects void
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
              mark.addClass("hltr");
              mark.style.setProperty("--hltr-color", color);
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
        if (!activeDocument.querySelector(".menu.highlighter-container")) {
          highlighterMenu(this.app, this.settings, editor);
        }
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
    let currentSheet = activeDocument.querySelector("style#highlightr-styles");
    if (currentSheet) {
      currentSheet.remove();
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
            newLineText = newLineText.replace(regex, (match: string, p1: string, offset: number) => {
                if (offset <= currentSelEnd && offset + match.length >= currentSelStart) {
                    localDiff -= (match.length - p1.length);
                    return p1;
                }
                return match;
            });
            currentSelStart += localDiff;
            currentSelEnd += localDiff;
        };

        processRegex(/<mark.*?>(.*?)<\/mark>/g);
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
          
          const lineStart = from.line;
          const lineEnd = to.line;

          let newFromCh = from.ch;
          let newToCh = to.ch;

          for (let i = lineStart; i <= lineEnd; i++) {
            let lineText = editor.getLine(i);
            let selStartCh = (i === from.line) ? from.ch : 0;
            let selEndCh = (i === to.line) ? to.ch : lineText.length;

            const res = applyColorToLine(lineText, selStartCh, selEndCh, highlighterKey, this.settings.colorChangeMode);

            if (res.handled) {
              if (i === from.line) newFromCh = res.newC1;
              if (i === to.line) newToCh = res.newC2;

              if (res.newLineText !== lineText) {
                changes.push({
                  from: { line: i, ch: 0 },
                  to: { line: i, ch: lineText.length },
                  text: res.newLineText
                });
              }
            } else {
              changes.push({
                from: { line: i, ch: selStartCh },
                to: { line: i, ch: selEndCh },
                text: `${prefix}${suffix}`
              });

              if (i === from.line) newFromCh = selStartCh + prefix.length;
              if (i === to.line) newToCh = selEndCh + prefix.length;
            }
          }

          const newHead = (selection.head === from) ? { line: from.line, ch: newFromCh } : { line: to.line, ch: newToCh };

          newSelections.push({
            from: newHead,
            to: newHead
          });
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
    activeDocument.body.classList.toggle(
      "highlightr-lowlight",
      this.settings.highlighterStyle === "lowlight"
    );
    activeDocument.body.classList.toggle(
      "highlightr-floating",
      this.settings.highlighterStyle === "floating"
    );
    activeDocument.body.classList.toggle(
      "highlightr-rounded",
      this.settings.highlighterStyle === "rounded"
    );
    activeDocument.body.classList.toggle(
      "highlightr-realistic",
      this.settings.highlighterStyle === "realistic"
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- loadData returns any
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
