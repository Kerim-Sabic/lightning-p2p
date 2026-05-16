//! Commands for native runtime platform capability policy.

use serde::Serialize;

const TRANSFER_ENGINE: &str = "iroh + iroh-blobs";
const ONLINE_HANDOFF_MODEL: &str = "web_handoff_to_native_iroh";

/// Native platform detected for this compiled Tauri runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NativePlatformKind {
    /// Microsoft Windows desktop runtime.
    Windows,
    /// Apple macOS desktop runtime.
    Macos,
    /// Linux desktop runtime.
    Linux,
    /// Android mobile runtime.
    Android,
    /// iOS mobile runtime.
    Ios,
    /// Unknown native platform.
    Unknown,
}

impl NativePlatformKind {
    /// Returns the platform for the currently compiled target.
    #[must_use]
    pub const fn current() -> Self {
        #[cfg(target_os = "windows")]
        {
            Self::Windows
        }
        #[cfg(target_os = "macos")]
        {
            Self::Macos
        }
        #[cfg(target_os = "linux")]
        {
            Self::Linux
        }
        #[cfg(target_os = "android")]
        {
            Self::Android
        }
        #[cfg(target_os = "ios")]
        {
            Self::Ios
        }
        #[cfg(not(any(
            target_os = "windows",
            target_os = "macos",
            target_os = "linux",
            target_os = "android",
            target_os = "ios"
        )))]
        {
            Self::Unknown
        }
    }

    /// Returns whether this platform is one of the mobile Tauri targets.
    #[must_use]
    pub const fn is_mobile(self) -> bool {
        matches!(self, Self::Android | Self::Ios)
    }

    /// Returns whether this platform is one of the desktop Tauri targets.
    #[must_use]
    pub const fn is_desktop(self) -> bool {
        matches!(self, Self::Windows | Self::Macos | Self::Linux)
    }

    /// Returns the runtime family used by the frontend shell.
    #[must_use]
    pub const fn runtime_family(self) -> RuntimeFamily {
        match self {
            Self::Android => RuntimeFamily::Android,
            Self::Ios => RuntimeFamily::Ios,
            Self::Windows | Self::Macos | Self::Linux | Self::Unknown => RuntimeFamily::Desktop,
        }
    }
}

/// Coarse runtime family used for capability decisions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeFamily {
    /// Native desktop shell.
    Desktop,
    /// Android shell.
    Android,
    /// iOS shell.
    Ios,
}

/// Storage model for verified receive outputs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageModel {
    /// User-visible downloads folder with optional custom folder selection.
    UserSelected,
    /// Mobile app-private storage.
    AppPrivate,
}

/// Release support level for a native platform.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReleaseSupport {
    /// Public Windows release path.
    PublicWindows,
    /// Source-build or future packaging path for desktop platforms.
    SourceBuild,
    /// Android internal alpha path.
    AndroidAlpha,
    /// iOS preparation only; not shipped from this workspace.
    IosPrepared,
    /// Native runtime exists but is not supported yet.
    Unsupported,
}

/// Feature switches enforced by the native runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[allow(clippy::struct_excessive_bools)]
pub struct PlatformCapabilities {
    /// Whether the native Tauri runtime is available.
    pub native_runtime: bool,
    /// Whether file sending is supported.
    pub send_files: bool,
    /// Whether folder sending is supported.
    pub send_folders: bool,
    /// Whether receiving files is supported.
    pub receive_files: bool,
    /// Whether QR receive scanning is expected to be available.
    pub scan_receive_qr: bool,
    /// Whether LAN nearby-share discovery should be enabled.
    pub local_discovery: bool,
    /// Whether Bluetooth proximity discovery is wired in this runtime.
    pub bluetooth_discovery: bool,
    /// Whether iroh relay fallback is supported.
    pub relay_fallback: bool,
    /// Whether users can configure a custom relay URL.
    pub custom_relay: bool,
    /// Whether users can choose a public receive folder.
    pub custom_receive_dir: bool,
    /// Whether received files can be exported to public Downloads.
    pub public_downloads_export: bool,
    /// Whether received files are auto-routed into `MediaStore` buckets
    /// (Pictures / Movies / Music / Downloads) instead of a single user
    /// folder. Drives Android-specific Settings and `FirstRun` copy.
    pub smart_routing: bool,
    /// Whether built-in update checks are enabled for this runtime.
    pub auto_update: bool,
    /// Whether receive tickets can be opened from OS deep links.
    pub deep_link_receive: bool,
    /// Whether HTTPS receive handoff links can route into the native app.
    pub web_handoff_receive: bool,
    /// Whether transfers are allowed to continue as a mobile background job.
    pub background_transfer: bool,
    /// Whether browser-only transfer is allowed.
    pub browser_transfer: bool,
    /// Whether benchmark evidence is required before public speed claims.
    pub benchmark_required_for_speed_claims: bool,
}

/// User-facing runtime guidance generated from Rust policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PlatformGuidance {
    /// Short storage policy statement.
    pub storage_notice: &'static str,
    /// Short transfer reliability statement.
    pub transfer_notice: &'static str,
    /// Short online reachability statement.
    pub online_notice: &'static str,
    /// Release/support statement for this platform.
    pub release_notice: &'static str,
    /// Benchmark statement for public performance claims.
    pub benchmark_notice: &'static str,
}

/// Complete native platform profile returned to the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PlatformProfile {
    /// Native platform kind.
    pub platform_kind: NativePlatformKind,
    /// Runtime family used by the UI shell.
    pub runtime_family: RuntimeFamily,
    /// Target operating system as reported by Rust.
    pub target_os: &'static str,
    /// Transfer engine policy.
    pub transfer_engine: &'static str,
    /// Online handoff model policy.
    pub online_handoff_model: &'static str,
    /// Storage model for receives.
    pub storage_model: StorageModel,
    /// Release support status.
    pub release_support: ReleaseSupport,
    /// Capability flags.
    pub capabilities: PlatformCapabilities,
    /// User-visible guidance derived from capability flags.
    pub guidance: PlatformGuidance,
}

/// Returns the profile for the current native target.
#[must_use]
pub fn current_platform_profile() -> PlatformProfile {
    platform_profile_for(NativePlatformKind::current())
}

/// Returns a deterministic profile for a specific platform.
#[must_use]
pub fn platform_profile_for(platform_kind: NativePlatformKind) -> PlatformProfile {
    PlatformProfile {
        platform_kind,
        runtime_family: platform_kind.runtime_family(),
        target_os: target_os_label(platform_kind),
        transfer_engine: TRANSFER_ENGINE,
        online_handoff_model: ONLINE_HANDOFF_MODEL,
        storage_model: storage_model(platform_kind),
        release_support: release_support(platform_kind),
        capabilities: capabilities(platform_kind),
        guidance: guidance(platform_kind),
    }
}

/// Returns the native runtime profile used by the app shell.
///
/// # Errors
///
/// This command currently has no fallible path; it returns `Result` to keep the
/// command contract consistent with the rest of the IPC surface.
#[tauri::command]
pub fn get_platform_profile() -> Result<PlatformProfile, String> {
    Ok(current_platform_profile())
}

fn capabilities(platform_kind: NativePlatformKind) -> PlatformCapabilities {
    let mobile = platform_kind.is_mobile();
    let desktop = platform_kind.is_desktop();
    let public_storage = desktop;
    let android = platform_kind == NativePlatformKind::Android;
    let windows = platform_kind == NativePlatformKind::Windows;
    let local_discovery =
        platform_kind != NativePlatformKind::Ios && platform_kind != NativePlatformKind::Unknown;

    PlatformCapabilities {
        native_runtime: true,
        send_files: platform_kind != NativePlatformKind::Unknown,
        send_folders: desktop,
        receive_files: platform_kind != NativePlatformKind::Unknown,
        scan_receive_qr: mobile,
        local_discovery,
        bluetooth_discovery: android,
        relay_fallback: platform_kind != NativePlatformKind::Unknown,
        custom_relay: platform_kind != NativePlatformKind::Unknown,
        custom_receive_dir: public_storage,
        // Android routes verified receives into public MediaStore buckets
        // (Pictures / Movies / Music / Downloads). Desktop exports to the
        // configured user folder.
        public_downloads_export: public_storage || android,
        smart_routing: android,
        auto_update: desktop,
        deep_link_receive: windows || android,
        web_handoff_receive: windows || android,
        background_transfer: false,
        browser_transfer: false,
        benchmark_required_for_speed_claims: true,
    }
}

fn guidance(platform_kind: NativePlatformKind) -> PlatformGuidance {
    PlatformGuidance {
        storage_notice: storage_notice(platform_kind),
        transfer_notice: transfer_notice(platform_kind),
        online_notice: online_notice(platform_kind),
        release_notice: release_notice(platform_kind),
        benchmark_notice: "Do not claim speed leadership until the benchmark matrix has repeatable results for route kind, throughput, failures, export time, and battery or thermal notes.",
    }
}

const fn storage_model(platform_kind: NativePlatformKind) -> StorageModel {
    if platform_kind.is_mobile() {
        StorageModel::AppPrivate
    } else {
        StorageModel::UserSelected
    }
}

const fn release_support(platform_kind: NativePlatformKind) -> ReleaseSupport {
    match platform_kind {
        NativePlatformKind::Windows => ReleaseSupport::PublicWindows,
        NativePlatformKind::Macos | NativePlatformKind::Linux => ReleaseSupport::SourceBuild,
        NativePlatformKind::Android => ReleaseSupport::AndroidAlpha,
        NativePlatformKind::Ios => ReleaseSupport::IosPrepared,
        NativePlatformKind::Unknown => ReleaseSupport::Unsupported,
    }
}

const fn target_os_label(platform_kind: NativePlatformKind) -> &'static str {
    match platform_kind {
        NativePlatformKind::Windows => "windows",
        NativePlatformKind::Macos => "macos",
        NativePlatformKind::Linux => "linux",
        NativePlatformKind::Android => "android",
        NativePlatformKind::Ios => "ios",
        NativePlatformKind::Unknown => "unknown",
    }
}

const fn storage_notice(platform_kind: NativePlatformKind) -> &'static str {
    match platform_kind {
        NativePlatformKind::Android => {
            "Android receives are auto-routed into public MediaStore: images to Pictures, video to Movies, audio to Music, other files to Downloads. Each lands in a Lightning P2P subfolder."
        }
        NativePlatformKind::Ios => {
            "iOS receives must use app-private storage until TestFlight, file export, and entitlement work are verified."
        }
        NativePlatformKind::Windows | NativePlatformKind::Macos | NativePlatformKind::Linux => {
            "Desktop receives export to a user-visible folder after iroh-blobs verification."
        }
        NativePlatformKind::Unknown => "This native target is not supported yet.",
    }
}

const fn transfer_notice(platform_kind: NativePlatformKind) -> &'static str {
    match platform_kind {
        NativePlatformKind::Android => {
            "Android alpha transfers are foreground-only. Keep the screen awake and both apps open."
        }
        NativePlatformKind::Ios => {
            "iOS transfers are not shipped until macOS, Xcode, signing, and multicast entitlement testing pass."
        }
        NativePlatformKind::Windows | NativePlatformKind::Macos | NativePlatformKind::Linux => {
            "Desktop transfers use the native iroh endpoint and remain active while the app is running."
        }
        NativePlatformKind::Unknown => "Transfers are disabled on this unsupported native target.",
    }
}

const fn online_notice(platform_kind: NativePlatformKind) -> &'static str {
    match platform_kind {
        NativePlatformKind::Windows | NativePlatformKind::Android => {
            "Online sharing uses HTTPS handoff links that open the native app, then native iroh handles direct or relay-backed transfer. No WebRTC, HTTP transfer server, or WebSocket transfer path is used."
        }
        NativePlatformKind::Macos | NativePlatformKind::Linux => {
            "Online transfer still requires the native app and iroh tickets; web pages are only handoff surfaces."
        }
        NativePlatformKind::Ios => {
            "iOS online handoff is prepared conceptually but not shipped without Apple signing and entitlement validation."
        }
        NativePlatformKind::Unknown => "Online transfer is unavailable on this unsupported native target.",
    }
}

const fn release_notice(platform_kind: NativePlatformKind) -> &'static str {
    match platform_kind {
        NativePlatformKind::Windows => {
            "Windows is the public release target. Community builds are unsigned until Authenticode signing is configured; verify GitHub release checksums."
        }
        NativePlatformKind::Android => {
            "Android is a public sideload alpha. Verify the APK checksum and signer fingerprint before installing."
        }
        NativePlatformKind::Ios => {
            "iOS is not shipped from this Windows workspace; it needs macOS, Xcode, Apple signing, and multicast entitlement review."
        }
        NativePlatformKind::Macos | NativePlatformKind::Linux => {
            "This desktop target can be built from source but is not a public packaged release yet."
        }
        NativePlatformKind::Unknown => "This native target is not a supported release platform.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_profile_is_public_desktop() {
        let profile = platform_profile_for(NativePlatformKind::Windows);

        assert_eq!(profile.runtime_family, RuntimeFamily::Desktop);
        assert_eq!(profile.storage_model, StorageModel::UserSelected);
        assert_eq!(profile.release_support, ReleaseSupport::PublicWindows);
        assert!(profile.capabilities.send_folders);
        assert!(profile.capabilities.public_downloads_export);
        assert!(profile.capabilities.web_handoff_receive);
        assert!(!profile.capabilities.bluetooth_discovery);
        assert!(!profile.capabilities.browser_transfer);
    }

    #[test]
    fn android_profile_is_foreground_alpha() {
        let profile = platform_profile_for(NativePlatformKind::Android);

        assert_eq!(profile.runtime_family, RuntimeFamily::Android);
        assert_eq!(profile.storage_model, StorageModel::AppPrivate);
        assert_eq!(profile.release_support, ReleaseSupport::AndroidAlpha);
        assert!(profile.capabilities.scan_receive_qr);
        assert!(profile.capabilities.local_discovery);
        assert!(profile.capabilities.bluetooth_discovery);
        assert!(profile.capabilities.public_downloads_export);
        assert!(profile.capabilities.smart_routing);
        assert!(!profile.capabilities.send_folders);
        assert!(!profile.capabilities.background_transfer);
    }

    #[test]
    fn desktop_profiles_do_not_use_smart_routing() {
        for platform in [
            NativePlatformKind::Windows,
            NativePlatformKind::Macos,
            NativePlatformKind::Linux,
        ] {
            let profile = platform_profile_for(platform);
            assert!(
                !profile.capabilities.smart_routing,
                "desktop {platform:?} should keep single user-folder routing"
            );
        }
    }

    #[test]
    fn ios_profile_disables_local_discovery_until_entitlement() {
        let profile = platform_profile_for(NativePlatformKind::Ios);

        assert_eq!(profile.runtime_family, RuntimeFamily::Ios);
        assert_eq!(profile.release_support, ReleaseSupport::IosPrepared);
        assert!(!profile.capabilities.local_discovery);
        assert!(!profile.capabilities.public_downloads_export);
        assert!(profile.guidance.release_notice.contains("not shipped"));
    }

    #[test]
    fn every_supported_profile_keeps_native_iroh_transfer_model() {
        for platform in [
            NativePlatformKind::Windows,
            NativePlatformKind::Macos,
            NativePlatformKind::Linux,
            NativePlatformKind::Android,
            NativePlatformKind::Ios,
        ] {
            let profile = platform_profile_for(platform);

            assert_eq!(profile.transfer_engine, TRANSFER_ENGINE);
            assert_eq!(profile.online_handoff_model, ONLINE_HANDOFF_MODEL);
            assert!(profile.capabilities.relay_fallback);
            assert!(!profile.capabilities.browser_transfer);
        }
    }
}
