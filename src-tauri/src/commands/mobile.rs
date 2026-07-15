//! Android-only mobile bridge commands.
//!
//! These commands wrap the Kotlin `ContentUriResolver` (see
//! `gen/android/app/src/main/java/com/lightningp2p/app/ContentUriResolver.kt`)
//! via JNI so the rest of the Rust transfer code can keep working with
//! plain filesystem paths even on Android, where the system file picker
//! and share-sheet hand back `content://` URIs.
//!
//! The same commands are defined on non-Android targets as pass-throughs
//! so the IPC handler list stays uniform and the frontend can call them
//! unconditionally.

use crate::commands::{command_error, CommandResult};
#[cfg(target_os = "android")]
use crate::error::AppErrorPayload;
use crate::AppState;
#[cfg(target_os = "android")]
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, State};

#[cfg(target_os = "android")]
static QUEUED_FOREGROUND_TRANSFERS: AtomicUsize = AtomicUsize::new(0);
#[cfg(target_os = "android")]
static SCOPED_FOREGROUND_TRANSFERS: AtomicUsize = AtomicUsize::new(0);

#[cfg(target_os = "android")]
pub(crate) mod android {
    use jni::objects::{JClass, JObject, JObjectArray, JString, JValue};
    use jni::signature::RuntimeMethodSignature;
    use jni::sys::jint;
    use jni::{jni_sig, jni_str, Env, JavaVM};
    use jni::strings::JNIString;
    use std::time::{SystemTime, UNIX_EPOCH};

    const RESOLVER_CLASS_DOTTED: &str = "com.lightningp2p.app.ContentUriResolver";
    const FOREGROUND_SERVICE_CLASS_DOTTED: &str =
        "com.lightningp2p.app.TransferForegroundService";

    type BridgeResult<T> = Result<T, BridgeError>;

    #[derive(Debug)]
    struct BridgeError(String);

    impl std::fmt::Display for BridgeError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(&self.0)
        }
    }

    impl From<jni::errors::Error> for BridgeError {
        fn from(error: jni::errors::Error) -> Self {
            Self(error.to_string())
        }
    }

    impl From<std::num::TryFromIntError> for BridgeError {
        fn from(error: std::num::TryFromIntError) -> Self {
            Self(error.to_string())
        }
    }

    /// Fail-soft readiness gate. `ndk_context::android_context()` asserts
    /// when nothing initialized it (tao 0.35 no longer does), and under the
    /// release profile's `panic = "abort"` that assert kills the whole app.
    /// Returning an error here instead lets every bridge caller degrade
    /// gracefully until `MainActivity` has run `initRustAndroidContext`.
    fn ensure_context_ready() -> Result<(), String> {
        if crate::commands::mobile_context::context_ready() {
            Ok(())
        } else {
            Err("Android JNI context is not initialized yet".into())
        }
    }

    fn jvm() -> Result<JavaVM, String> {
        ensure_context_ready()?;
        let ctx = ndk_context::android_context();
        // SAFETY: ndk-context guarantees the JavaVM pointer outlives the app.
        Ok(unsafe { JavaVM::from_raw(ctx.vm().cast()) })
    }

    fn context_obj<'local>(env: &mut Env<'local>) -> BridgeResult<JObject<'local>> {
        ensure_context_ready().map_err(BridgeError)?;
        let ctx = ndk_context::android_context();
        // SAFETY: ndk-context guarantees the Context jobject outlives the app.
        let raw = ctx.context() as jni::sys::jobject;
        let obj = unsafe { JObject::from_raw(env, raw) };
        // Promote to a local ref so it stays alive for this JNI call frame.
        Ok(env.new_local_ref(&obj)?)
    }

    /// Load an app-defined class via the host activity's classloader.
    ///
    /// On Android, JNI's `FindClass` uses the *system* classloader when called
    /// from a Rust-spawned thread. That classloader can't see app classes like
    /// `ContentUriResolver`, so we have to ask the Context for its classloader
    /// and load through that. This is the standard Android JNI workaround.
    fn load_app_class<'local>(
        env: &mut Env<'local>,
        dotted_name: &str,
    ) -> BridgeResult<JClass<'local>> {
        let context = context_obj(env)?;
        let loader = env
            .call_method(
                &context,
                jni_str!("getClassLoader"),
                jni_sig!("()Ljava/lang/ClassLoader;"),
                &[],
            )
            .map_err(BridgeError::from)?
            .l()
            .map_err(BridgeError::from)?;
        let name = env.new_string(dotted_name)?;
        let class_obj = env
            .call_method(
                &loader,
                jni_str!("loadClass"),
                jni_sig!("(Ljava/lang/String;)Ljava/lang/Class;"),
                &[JValue::Object(&name)],
            )
            .map_err(BridgeError::from)?
            .l()
            .map_err(BridgeError::from)?;
        Ok(env.cast_local::<JClass>(class_obj)?)
    }

    fn vec_to_jstring_array<'local>(
        env: &mut Env<'local>,
        values: &[String],
    ) -> BridgeResult<JObjectArray<'local, JString<'local>>> {
        let empty = env.new_string("")?;
        let array = JObjectArray::<JString>::new(env, values.len(), &empty)?;
        for (i, value) in values.iter().enumerate() {
            let jstr = env.new_string(value)?;
            array.set_element(env, i, &jstr)?;
        }
        Ok(array)
    }

    fn jstring_array_to_vec(
        env: &mut Env<'_>,
        array: &JObjectArray<'_, JString<'_>>,
    ) -> BridgeResult<Vec<String>> {
        let len = array.len(env)?;
        let mut out = Vec::with_capacity(len);
        for i in 0..len {
            let jstr = array.get_element(env, i)?;
            out.push(jstr.try_to_string(env)?);
        }
        Ok(out)
    }

    /// Clear any pending Java exception so it does not crash the host
    /// thread on return, and return its string description.
    fn drain_exception(env: &mut Env<'_>, err: &jni::errors::Error) -> BridgeError {
        env.exception_clear();
        BridgeError(err.to_string())
    }

    pub fn resolve_content_uris(uris: Vec<String>) -> Result<Vec<String>, String> {
        if uris.is_empty() || !uris.iter().any(|u| u.starts_with("content://")) {
            return Ok(uris);
        }
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<Vec<String>> {
            let context = context_obj(env)?;
            let array = vec_to_jstring_array(env, &uris)?;
            let class = load_app_class(env, RESOLVER_CLASS_DOTTED)?;
            let raw = env.call_static_method(
                class,
                jni_str!("resolveContentUris"),
                jni_sig!("(Landroid/content/Context;[Ljava/lang/String;)[Ljava/lang/String;"),
                &[JValue::Object(&context), JValue::Object(&array)],
            );
            let result = match raw {
                Ok(r) => r,
                Err(e) => return Err(drain_exception(env, &e)),
            };
            let obj = result.l().map_err(BridgeError::from)?;
            let array_out: JObjectArray<'_, JString<'_>> =
                env.cast_local::<JObjectArray<JString>>(obj)?;
            jstring_array_to_vec(env, &array_out)
        })
        .map_err(|e| e.to_string())
    }

    pub fn set_transfer_foreground_count(active_count: usize) -> Result<(), String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<()> {
            let context = context_obj(env)?;
            let class = load_app_class(env, FOREGROUND_SERVICE_CLASS_DOTTED)?;
            let count: jint = active_count.try_into().map_err(|_| {
                BridgeError(format!(
                    "active transfer count overflows Android int: {active_count}"
                ))
            })?;
            let raw = env.call_static_method(
                class,
                jni_str!("start"),
                jni_sig!("(Landroid/content/Context;I)V"),
                &[JValue::Object(&context), JValue::Int(count)],
            );
            if let Err(e) = raw {
                return Err(drain_exception(env, &e));
            }
            Ok(())
        })
        .map_err(|e| e.to_string())
    }

    pub fn publish_to_mediastore(
        staged_path: &str,
        filename: &str,
        mime: &str,
        bucket: &str,
    ) -> Result<String, String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<String> {
            let context = context_obj(env)?;
            let staged_j = env.new_string(staged_path)?;
            let filename_j = env.new_string(filename)?;
            let mime_j = env.new_string(mime)?;
            let bucket_j = env.new_string(bucket)?;
            let class = load_app_class(env, RESOLVER_CLASS_DOTTED)?;
            let raw = env.call_static_method(
                class,
                jni_str!("publishToMediaStore"),
                jni_sig!("(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;"),
                &[
                    JValue::Object(&context),
                    JValue::Object(&staged_j),
                    JValue::Object(&filename_j),
                    JValue::Object(&mime_j),
                    JValue::Object(&bucket_j),
                ],
            );
            let result = match raw {
                Ok(r) => r,
                Err(e) => return Err(drain_exception(env, &e)),
            };
            let obj = result.l().map_err(BridgeError::from)?;
            let jstr: JString<'_> = env.cast_local::<JString>(obj)?;
            Ok(jstr.try_to_string(env)?)
        })
        .map_err(|e| e.to_string())
    }

    pub fn take_pending_shared_files() -> Result<Vec<String>, String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<Vec<String>> {
            let class = load_app_class(env, RESOLVER_CLASS_DOTTED)?;
            let raw = env.call_static_method(
                class,
                jni_str!("takePendingSharedFiles"),
                jni_sig!("()[Ljava/lang/String;"),
                &[],
            );
            let result = match raw {
                Ok(r) => r,
                Err(e) => return Err(drain_exception(env, &e)),
            };
            let obj = result.l().map_err(BridgeError::from)?;
            let array_out: JObjectArray<'_, JString<'_>> =
                env.cast_local::<JObjectArray<JString>>(obj)?;
            jstring_array_to_vec(env, &array_out)
        })
        .map_err(|e| e.to_string())
    }

    pub fn open_system_folder(bucket: &str) -> Result<(), String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<()> {
            let context = context_obj(env)?;
            let bucket_j = env.new_string(bucket)?;
            let class = load_app_class(env, RESOLVER_CLASS_DOTTED)?;
            let raw = env.call_static_method(
                class,
                jni_str!("openSystemFolder"),
                jni_sig!("(Landroid/content/Context;Ljava/lang/String;)V"),
                &[JValue::Object(&context), JValue::Object(&bucket_j)],
            );
            if let Err(e) = raw {
                return Err(drain_exception(env, &e));
            }
            Ok(())
        })
        .map_err(|e| e.to_string())
    }

    /// Best-effort sweep of staged cache files older than `older_than_ms`.
    pub fn sweep_staging_older_than(older_than_ms: u128) -> Result<i32, String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<i32> {
            let context = context_obj(env)?;
            let cutoff: i64 = older_than_ms
                .try_into()
                .map_err(|_| BridgeError("cutoff overflows i64".to_string()))?;
            let class = load_app_class(env, RESOLVER_CLASS_DOTTED)?;
            let raw = env.call_static_method(
                class,
                jni_str!("sweepStagingOlderThan"),
                jni_sig!("(Landroid/content/Context;J)I"),
                &[JValue::Object(&context), JValue::Long(cutoff)],
            );
            let result = match raw {
                Ok(r) => r,
                Err(e) => return Err(drain_exception(env, &e)),
            };
            result.i().map_err(BridgeError::from)
        })
        .map_err(|e| e.to_string())
    }

    const BLE_CLASS_DOTTED: &str = "com.lightningp2p.app.LightningBleService";

    pub fn take_pending_shared_ticket() -> Result<Option<String>, String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<Option<String>> {
            let class = load_app_class(env, RESOLVER_CLASS_DOTTED)?;
            let raw = env.call_static_method(
                class,
                jni_str!("takePendingSharedTicket"),
                jni_sig!("()Ljava/lang/String;"),
                &[],
            );
            let result = match raw {
                Ok(r) => r,
                Err(e) => return Err(drain_exception(env, &e)),
            };
            let obj = result.l().map_err(BridgeError::from)?;
            optional_jstring(env, obj)
        })
        .map_err(|e| e.to_string())
    }

    pub fn ble_start_advertise(node_id_prefix_hex: &str) -> Result<bool, String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<bool> {
            let context = context_obj(env)?;
            let payload = env.new_string(node_id_prefix_hex)?;
            let class = load_app_class(env, BLE_CLASS_DOTTED)?;
            let raw = env.call_static_method(
                class,
                jni_str!("advertiseNodeId"),
                jni_sig!("(Landroid/content/Context;Ljava/lang/String;)Z"),
                &[JValue::Object(&context), JValue::Object(&payload)],
            );
            let result = match raw {
                Ok(r) => r,
                Err(e) => return Err(drain_exception(env, &e)),
            };
            result.z().map_err(BridgeError::from)
        })
        .map_err(|e| e.to_string())
    }

    pub fn ble_stop_advertise() -> Result<(), String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<()> {
            let class = load_app_class(env, BLE_CLASS_DOTTED)?;
            let raw = env.call_static_method(
                class,
                jni_str!("stopAdvertising"),
                jni_sig!("()V"),
                &[],
            );
            if let Err(e) = raw {
                return Err(drain_exception(env, &e));
            }
            Ok(())
        })
        .map_err(|e| e.to_string())
    }

    pub fn ble_start_scan() -> Result<bool, String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<bool> {
            let context = context_obj(env)?;
            let class = load_app_class(env, BLE_CLASS_DOTTED)?;
            let raw = env.call_static_method(
                class,
                jni_str!("startScan"),
                jni_sig!("(Landroid/content/Context;)Z"),
                &[JValue::Object(&context)],
            );
            let result = match raw {
                Ok(r) => r,
                Err(e) => return Err(drain_exception(env, &e)),
            };
            result.z().map_err(BridgeError::from)
        })
        .map_err(|e| e.to_string())
    }

    pub fn ble_stop_scan() -> Result<(), String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<()> {
            let class = load_app_class(env, BLE_CLASS_DOTTED)?;
            let raw = env.call_static_method(class, jni_str!("stopScan"), jni_sig!("()V"), &[]);
            if let Err(e) = raw {
                return Err(drain_exception(env, &e));
            }
            Ok(())
        })
        .map_err(|e| e.to_string())
    }

    /// Drain BLE discoveries as a flat (`hex`, `epoch_ms`) string pair list.
    pub fn ble_drain_discoveries() -> Result<Vec<(String, i64)>, String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<Vec<(String, i64)>> {
            let class = load_app_class(env, BLE_CLASS_DOTTED)?;
            let raw = env.call_static_method(
                class,
                jni_str!("drainDiscoveries"),
                jni_sig!("()[Ljava/lang/String;"),
                &[],
            );
            let result = match raw {
                Ok(r) => r,
                Err(e) => return Err(drain_exception(env, &e)),
            };
            let obj = result.l().map_err(BridgeError::from)?;
            let arr: JObjectArray<'_, JString<'_>> =
                env.cast_local::<JObjectArray<JString>>(obj)?;
            let flat = jstring_array_to_vec(env, &arr)?;
            let mut pairs = Vec::with_capacity(flat.len() / 2);
            let mut iter = flat.into_iter();
            while let (Some(hex), Some(ts)) = (iter.next(), iter.next()) {
                let parsed: i64 = ts.parse::<i64>().unwrap_or_default();
                pairs.push((hex, parsed));
            }
            Ok(pairs)
        })
        .map_err(|e| e.to_string())
    }

    pub fn ble_permission_state() -> Result<String, String> {
        call_ble_string_with_context(
            "permissionState",
            "(Landroid/content/Context;)Ljava/lang/String;",
        )
        .map(|value| value.unwrap_or_else(|| "unknown".into()))
    }

    pub fn ble_adapter_state() -> Result<String, String> {
        call_ble_string_with_context(
            "adapterState",
            "(Landroid/content/Context;)Ljava/lang/String;",
        )
        .map(|value| value.unwrap_or_else(|| "unknown".into()))
    }

    pub fn ble_is_scanning() -> Result<bool, String> {
        call_ble_bool_no_context("isScanning", "()Z")
    }

    pub fn ble_is_advertising() -> Result<bool, String> {
        call_ble_bool_no_context("isAdvertising", "()Z")
    }

    pub fn ble_last_error() -> Result<Option<String>, String> {
        call_ble_string_no_context("lastError", "()Ljava/lang/String;")
    }

    fn call_ble_string_with_context(
        method: &str,
        signature: &str,
    ) -> Result<Option<String>, String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<Option<String>> {
            let context = context_obj(env)?;
            let class = load_app_class(env, BLE_CLASS_DOTTED)?;
            let method_name = JNIString::new(method);
            let method_sig = RuntimeMethodSignature::from_str(signature)?;
            let raw = env.call_static_method(
                class,
                &method_name,
                method_sig.method_signature(),
                &[JValue::Object(&context)],
            );
            let result = match raw {
                Ok(r) => r,
                Err(e) => return Err(drain_exception(env, &e)),
            };
            optional_jstring(env, result.l().map_err(BridgeError::from)?)
        })
        .map_err(|e| e.to_string())
    }

    fn call_ble_string_no_context(method: &str, signature: &str) -> Result<Option<String>, String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<Option<String>> {
            let class = load_app_class(env, BLE_CLASS_DOTTED)?;
            let method_name = JNIString::new(method);
            let method_sig = RuntimeMethodSignature::from_str(signature)?;
            let raw = env.call_static_method(class, &method_name, method_sig.method_signature(), &[]);
            let result = match raw {
                Ok(r) => r,
                Err(e) => return Err(drain_exception(env, &e)),
            };
            optional_jstring(env, result.l().map_err(BridgeError::from)?)
        })
        .map_err(|e| e.to_string())
    }

    fn call_ble_bool_no_context(method: &str, signature: &str) -> Result<bool, String> {
        let vm = jvm()?;
        vm.attach_current_thread(|env| -> BridgeResult<bool> {
            let class = load_app_class(env, BLE_CLASS_DOTTED)?;
            let method_name = JNIString::new(method);
            let method_sig = RuntimeMethodSignature::from_str(signature)?;
            let raw = env.call_static_method(class, &method_name, method_sig.method_signature(), &[]);
            let result = match raw {
                Ok(r) => r,
                Err(e) => return Err(drain_exception(env, &e)),
            };
            result.z().map_err(BridgeError::from)
        })
        .map_err(|e| e.to_string())
    }

    fn optional_jstring(env: &mut Env<'_>, obj: JObject<'_>) -> BridgeResult<Option<String>> {
        if obj.is_null() {
            return Ok(None);
        }
        let jstr: JString<'_> = env.cast_local::<JString>(obj)?;
        Ok(Some(jstr.try_to_string(env)?))
    }

    /// Wall-clock epoch (ms) for a "older than 24h" cutoff used at app boot.
    pub fn epoch_ms_24h_ago() -> u128 {
        const DAY_MS: u128 = 24 * 60 * 60 * 1000;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        now.saturating_sub(DAY_MS)
    }
}

/// Scoped foreground-service activity for Android transfers that do not live
/// in the receive queue, such as sender-side share preparation.
pub(crate) struct TransferForegroundGuard {
    #[cfg(target_os = "android")]
    active: bool,
}

impl TransferForegroundGuard {
    /// Registers one scoped Android foreground transfer.
    #[must_use]
    pub(crate) fn acquire() -> Self {
        #[cfg(target_os = "android")]
        {
            SCOPED_FOREGROUND_TRANSFERS.fetch_add(1, Ordering::SeqCst);
            refresh_transfer_foreground_count();
            Self { active: true }
        }
        #[cfg(not(target_os = "android"))]
        {
            Self {}
        }
    }
}

impl Drop for TransferForegroundGuard {
    fn drop(&mut self) {
        #[cfg(target_os = "android")]
        if self.active {
            SCOPED_FOREGROUND_TRANSFERS.fetch_sub(1, Ordering::SeqCst);
            self.active = false;
            refresh_transfer_foreground_count();
        }
    }
}

/// Synchronizes queued receive activity with the Android foreground service.
pub(crate) fn sync_transfer_queue_foreground_count(count: usize) {
    #[cfg(target_os = "android")]
    {
        QUEUED_FOREGROUND_TRANSFERS.store(count, Ordering::SeqCst);
        refresh_transfer_foreground_count();
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = count;
    }
}

#[cfg(target_os = "android")]
fn refresh_transfer_foreground_count() {
    let queued = QUEUED_FOREGROUND_TRANSFERS.load(Ordering::SeqCst);
    let scoped = SCOPED_FOREGROUND_TRANSFERS.load(Ordering::SeqCst);
    let active_count = queued.saturating_add(scoped);
    if let Err(error) = android::set_transfer_foreground_count(active_count) {
        tracing::warn!(%error, active_count, "failed to sync Android foreground service");
    }
}

/// Resolves any Android `content://` URIs in the input to absolute file
/// paths under the app cache, leaving regular paths unchanged.
///
/// On non-Android targets this is a no-op identity transform so the
/// frontend can call it unconditionally.
///
/// # Errors
///
/// Returns an error string if the JNI bridge or `ContentResolver` fails
/// to stream any of the URIs.
#[tauri::command]
pub async fn resolve_content_uris(uris: Vec<String>) -> CommandResult<Vec<String>> {
    #[cfg(target_os = "android")]
    {
        android::resolve_content_uris(uris)
            .map_err(|error| command_error(AppErrorPayload::android_content_uri_failed(error)))
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(uris)
    }
}

/// Drains any files captured by the Android share-sheet handler since the
/// last call. Returns an empty list on non-Android targets.
///
/// # Errors
///
/// Returns an error string if the JNI drain fails.
#[tauri::command]
pub async fn take_pending_shared_files() -> Result<Vec<String>, String> {
    #[cfg(target_os = "android")]
    {
        android::take_pending_shared_files()
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(Vec::new())
    }
}

/// Launches the Android system file UI focused on a `MediaStore` bucket
/// (Pictures / Movies / Music / Downloads). No-op on other targets.
///
/// # Errors
///
/// Returns an error string if the JNI bridge fails. The Kotlin side
/// already swallows missing-handler errors as best-effort.
#[tauri::command]
pub async fn open_android_bucket(bucket: String) -> CommandResult<()> {
    #[cfg(target_os = "android")]
    {
        android::open_system_folder(&bucket)
            .map_err(|error| command_error(AppErrorPayload::android_content_uri_failed(error)))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = bucket;
        Err(command_error(
            "open_android_bucket is only available on Android",
        ))
    }
}

/// Drain any Lightning P2P receive ticket dropped here via NFC tap or any
/// other side channel since the last call. Returns `null` if nothing is
/// queued. Empty / no-op on non-Android.
///
/// # Errors
///
/// Returns an error string if the JNI drain fails.
#[tauri::command]
pub async fn take_pending_shared_ticket() -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        android::take_pending_shared_ticket()
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(None)
    }
}

/// Start the experimental Lightning P2P BLE advertise + scan pair.
///
/// Android uses the Kotlin BLE bridge. Windows uses the native `WinRT` BLE
/// advertisement watcher and publisher when the machine has a compatible
/// adapter. Other targets return `false`.
///
/// The local iroh `NodeId` is broadcast in chunked BLE service data so other
/// Lightning P2P devices in range can discover us.
///
/// Returns whether the advertise + scan started. Either may legitimately
/// return false if the BLE adapter is disabled or permissions are denied.
///
/// # Errors
///
/// Returns an error string if the JNI bridge fails.
#[tauri::command]
pub async fn start_ble_discovery(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    node_id_prefix_hex: String,
) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let advertising = android::ble_start_advertise(&node_id_prefix_hex)?;
        let scanning = android::ble_start_scan()?;
        let started = advertising || scanning;
        if started {
            let local_node_id = state.node.read().await.as_ref().map(|node| node.node_id());
            spawn_ble_poll_loop(
                app_handle,
                state.nearby_shares.clone(),
                state.settings.clone(),
                local_node_id,
                state.ble_polling_active.clone(),
                android::ble_drain_discoveries,
            );
        }
        Ok(started)
    }
    #[cfg(windows)]
    {
        let started = crate::proximity::ble::start(&node_id_prefix_hex)?;
        if started {
            let local_node_id = state.node.read().await.as_ref().map(|node| node.node_id());
            spawn_ble_poll_loop(
                app_handle,
                state.nearby_shares.clone(),
                state.settings.clone(),
                local_node_id,
                state.ble_polling_active.clone(),
                crate::proximity::ble::drain_discoveries,
            );
        }
        Ok(started)
    }
    #[cfg(not(any(target_os = "android", windows)))]
    {
        let _ = (app_handle, state, node_id_prefix_hex);
        Ok(false)
    }
}

/// Stop the Lightning P2P BLE advertise + scan pair. Idempotent.
///
/// # Errors
///
/// Returns an error string if the JNI bridge fails.
#[tauri::command]
pub async fn stop_ble_discovery(state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        state
            .ble_polling_active
            .store(false, std::sync::atomic::Ordering::SeqCst);
        let _ = android::ble_stop_scan();
        android::ble_stop_advertise()?;
        Ok(())
    }
    #[cfg(windows)]
    {
        state
            .ble_polling_active
            .store(false, std::sync::atomic::Ordering::SeqCst);
        crate::proximity::ble::stop()
    }
    #[cfg(not(any(target_os = "android", windows)))]
    {
        let _ = state;
        Ok(())
    }
}

#[cfg(any(target_os = "android", windows))]
type BleDiscoveryDrain = fn() -> Result<Vec<(String, i64)>, String>;

#[cfg(any(target_os = "android", windows))]
fn spawn_ble_poll_loop(
    app_handle: AppHandle,
    registry: crate::node::NearbyShareRegistry,
    settings: crate::storage::settings::SettingsState,
    local_node_id: Option<iroh::NodeId>,
    active: std::sync::Arc<std::sync::atomic::AtomicBool>,
    drain_discoveries: BleDiscoveryDrain,
) {
    use std::str::FromStr;
    use std::sync::atomic::Ordering;
    use std::time::Duration;
    use tauri::Emitter;
    use tokio::time::MissedTickBehavior;

    if active.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(1500));
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

        loop {
            interval.tick().await;
            if !active.load(Ordering::SeqCst)
                || !settings.snapshot().await.bluetooth_discovery_enabled
            {
                break;
            }

            let drained = tauri::async_runtime::spawn_blocking(drain_discoveries).await;
            let discoveries = match drained {
                Ok(Ok(discoveries)) => discoveries,
                Ok(Err(error)) => {
                    tracing::warn!(%error, "BLE discovery drain failed");
                    Vec::new()
                }
                Err(error) => {
                    tracing::warn!(%error, "BLE discovery drain task failed");
                    Vec::new()
                }
            };

            let mut changed = false;
            for (node_id_hex, _) in discoveries {
                let Ok(node_id) = iroh::NodeId::from_str(&node_id_hex) else {
                    tracing::debug!(node_id_hex, "ignoring invalid BLE NodeId");
                    continue;
                };
                if local_node_id
                    .as_ref()
                    .is_some_and(|local| *local == node_id)
                {
                    continue;
                }
                if registry
                    .register_ble_candidate(node_id, "Bluetooth peer".into(), false)
                    .await
                    .is_some()
                {
                    changed = true;
                }
            }

            if changed {
                let snapshot = registry.devices_snapshot().await;
                if let Err(error) = app_handle.emit("nearby-devices-updated", snapshot) {
                    tracing::warn!(%error, "failed to emit BLE nearby devices");
                }
            }
        }

        active.store(false, Ordering::SeqCst);
    });
}
