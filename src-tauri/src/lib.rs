// Papier — lecteur/éditeur Markdown natif.
// Backend Tauri v2 : commandes fichier (std::fs, hors scope du plugin fs pour
// pouvoir ouvrir n'importe quel .md), réception des fichiers ouverts via Finder
// (RunEvent::Opened sur macOS) + buffer pour le cold-start, single-instance, et
// interception de la fermeture/quit pour sauvegarder les onglets modifiés.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Fichiers ouverts avant que le webview soit prêt (cold-start).
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

/// Passe à vrai quand le frontend a fini de sauvegarder et autorise la fermeture.
struct CloseReady(AtomicBool);

#[tauri::command]
fn read_md(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Lecture impossible : {e}"))
}

#[tauri::command]
fn write_md(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("Écriture impossible : {e}"))
}

/// Dossier par défaut des documents auto-enregistrés : ~/Documents/Papier (créé au besoin).
#[tauri::command]
fn default_dir(app: tauri::AppHandle) -> Result<String, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("Dossier Documents introuvable : {e}"))?;
    let dir = docs.join("Papier");
    fs::create_dir_all(&dir).map_err(|e| format!("Création du dossier impossible : {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn rename_md(from: String, to: String) -> Result<(), String> {
    fs::rename(&from, &to).map_err(|e| format!("Renommage impossible : {e}"))
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn delete_md(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("Suppression impossible : {e}"))
}

/// Vrai si a et b désignent le même fichier (résout la casse sur APFS).
#[tauri::command]
fn same_file(a: String, b: String) -> bool {
    match (fs::canonicalize(&a), fs::canonicalize(&b)) {
        (Ok(pa), Ok(pb)) => pa == pb,
        _ => a == b,
    }
}

#[tauri::command]
fn take_pending_files(app: tauri::AppHandle) -> Vec<String> {
    let state = app.state::<PendingFiles>();
    let mut buf = state.0.lock().unwrap();
    std::mem::take(&mut *buf)
}

/// Appelé par le frontend une fois tous les onglets modifiés sauvegardés.
#[tauri::command]
fn confirm_close(app: tauri::AppHandle) {
    app.state::<CloseReady>().0.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn collect_cli_paths() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| Path::new(a).exists())
        .collect()
}

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
    let mut builder = tauri::Builder::default()
        .manage(PendingFiles::default())
        .manage(CloseReady(AtomicBool::new(false)));

    // single-instance DOIT être le premier plugin enregistré.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
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
            take_pending_files,
            confirm_close,
            default_dir,
            rename_md,
            path_exists,
            delete_md,
            same_file
        ])
        .setup(|app| {
            let cli = collect_cli_paths();
            if !cli.is_empty() {
                app.state::<PendingFiles>().0.lock().unwrap().extend(cli);
            }
            Ok(())
        })
        // Fermeture de fenêtre (bouton rouge / Cmd+W sur dernière fenêtre) :
        // on empêche, on demande au frontend de sauvegarder, il rappellera confirm_close.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if app.state::<CloseReady>().0.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                let _ = app.emit("app-close-requested", ());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                // Finder double-clic sur macOS = Apple Event kAEOpenDocuments.
                #[cfg(any(target_os = "macos", target_os = "ios"))]
                tauri::RunEvent::Opened { urls } => {
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
                // Quit de l'app (Cmd+Q) : on empêche, on sauvegarde, puis on confirme.
                tauri::RunEvent::ExitRequested { api, .. } => {
                    if !app.state::<CloseReady>().0.load(Ordering::SeqCst) {
                        api.prevent_exit();
                        let _ = app.emit("app-close-requested", ());
                    }
                }
                _ => {}
            }
        });
}
