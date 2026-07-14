// Entrées/sorties fichier. En contexte Tauri : dialog natif + commandes Rust
// (std::fs) pour lire/écrire n'importe quel chemin. En navigateur (dev/preview) :
// fallback <input type=file> / download, pour pouvoir itérer sur l'UI.

export const isTauri =
  typeof (window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__ !== "undefined";

const MD_EXT = ["md", "markdown", "mdown", "mkd", "mdwn", "txt"];

async function tauriDialog() {
  return import("@tauri-apps/plugin-dialog");
}
async function tauriCore() {
  return import("@tauri-apps/api/core");
}

export async function pickMarkdown(): Promise<string | null> {
  if (!isTauri) return pickInBrowser();
  const d = await tauriDialog();
  const sel = await d.open({
    multiple: false,
    directory: false,
    filters: [{ name: "Markdown", extensions: MD_EXT }],
  });
  if (typeof sel === "string") return sel;
  if (sel && typeof sel === "object" && "path" in sel) {
    return (sel as { path: string }).path;
  }
  return null;
}

export async function readMarkdown(path: string): Promise<string> {
  if (path.startsWith("browser://")) return browserContent?.text ?? "";
  const c = await tauriCore();
  return c.invoke<string>("read_md", { path });
}

export async function writeMarkdown(
  path: string,
  contents: string,
): Promise<void> {
  if (!isTauri || path.startsWith("browser://")) {
    downloadInBrowser(path, contents);
    return;
  }
  const c = await tauriCore();
  await c.invoke("write_md", { path, contents });
}

export async function saveAs(
  contents: string,
  suggestedName = "sans-titre.md",
): Promise<string | null> {
  if (!isTauri) {
    downloadInBrowser(suggestedName, contents);
    return null;
  }
  const d = await tauriDialog();
  const path = await d.save({
    defaultPath: suggestedName,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  if (!path) return null;
  await writeMarkdown(path, contents);
  return path;
}

export function baseName(path: string): string {
  if (path.startsWith("browser://")) return path.slice("browser://".length);
  return path.split("/").pop() || path;
}

// --- auto-enregistrement (Tauri uniquement) ---
export async function getDefaultDir(): Promise<string> {
  const c = await tauriCore();
  return c.invoke<string>("default_dir");
}
export async function renameFile(from: string, to: string): Promise<void> {
  const c = await tauriCore();
  await c.invoke("rename_md", { from, to });
}
export async function pathExists(path: string): Promise<boolean> {
  if (!isTauri) return false;
  const c = await tauriCore();
  return c.invoke<boolean>("path_exists", { path });
}
export async function deleteFile(path: string): Promise<void> {
  const c = await tauriCore();
  await c.invoke("delete_md", { path });
}
export async function sameFile(a: string, b: string): Promise<boolean> {
  if (!isTauri) return a === b;
  const c = await tauriCore();
  return c.invoke<boolean>("same_file", { a, b });
}

// --- fallbacks navigateur ---
let browserContent: { name: string; text: string } | null = null;

function pickInBrowser(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt,.mkd,text/markdown";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        browserContent = { name: f.name, text: String(reader.result) };
        resolve("browser://" + f.name);
      };
      reader.readAsText(f);
    };
    input.click();
  });
}

function downloadInBrowser(name: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = baseName(name) || "document.md";
  a.click();
  URL.revokeObjectURL(a.href);
}
