//! Android JNI context bootstrap.
//!
//! `MainActivity` installs a typed process-wide `JavaVM` and application
//! `Context` before Tauri starts. Bridge callers fail soft until this state is
//! ready, without treating a raw global JNI reference as a local reference.

use jni::errors::LogErrorAndDefault;
use jni::objects::{Global, JObject};
use jni::sys::{jboolean, JNI_FALSE, JNI_TRUE};
use jni::{Env, EnvUnowned, JavaVM};
use std::sync::OnceLock;

struct BridgeContext {
    vm: JavaVM,
    application: Global<JObject<'static>>,
}

static CONTEXT: OnceLock<BridgeContext> = OnceLock::new();

/// Returns the process `JavaVM`, or a fail-soft error before bootstrap.
pub(crate) fn java_vm() -> Result<JavaVM, String> {
    CONTEXT
        .get()
        .map(|context| context.vm.clone())
        .ok_or_else(|| "Android JNI context is not initialized yet".to_owned())
}

/// Creates a local reference to the process-lifetime application context.
pub(crate) fn application_context<'local>(
    env: &mut Env<'local>,
) -> Result<JObject<'local>, String> {
    let context = CONTEXT
        .get()
        .ok_or_else(|| "Android JNI context is not initialized yet".to_owned())?;
    env.new_local_ref(&context.application)
        .map_err(|error| error.to_string())
}

/// Installs the process JNI state before `MainActivity` starts Tauri.
///
/// Returning `false` exposes bootstrap failures to Kotlin diagnostics and the
/// emulator smoke test. A failed attempt leaves `CONTEXT` empty so a later
/// activity creation can retry.
#[no_mangle]
pub extern "system" fn Java_com_lightningp2p_app_MainActivity_initRustAndroidContext<'caller>(
    mut unowned_env: EnvUnowned<'caller>,
    _this: JObject<'caller>,
    application: JObject<'caller>,
) -> jboolean {
    unowned_env
        .with_env(|env| -> jni::errors::Result<jboolean> {
            match install_context(env, &application) {
                Ok(()) => Ok(JNI_TRUE),
                Err(error) => {
                    tracing::error!(%error, "failed to install Android JNI context");
                    Ok(JNI_FALSE)
                }
            }
        })
        .resolve::<LogErrorAndDefault>()
}

fn install_context(env: &mut Env<'_>, application: &JObject<'_>) -> Result<(), String> {
    if CONTEXT.get().is_some() {
        return Ok(());
    }
    let candidate = BridgeContext {
        vm: env.get_java_vm().map_err(|error| error.to_string())?,
        application: env
            .new_global_ref(application)
            .map_err(|error| error.to_string())?,
    };
    let _ = CONTEXT.set(candidate);
    let installed = CONTEXT
        .get()
        .ok_or_else(|| "Android JNI context could not be stored".to_owned())?;
    install_ndk_context(installed);
    Ok(())
}

/// Publishes the (`JavaVM`, `Context`) pair into the `ndk-context` global that
/// ecosystem crates read directly — on the iroh 1.0 tree, `netdev`,
/// `hickory-resolver`, and `iroh-dns` all call `ndk_context::android_context()`
/// from node worker threads and abort the process if it was never installed.
/// tao 0.35+ / wry no longer initialize it, so this is the only writer.
fn install_ndk_context(context: &BridgeContext) {
    static NDK_CONTEXT: std::sync::Once = std::sync::Once::new();
    NDK_CONTEXT.call_once(|| {
        // SAFETY: the pointers come from a live JavaVM and a JNI global
        // reference held in the process-lifetime `CONTEXT` static (never
        // dropped), and the `Once` guarantees the exactly-once contract.
        unsafe {
            ndk_context::initialize_android_context(
                context.vm.get_raw().cast(),
                context.application.as_obj().as_raw().cast(),
            );
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn context_starts_uninitialized() {
        assert!(super::CONTEXT.get().is_none());
    }
}
