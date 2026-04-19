// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    if handle_velopack_hook() {
        return;
    }

    fastdrop_lib::run();
}

#[cfg(windows)]
fn handle_velopack_hook() -> bool {
    let mut args = std::env::args().skip(1);
    let Some(arg) = args.next() else {
        return false;
    };

    let script_name = match arg.as_str() {
        "--veloapp-install" | "--veloapp-updated" => "velopack-post-install.ps1",
        "--veloapp-uninstall" => "velopack-post-uninstall.ps1",
        "--veloapp-obsolete" => return true,
        _ => return false,
    };

    run_powershell_hook(script_name);
    true
}

#[cfg(windows)]
fn run_powershell_hook(script_name: &str) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let Some(script_path) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|parent| parent.join(script_name)))
    else {
        return;
    };

    if !script_path.is_file() {
        return;
    }

    let _ = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(script_path)
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}
