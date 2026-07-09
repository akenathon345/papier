// Recherche dans le document (Cmd+F). Utilise la CSS Custom Highlight API pour
// surligner sans modifier le DOM de ProseMirror (fallback window.find sinon).

let bar: HTMLElement | null = null;
let input: HTMLInputElement | null = null;
let counter: HTMLElement | null = null;
let ranges: Range[] = [];
let current = -1;

type HighlightRegistry = {
  set: (name: string, hl: unknown) => void;
  delete: (name: string) => void;
};
const HL: HighlightRegistry | null =
  typeof CSS !== "undefined" && "highlights" in CSS
    ? (CSS as unknown as { highlights: HighlightRegistry }).highlights
    : null;

const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown })
  .Highlight;
const supportsHighlight = !!HL && !!HighlightCtor;

function editorRoot(): HTMLElement {
  return (
    (document.querySelector(".milkdown") as HTMLElement) || document.body
  );
}

function clearHighlights(): void {
  if (HL) {
    HL.delete("find");
    HL.delete("find-current");
  }
  ranges = [];
  current = -1;
}

function collectTextNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = (n as Text).parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.tagName === "STYLE" || p.tagName === "SCRIPT")
        return NodeFilter.FILTER_REJECT;
      if (!n.nodeValue || !n.nodeValue.trim())
        return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const out: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) out.push(node as Text);
  return out;
}

function search(query: string): void {
  clearHighlights();
  if (!query) {
    updateCounter();
    return;
  }
  if (!supportsHighlight) {
    updateCounter();
    return; // navigation gérée par window.find dans next()
  }
  const q = query.toLowerCase();
  for (const node of collectTextNodes(editorRoot())) {
    const text = node.nodeValue!.toLowerCase();
    let idx = text.indexOf(q, 0);
    while (idx !== -1) {
      const r = document.createRange();
      r.setStart(node, idx);
      r.setEnd(node, idx + q.length);
      ranges.push(r);
      idx = text.indexOf(q, idx + q.length);
    }
  }
  if (ranges.length && HL && HighlightCtor) {
    HL.set("find", new HighlightCtor(...ranges));
    current = 0;
    focusCurrent();
  }
  updateCounter();
}

function focusCurrent(): void {
  if (!HL || !HighlightCtor) return;
  if (current < 0 || current >= ranges.length) {
    HL.delete("find-current");
    return;
  }
  HL.set("find-current", new HighlightCtor(ranges[current]));
  const el = ranges[current].startContainer.parentElement;
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  updateCounter();
}

function next(dir: number): void {
  if (!supportsHighlight) {
    const w = window as unknown as {
      find?: (s: string, cs: boolean, bw: boolean, wrap: boolean) => boolean;
    };
    if (input?.value && w.find) w.find(input.value, false, dir < 0, true);
    return;
  }
  if (!ranges.length) return;
  current = (current + dir + ranges.length) % ranges.length;
  focusCurrent();
}

function updateCounter(): void {
  if (!counter) return;
  if (ranges.length) counter.textContent = `${current + 1} / ${ranges.length}`;
  else counter.textContent = input?.value ? "0" : "";
}

function ensureBar(): void {
  if (bar) return;
  bar = document.createElement("div");
  bar.className = "find-bar hidden";
  bar.innerHTML = `
    <input type="text" class="find-input" placeholder="Rechercher…" spellcheck="false" autocapitalize="off" />
    <span class="find-count"></span>
    <button class="find-btn find-prev" title="Précédent (⇧⏎)" tabindex="-1">↑</button>
    <button class="find-btn find-next" title="Suivant (⏎)" tabindex="-1">↓</button>
    <button class="find-btn find-close" title="Fermer (Esc)" tabindex="-1">✕</button>`;
  document.body.append(bar);
  input = bar.querySelector(".find-input");
  counter = bar.querySelector(".find-count");
  input!.addEventListener("input", () => search(input!.value));
  input!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      next(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeFind();
    }
  });
  bar.querySelector(".find-prev")!.addEventListener("click", () => next(-1));
  bar.querySelector(".find-next")!.addEventListener("click", () => next(1));
  bar.querySelector(".find-close")!.addEventListener("click", () => closeFind());
}

export function openFind(): void {
  ensureBar();
  bar!.classList.remove("hidden");
  input!.focus();
  input!.select();
  if (input!.value) search(input!.value);
}

export function closeFind(): void {
  if (!bar) return;
  bar.classList.add("hidden");
  clearHighlights();
  updateCounter();
}

export function isFindOpen(): boolean {
  return !!bar && !bar.classList.contains("hidden");
}

export function refreshFind(): void {
  if (isFindOpen() && input?.value) search(input.value);
}
