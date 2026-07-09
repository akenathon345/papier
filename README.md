# Papier

Lecteur / éditeur Markdown natif pour macOS. Fini de lire du Markdown balisé :
Papier affiche vos fichiers `.md` bien mis en page, avec édition inline façon
Notion et les raccourcis qui vont avec.

## Fonctions

- Rendu propre et éditorial du Markdown (titres, listes, tableaux, code, citations, tâches)
- Édition inline permanente (WYSIWYG, moteur Milkdown/Crepe)
- Verrou lecture (Cmd+E) pour lire sans risquer de modifier
- Thème clair / sombre automatique (suit macOS)
- Sommaire, recherche dans le document, fichiers récents
- S'ouvre au double-clic depuis le Finder, définissable comme app par défaut des `.md`
- Le frontmatter YAML est préservé (jamais perdu à la sauvegarde)

## Raccourcis

| Raccourci        | Action                                   |
| ---------------- | ---------------------------------------- |
| `Cmd + O`        | Ouvrir un fichier                        |
| `Cmd + P`        | Fichiers récents (quick switcher)        |
| `Cmd + F`        | Rechercher dans le document              |
| `Cmd + E`        | Verrouiller / déverrouiller l'édition    |
| `Cmd + S`        | Enregistrer                              |
| `Cmd + B` / `I`  | Gras / Italique (en édition)             |
| `Cmd + +` / `-`  | Zoom texte                               |
| `Cmd + 0`        | Réinitialiser le zoom                    |
| `Cmd + Maj + L`  | Thème clair / sombre                     |
| `Cmd + \`        | Afficher / masquer le sommaire           |
| `Cmd + W`        | Fermer                                   |

## Développement

```bash
npm install
npm run tauri dev      # app en mode dev (HMR)
npm run tauri build    # build release -> src-tauri/target/release/bundle/
```

Le frontend peut aussi tourner seul dans un navigateur (`npm run dev`) : hors
contexte Tauri il charge un document d'exemple pour itérer sur l'UI.

## Installer sur le Mac + définir par défaut

```bash
npm run tauri build
bash scripts/install-macos.sh
```

Le script copie `Papier.app` dans `/Applications`, l'enregistre auprès de Launch
Services et l'associe aux fichiers Markdown via `duti`.

Pour revenir en arrière : Finder → clic droit sur un `.md` → Lire les informations
→ « Ouvrir avec » → choisir une autre app → « Tout modifier… ».

## Limites connues (v1)

- Les images en **chemin local relatif** (`![](img/x.png)`) ne s'affichent pas
  encore (les images distantes `https://…` fonctionnent). Rendu texte uniquement
  pour ces cas.
- La sauvegarde **canonicalise** le Markdown (met au propre : `**gras**`, tables
  réalignées, etc.). Le fichier n'est réécrit que si vous avez modifié quelque chose.

## Pile technique

Tauri v2 (Rust) · Milkdown Crepe (WYSIWYG) · Vite + TypeScript.
