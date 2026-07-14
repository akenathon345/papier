// Fichiers récents, persistés en localStorage (pour le quick-switcher Cmd+P).

export interface Recent {
  path: string;
  name: string;
  ts: number;
}

const KEY = "papier.recents";
const MAX = 300; // historique complet des fichiers ouverts

export function getRecents(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function addRecent(path: string): void {
  if (path.startsWith("browser://")) return;
  const name = path.split("/").pop() || path;
  const list = getRecents().filter((r) => r.path !== path);
  list.unshift({ path, name, ts: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export function removeRecent(path: string): void {
  localStorage.setItem(
    KEY,
    JSON.stringify(getRecents().filter((r) => r.path !== path)),
  );
}

export function clearRecents(): void {
  localStorage.removeItem(KEY);
}
