// Dérivation du titre et du nom de fichier d'un document auto-enregistré.

/// Titre lisible = première ligne qui, une fois les marqueurs Markdown retirés,
/// donne du texte non vide (une ligne « # » seule est ignorée au profit de la
/// suivante).
export function docTitle(markdown: string): string {
  for (const raw of markdown.split(/\r?\n/)) {
    const stripped = raw
      .replace(/^#{1,6}\s+/, "") // # Titre -> Titre
      .replace(/^>\s+/, "") // citation
      .replace(/^[-*+]\s+/, "") // puce
      .trim();
    if (stripped) return stripped.slice(0, 120);
  }
  return "";
}

/// Nom de fichier sûr dérivé du titre (seuls les caractères interdits par le
/// système de fichiers et les caractères de contrôle sont retirés ; les tirets
/// et espaces sont conservés).
export function sanitizeName(title: string): string {
  const cleaned = Array.from(title)
    .map((ch) => {
      const code = ch.codePointAt(0) || 0;
      if (code < 0x20) return " "; // contrôle
      if ('/\\:*?"<>|'.includes(ch)) return " "; // interdits
      return ch;
    })
    .join("")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "") // pas de nom commençant par un point
    .trim()
    .slice(0, 80)
    .trim();
  return cleaned || "Sans titre";
}
