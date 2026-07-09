// Papier — orchestrateur du frontend.
import "./styles.css";
import sampleMd from "./sample.md?raw";

import { initTheme, cycleTheme, themeLabel } from "./theme";
import {
  isTauri,
  pickMarkdown,
  readMarkdown,
  writeMarkdown,
  saveAs,
  baseName,
} from "./fileIO";
import {
  loadMarkdown,
  getMarkdown,
  setReadonly,
  onEditorChange,
  hasEditor,
} from "./editor";
import {
  splitFrontmatter,
  joinFrontmatter,
  parseFrontmatterFields,
} from "./frontmatter";
import { addRecent, getRecents, type Recent } from "./recents";
import { openFind, closeFind, isFindOpen, refreshFind } from "./find";
import { toggleOutline, refreshOutline } from "./outline";

// ------- état -------
let currentPath: string | null = null;
let currentFrontmatter: string | null = null;
let displayName: string | null = null;
let dirty = false;
let readonly = false;
let zoom = clampZoom(Number(localStorage.getItem("papier.zoom")) || 1);

// ------- refs DOM -------
const editorHost = document.getElementById("editor-host")!;
const welcomeEl = document.getElementById("welcome")!;
const docTitleEl = document.getElementById("doc-title")!;
const dirtyDotEl = document.getElementById("dirty-dot")!;
const frontmatterEl = document.getElementById("frontmatter")!;
const lockBtn = document.getElementById("lock-indicator")!;

// ------- utilitaires -------
function clampZoom(z: number): number {
  if (!isFinite(z) || z <= 0) return 1;
  return Math.min(2.2, Math.max(0.7, z));
}

function applyZoom(): void {
  document.documentElement.style.setProperty("--zoom", String(zoom));
  localStorage.setItem("papier.zoom", String(zoom));
}

function setState(state: "welcome" | "doc"): void {
  document.body.dataset.state = state;
}

let toastTimer: number | undefined;
function toast(msg: string): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("show"), 1600);
}

function updateTitle(): void {
  const name = currentPath ? baseName(currentPath) : (displayName ?? "Papier");
  docTitleEl.textContent = name;
  dirtyDotEl.classList.toggle("hidden", !dirty);
  if (isTauri) {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().setTitle((dirty ? "• " : "") + name),
      )
      .catch(() => {});
  }
}

function renderFrontmatter(): void {
  frontmatterEl.innerHTML = "";
  if (!currentFrontmatter) {
    frontmatterEl.classList.add("hidden");
    return;
  }
  const fields = parseFrontmatterFields(currentFrontmatter);
  if (!fields.length) {
    frontmatterEl.classList.add("hidden");
    return;
  }
  for (const f of fields) {
    const row = document.createElement("div");
    row.className = "fm-row";
    row.innerHTML = `<span class="fm-key"></span><span class="fm-val"></span>`;
    (row.querySelector(".fm-key") as HTMLElement).textContent = f.key;
    (row.querySelector(".fm-val") as HTMLElement).textContent = f.value;
    frontmatterEl.append(row);
  }
  frontmatterEl.classList.remove("hidden");
}

// ------- ouverture / sauvegarde -------
async function openPath(path: string): Promise<void> {
  let raw: string;
  try {
    raw = await readMarkdown(path);
  } catch (err) {
    toast("Impossible d'ouvrir le fichier");
    console.error(err);
    return;
  }
  const { frontmatter, body } = splitFrontmatter(raw);
  currentPath = path;
  currentFrontmatter = frontmatter;
  displayName = null;
  await loadMarkdown(editorHost, body);
  readonly = false;
  setReadonly(false);
  updateLockIndicator();
  dirty = false;
  addRecent(path);
  renderFrontmatter();
  updateTitle();
  setState("doc");
  refreshOutline();
  refreshFind();
}

async function doOpen(): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return;
  const path = await pickMarkdown();
  if (path) await openPath(path);
}

async function newDocument(): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return;
  currentPath = null;
  currentFrontmatter = null;
  displayName = "Sans titre";
  await loadMarkdown(editorHost, "");
  readonly = false;
  setReadonly(false);
  updateLockIndicator();
  dirty = false;
  renderFrontmatter();
  updateTitle();
  setState("doc");
  refreshOutline();
  refreshFind();
  // focus l'éditeur pour taper tout de suite
  const pm = document.querySelector(
    ".milkdown .ProseMirror",
  ) as HTMLElement | null;
  pm?.focus();
}

async function save(): Promise<void> {
  if (!hasEditor()) return;
  const body = getMarkdown();
  const full = joinFrontmatter(currentFrontmatter, body);
  if (currentPath && !currentPath.startsWith("browser://")) {
    try {
      await writeMarkdown(currentPath, full);
      dirty = false;
      updateTitle();
      toast("Enregistré");
    } catch (err) {
      toast("Échec de l'enregistrement");
      console.error(err);
    }
  } else {
    const newPath = await saveAs(full, currentPath ? baseName(currentPath) : "sans-titre.md");
    if (newPath) {
      currentPath = newPath;
      displayName = null;
      dirty = false;
      addRecent(newPath);
      updateTitle();
      toast("Enregistré");
    }
  }
}

async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!dirty) return true;
  if (isTauri) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const keep = await ask("Des modifications ne sont pas enregistrées. Les enregistrer ?", {
      title: "Papier",
      kind: "warning",
      okLabel: "Enregistrer",
      cancelLabel: "Ignorer",
    });
    if (keep) await save();
    return true;
  }
  return confirm("Modifications non enregistrées. Continuer et les perdre ?");
}

// ------- verrou lecture (Cmd+E) -------
function updateLockIndicator(): void {
  lockBtn.textContent = readonly ? "🔒 Lecture" : "✏︎ Édition";
  lockBtn.classList.toggle("locked", readonly);
}
function toggleReadonly(): void {
  readonly = !readonly;
  setReadonly(readonly);
  updateLockIndicator();
  toast(readonly ? "Mode lecture (verrouillé)" : "Édition déverrouillée");
}

// ------- zoom -------
function zoomBy(delta: number): void {
  zoom = clampZoom(zoom + delta);
  applyZoom();
  toast(`Zoom ${Math.round(zoom * 100)} %`);
}
function zoomReset(): void {
  zoom = 1;
  applyZoom();
  toast("Zoom 100 %");
}

// ------- quick-switcher (Cmd+P) -------
let switcherEl: HTMLElement | null = null;
function buildSwitcher(): void {
  switcherEl = document.createElement("div");
  switcherEl.className = "switcher hidden";
  switcherEl.innerHTML = `
    <div class="switcher-box">
      <input type="text" class="switcher-input" placeholder="Ouvrir un fichier récent…" spellcheck="false" />
      <div class="switcher-list"></div>
      <div class="switcher-foot"><kbd>↑↓</kbd> naviguer · <kbd>⏎</kbd> ouvrir · <kbd>Esc</kbd> fermer · <kbd>⌘O</kbd> parcourir</div>
    </div>`;
  document.body.append(switcherEl);
  switcherEl.addEventListener("click", (e) => {
    if (e.target === switcherEl) closeSwitcher();
  });
}
let switcherIndex = 0;
let switcherItems: Recent[] = [];

function renderSwitcher(filter: string): void {
  const listEl = switcherEl!.querySelector(".switcher-list") as HTMLElement;
  const q = filter.trim().toLowerCase();
  switcherItems = getRecents().filter(
    (r) => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
  );
  switcherIndex = 0;
  if (!switcherItems.length) {
    listEl.innerHTML = `<div class="switcher-empty">${
      getRecents().length ? "Aucun résultat" : "Aucun fichier récent — Cmd+O pour parcourir"
    }</div>`;
    return;
  }
  listEl.innerHTML = "";
  switcherItems.forEach((r, i) => {
    const item = document.createElement("button");
    item.className = "switcher-item" + (i === switcherIndex ? " active" : "");
    item.innerHTML = `<span class="sw-name"></span><span class="sw-path"></span>`;
    (item.querySelector(".sw-name") as HTMLElement).textContent = r.name;
    (item.querySelector(".sw-path") as HTMLElement).textContent = r.path;
    item.addEventListener("click", () => {
      closeSwitcher();
      openGuarded(r.path);
    });
    listEl.append(item);
  });
}
function moveSwitcher(dir: number): void {
  if (!switcherItems.length) return;
  switcherIndex = (switcherIndex + dir + switcherItems.length) % switcherItems.length;
  const items = switcherEl!.querySelectorAll(".switcher-item");
  items.forEach((el, i) => el.classList.toggle("active", i === switcherIndex));
  items[switcherIndex]?.scrollIntoView({ block: "nearest" });
}
function openSwitcher(): void {
  if (!switcherEl) buildSwitcher();
  const input = switcherEl!.querySelector(".switcher-input") as HTMLInputElement;
  switcherEl!.classList.remove("hidden");
  input.value = "";
  renderSwitcher("");
  input.focus();
  input.oninput = () => renderSwitcher(input.value);
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveSwitcher(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSwitcher(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const r = switcherItems[switcherIndex];
      if (r) { closeSwitcher(); openGuarded(r.path); }
    } else if (e.key === "Escape") { e.preventDefault(); closeSwitcher(); }
  };
}
function closeSwitcher(): void {
  switcherEl?.classList.add("hidden");
}
function isSwitcherOpen(): boolean {
  return !!switcherEl && !switcherEl.classList.contains("hidden");
}

async function openGuarded(path: string): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return;
  await openPath(path);
}

// ------- clavier -------
function onKey(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey;

  // Esc ferme les surcouches en priorité
  if (e.key === "Escape") {
    if (isFindOpen()) { closeFind(); return; }
    if (isSwitcherOpen()) { closeSwitcher(); return; }
  }
  if (!mod) return;

  // Laisse le switcher/find gérer leur propre saisie
  const inOverlayInput =
    (e.target as HTMLElement)?.classList?.contains("switcher-input") ||
    (e.target as HTMLElement)?.classList?.contains("find-input");

  const key = e.key.toLowerCase();
  switch (key) {
    case "n":
      if (inOverlayInput) return;
      e.preventDefault(); e.stopPropagation();
      newDocument();
      break;
    case "o":
      e.preventDefault(); e.stopPropagation();
      doOpen();
      break;
    case "p":
      if (e.shiftKey) return;
      e.preventDefault(); e.stopPropagation();
      isSwitcherOpen() ? closeSwitcher() : openSwitcher();
      break;
    case "f":
      e.preventDefault(); e.stopPropagation();
      openFind();
      break;
    case "s":
      e.preventDefault(); e.stopPropagation();
      save();
      break;
    case "e":
      if (inOverlayInput) return;
      e.preventDefault(); e.stopPropagation();
      toggleReadonly();
      break;
    case "\\":
      e.preventDefault(); e.stopPropagation();
      toggleOutline();
      break;
    case "=":
    case "+":
      e.preventDefault(); e.stopPropagation();
      zoomBy(0.1);
      break;
    case "-":
    case "_":
      e.preventDefault(); e.stopPropagation();
      zoomBy(-0.1);
      break;
    case "0":
      e.preventDefault(); e.stopPropagation();
      zoomReset();
      break;
    case "l":
      if (!e.shiftKey) return;
      e.preventDefault(); e.stopPropagation();
      toast("Thème : " + themeLabel(cycleTheme()));
      break;
    case "w":
      if (isTauri) {
        e.preventDefault();
        import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
          getCurrentWindow().close(),
        );
      }
      break;
    default:
      break;
  }
}

// ------- init -------
async function init(): Promise<void> {
  initTheme();
  applyZoom();
  updateLockIndicator();

  onEditorChange(() => {
    if (!dirty) {
      dirty = true;
      updateTitle();
    }
    refreshOutline();
    refreshFind();
  });

  // boutons de l'écran d'accueil
  document.getElementById("welcome-open")?.addEventListener("click", () => doOpen());
  document.getElementById("welcome-new")?.addEventListener("click", () => newDocument());
  document.getElementById("welcome-sample")?.addEventListener("click", async () => {
    const { frontmatter, body } = splitFrontmatter(sampleMd);
    currentPath = null;
    currentFrontmatter = frontmatter;
    displayName = "Exemple";
    await loadMarkdown(editorHost, body);
    renderFrontmatter();
    dirty = false;
    setState("doc");
    updateTitle();
  });
  lockBtn.addEventListener("click", () => toggleReadonly());
  document.getElementById("new-btn")?.addEventListener("click", () => newDocument());
  document.getElementById("open-btn")?.addEventListener("click", () => doOpen());
  document.getElementById("outline-btn")?.addEventListener("click", () => toggleOutline());

  window.addEventListener("keydown", onKey, true);
  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });

  renderRecentsOnWelcome();

  // Tauri : fichiers ouverts via Finder (hot + cold start)
  if (isTauri) {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string[]>("open-file", (ev) => {
      const p = ev.payload?.[0];
      if (p) openGuarded(p);
    });
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const pending = await invoke<string[]>("take_pending_files");
      if (pending?.length) {
        await openPath(pending[0]);
        return;
      }
    } catch (err) {
      console.error(err);
    }
    setState("welcome");
  } else {
    // navigateur : montre l'exemple pour pouvoir tester l'UI
    const { frontmatter, body } = splitFrontmatter(sampleMd);
    currentFrontmatter = frontmatter;
    await loadMarkdown(editorHost, body);
    renderFrontmatter();
    setState("doc");
    updateTitle();
  }
}

function renderRecentsOnWelcome(): void {
  const wrap = document.getElementById("welcome-recents");
  if (!wrap) return;
  const recents = getRecents();
  if (!recents.length) {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = '<div class="welcome-recents-title">Récents</div>';
  recents.slice(0, 6).forEach((r) => {
    const b = document.createElement("button");
    b.className = "welcome-recent";
    b.innerHTML = `<span class="wr-name"></span><span class="wr-path"></span>`;
    (b.querySelector(".wr-name") as HTMLElement).textContent = r.name;
    (b.querySelector(".wr-path") as HTMLElement).textContent = r.path;
    b.addEventListener("click", () => openGuarded(r.path));
    wrap.append(b);
  });
}

init();
