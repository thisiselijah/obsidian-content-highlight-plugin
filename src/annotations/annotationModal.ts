import { App, Modal, Setting } from "obsidian";

export class AnnotationModal extends Modal {
  constructor(
    app: App,
    private initialNote: string,
    private onSubmit: (note: string) => void
  ) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("Annotate highlight");

    const input = this.contentEl.createEl("textarea", { cls: "hltr-annotation-input" });
    input.value = this.initialNote;
    input.rows = 3;
    input.placeholder = "Write a note for this highlight…";
    input.addEventListener("keydown", (evt) => {
      // isComposing: don't submit while an IME (e.g. Zhuyin, Pinyin) is still composing.
      if (evt.key === "Enter" && !evt.shiftKey && !evt.isComposing) {
        evt.preventDefault();
        this.submit(input.value);
      }
    });

    const buttons = new Setting(this.contentEl);
    if (this.initialNote) {
      buttons.addButton((button) =>
        button
          .setButtonText("Remove note")
          .setWarning()
          .onClick(() => this.submit(""))
      );
    }
    buttons.addButton((button) =>
      button
        .setButtonText("Save")
        .setCta()
        .onClick(() => this.submit(input.value))
    );

    window.setTimeout(() => input.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
  }

  private submit(note: string) {
    this.onSubmit(note);
    this.close();
  }
}
