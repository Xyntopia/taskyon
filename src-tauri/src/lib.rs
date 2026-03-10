use serde::Deserialize;
use serde::Serialize;
use std::fmt::Write as _;
use std::path::PathBuf;
use tauri::{webview::NewWindowResponse, webview::Url, Listener, WebviewUrl};
use tracing_subscriber::EnvFilter;
use tauri::Manager;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RunMode {
    Gui,
    Headless,
}

#[derive(Clone, Debug)]
struct RunConfig {
    mode: RunMode,
    run_diagnostics: bool,
    diagnostics_detailed: bool,
    diagnostics_no_gui: bool,
    diagnostics_filter: Option<String>,
    diagnostics_stdout: bool,
    all_logs: bool,
}

#[derive(Debug, Deserialize)]
struct DiagnosticsResultPayload {
    passed: bool,
    total: usize,
    failed: usize,
}

#[derive(Debug, Deserialize)]
struct DiagnosticsProgressPayload {
    phase: String,
    test: String,
    ok: Option<bool>,
    #[serde(rename = "errorMessage")]
    error_message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ConsolePayload {
    level: String,
    message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HeadlessLogPolicy {
    DiagnosticsTestCentric,
    ServerOperational,
    AllLogs,
}

fn normalize_level(level: &str) -> String {
    level.trim().to_uppercase()
}

fn is_warning_or_error(level: &str) -> bool {
    matches!(
        normalize_level(level).as_str(),
        "WARN" | "WARNING" | "ERROR"
    )
}

fn classify_headless_log_policy(config: &RunConfig) -> HeadlessLogPolicy {
    if config.all_logs {
        HeadlessLogPolicy::AllLogs
    } else if config.run_diagnostics {
        HeadlessLogPolicy::DiagnosticsTestCentric
    } else {
        HeadlessLogPolicy::ServerOperational
    }
}

const HEADLESS_KEEP_TAG: &str = "[HEADLESS][KEEP]";

fn has_headless_keep_tag(message: &str) -> bool {
    message.contains(HEADLESS_KEEP_TAG)
}

fn policy_allows_headless_console(policy: HeadlessLogPolicy, level: &str, message: &str) -> bool {
    if is_warning_or_error(level) {
        return true;
    }

    match policy {
        HeadlessLogPolicy::AllLogs => true,
        HeadlessLogPolicy::DiagnosticsTestCentric | HeadlessLogPolicy::ServerOperational => {
            has_headless_keep_tag(message)
        }
    }
}

fn print_headless_line(level: &str, message: &str) {
    println!("[HEADLESS][{}] {}", normalize_level(level), message);
}

fn detect_run_config() -> RunConfig {
    let args: Vec<String> = std::env::args().collect();
    let mode = if args
        .iter()
        .any(|arg| arg == "--headless" || arg == "--serve")
    {
        RunMode::Headless
    } else {
        RunMode::Gui
    };

    let diagnostics_filter = arg_value(&args, "--test-filter")
        .or_else(|| arg_value(&args, "--diagnostics-filter"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let run_diagnostics = args
        .iter()
        .any(|arg| arg == "--run-diagnostics" || arg == "--diagnostics");

    RunConfig {
        mode,
        run_diagnostics,
        diagnostics_detailed: args.iter().any(|arg| arg == "--diagnostics-detailed"),
        diagnostics_no_gui: !args.iter().any(|arg| arg == "--diagnostics-gui"),
        diagnostics_filter,
        diagnostics_stdout: run_diagnostics
            || has_arg(&args, "--stdout")
            || has_arg(&args, "--diagnostics-stdout")
            || has_arg(&args, "--diagnostics-verbose"),
        all_logs: has_arg(&args, "--all-logs") || has_arg(&args, "--diagnostics-all-logs"),
    }
}

fn headless_url(config: &RunConfig) -> String {
    if config.run_diagnostics {
        let details = if config.diagnostics_detailed {
            "1"
        } else {
            "0"
        };
        let no_gui = if config.diagnostics_no_gui { "1" } else { "0" };
        let mut url =
            format!("/headless?runDiagnostics=1&details={details}&nogui={no_gui}&close=1&emit=1");
        if let Some(filter) = config.diagnostics_filter.as_deref() {
            url.push_str("&testFilter=");
            url.push_str(&url_encode_query_value(filter));
        }
        if config.diagnostics_stdout {
            url.push_str("&stdout=1");
        }
        url
    } else {
        "/headless".to_string()
    }
}

fn arg_value(args: &[String], flag: &str) -> Option<String> {
    let with_equals = format!("{flag}=");
    for (idx, arg) in args.iter().enumerate() {
        if let Some(value) = arg.strip_prefix(&with_equals) {
            return Some(value.to_string());
        }
        if arg == flag {
            if let Some(next) = args.get(idx + 1) {
                if !next.starts_with("--") {
                    return Some(next.clone());
                }
            }
        }
    }
    None
}

fn has_arg(args: &[String], flag: &str) -> bool {
    let with_equals = format!("{flag}=");
    args.iter()
        .any(|arg| arg == flag || arg.starts_with(&with_equals))
}

fn url_encode_query_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => {
                let _ = write!(&mut out, "%{b:02X}");
            }
        }
    }
    out
}

fn should_open_externally(url: &Url) -> bool {
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return false;
    }
    let host = url.host_str().unwrap_or_default();
    host != "localhost" && host != "127.0.0.1"
}

fn open_external_browser(url: &str) {
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();

    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();

    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();
}

const STORAGE_RESET_MARKER_FILE: &str = ".pending_storage_reset";
const STORAGE_RESET_TARGETS: [&str; 5] = [
    "databases/indexeddb",
    "localstorage",
    "CacheStorage",
    "WebKitCache",
    "hsts-storage.sqlite",
];

#[derive(Debug, Serialize)]
struct StorageResetReport {
    app_data_dir: String,
    removed: Vec<String>,
    failed: Vec<String>,
}

fn storage_reset_marker_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join(STORAGE_RESET_MARKER_FILE)
}

fn apply_pending_storage_reset(app: &tauri::AppHandle) {
    let Some(app_data_dir) = app.path().app_data_dir().ok() else {
        eprintln!("[TAURI][STORAGE][WARN] app_data_dir not available");
        return;
    };

    let marker = storage_reset_marker_path(&app_data_dir);
    if !marker.exists() {
        return;
    }

    let mut report = StorageResetReport {
        app_data_dir: app_data_dir.display().to_string(),
        removed: vec![],
        failed: vec![],
    };

    for rel in STORAGE_RESET_TARGETS {
        let path = app_data_dir.join(rel);
        if !path.exists() {
            continue;
        }
        let result = if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        match result {
            Ok(()) => report.removed.push(path.display().to_string()),
            Err(err) => report
                .failed
                .push(format!("{}: {}", path.display(), err)),
        }
    }

    if let Err(err) = std::fs::remove_file(&marker) {
        report
            .failed
            .push(format!("{}: {}", marker.display(), err));
    }

    if report.failed.is_empty() {
        println!(
            "[TAURI][STORAGE][RESET][OK] {}",
            serde_json::to_string(&report).unwrap_or_else(|_| "{}".to_string())
        );
    } else {
        eprintln!(
            "[TAURI][STORAGE][RESET][WARN] {}",
            serde_json::to_string(&report).unwrap_or_else(|_| "{}".to_string())
        );
    }
}

#[tauri::command]
fn request_tauri_storage_reset(app: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app_data_dir: {e}"))?;
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Could not create app_data_dir {}: {e}", app_data_dir.display()))?;
    let marker = storage_reset_marker_path(&app_data_dir);
    std::fs::write(&marker, b"reset")
        .map_err(|e| format!("Could not create reset marker {}: {e}", marker.display()))?;

    // Exit now; reset is performed on next startup before creating a window.
    app.exit(0);
    Ok(format!(
        "Scheduled storage reset via marker {}",
        marker.display()
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http_trace_enabled = std::env::var("TASKYON_TAURI_HTTP_TRACE").as_deref() == Ok("1");

    if http_trace_enabled {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                EnvFilter::new(
                    "info,tauri_plugin_http=trace,reqwest=debug,hyper_util=debug,rustls=debug",
                )
            }))
            .try_init();
    }

    let config = detect_run_config();
    let run_mode = config.mode;

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![request_tauri_storage_reset])
        .setup(move |app| {
            app.handle().plugin(tauri_plugin_http::init())?;
            apply_pending_storage_reset(app.handle());

            if cfg!(debug_assertions) {
                if !http_trace_enabled {
                    app.handle().plugin(
                        tauri_plugin_log::Builder::default()
                            .level(log::LevelFilter::Info)
                            .build(),
                    )?;
                }
            }

            if run_mode == RunMode::Headless {
                let policy = classify_headless_log_policy(&config);
                app.listen("headless-console", move |event| {
                    let payload_str = event.payload();
                    let (level, message) =
                        if let Ok(payload) = serde_json::from_str::<ConsolePayload>(payload_str) {
                            (payload.level, payload.message)
                        } else {
                            ("INFO".to_string(), payload_str.to_string())
                        };

                    if policy_allows_headless_console(policy, &level, &message) {
                        print_headless_line(&level, &message);
                    }
                });
            }

            if run_mode == RunMode::Headless && config.run_diagnostics {
                app.listen("headless-diagnostics-progress", move |event| {
                    let payload_str = event.payload();
                    if let Ok(payload) =
                        serde_json::from_str::<DiagnosticsProgressPayload>(payload_str)
                    {
                        match payload.ok {
                            Some(ok) => {
                                if ok {
                                    println!(
                                        "[HEADLESS][TEST] {} {} ({})",
                                        payload.phase.to_uppercase(),
                                        payload.test,
                                        "OK"
                                    );
                                } else if let Some(message) = payload.error_message {
                                    println!(
                                        "[HEADLESS][TEST] {} {} ({}) {}",
                                        payload.phase.to_uppercase(),
                                        payload.test,
                                        "ERROR",
                                        message
                                    );
                                } else {
                                    println!(
                                        "[HEADLESS][TEST] {} {} ({})",
                                        payload.phase.to_uppercase(),
                                        payload.test,
                                        "ERROR"
                                    );
                                }
                            }
                            None => println!(
                                "[HEADLESS][TEST] {} {}",
                                payload.phase.to_uppercase(),
                                payload.test
                            ),
                        }
                    } else {
                        eprintln!(
                            "[HEADLESS][WARN] failed to parse diagnostics progress payload: {}",
                            payload_str
                        );
                    }
                });

                let app_handle = app.handle().clone();
                app.listen("headless-diagnostics-result", move |event| {
                    let payload_str = event.payload();
                    match serde_json::from_str::<DiagnosticsResultPayload>(payload_str) {
                        Ok(payload) => {
                            println!(
                                "HEADLESS_DIAGNOSTICS_RESULT {}",
                                serde_json::json!({
                                  "passed": payload.passed,
                                  "total": payload.total,
                                  "failed": payload.failed
                                })
                            );
                            app_handle.exit(if payload.passed { 0 } else { 1 });
                        }
                        Err(err) => {
                            eprintln!(
                                "HEADLESS_DIAGNOSTICS_RESULT_PARSE_ERROR {}",
                                serde_json::json!({
                                  "error": err.to_string(),
                                  "raw_payload": payload_str
                                })
                            );
                            app_handle.exit(2);
                        }
                    }
                });
            }

            match run_mode {
                RunMode::Gui => {
                    if let Some(main_window_cfg) = app.config().app.windows.first() {
                        tauri::WebviewWindowBuilder::from_config(app.handle(), main_window_cfg)?
                            .on_navigation(|url| {
                                if should_open_externally(url) {
                                    open_external_browser(url.as_str());
                                    return false;
                                }
                                true
                            })
                            .on_new_window(|url, _| {
                                open_external_browser(url.as_str());
                                NewWindowResponse::Deny
                            })
                            .build()?;
                    } else {
                        tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/".into()))
                            .title("taskyon")
                            .on_navigation(|url| {
                                if should_open_externally(url) {
                                    open_external_browser(url.as_str());
                                    return false;
                                }
                                true
                            })
                            .on_new_window(|url, _| {
                                open_external_browser(url.as_str());
                                NewWindowResponse::Deny
                            })
                            .build()?;
                    }
                }
                RunMode::Headless => {
                    let url = headless_url(&config);
                    tauri::WebviewWindowBuilder::new(app, "headless", WebviewUrl::App(url.into()))
                        .title("taskyon-headless")
                        .visible(false)
                        .skip_taskbar(true)
                        .build()?;
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_run_config() -> RunConfig {
        RunConfig {
            mode: RunMode::Headless,
            run_diagnostics: false,
            diagnostics_detailed: false,
            diagnostics_no_gui: true,
            diagnostics_filter: None,
            diagnostics_stdout: false,
            all_logs: false,
        }
    }

    #[test]
    fn tag_gate_allows_warn_error_or_keep_tag() {
        assert!(policy_allows_headless_console(
            HeadlessLogPolicy::DiagnosticsTestCentric,
            "warn",
            "something noisy"
        ));
        assert!(policy_allows_headless_console(
            HeadlessLogPolicy::DiagnosticsTestCentric,
            "info",
            "[HEADLESS][KEEP][TEST][FAIL] Test Secret Store"
        ));
        assert!(!policy_allows_headless_console(
            HeadlessLogPolicy::DiagnosticsTestCentric,
            "info",
            "create tool chatCompletion"
        ));
    }

    #[test]
    fn policy_selection_prefers_all_logs_override() {
        let mut cfg = test_run_config();
        cfg.run_diagnostics = true;
        assert_eq!(
            classify_headless_log_policy(&cfg),
            HeadlessLogPolicy::DiagnosticsTestCentric
        );

        cfg.all_logs = true;
        assert_eq!(
            classify_headless_log_policy(&cfg),
            HeadlessLogPolicy::AllLogs
        );
    }

    #[test]
    fn all_logs_policy_bypasses_tag_gate() {
        assert!(policy_allows_headless_console(
            HeadlessLogPolicy::AllLogs,
            "info",
            "completely untagged message"
        ));
    }
}
