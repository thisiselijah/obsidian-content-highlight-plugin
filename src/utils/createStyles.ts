import { HighlightrSettings } from "src/settings/settingsData";
import { setAttributes } from "./setAttributes";

function addNewStyle(selector: any, style: any, sheet: HTMLElement) {
  sheet.textContent += selector + `{\n ${style}\n}\n\n`;
}

export function createStyles(settings: HighlightrSettings) {
  let styleSheet = document.createElement("style");
  setAttributes(styleSheet, {
    type: "text/css",
    id: "highlightr-styles",
  });

  let header = document.getElementsByTagName("HEAD")[0];
  header.appendChild(styleSheet);

  Object.keys(settings.highlighters).forEach((highlighter) => {
    let colorLowercase = highlighter.toLowerCase().replace(/ /g, '-');
    addNewStyle(
      `.hltr-${colorLowercase},\nmark.hltr-${colorLowercase},\n.markdown-preview-view mark.hltr-${colorLowercase}`,
      `background-color: ${settings.highlighters[highlighter]} !important;\n padding: 0.125em 0.15em !important;\n margin: 0 -0.15em !important;`,
      styleSheet
    );
    addNewStyle(
      `.hltr-${colorLowercase} .cm-inline-code,\nmark.hltr-${colorLowercase} code,\n.markdown-preview-view mark.hltr-${colorLowercase} code`,
      `background-color: transparent !important;`,
      styleSheet
    );
  });
}
