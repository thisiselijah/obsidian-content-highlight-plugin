import { App, Editor, Menu } from "obsidian";

export interface Coords {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export type EnhancedMenu = Menu & { dom: HTMLElement };

export type EnhancedApp = App & {
  commands: { executeCommandById: (id: string) => void };
};

export type EnhancedEditor = Editor & {
  cursorCoords: (b: boolean, m: string) => Coords;
  coordsAtPos: (pos: number) => Coords;
  cm: CodeMirror.Editor & { coordsAtPos?: (pos: number) => Coords };
  hasFocus: () => boolean;
  getSelection: () => string;
};

declare global {
  interface HTMLElement {
    setCssStyles(styles: Record<string, string>): void;
    setCssProps(props: Record<string, string>): void;
  }
}
