// Préservation non destructive du frontmatter YAML.
// Crepe ne gère pas le frontmatter : on le détache avant l'édition et on le
// ré-attache tel quel à la sauvegarde, pour ne jamais perdre ces métadonnées.

export interface Split {
  frontmatter: string | null;
  body: string;
}

export function splitFrontmatter(md: string): Split {
  const src = md.replace(/^﻿/, "");
  if (!src.startsWith("---")) return { frontmatter: null, body: md };
  const m = src.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!m) return { frontmatter: null, body: md };
  // Valide que le bloc ressemble bien à du YAML « clé: valeur ». Sinon c'est
  // un simple trait de séparation --- en tête de document (pas un frontmatter),
  // et le prendre pour tel masquerait/altérerait le corps.
  const firstLine = m[1].split(/\r?\n/).find((l) => l.trim() !== "");
  if (!firstLine || !/^[A-Za-z0-9_.$-]+\s*:/.test(firstLine)) {
    return { frontmatter: null, body: md };
  }
  // Normalise le bloc en LF (le corps sort de l'éditeur en LF) pour éviter des
  // fins de ligne mixtes à la sauvegarde.
  const frontmatter = m[0].replace(/\r\n/g, "\n");
  return { frontmatter, body: src.slice(m[0].length) };
}

export function joinFrontmatter(frontmatter: string | null, body: string): string {
  if (!frontmatter) return body;
  const fm = frontmatter.endsWith("\n") ? frontmatter : frontmatter + "\n";
  return fm + body;
}

export function parseFrontmatterFields(
  frontmatter: string,
): Array<{ key: string; value: string }> {
  const inner = frontmatter
    .replace(/^---[ \t]*\r?\n/, "")
    .replace(/\r?\n---[ \t]*(\r?\n|$)$/, "");
  const fields: Array<{ key: string; value: string }> = [];
  for (const line of inner.split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z0-9_\-. ]+):\s?(.*)$/);
    if (mm) fields.push({ key: mm[1].trim(), value: mm[2].trim() });
  }
  return fields;
}
