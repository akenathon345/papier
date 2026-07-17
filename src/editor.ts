// Enveloppe autour de Milkdown Crepe (éditeur WYSIWYG Markdown façon Notion).
// Édition inline permanente ; verrou lecture optionnel (Cmd+E).

import { Crepe } from "@milkdown/crepe";

let crepe: Crepe | null = null;
let changeCb: ((markdown: string) => void) | null = null;

export function onEditorChange(cb: (markdown: string) => void): void {
  changeCb = cb;
}

export async function loadMarkdown(
  host: HTMLElement,
  markdown: string,
): Promise<void> {
  // Crepe n'a pas de setMarkdown : on détruit puis on recrée.
  if (crepe) {
    await crepe.destroy();
    crepe = null;
  }
  host.replaceChildren();
  crepe = new Crepe({
    root: host,
    defaultValue: markdown,
    features: {
      // Le "virtual cursor" positionne le caret en pixels écran ; avec le zoom
      // CSS (Cmd+/-) ses coordonnées dérivent. Le caret natif suit la mise en
      // page dans tous les cas.
      [Crepe.Feature.Cursor]: false,
    },
  });
  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, md, prev) => {
      if (md === prev) return;
      changeCb?.(md);
    });
  });
  await crepe.create();

  // Coupe les suggestions de fins de mots (prédiction inline de macOS/WebKit)
  // et l'autocorrection dans l'éditeur.
  const pm = host.querySelector(".ProseMirror") as HTMLElement | null;
  if (pm) {
    pm.setAttribute("writingsuggestions", "false");
    pm.setAttribute("autocorrect", "off");
    pm.setAttribute("autocapitalize", "off");
  }
}

export function getMarkdown(): string {
  return crepe ? crepe.getMarkdown() : "";
}

export function hasEditor(): boolean {
  return !!crepe;
}

export function setReadonly(readonly: boolean): void {
  const anyCrepe = crepe as unknown as {
    setReadonly?: (v: boolean) => void;
  } | null;
  if (anyCrepe && typeof anyCrepe.setReadonly === "function") {
    anyCrepe.setReadonly(readonly);
  }
  const pm = document.querySelector(
    ".milkdown .ProseMirror",
  ) as HTMLElement | null;
  if (pm) pm.setAttribute("contenteditable", readonly ? "false" : "true");
  document.documentElement.dataset.readonly = readonly ? "1" : "0";
}
