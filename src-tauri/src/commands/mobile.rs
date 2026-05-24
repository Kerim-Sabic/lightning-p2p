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

#[cfg(target_os = "android")]
pub(crate) mod android {
    use jni::objects::{JClass, JObject, JObjectArray, JString, JValue};
    use jni::sys::jsize;
    use jni::{JNIEnv, JavaVM};
    use std::time::{SystemTime, UNIX_EPOCH};

    const RESOLVER_CLASS_DOTTED: &str = "com.lightningp2p.app.ContentUriResolver";

    fn jvm() -> Result<JavaVM, String> {
        let ctx = ndk_context::android_context();
        // SAFETY: ndk-context guarantees the JavaVM pointer outlives the app.
        unsafe { JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())
    }

    fn context_obj<'local>(env: &mut JNIEnv<'local>) -> Result<JObject<'local>, String> {
        let ctx = ndk_context::android_context();
        // SAFETY: ndk-context guarantees the Context jobject outlives the app.
        let raw = ctx.context() as jni::sys::jobject;
        let obj = unsafe { JObject::from_raw(raw) };
        // Promote to a local ref so it stays alive for this JNI call frame.
        env.new_local_ref(&obj).map_err(|e| e.to_string())
    }

    /// Load an app-defined class via the host activity's classloader.
    ///
    /// On Android, JNI's `FindClass` uses the *system* classloader when called
    /// from a Rust-spawned thread. That classloader can't see app classes like
    /// `ContentUriResolver`, so we have to ask the Context for its classloader
    /// and load through that. This is the standard Android JNI workaround.
    fn load_app_class<'local>(
        env: &mut JNIEnv<'local>,
        dotted_name: &str,
    ) -> Result<JClass<'local>, String> {
        let context = context_obj(env)?;
        let loader = env
            .call_method(&context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
            .map_err(|e| e.to_string())?
            .l()
            .map_err(|e| e.to_string())?;
        let name = env.new_string(dotted_name).map_err(|e| e.to_string())?;
        let class_obj = env
            .call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(&name)],
            )
            .map_err(|e| e.to_string())?
            .l()
            .map_err(|e| e.to_string())?;
        Ok(JClass::from(class_obj))
    }

    fn vec_to_jstring_array<'local>(
        env: &mut JNIEnv<'local>,
        values: &[String],
    ) -> Result<JObjectArray<'local>, String> {
        let len = jsize::try_from(values.len()).map_err(|e| e.to_string())?;
        // `java.lang.String` lives in the system classloader so plain
        // `find_class` works for it.
        let string_class = env
            .find_class("java/lang/String")
            .map_err(|e| e.to_string())?;
        let empty = env.new_string("").map_err(|e| e.to_string())?;
        let array = env
            .new_object_array(len, string_class, empty)
            .map_err(|e| e.to_string())?;
        for (i, value) in values.iter().enumerate() {
            let jstr = env.new_string(value).map_err(|e| e.to_string())?;
            let idx = jsize::try_from(i).map_err(|e| e.to_string())?;
            env.set_object_array_element(&array, idx, jstr)
                .map_err(|e| e.to_string())?;
        }
        Ok(array)
    }

    fn jstring_array_to_vec(
        env: &mut JNIEnv<'_>,
        array: JObjectArray<'_>,
    ) -> Result<Vec<String>, String> {
        let len = env.get_array_length(&array).map_err(|e| e.to_string())?;
        let mut out = Vec::with_capacity(len as usize);
        for i in 0..len {
            let element = env
                .get_object_array_element(&array, i)
                .map_err(|e| e.to_string())?;
            let jstr = JString::from(element);
            let value: String = env.get_string(&jstr).map_err(|e| e.to_string())?.into();
            out.push(value);
        }
        Ok(out)
    }

    /// Clear any pending Java exception so it does not crash the host
    /// thread on return, and return its string description.
    fn drain_exception(env: &mut JNIEnv<'_>, err: jni::errors::Error) -> String {
        let _ = env.exception_clear();
        err.to_string()
    }

    pub fn resolve_content_uris(uris: Vec<String>) -> Result<Vec<String>, String> {
        if uris.is_empty() || !uris.iter().any(|u| u.starts_with("content://")) {
            return Ok(uris);
        }
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let context = context_obj(&mut env)?;
        let array = vec_to_jstring_array(&mut env, &uris)?;
        let class = load_app_class(&mut env, RESOLVER_CLASS_DOTTED)?;
        let raw = env.call_static_method(
            class,
            "resolveContentUris",
            "(Landroid/content/Context;[Ljava/lang/String;)[Ljava/lang/String;",
            &[JValue::Object(&context), JValue::Object(&array)],
        );
        let result = match raw {
            Ok(r) => r,
            Err(e) => return Err(drain_exception(&mut env, e)),
        };
        let obj: JObject<'_> = result.l().map_err(|e| e.to_string())?;
        let array_out: JObjectArray<'_> = obj.into();
        jstring_array_to_vec(&mut env, array_out)
    }

    pub fn publish_to_mediastore(
        staged_path: &str,
        filename: &str,
        mime: &str,
        bucket: &str,
    ) -> Result<String, String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let context = context_obj(&mut env)?;
        let staged_j = env.new_string(staged_path).map_err(|e| e.to_string())?;
        let filename_j = env.new_string(filename).map_err(|e| e.to_string())?;
        let mime_j = env.new_string(mime).map_err(|e| e.to_string())?;
        let bucket_j = env.new_string(bucket).map_err(|e| e.to_string())?;
        let class = load_app_class(&mut env, RESOLVER_CLASS_DOTTED)?;
        let raw = env.call_static_method(
            class,
            "publishToMediaStore",
            "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
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
            Err(e) => return Err(drain_exception(&mut env, e)),
        };
        let obj: JObject<'_> = result.l().map_err(|e| e.to_string())?;
        let jstr: JString<'_> = obj.into();
        let value: String = env.get_string(&jstr).map_err(|e| e.to_string())?.into();
        Ok(value)
    }

    pub fn take_pending_shared_files() -> Result<Vec<String>, String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let class = load_app_class(&mut env, RESOLVER_CLASS_DOTTED)?;
        let raw = env.call_static_method(
            class,
            "takePendingSharedFiles",
            "()[Ljava/lang/String;",
            &[],
        );
        let result = match raw {
            Ok(r) => r,
            Err(e) => return Err(drain_exception(&mut env, e)),
        };
        let obj: JObject<'_> = result.l().map_err(|e| e.to_string())?;
        let array_out: JObjectArray<'_> = obj.into();
        jstring_array_to_vec(&mut env, array_out)
    }

    pub fn open_system_folder(bucket: &str) -> Result<(), String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let context = context_obj(&mut env)?;
        let bucket_j = env.new_string(bucket).map_err(|e| e.to_string())?;
        let class = load_app_class(&mut env, RESOLVER_CLASS_DOTTED)?;
        let raw = env.call_static_method(
            class,
            "openSystemFolder",
            "(Landroid/content/Context;Ljava/lang/String;)V",
            &[JValue::Object(&context), JValue::Object(&bucket_j)],
        );
        if let Err(e) = raw {
            return Err(drain_exception(&mut env, e));
        }
        Ok(())
    }

    /// Best-effort sweep of staged cache files older than `older_than_ms`.
    pub fn sweep_staging_older_than(older_than_ms: u128) -> Result<i32, String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let context = context_obj(&mut env)?;
        let cutoff: i64 = older_than_ms
            .try_into()
            .map_err(|_| "cutoff overflows i64".to_string())?;
        let class = load_app_class(&mut env, RESOLVER_CLASS_DOTTED)?;
        let raw = env.call_static_method(
            class,
            "sweepStagingOlderThan",
            "(Landroid/content/Context;J)I",
            &[JValue::Object(&context), JValue::Long(cutoff)],
        );
        let result = match raw {
            Ok(r) => r,
            Err(e) => return Err(drain_exception(&mut env, e)),
        };
        result.i().map_err(|e| e.to_string())
    }

    const BLE_CLASS_DOTTED: &str = "com.lightningp2p.app.LightningBleService";

    pub fn take_pending_shared_ticket() -> Result<Option<String>, String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let class = load_app_class(&mut env, RESOLVER_CLASS_DOTTED)?;
        let raw = env.call_static_method(
            class,
            "takePendingSharedTicket",
            "()Ljava/lang/String;",
            &[],
        );
        let result = match raw {
            Ok(r) => r,
            Err(e) => return Err(drain_exception(&mut env, e)),
        };
        let obj: JObject<'_> = result.l().map_err(|e| e.to_string())?;
        if obj.is_null() {
            return Ok(None);
        }
        let jstr: JString<'_> = obj.into();
        let value: String = env.get_string(&jstr).map_err(|e| e.to_string())?.into();
        Ok(Some(value))
    }

    pub fn ble_start_advertise(node_id_prefix_hex: &str) -> Result<bool, String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let context = context_obj(&mut env)?;
        let payload = env
            .new_string(node_id_prefix_hex)
            .map_err(|e| e.to_string())?;
        let class = load_app_class(&mut env, BLE_CLASS_DOTTED)?;
        let raw = env.call_static_method(
            class,
            "advertiseNodeId",
            "(Landroid/content/Context;Ljava/lang/String;)Z",
            &[JValue::Object(&context), JValue::Object(&payload)],
        );
        let result = match raw {
            Ok(r) => r,
            Err(e) => return Err(drain_exception(&mut env, e)),
        };
        result.z().map_err(|e| e.to_string())
    }

    pub fn ble_stop_advertise() -> Result<(), String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let class = load_app_class(&mut env, BLE_CLASS_DOTTED)?;
        let raw = env.call_static_method(class, "stopAdvertising", "()V", &[]);
        if let Err(e) = raw {
            return Err(drain_exception(&mut env, e));
        }
        Ok(())
    }

    pub fn ble_start_scan() -> Result<bool, String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let context = context_obj(&mut env)?;
        let class = load_app_class(&mut env, BLE_CLASS_DOTTED)?;
        let raw = env.call_static_method(
            class,
            "startScan",
            "(Landroid/content/Context;)Z",
            &[JValue::Object(&context)],
        );
        let result = match raw {
            Ok(r) => r,
            Err(e) => return Err(drain_exception(&mut env, e)),
        };
        result.z().map_err(|e| e.to_string())
    }

    pub fn ble_stop_scan() -> Result<(), String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let class = load_app_class(&mut env, BLE_CLASS_DOTTED)?;
        let raw = env.call_static_method(class, "stopScan", "()V", &[]);
        if let Err(e) = raw {
            return Err(drain_exception(&mut env, e));
        }
        Ok(())
    }

    /// Drain BLE discoveries as a flat (`hex`, `epoch_ms`) string pair list.
    pub fn ble_drain_discoveries() -> Result<Vec<(String, i64)>, String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let class = load_app_class(&mut env, BLE_CLASS_DOTTED)?;
        let raw = env.call_static_method(class, "drainDiscoveries", "()[Ljava/lang/String;", &[]);
        let result = match raw {
            Ok(r) => r,
            Err(e) => return Err(drain_exception(&mut env, e)),
        };
        let obj: JObject<'_> = result.l().map_err(|e| e.to_string())?;
        let arr: JObjectArray<'_> = obj.into();
        let flat = jstring_array_to_vec(&mut env, arr)?;
        let mut pairs = Vec::with_capacity(flat.len() / 2);
        let mut iter = flat.into_iter();
        while let (Some(hex), Some(ts)) = (iter.next(), iter.next()) {
            let parsed: i64 = ts.parse().unwrap_or(0);
            pairs.push((hex, parsed));
        }
        Ok(pairs)
    }

    /// Wall-clock epoch (ms) for a "older than 24h" cutoff used at app boot.
    pub fn epoch_ms_24h_ago() -> u128 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        const DAY_MS: u128 = 24 * 60 * 60 * 1000;
        now.saturating_sub(DAY_MS)
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

/// Start the experimental Lightning P2P BLE advertise + scan pair on
/// Android. The local node id short-prefix is broadcast in the BLE
/// service data so other Lightning P2P phones in range can discover us.
///
/// Returns whether the advertise + scan started. Either may legitimately
/// return false if the BLE adapter is disabled or permissions are denied.
///
/// # Errors
///
/// Returns an error string if the JNI bridge fails.
#[tauri::command]
pub async fn start_ble_discovery(node_id_prefix_hex: String) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let advertising = android::ble_start_advertise(&node_id_prefix_hex)?;
        let scanning = android::ble_start_scan()?;
        Ok(advertising || scanning)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = node_id_prefix_hex;
        Ok(false)
    }
}

/// Stop the Lightning P2P BLE advertise + scan pair. Idempotent.
///
/// # Errors
///
/// Returns an error string if the JNI bridge fails.
#[tauri::command]
pub async fn stop_ble_discovery() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _ = android::ble_stop_scan();
        android::ble_stop_advertise()?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}
