// Sommaire / table des matières (Cmd+\). Construit depuis les titres du document.

let panel: HTMLElement | null = null;
let list: HTMLElement | null = null;
let visible = false;

function ensure(): void {
  panel = panel || document.getElementById("outline");
  list = list || document.getElementById("outline-list");
}

export function rebuildOutline(): void {
  ensure();
  if (!list) return;
  const root = document.querySelector(".milkdown");
  list.innerHTML = "";
  if (!root) return;
  const heads = Array.from(
    root.querySelectorAll("h1,h2,h3,h4,h5,h6"),
  ) as HTMLElement[];
  if (!heads.length) {
    list.innerHTML = '<div class="outline-empty">Aucun titre</div>';
    return;
  }
  heads.forEach((h) => {
    const level = Number(h.tagName[1]);
    const item = document.createElement("button");
    item.className = "outline-item lvl" + level;
    item.textContent = h.textContent || "(sans titre)";
    item.title = item.textContent;
    item.addEventListener("click", () => {
      h.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    list!.append(item);
  });
}

export function toggleOutline(): void {
  ensure();
  if (!panel) return;
  visible = !visible;
  panel.classList.toggle("hidden", !visible);
  document.documentElement.dataset.outline = visible ? "1" : "0";
  if (visible) rebuildOutline();
}

export function refreshOutline(): void {
  if (visible) rebuildOutline();
}
