import type HighlightrPlugin from "src/plugin/main";
import {
  App,
  Setting,
  PluginSettingTab,
  Notice,
  TextComponent,
  ButtonComponent,
} from "obsidian";
import Pickr from "@simonwep/pickr";
import Sortable from "sortablejs";
import { HIGHLIGHTER_STYLES } from "./settingsData";
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
    // containerEl.createEl("h1", { text: "Highlightr" });
    // containerEl.createEl("p", { text: "Maintained by " }).createEl("a", {
    //   text: "thisiselijah",
    //   href: "https://github.com/thisiselijah",
    // });
    // containerEl.createEl("p", { text: " (Original by chetachi)" });
    new Setting(containerEl).setName("Highlightr").setHeading();



    new Setting(containerEl)
      .setName("Enable floating popup menu")
      .setDesc("When selecting text, automatically show a floating menu with your highlighter colors.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.enableFloatingMenu)
          .onChange(async (val) => {
            this.plugin.settings.enableFloatingMenu = val;
            await this.plugin.saveSettings();
            dispatchEvent(new Event("Highlightr-ToggleFloatingMenu"));
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
          .onChange(async (highlighterStyle) => {
            this.plugin.settings.highlighterStyle = highlighterStyle;
            await this.plugin.saveSettings();
            this.plugin.refresh();
          });
      });

    const styleDemo = () => {
      const d = createEl("p", { cls: "highlighter-style-demo" });
      d.createEl("span", { text: "Lowlight", cls: "hltr-style-demo-lowlight" });
      d.createEl("span", { text: "Floating", cls: "hltr-style-demo-floating" });
      d.createEl("span", { text: "Realistic", cls: "hltr-style-demo-realistic" });
      d.createEl("span", { text: "Rounded", cls: "hltr-style-demo-rounded" });
      return d;
    };

    stylesSetting.infoEl.appendChild(styleDemo());

    new Setting(containerEl)
      .setName("Highlight color change behavior")
      .setDesc("Choose what happens when you change the color of a sub-segment inside an already highlighted block.")
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          "entire": "Change entire highlight color",
          "subsegment": "Change selected sub-segment color only"
        });
        dropdown
          .setValue(this.plugin.settings.colorChangeMode || "entire")
          .onChange(async (val) => {
            this.plugin.settings.colorChangeMode = val as "entire" | "subsegment";
            await this.plugin.saveSettings();
          });
      });

    const highlighterSetting = new Setting(containerEl);

    highlighterSetting
      .setName("Choose highlight colors")
      .setClass("highlighterplugin-setting-item")
      .setDesc(
        `Create a highlight color by entering a name and a hex code. Use the picker to choose visually. Drag items to reorder.`
      );
    const inputSpan = highlighterSetting.controlEl.createEl("span", {
      cls: "highlighter-settings-inputs"
    });

    const leftGroup = inputSpan.createEl("span", { cls: "highlighter-settings-left" });
    
    const rightGroup = inputSpan.createEl("span", { cls: "highlighter-settings-right" });

    const colorInput = new TextComponent(leftGroup);
    colorInput.setPlaceholder("Color name");
    colorInput.inputEl.addClass("highlighter-settings-color");

    const valueInput = new TextComponent(leftGroup);
    valueInput.setPlaceholder("Hex Code");
    valueInput.inputEl.addClass("highlighter-settings-value");

    const pickerButton = new ButtonComponent(rightGroup);
    pickerButton.setClass("highlightr-color-picker");

    highlighterSetting
      .then(() => {
        let input = valueInput.inputEl;

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
            try { pickrCreate.setColor(typed); } catch { /* ignore */ }
          }
          window.setTimeout(() => { isManualInput = false; }, 50);
        });

        // Move pcr-app inside modal on show so Obsidian's focus trap doesn't steal focus
        const modalContainer = containerEl.closest(".modal-content") as HTMLElement;
        pickrCreate.on("show", (color: Pickr.HSVaColor | null, instance: Pickr) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- Required to access Pickr's internal app DOM element
          const pcrApp = (instance.getRoot() as unknown as { app: HTMLElement }).app;
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
            instance.hide();
          })
          .on("change", function (color: Pickr.HSVaColor) {
            if (isManualInput) return;
            colorHex = color.toHEXA().toString();
            let newColor;
            if (colorHex.length == 6) {
              newColor = `${colorHex}A6`;
            } else {
              newColor = colorHex;
            }

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
      });

    const addButton = new ButtonComponent(rightGroup);
    addButton
      .setClass("highlightr-settings-button")
      .setCta()
      .setIcon("highlightr-save")
      .setTooltip("Save")
      .onClick(async (buttonEl: MouseEvent) => {
        let color = colorInput.inputEl.value.replace(" ", "-");
            let value = valueInput.inputEl.value.trim().toUpperCase();

            if (value && /^[0-9A-Fa-f]{3,8}$/.test(value)) {
              value = "#" + value;
            }

            if (color && value) {
              if (this.plugin.settings.highlighterOrder.indexOf(color) === -1) {
                this.plugin.settings.highlighterOrder.push(color);
                this.plugin.settings.highlighters[color] = value;
                window.setTimeout(() => {
                  dispatchEvent(new Event("Highlightr-NewCommand"));
                }, 100);
                await this.plugin.saveSettings();
                this.display();
              } else {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- MouseEvent
                buttonEl.stopImmediatePropagation();
                new Notice("This color already exists");
              }
            } else {
              if (color && !value) {
                new Notice("Highlighter hex code missing");
              } else if (!color && value) {
                new Notice("Highlighter name missing");
              } else {
                new Notice("Highlighter values missing");
              }
            }
          });

    const highlightersContainer = containerEl.createEl("div", {
      cls: "highlightr-settings-tabs-container",
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
      onSort: (command: Sortable.SortableEvent) => {
        if (command.oldIndex !== undefined && command.newIndex !== undefined) {
          const arrayResult = this.plugin.settings.highlighterOrder;
          const [removed] = arrayResult.splice(command.oldIndex, 1);
          arrayResult.splice(command.newIndex, 0, removed);
          this.plugin.settings.highlighterOrder = arrayResult;
          this.plugin.saveSettings().catch(() => {});
        }
      },
    });

    this.plugin.settings.highlighterOrder.forEach((highlighter) => {
      const settingItem = highlightersContainer.createEl("div");
      settingItem.addClass("highlighter-item-draggable");
      const setting = new Setting(settingItem)
        .setClass("highlighter-setting-item");

      const colorIcon = createEl("span");
      colorIcon.addClass("highlighter-setting-icon");
      
      const svg = activeDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      const circle = activeDocument.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", "12");
      circle.setAttribute("cy", "12");
      circle.setAttribute("r", "8");
      circle.setAttribute("fill", this.plugin.settings.highlighters[highlighter]);
      svg.appendChild(circle);
      colorIcon.appendChild(svg);
      
      setting.infoEl.addClass("highlighter-info-el");

      const renderNormalMode = () => {
        setting.infoEl.empty();
        setting.infoEl.appendChild(colorIcon);

        const infoGroup = setting.infoEl.createEl("div", { cls: "highlighter-info-group" });
        infoGroup.createEl("span", { text: highlighter, cls: "highlighter-name-span" });
        infoGroup.createEl("span", { text: this.plugin.settings.highlighters[highlighter], cls: "highlighter-val-span" });
      };

      renderNormalMode();

      let isEditing = false;
      let nameInputEl: HTMLInputElement;
      let valInputEl: HTMLInputElement;

      setting.addButton((button) => {
        button
          .setClass("highlightr-settings-button")
          .setCta()
          .setIcon("pencil")
          .setTooltip("Edit")
          .onClick(async () => {
            if (!isEditing) {
              isEditing = true;
              setting.infoEl.empty();
              setting.infoEl.removeClass("is-editing");
              setting.infoEl.addClass("is-editing");
              setting.infoEl.appendChild(colorIcon);

              nameInputEl = setting.infoEl.createEl("input", { type: "text", value: highlighter, cls: "highlighter-name-input" });

              valInputEl = setting.infoEl.createEl("input", { type: "text", value: this.plugin.settings.highlighters[highlighter], cls: "highlighter-val-input" });

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
                  if (this.plugin.settings.highlighterOrder.indexOf(newName) !== -1) {
                    new Notice("This color name already exists");
                    return;
                  }
                  const index = this.plugin.settings.highlighterOrder.indexOf(highlighter);
                  if (index > -1) {
                    this.plugin.settings.highlighterOrder[index] = newName;
                  }
                  this.plugin.settings.highlighters[newName] = newVal;
                  delete this.plugin.settings.highlighters[highlighter];
                  this.plugin.app.commands.removeCommand(`content-highlight:${highlighter}`);
                } else {
                  this.plugin.settings.highlighters[highlighter] = newVal;
                }
                
                await this.plugin.saveSettings();
                window.setTimeout(() => {
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
          .setClass("highlightr-settings-button")
          .setWarning()
          .setIcon("highlightr-delete")
          .setTooltip("Remove")
          .onClick(async () => {
            new Notice(`${highlighter} highlight deleted`);
            this.plugin.app.commands.removeCommand(
              `content-highlight:${highlighter}`
            );
            delete this.plugin.settings.highlighters[highlighter];
            this.plugin.settings.highlighterOrder.remove(highlighter);
            window.setTimeout(() => {
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
