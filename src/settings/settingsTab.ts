import type HighlightrPlugin from "src/plugin/main";
import {
  App,
  Setting,
  PluginSettingTab,
  Notice,
  TextComponent,
} from "obsidian";
import Pickr from "@simonwep/pickr";
import Sortable from "sortablejs";
import { HIGHLIGHTER_METHODS, HIGHLIGHTER_STYLES } from "./settingsData";
import { setAttributes } from "src/utils/setAttributes";

export class HighlightrSettingTab extends PluginSettingTab {
  plugin: HighlightrPlugin;
  appendMethod: string;

  constructor(app: App, plugin: HighlightrPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h1", { text: "Highlightr" });
    containerEl.createEl("p", { text: "Maintained by " }).createEl("a", {
      text: "Elijah",
      href: "https://github.com/thisiselijah",
    });
    containerEl.createEl("p", { text: " (Original by chetachi)" });
    containerEl.createEl("h2", { text: "Plugin Settings" });

    new Setting(containerEl)
      .setName("Choose highlight method")
      .setDesc(
        `Choose between highlighting with inline CSS or CSS classes. Please note that there are pros and cons to both choices. Inline CSS will keep you from being reliant on external CSS files if you choose to export your notes. CSS classes are more flexible and easier to customize.`
      )
      .addDropdown((dropdown) => {
        let methods: Record<string, string> = {};
        HIGHLIGHTER_METHODS.map((method) => (methods[method] = method));
        dropdown.addOptions(methods);
        dropdown
          .setValue(this.plugin.settings.highlighterMethods)
          .onChange((highlightrMethod) => {
            this.plugin.settings.highlighterMethods = highlightrMethod;
            setTimeout(() => {
              dispatchEvent(new Event("Highlightr-NewCommand"));
            }, 100);
            this.plugin.saveSettings();
            this.plugin.saveData(this.plugin.settings);
            this.display();
          });
      });

    const stylesSetting = new Setting(containerEl);

    stylesSetting
      .setName("Choose highlight style")
      .setDesc(
        `Depending on your design aesthetic, you may want to customize the style of your highlights. Choose from an assortment of different highlighter styles by using the dropdown. Depending on your theme, this plugin's CSS may be overriden.`
      )
      .addDropdown((dropdown) => {
        let styles: Record<string, string> = {};
        HIGHLIGHTER_STYLES.map((style) => (styles[style] = style));
        dropdown.addOptions(styles);
        dropdown
          .setValue(this.plugin.settings.highlighterStyle)
          .onChange((highlighterStyle) => {
            this.plugin.settings.highlighterStyle = highlighterStyle;
            this.plugin.saveSettings();
            this.plugin.saveData(this.plugin.settings);
            this.plugin.refresh();
          });
      });

    const styleDemo = () => {
      const d = createEl("p");
      d.setAttribute("style", "font-size: .925em; margin-top: 12px; display: flex; gap: 16px; flex-wrap: wrap; align-items: center;");
      d.innerHTML = `
      <span style="background:#FFB7EACC;padding: .125em .125em;--lowlight-background: var(--background-primary);border-radius: 0;background-image: linear-gradient(360deg,rgba(255, 255, 255, 0) 40%,var(--lowlight-background) 40%) !important;">Lowlight</span>
      <span style="background:#93C0FFCC;--floating-background: var(--background-primary);border-radius: 0;padding-bottom: 5px;background-image: linear-gradient(360deg,rgba(255, 255, 255, 0) 28%,var(--floating-background) 28%) !important;">Floating</span>
      <span style="background:#9CF09CCC;padding: 0.1em 0.4em;border-radius: 0.8em 0.3em;-webkit-box-decoration-break: clone;box-decoration-break: clone;text-shadow: 0 0 0.75em var(--background-primary-alt);">Realistic</span>
      <span style="background:#CCA9FFCC;padding: 0.125em 0.15em;border-radius: 0.2em;-webkit-box-decoration-break: clone;box-decoration-break: clone;">Rounded</span>`;
      return d;
    };

    stylesSetting.infoEl.appendChild(styleDemo());

    const highlighterSetting = new Setting(containerEl);

    highlighterSetting
      .setName("Choose highlight colors")
      .setClass("highlighterplugin-setting-item")
      .setDesc(
        `Create a highlight color by entering a name and a hex code. Use the picker to choose visually. Drag items to reorder.`
      );

    const colorInput = new TextComponent(highlighterSetting.controlEl);
    colorInput.setPlaceholder("Color name");
    colorInput.inputEl.addClass("highlighter-settings-color");

    const valueInput = new TextComponent(highlighterSetting.controlEl);
    valueInput.setPlaceholder("Hex Code");
    valueInput.inputEl.addClass("highlighter-settings-value");

    highlighterSetting
      .addButton((button) => {
        button.setClass("highlightr-color-picker");
      })
      .then(() => {
        let input = valueInput.inputEl;
        let currentColor = valueInput.inputEl.value || null;

        const colorMap = this.plugin.settings.highlighterOrder.map(
          (highlightKey) => this.plugin.settings.highlighters[highlightKey]
        );

        let colorHex;
        let pickrCreate = new Pickr({
          el: ".highlightr-color-picker",
          theme: "nano",
          swatches: colorMap,
          defaultRepresentation: "HEXA",
          default: colorMap[colorMap.length - 1],
          comparison: false,
          components: {
            preview: true,
            opacity: true,
            hue: true,
            interaction: {
              hex: true,
              rgba: true,
              hsla: false,
              hsva: false,
              cmyk: false,
              input: true,
              clear: true,
              cancel: true,
              save: true,
            },
          },
        });

        // Allow manual hex input
        let isManualInput = false;
        valueInput.inputEl.addEventListener("input", () => {
          isManualInput = true;
          let typed = valueInput.inputEl.value.trim().toUpperCase();
          if (!/^#/.test(typed) && typed.length > 0) typed = "#" + typed;
          if (/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(typed)) {
            try { pickrCreate.setColor(typed); } catch (e) {}
          }
          setTimeout(() => { isManualInput = false; }, 50);
        });

        // Move pcr-app inside modal on show so Obsidian's focus trap doesn't steal focus
        const modalContainer = containerEl.closest(".modal-content") as HTMLElement;
        pickrCreate.on("show", () => {
          const pcrApp = document.querySelector(".pcr-app") as HTMLElement;
          if (pcrApp && modalContainer && !modalContainer.contains(pcrApp)) {
            modalContainer.appendChild(pcrApp);
          }
        });

        pickrCreate
          .on("clear", function (instance: Pickr) {
            instance.hide();
            input.trigger("change");
          })
          .on("cancel", function (instance: Pickr) {
            currentColor = instance.getSelectedColor().toHEXA().toString();

            input.trigger("change");
            instance.hide();
          })
          .on("change", function (color: Pickr.HSVaColor) {
            if (isManualInput) return;
            colorHex = color.toHEXA().toString();
            let newColor;
            colorHex.length == 6
              ? (newColor = `${color.toHEXA().toString()}A6`)
              : (newColor = color.toHEXA().toString());

            setAttributes(input, {
              value: newColor,
            });
            input.setText(newColor);
            input.textContent = newColor;
            input.value = newColor;
            input.trigger("change");
          })
          .on("save", function (color: Pickr.HSVaColor, instance: Pickr) {
            let newColorValue = color.toHEXA().toString();

            input.setText(newColorValue);
            input.textContent = newColorValue;
            input.value = newColorValue;
            input.trigger("change");

            instance.hide();
            instance.addSwatch(color.toHEXA().toString());
          });
      })
      .addButton((button) => {
        button
          .setClass("HighlightrSettingsButton")
          .setClass("HighlightrSettingsButtonAdd")
          .setIcon("highlightr-save")
          .setTooltip("Save")
          .onClick(async (buttonEl: any) => {
            let color = colorInput.inputEl.value.replace(" ", "-");
            let value = valueInput.inputEl.value.trim().toUpperCase();

            if (value && /^[0-9A-Fa-f]{3,8}$/.test(value)) {
              value = "#" + value;
            }

            if (color && value) {
              if (!this.plugin.settings.highlighterOrder.includes(color)) {
                this.plugin.settings.highlighterOrder.push(color);
                this.plugin.settings.highlighters[color] = value;
                setTimeout(() => {
                  dispatchEvent(new Event("Highlightr-NewCommand"));
                }, 100);
                await this.plugin.saveSettings();
                this.display();
              } else {
                buttonEl.stopImmediatePropagation();
                new Notice("This color already exists");
              }
            } else {
              color && !value
                ? new Notice("Highlighter hex code missing")
                : !color && value
                ? new Notice("Highlighter name missing")
                : new Notice("Highlighter values missing");
            }
          });
      });

    const highlightersContainer = containerEl.createEl("div", {
      cls: "HighlightrSettingsTabsContainer",
    });

    Sortable.create(highlightersContainer, {
      animation: 500,
      ghostClass: "highlighter-sortable-ghost",
      chosenClass: "highlighter-sortable-chosen",
      dragClass: "highlighter-sortable-drag",
      dragoverBubble: true,
      forceFallback: true,
      fallbackClass: "highlighter-sortable-fallback",
      easing: "cubic-bezier(1, 0, 0, 1)",
      onSort: (command: { oldIndex: number; newIndex: number }) => {
        const arrayResult = this.plugin.settings.highlighterOrder;
        const [removed] = arrayResult.splice(command.oldIndex, 1);
        arrayResult.splice(command.newIndex, 0, removed);
        this.plugin.settings.highlighterOrder = arrayResult;
        this.plugin.saveSettings();
      },
    });

    this.plugin.settings.highlighterOrder.forEach((highlighter) => {
      const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="${this.plugin.settings.highlighters[highlighter]}"/></svg>`;
      const settingItem = highlightersContainer.createEl("div");
      settingItem.addClass("highlighter-item-draggable");
      const setting = new Setting(settingItem)
        .setClass("highlighter-setting-item");

      const colorIcon = createEl("span");
      colorIcon.addClass("highlighter-setting-icon");
      colorIcon.innerHTML = icon;
      
      setting.infoEl.style.display = "flex";
      setting.infoEl.style.alignItems = "center";
      setting.infoEl.style.flex = "1";
      setting.infoEl.style.minWidth = "0";
      setting.infoEl.style.overflow = "hidden";

      const renderNormalMode = () => {
        setting.infoEl.empty();
        setting.infoEl.appendChild(colorIcon);
        
        const nameSpan = setting.infoEl.createEl("span", { text: highlighter });
        nameSpan.style.flexGrow = "1";
        nameSpan.style.flexShrink = "1";
        nameSpan.style.flexBasis = "200px";
        nameSpan.style.minWidth = "0";
        nameSpan.style.overflow = "hidden";
        nameSpan.style.textOverflow = "ellipsis";
        nameSpan.style.whiteSpace = "nowrap";
      };

      // Create hex code span in the control area (right side)
      const valSpan = createEl("span", { text: this.plugin.settings.highlighters[highlighter] });
      valSpan.style.flexShrink = "0";
      valSpan.style.whiteSpace = "nowrap";
      valSpan.style.fontFamily = "var(--font-monospace)";
      valSpan.style.textTransform = "uppercase";
      valSpan.style.color = "var(--text-muted)";
      valSpan.style.fontSize = "0.85em";
      setting.controlEl.prepend(valSpan);

      renderNormalMode();

      let isEditing = false;
      let nameInputEl: HTMLInputElement;
      let valInputEl: HTMLInputElement;

      setting.addButton((button) => {
        button
          .setClass("HighlightrSettingsButton")
          .setIcon("pencil")
          .setTooltip("Edit")
          .onClick(async () => {
            if (!isEditing) {
              isEditing = true;
              setting.infoEl.empty();
              setting.infoEl.appendChild(colorIcon);

              nameInputEl = setting.infoEl.createEl("input", { type: "text", value: highlighter });
              nameInputEl.style.flex = "2";
              nameInputEl.style.minWidth = "0";
              nameInputEl.style.marginRight = "10px";

              valInputEl = setting.infoEl.createEl("input", { type: "text", value: this.plugin.settings.highlighters[highlighter] });
              valInputEl.style.flex = "1";
              valInputEl.style.minWidth = "0";
              valInputEl.style.fontFamily = "var(--font-monospace)";
              valInputEl.style.textTransform = "uppercase";

              button.setIcon("highlightr-save");
              button.setTooltip("Save");
            } else {
              const newName = nameInputEl.value.trim().replace(/ /g, "-");
              let newVal = valInputEl.value.trim().toUpperCase();

              if (newVal && /^[0-9A-Fa-f]{3,8}$/.test(newVal)) {
                newVal = "#" + newVal;
              }

              if (newName && newVal) {
                if (newName !== highlighter) {
                  if (this.plugin.settings.highlighterOrder.includes(newName)) {
                    new Notice("This color name already exists");
                    return;
                  }
                  const index = this.plugin.settings.highlighterOrder.indexOf(highlighter);
                  if (index > -1) {
                    this.plugin.settings.highlighterOrder[index] = newName;
                  }
                  this.plugin.settings.highlighters[newName] = newVal;
                  delete this.plugin.settings.highlighters[highlighter];
                  (this.app as any).commands.removeCommand(`highlightr-plugin:${highlighter}`);
                } else {
                  this.plugin.settings.highlighters[highlighter] = newVal;
                }
                
                await this.plugin.saveSettings();
                setTimeout(() => {
                  dispatchEvent(new Event("Highlightr-NewCommand"));
                }, 100);
                this.display();
              } else {
                new Notice("Name or color cannot be empty");
              }
            }
          });
      });

      setting.addButton((button) => {
        button
          .setClass("HighlightrSettingsButton")
          .setClass("HighlightrSettingsButtonDelete")
          .setIcon("highlightr-delete")
          .setTooltip("Remove")
          .onClick(async () => {
            new Notice(`${highlighter} highlight deleted`);
            (this.app as any).commands.removeCommand(
              `highlightr-plugin:${highlighter}`
            );
            delete this.plugin.settings.highlighters[highlighter];
            this.plugin.settings.highlighterOrder.remove(highlighter);
            setTimeout(() => {
              dispatchEvent(new Event("Highlightr-NewCommand"));
            }, 100);
            await this.plugin.saveSettings();
            this.display();
          });
      });

      const a = createEl("a");
      a.setAttribute("href", "");
    });
  }
}
