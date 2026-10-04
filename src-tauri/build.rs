fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "device_open",
            "device_open_session",
            "device_import_session",
            "device_close",
            "request_tauri_storage_reset",
            "tauri_workspace_list_files",
            "tauri_workspace_read_files",
            "tauri_workspace_write_file",
            "tauri_run_bash_command",
        ]),
    ))
    .expect("Tauri build");
}
