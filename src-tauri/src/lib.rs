// Papier — lecteur/éditeur Markdown natif.
// Backend Tauri v2 : commandes fichier (std::fs, hors scope du plugin fs pour
// pouvoir ouvrir n'importe quel .md), réception des fichiers ouverts via Finder
// (RunEvent::Opened sur macOS) + buffer pour le cold-start, et single-instance.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Fichiers ouverts avant que le webview soit prêt (cold-start). Le frontend les
/// draine via `take_pending_files` au montage.
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

/// Lit n'importe quel fichier absolu. std::fs contourne totalement le scope du
/// plugin fs : une commande Tauri tourne avec les permissions du process.
#[tauri::command]
fn read_md(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Lecture impossible : {e}"))
}

/// Écrit le contenu à un chemin absolu.
#[tauri::command]
fn write_md(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("Écriture impossible : {e}"))
}

/// Draine les fichiers en attente (cold-start / ouverture pendant le démarrage).
#[tauri::command]
fn take_pending_files(app: tauri::AppHandle) -> Vec<String> {
    let state = app.state::<PendingFiles>();
    let mut buf = state.0.lock().unwrap();
    std::mem::take(&mut *buf)
}

/// Arguments CLI qui sont des chemins existants (fallback « open with » / dev).
fn collect_cli_paths() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| Path::new(a).exists())
        .collect()
}

/// Convertit des URLs file:// (venant de RunEvent::Opened) en chemins.
#[allow(dead_code)]
fn urls_to_paths(urls: &[tauri::Url]) -> Vec<String> {
    urls.iter()
        .filter(|u| u.scheme() == "file")
        .filter_map(|u| u.to_file_path().ok())
        .map(|p: PathBuf| p.to_string_lossy().into_owned())
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().manage(PendingFiles::default());

    // single-instance DOIT être le premier plugin enregistré.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Windows/Linux : le chemin arrive dans argv. macOS : il arrive plutôt
            // via RunEvent::Opened, on câble donc les deux.
            let paths: Vec<String> = argv
                .iter()
                .skip(1)
                .filter(|a| !a.starts_with('-'))
                .filter(|a| Path::new(a).exists())
                .cloned()
                .collect();
            if !paths.is_empty() {
                app.state::<PendingFiles>()
                    .0
                    .lock()
                    .unwrap()
                    .extend(paths.clone());
                let _ = app.emit("open-file", paths);
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_md,
            write_md,
            take_pending_files
        ])
        .setup(|app| {
            let cli = collect_cli_paths();
            if !cli.is_empty() {
                app.state::<PendingFiles>().0.lock().unwrap().extend(cli);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            let _ = (&app, &event);

            // Finder double-clic sur macOS = Apple Event kAEOpenDocuments, livré ici.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths = urls_to_paths(&urls);
                if !paths.is_empty() {
                    app.state::<PendingFiles>()
                        .0
                        .lock()
                        .unwrap()
                        .extend(paths.clone());
                    let _ = app.emit("open-file", paths);
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.set_focus();
                    }
                }
            }
        });
}
