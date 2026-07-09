import { addIcon } from "obsidian";
import HighlightrPlugin from "src/plugin/main";
import { HighlightrSettings } from "src/settings/settingsData";

const icons: Record<string, string> = {
  "highlightr-eraser": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19.36,2.72L20.78,4.14L15.06,9.85C16.13,11.39 16.28,13.24 15.38,14.44L9.06,8.12C10.26,7.22 12.11,7.37 13.65,8.44L19.36,2.72M5.93,17.57C3.92,15.56 2.69,13.16 2.35,10.92L7.23,8.83L14.67,16.27L12.58,21.15C10.34,20.81 7.94,19.58 5.93,17.57Z" fill="currentColor"/></svg>`,
  "highlightr-pen": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" stroke-width="0" stroke-linecap="round" stroke-linejoin="round"><path d="M20.707 5.826l-3.535-3.533a.999.999 0 0 0-1.408-.006L7.096 10.82a1.01 1.01 0 0 0-.273.488l-1.024 4.437L4 18h2.828l1.142-1.129l3.588-.828c.18-.042.345-.133.477-.262l8.667-8.535a1 1 0 0 0 .005-1.42zm-9.369 7.833l-2.121-2.12l7.243-7.131l2.12 2.12l-7.242 7.131zM4 20h16v2H4z" fill="currentColor"/></svg>`,
  "highlightr-add": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="white" stroke-width="0" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7h-2v4H7v2h4v4h2v-4h4v-2h-4z" fill="white"/><path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10s10-4.486 10-10S17.514 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8s8 3.589 8 8s-3.589 8-8 8z" fill="white"/></svg>`,
  "highlightr-save": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="white" stroke-width="0" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21h14a2 2 0 0 0 2-2V8a1 1 0 0 0-.29-.71l-4-4A1 1 0 0 0 16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2zm10-2H9v-5h6zM13 7h-2V5h2zM5 5h2v4h8V5h.59L19 8.41V19h-2v-5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v5H5z" fill="white"/></svg>`,
  "highlightr-delete": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="white" stroke-width="0" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8h2V6h-4V4a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2H3v2h2zM9 4h6v2H9zM8 8h9v12H7V8z" fill="white"/><path d="M9 10h2v8H9zm4 0h2v8h-2z" fill="white"/></svg>`,
  "highlightr-copy": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><style>.cls-1{fill:white;opacity:0;}.cls-2{fill:white;}</style></defs><title>copy</title><g id="Layer_2" data-name="Layer 2"><g id="copy"><g id="copy-2" data-name="copy"><rect class="cls-1" width="24" height="24"/><path class="cls-2" d="M18,21H12a3,3,0,0,1-3-3V12a3,3,0,0,1,3-3h6a3,3,0,0,1,3,3v6A3,3,0,0,1,18,21ZM12,11a1,1,0,0,0-1,1v6a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V12a1,1,0,0,0-1-1Z"/><path class="cls-2" d="M9.73,15H5.67A2.68,2.68,0,0,1,3,12.33V5.67A2.68,2.68,0,0,1,5.67,3h6.66A2.68,2.68,0,0,1,15,5.67V9.4H13V5.67A.67.67,0,0,0,12.33,5H5.67A.67.67,0,0,0,5,5.67v6.66a.67.67,0,0,0,.67.67H9.73Z"/></g></g></g></svg>`,
};

export function createHighlighterIcons(
  settings: HighlightrSettings,
  plugin: HighlightrPlugin
) {
  const highlighterIcons: Record<string, string> = {};

  for (const key of plugin.settings.highlighterOrder) {
    let colorLowercase = key.toLowerCase().replace(/ /g, '-');
    let highlighterpen = `highlightr-pen-${colorLowercase}`;
    let colorVal = settings.highlighters[key];
    if (colorVal && /^[0-9A-Fa-f]{3,8}$/.test(colorVal)) {
      colorVal = "#" + colorVal;
    }
    highlighterIcons[
      highlighterpen
    ] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="${colorVal}"/></svg>`;
  }

  Object.keys(highlighterIcons).forEach((key) => {
    addIcon(key, highlighterIcons[key]);
  });

  return highlighterIcons;
}

export default function addIcons() {
  Object.keys(icons).forEach((key) => {
    addIcon(key, icons[key]);
  });
}
