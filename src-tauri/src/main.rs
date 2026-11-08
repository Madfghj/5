use tauri::{Manager, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;

// External pages belong in the system browser. They never receive our local
// window's filesystem, clipboard or deep-link capabilities.
fn is_local_navigation(url: &tauri::Url) -> bool {
    let bundled = url.scheme() == "tauri" && url.host_str() == Some("localhost");
    let local_webview = matches!(url.scheme(), "http" | "https")
        && url.host_str() == Some("tauri.localhost");
    let development = cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(5176);
    (bundled || local_webview || development)
        && url.username().is_empty()
        && url.password().is_none()
}

fn is_auth_return(url: &tauri::Url) -> bool {
    url.scheme() == "space.opencalendar.app"
        && url.host_str() == Some("auth")
        && matches!(url.path(), "" | "/")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.as_str().len() <= 8192
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        // The frontend opens approved links explicitly, avoiding duplicate opens
        // from a second, automatically injected anchor handler.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .first()
                .ok_or_else(|| std::io::Error::other("Main window configuration is missing"))?;
            let window = WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(is_local_navigation)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                if event.urls().iter().any(is_auth_return) {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });
            // Cold-start URLs are consumed by the frontend's getCurrent before
            // it exchanges the one-use code. No URL or credential is logged.
            let _ = window.show();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("OpenCalendar desktop could not start")
        .run(|app, event| {
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } = event
            {
                if label == "main" {
                    // onCloseRequested in the frontend has finished its bounded
                    // presence-leave request before it destroys this window.
                    // Exit rather than leaving an invisible macOS process alive;
                    // opening the Dock icon then creates a fresh normal window.
                    app.exit(0);
                }
            }
        });
}
