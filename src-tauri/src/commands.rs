use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const DEFAULT_MAX_ENTRIES: usize = 5_000;

#[derive(Debug, Serialize)]
pub struct WorkspaceReadResult {
    pub path: String,
    pub content: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BashCommandResult {
    pub success: bool,
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Deserialize)]
pub struct WriteFileArgs {
    pub path: String,
    pub content: String,
}

fn workspace_root() -> Result<PathBuf, String> {
    std::env::current_dir()
        .map_err(|err| format!("Could not resolve current working directory: {err}"))
        .and_then(|dir| {
            dir.canonicalize()
                .map_err(|err| format!("Could not canonicalize workspace directory {}: {err}", dir.display()))
        })
}

fn resolve_workspace_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err("Path must not be empty".to_string());
    }

    let candidate = root.join(trimmed);
    let normalized = candidate
        .components()
        .collect::<PathBuf>();

    if normalized.starts_with(root) {
        Ok(normalized)
    } else {
        Err(format!("Path escapes workspace root: {relative_path}"))
    }
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "dist"
            | "build"
            | "target"
            | "coverage"
            | ".next"
            | ".nuxt"
            | ".cache"
    )
}

fn collect_files_recursive(root: &Path, current: &Path, acc: &mut Vec<String>, max_entries: usize) {
    if acc.len() >= max_entries {
        return;
    }

    let Ok(entries) = fs::read_dir(current) else {
        return;
    };

    for entry in entries.flatten() {
        if acc.len() >= max_entries {
            break;
        }

        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            if let Some(name) = path.file_name().and_then(|v| v.to_str()) {
                if should_skip_dir(name) {
                    continue;
                }
            }
            collect_files_recursive(root, &path, acc, max_entries);
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };

        acc.push(relative.to_string_lossy().replace('\\', "/"));
    }
}

#[tauri::command]
pub fn tauri_workspace_list_files(max_entries: Option<usize>) -> Result<Vec<String>, String> {
    let root = workspace_root()?;
    let mut files = Vec::new();
    collect_files_recursive(
        &root,
        &root,
        &mut files,
        max_entries.unwrap_or(DEFAULT_MAX_ENTRIES),
    );
    files.sort();
    Ok(files)
}

#[tauri::command]
pub fn tauri_workspace_read_files(paths: Vec<String>) -> Result<Vec<WorkspaceReadResult>, String> {
    let root = workspace_root()?;

    let results = paths
        .iter()
        .map(|path| {
            let resolved = match resolve_workspace_path(&root, path) {
                Ok(value) => value,
                Err(error) => {
                    return WorkspaceReadResult {
                        path: path.clone(),
                        content: None,
                        error: Some(error),
                    }
                }
            };

            match fs::read_to_string(&resolved) {
                Ok(content) => WorkspaceReadResult {
                    path: path.clone(),
                    content: Some(content),
                    error: None,
                },
                Err(error) => WorkspaceReadResult {
                    path: path.clone(),
                    content: None,
                    error: Some(format!("Could not read {}: {error}", resolved.display())),
                },
            }
        })
        .collect();

    Ok(results)
}

#[tauri::command]
pub fn tauri_workspace_write_file(args: WriteFileArgs) -> Result<String, String> {
    let root = workspace_root()?;
    let resolved = resolve_workspace_path(&root, &args.path)?;

    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create directory {}: {error}", parent.display()))?;
    }

    fs::write(&resolved, args.content)
        .map_err(|error| format!("Could not write {}: {error}", resolved.display()))?;

    Ok(args.path)
}

#[tauri::command]
pub fn tauri_run_bash_command(command: String) -> Result<BashCommandResult, String> {
    let output = Command::new("bash")
        .arg("-lc")
        .arg(command)
        .output()
        .map_err(|error| format!("Failed to execute bash command: {error}"))?;

    let status = output.status.code().unwrap_or(-1);
    Ok(BashCommandResult {
        success: output.status.success(),
        status,
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}
