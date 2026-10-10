export const HIGHLIGHTER_STYLES = [
  "none",
  "lowlight",
  "floating",
  "rounded",
  "realistic",
];

// Which end(s) of an annotation's connector get an arrowhead.
export type ArrowDirection = "to-highlight" | "to-note" | "both" | "none";

export interface Highlighters {
  [color: string]: string;
}

export interface HighlightrSettings {
  highlighterStyle: string;
  enableFloatingMenu: boolean;
  highlighters: Highlighters;
  highlighterOrder: string[];
  colorChangeMode: "entire" | "subsegment";
  arrowDirection: ArrowDirection;
  // 0..1: how much annotations vary in placement and in their hand-drawn strokes.
  annotationRandomness: number;
}

const DEFAULT_SETTINGS: HighlightrSettings = {
  highlighterStyle: "none",
  enableFloatingMenu: true,
  highlighters: {
    Pink: "#FFB8EBA6",
    Red: "#FF5582A6",
    Orange: "#FFB86CA6",
    Yellow: "#FFF3A3A6",
    Green: "#BBFABBA6",
    Cyan: "#ABF7F7A6",
    Blue: "#ADCCFFA6",
    Purple: "#D2B3FFA6",
    Grey: "#CACFD9A6",
  },
  highlighterOrder: [],
  colorChangeMode: "entire",
  arrowDirection: "to-highlight",
  annotationRandomness: 0.5,
};

DEFAULT_SETTINGS.highlighterOrder = Object.keys(DEFAULT_SETTINGS.highlighters);

export default DEFAULT_SETTINGS;
