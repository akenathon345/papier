// Gestion du thème : styles Crepe (clair/sombre) + thème du châssis de l'app.
// On injecte les CSS Crepe en <style> et on bascule `disabled` selon le mode.

import commonCss from "@milkdown/crepe/theme/common/style.css?inline";
import lightCss from "@milkdown/crepe/theme/classic.css?inline";
import darkCss from "@milkdown/crepe/theme/classic-dark.css?inline";

export type ThemeMode = "auto" | "light" | "dark";
const KEY = "papier.theme";

const commonEl = document.createElement("style");
commonEl.textContent = commonCss;
const lightEl = document.createElement("style");
lightEl.textContent = lightCss;
const darkEl = document.createElement("style");
darkEl.textContent = darkCss;
document.head.append(commonEl, lightEl, darkEl);

const mq = window.matchMedia("(prefers-color-scheme: dark)");
let mode: ThemeMode = (localStorage.getItem(KEY) as ThemeMode) || "auto";

function effectiveDark(): boolean {
  return mode === "auto" ? mq.matches : mode === "dark";
}

function apply(): void {
  const dark = effectiveDark();
  lightEl.disabled = dark;
  darkEl.disabled = !dark;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

mq.addEventListener("change", () => {
  if (mode === "auto") apply();
});

export function initTheme(): void {
  apply();
}

export function getThemeMode(): ThemeMode {
  return mode;
}

export function cycleTheme(): ThemeMode {
  mode = mode === "auto" ? "light" : mode === "light" ? "dark" : "auto";
  localStorage.setItem(KEY, mode);
  apply();
  return mode;
}

export function themeLabel(m: ThemeMode): string {
  return m === "auto" ? "Automatique" : m === "light" ? "Clair" : "Sombre";
}
