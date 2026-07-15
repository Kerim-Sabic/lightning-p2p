//! Android JNI context bootstrap.
//!
//! tao 0.35 stopped initializing `ndk-context`, so the app installs the
//! (`JavaVM`, application `Context`) pair itself. Kotlin `MainActivity`
//! calls the exported `initRustAndroidContext` during `onCreate`, and every
//! JNI bridge helper in [`super::mobile`] checks [`context_ready`] first.
//! Without that guard, `ndk_context::android_context()` asserts on an
//! uninitialized context — which aborts the whole app under the release
//! profile's `panic = "abort"` (the v0.7.0 Android startup crash).

use jni::objects::JObject;
use jni::errors::LogErrorAndDefault;
use jni::{Env, EnvUnowned};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Once;

static INIT: Once = Once::new();
static CONTEXT_READY: AtomicBool = AtomicBool::new(false);

/// True once the (`JavaVM`, `Context`) pair has been installed into
/// `ndk-context`. Bridge helpers must check this before touching
/// `ndk_context::android_context()`, which aborts when uninitialized.
pub(crate) fn context_ready() -> bool {
    CONTEXT_READY.load(Ordering::Acquire)
}

/// Called once from Kotlin `MainActivity.onCreate` before Tauri spins up.
///
/// Installs the `JavaVM` pointer plus a process-lifetime global reference
/// to the application `Context` into `ndk-context`. Errors are logged and
/// swallowed: a failed init leaves the JNI bridge disabled (every caller
/// fails soft through [`context_ready`]) instead of crashing startup.
#[no_mangle]
pub extern "system" fn Java_com_lightningp2p_app_MainActivity_initRustAndroidContext<'caller>(
    mut unowned_env: EnvUnowned<'caller>,
    _this: JObject<'caller>,
    context: JObject<'caller>,
) {
    unowned_env
        .with_env(|env| -> jni::errors::Result<()> {
            INIT.call_once(|| match install_context(env, &context) {
                Ok(()) => {
                    CONTEXT_READY.store(true, Ordering::Release);
                    tracing::info!("Android JNI context installed for ndk-context");
                }
                Err(error) => {
                    tracing::error!(%error, "failed to install Android JNI context");
                }
            });
            Ok(())
        })
        .resolve::<LogErrorAndDefault>();
}

fn install_context(env: &mut Env<'_>, context: &JObject<'_>) -> jni::errors::Result<()> {
    let vm = env.get_java_vm()?;
    // Promote the Context to a global reference and leak it via `into_raw`:
    // ndk-context holds the pointer for the rest of the process lifetime.
    let context_ptr = env.new_global_ref(context)?.into_raw();
    // SAFETY: both pointers stay valid for the process lifetime (the JavaVM
    // by JVM contract, the Context via the leaked global ref), and the
    // surrounding `Once` guarantees the at-most-once call that
    // `initialize_android_context` requires.
    unsafe {
        ndk_context::initialize_android_context(vm.get_raw().cast(), context_ptr.cast());
    }
    Ok(())
}
