// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Velopack installer hooks run here and exit; for a Velopack install with a
    // downloaded update, this applies it and relaunches before the UI starts.
    // Installs made by other installers fall straight through.
    #[cfg(windows)]
    velopack::VelopackApp::build()
        .on_after_install_fast_callback(|_| run_powershell_hook("velopack-post-install.ps1"))
        .on_after_update_fast_callback(|_| run_powershell_hook("velopack-post-install.ps1"))
        .on_before_uninstall_fast_callback(|_| run_powershell_hook("velopack-post-uninstall.ps1"))
        .run();

    lightning_p2p_lib::run();
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
