// Papier — orchestrateur du frontend (multi-onglets).
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
} from "./editor";
import {
  splitFrontmatter,
  joinFrontmatter,
  parseFrontmatterFields,
} from "./frontmatter";
import { addRecent, getRecents, type Recent } from "./recents";
import { openFind, closeFind, isFindOpen, refreshFind } from "./find";
import { toggleOutline, refreshOutline } from "./outline";

// ------- modèle d'onglet -------
interface Tab {
  id: number;
  path: string | null; // null = document non enregistré
  displayName: string; // "Sans titre" pour un nouveau doc
  frontmatter: string | null;
  markdown: string; // contenu courant (inclut les modifs non enregistrées)
  dirty: boolean;
  readonly: boolean;
  scroll: number;
}

let tabs: Tab[] = [];
let activeId: number | null = null;
let nextId = 1;
let zoom = clampZoom(Number(localStorage.getItem("papier.zoom")) || 1);
// Vrai juste après un (re)chargement : absorbe les événements de normalisation
// de Crepe pour ne pas marquer un fichier "modifié" à l'ouverture. Levé soit par
// un timer court (couvre les modifs souris/barre d'outils qui n'émettent pas de
// beforeinput), soit dès la première saisie clavier/coller/glisser.
let justLoaded = false;
let loadTimer: number | undefined;

const activeTab = (): Tab | null =>
  tabs.find((t) => t.id === activeId) ?? null;

// ------- refs DOM -------
const editorHost = document.getElementById("editor-host")!;
const docTitleEl = document.getElementById("doc-title");
const dirtyDotEl = document.getElementById("dirty-dot");
const frontmatterEl = document.getElementById("frontmatter")!;
const lockBtn = document.getElementById("lock-indicator");
const tabstripEl = document.getElementById("tabstrip")!;
const contentEl = document.getElementById("content")!;

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

function tabTitle(t: Tab): string {
  return t.path ? baseName(t.path) : t.displayName;
}

function updateTitle(): void {
  const t = activeTab();
  const name = t ? tabTitle(t) : "Papier";
  if (docTitleEl) docTitleEl.textContent = name;
  if (dirtyDotEl) dirtyDotEl.classList.toggle("hidden", !(t && t.dirty));
  if (isTauri) {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().setTitle((t && t.dirty ? "• " : "") + name),
      )
      .catch(() => {});
  }
}

function renderFrontmatter(): void {
  const t = activeTab();
  frontmatterEl.innerHTML = "";
  if (!t || !t.frontmatter) {
    frontmatterEl.classList.add("hidden");
    return;
  }
  const fields = parseFrontmatterFields(t.frontmatter);
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

function updateLockIndicator(): void {
  const t = activeTab();
  const ro = !!t && t.readonly;
  if (lockBtn) {
    lockBtn.textContent = ro ? "🔒 Lecture" : "✏︎ Édition";
    lockBtn.classList.toggle("locked", ro);
  }
}

// ------- barre d'onglets -------
function renderTabs(): void {
  tabstripEl.innerHTML = "";
  for (const t of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === activeId ? " active" : "");
    el.title = t.path || t.displayName;
    el.innerHTML = `<span class="tab-name"></span><span class="tab-ind"><span class="tab-dot${t.dirty ? "" : " hidden"}"></span><button class="tab-close" title="Fermer (⌘W)" tabindex="-1">✕</button></span>`;
    (el.querySelector(".tab-name") as HTMLElement).textContent = tabTitle(t);
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("tab-close")) return;
      activateTab(t.id);
    });
    el.addEventListener("mousedown", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(t.id);
      }
    });
    el.querySelector(".tab-close")!.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(t.id);
    });
    tabstripEl.append(el);
  }
  const add = document.createElement("button");
  add.className = "tab-add";
  add.title = "Nouveau document (⌘N)";
  add.textContent = "+";
  add.addEventListener("click", () => newTab());
  tabstripEl.append(add);
}

// Capture l'état vivant de l'onglet actif (contenu + scroll) avant un switch.
function syncActive(): void {
  const t = activeTab();
  if (!t) return;
  t.markdown = getMarkdown();
  t.scroll = contentEl.scrollTop;
}

async function activateTab(id: number): Promise<void> {
  if (id === activeId) return;
  syncActive();
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  activeId = id;
  justLoaded = true;
  if (loadTimer) clearTimeout(loadTimer);
  await loadMarkdown(editorHost, t.markdown);
  t.markdown = getMarkdown(); // baseline normalisée (évite un faux "modifié")
  // Fin de la phase d'absorption après un court délai : au-delà, tout changement
  // (y compris via la barre d'outils souris) est une vraie modification.
  loadTimer = window.setTimeout(() => {
    justLoaded = false;
    loadTimer = undefined;
  }, 180);
  setReadonly(t.readonly);
  renderFrontmatter();
  updateLockIndicator();
  updateTitle();
  renderTabs();
  setState("doc");
  contentEl.scrollTop = t.scroll || 0;
  refreshOutline();
  refreshFind();
}

async function newTab(): Promise<void> {
  syncActive();
  const t: Tab = {
    id: nextId++,
    path: null,
    displayName: "Sans titre",
    frontmatter: null,
    markdown: "",
    dirty: false,
    readonly: false,
    scroll: 0,
  };
  tabs.push(t);
  activeId = null; // force le (re)chargement
  await activateTab(t.id);
  const pm = document.querySelector(
    ".milkdown .ProseMirror",
  ) as HTMLElement | null;
  pm?.focus();
}

async function openInTab(path: string): Promise<void> {
  // déjà ouvert ? -> on active l'onglet existant (garde les modifs en cours)
  const existing = tabs.find((t) => t.path === path);
  if (existing) {
    await activateTab(existing.id);
    return;
  }
  let raw: string;
  try {
    raw = await readMarkdown(path);
  } catch (err) {
    toast("Impossible d'ouvrir le fichier");
    console.error(err);
    return;
  }
  const { frontmatter, body } = splitFrontmatter(raw);
  const t: Tab = {
    id: nextId++,
    path,
    displayName: baseName(path),
    frontmatter,
    markdown: body,
    dirty: false,
    readonly: false,
    scroll: 0,
  };
  tabs.push(t);
  activeId = null;
  await activateTab(t.id);
  addRecent(path);
}

async function openSampleTab(): Promise<void> {
  syncActive();
  const { frontmatter, body } = splitFrontmatter(sampleMd);
  const t: Tab = {
    id: nextId++,
    path: null,
    displayName: "Exemple",
    frontmatter,
    markdown: body,
    dirty: false,
    readonly: false,
    scroll: 0,
  };
  tabs.push(t);
  activeId = null;
  await activateTab(t.id);
}

async function doOpen(): Promise<void> {
  const path = await pickMarkdown();
  if (path) await openInTab(path);
}

// ------- fermeture d'onglet -------
async function closeTab(id: number): Promise<void> {
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  if (id === activeId) syncActive();
  // Sauvegarde automatique avant fermeture (si des modifications existent).
  if (t.dirty) {
    const ok = await saveTab(t);
    // Doc jamais enregistré + dialogue "Enregistrer sous" annulé -> on ne ferme pas
    // (on ne perd pas le contenu).
    if (!ok) return;
  }
  const idx = tabs.findIndex((x) => x.id === id);
  tabs.splice(idx, 1);
  if (id === activeId) {
    if (tabs.length) {
      const next = tabs[Math.min(idx, tabs.length - 1)];
      activeId = null;
      await activateTab(next.id);
    } else {
      activeId = null;
      setState("welcome");
      renderTabs();
      updateTitle();
      renderRecentsOnWelcome();
    }
  } else {
    renderTabs();
  }
}

// ------- enregistrement -------
async function saveTab(t: Tab): Promise<boolean> {
  if (t.id === activeId) t.markdown = getMarkdown();
  const full = joinFrontmatter(t.frontmatter, t.markdown);
  if (t.path && !t.path.startsWith("browser://")) {
    try {
      await writeMarkdown(t.path, full);
      t.dirty = false;
      renderTabs();
      updateTitle();
      return true;
    } catch (err) {
      toast("Échec de l'enregistrement");
      console.error(err);
      return false;
    }
  }
  const newPath = await saveAs(full, t.path ? baseName(t.path) : "sans-titre.md");
  if (!newPath) return false;
  t.path = newPath;
  t.displayName = baseName(newPath);
  t.dirty = false;
  addRecent(newPath);
  renderTabs();
  updateTitle();
  return true;
}

async function save(): Promise<void> {
  const t = activeTab();
  if (!t) return;
  const ok = await saveTab(t);
  if (ok) toast("Enregistré");
}

// Sauvegarde tous les onglets modifiés avant un quit / fermeture de fenêtre.
// Renvoie false si un document sans nom a vu son « Enregistrer sous » annulé
// (dans ce cas on ne ferme pas, pour ne rien perdre).
async function saveAllDirtyForQuit(): Promise<boolean> {
  syncActive();
  for (const t of tabs) {
    if (t.dirty) {
      const ok = await saveTab(t);
      if (!ok) return false;
    }
  }
  return true;
}

// ------- verrou lecture (Cmd+E) -------
function toggleReadonly(): void {
  const t = activeTab();
  if (!t) return;
  t.readonly = !t.readonly;
  setReadonly(t.readonly);
  updateLockIndicator();
  toast(t.readonly ? "Mode lecture (verrouillé)" : "Édition déverrouillée");
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
let switcherIndex = 0;
let switcherItems: Recent[] = [];
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
      openInTab(r.path);
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
      if (r) { closeSwitcher(); openInTab(r.path); }
    } else if (e.key === "Escape") { e.preventDefault(); closeSwitcher(); }
  };
}
function closeSwitcher(): void {
  switcherEl?.classList.add("hidden");
}
function isSwitcherOpen(): boolean {
  return !!switcherEl && !switcherEl.classList.contains("hidden");
}

// ------- clavier -------
function onKey(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === "Escape") {
    if (isFindOpen()) { closeFind(); return; }
    if (isSwitcherOpen()) { closeSwitcher(); return; }
  }
  if (!mod) return;

  const inOverlayInput =
    (e.target as HTMLElement)?.classList?.contains("switcher-input") ||
    (e.target as HTMLElement)?.classList?.contains("find-input");

  const key = e.key.toLowerCase();
  switch (key) {
    case "n":
      if (inOverlayInput) return;
      e.preventDefault(); e.stopPropagation();
      newTab();
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
    case "w":
      e.preventDefault(); e.stopPropagation();
      if (activeId !== null) {
        closeTab(activeId);
      } else if (isTauri) {
        import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
          getCurrentWindow().close(),
        );
      }
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
    default:
      break;
  }
}

// ------- init -------
async function init(): Promise<void> {
  initTheme();
  applyZoom();
  updateLockIndicator();
  renderTabs();

  onEditorChange((md) => {
    const t = activeTab();
    if (!t) return;
    if (justLoaded) {
      // normalisation post-chargement : on met à jour la baseline sans "modifié"
      t.markdown = md;
      return;
    }
    if (md === t.markdown) return; // no-op
    t.markdown = md;
    if (!t.dirty) {
      t.dirty = true;
      renderTabs();
      updateTitle();
    }
    refreshOutline();
    refreshFind();
  });

  // Première vraie interaction de saisie -> fin immédiate de la phase de chargement.
  const endLoad = () => {
    justLoaded = false;
    if (loadTimer) {
      clearTimeout(loadTimer);
      loadTimer = undefined;
    }
  };
  editorHost.addEventListener("beforeinput", endLoad, true);
  editorHost.addEventListener("paste", endLoad, true);
  editorHost.addEventListener("drop", endLoad, true);

  document.getElementById("welcome-open")?.addEventListener("click", () => doOpen());
  document.getElementById("welcome-new")?.addEventListener("click", () => newTab());
  document.getElementById("welcome-sample")?.addEventListener("click", () => openSampleTab());
  lockBtn?.addEventListener("click", () => toggleReadonly());

  window.addEventListener("keydown", onKey, true);
  window.addEventListener("beforeunload", (e) => {
    syncActive();
    if (tabs.some((t) => t.dirty)) e.preventDefault();
  });

  renderRecentsOnWelcome();

  if (isTauri) {
    const { listen } = await import("@tauri-apps/api/event");
    const { invoke } = await import("@tauri-apps/api/core");
    await listen<string[]>("open-file", (ev) => {
      const p = ev.payload?.[0];
      if (p) openInTab(p);
    });
    // Fermeture/quit demandé côté natif : on sauvegarde tout, puis on confirme.
    await listen("app-close-requested", async () => {
      try {
        const ok = await saveAllDirtyForQuit();
        if (!ok) return; // « Enregistrer sous » annulé -> on ne ferme pas
      } catch (err) {
        console.error(err);
      }
      try {
        await invoke("confirm_close");
      } catch (err) {
        console.error(err);
      }
    });
    try {
      const pending = await invoke<string[]>("take_pending_files");
      if (pending?.length) {
        for (const p of pending) await openInTab(p);
        return;
      }
    } catch (err) {
      console.error(err);
    }
    setState("welcome");
  } else {
    await openSampleTab();
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
    b.addEventListener("click", () => openInTab(r.path));
    wrap.append(b);
  });
}

init();
