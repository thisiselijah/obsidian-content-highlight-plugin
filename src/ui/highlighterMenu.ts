import { Menu, Notice } from "obsidian";
import { HighlightrSettings } from "src/settings/settingsData";
import {
  Coords,
  EnhancedApp,
  EnhancedEditor,
  EnhancedMenu,
} from "src/settings/types";

const highlighterMenu = (
  app: EnhancedApp,
  settings: HighlightrSettings,
  editor: EnhancedEditor
): void => {
  if (editor) {
    const cursor = editor.getCursor("from");
    let coords: Coords;

    const menu = new Menu() as unknown as EnhancedMenu;

    menu.setUseNativeMenu(false);

    const menuDom = menu.dom;
    menuDom.addClass("highlighter-container");

    settings.highlighterOrder.forEach((highlighter) => {
      menu.addItem((highlighterItem) => {
        highlighterItem.setTitle(highlighter);
        highlighterItem.setIcon(`highlightr-pen-${highlighter}`.toLowerCase().replace(/ /g, '-'));
        highlighterItem.onClick(() => {
          app.commands.executeCommandById(`content-highlight:${highlighter}`);
        });
      });
    });

    if (editor.cursorCoords) {
      coords = editor.cursorCoords(true, "window");
    } else if (editor.coordsAtPos) {
      const offset = editor.posToOffset(cursor);
      coords = editor.cm.coordsAtPos?.(offset) ?? editor.coordsAtPos(offset);
    } else {
      return;
    }

    menu.showAtPosition({
      x: coords.right + 25,
      y: coords.top + 20,
    });
  } else {
    new Notice("Focus must be in editor");
  }
};

export default highlighterMenu;
