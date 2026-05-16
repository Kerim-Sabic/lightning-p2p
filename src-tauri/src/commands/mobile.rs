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

#[cfg(target_os = "android")]
pub(crate) mod android {
    use jni::objects::{JObject, JObjectArray, JString, JValue};
    use jni::sys::jsize;
    use jni::{JNIEnv, JavaVM};
    use std::time::{SystemTime, UNIX_EPOCH};

    const RESOLVER_CLASS: &str = "com/lightningp2p/app/ContentUriResolver";

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

    fn vec_to_jstring_array<'local>(
        env: &mut JNIEnv<'local>,
        values: &[String],
    ) -> Result<JObjectArray<'local>, String> {
        let len = jsize::try_from(values.len()).map_err(|e| e.to_string())?;
        let string_class = env.find_class("java/lang/String").map_err(|e| e.to_string())?;
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
            let value: String = env
                .get_string(&jstr)
                .map_err(|e| e.to_string())?
                .into();
            out.push(value);
        }
        Ok(out)
    }

    pub fn resolve_content_uris(uris: Vec<String>) -> Result<Vec<String>, String> {
        if uris.is_empty() || !uris.iter().any(|u| u.starts_with("content://")) {
            return Ok(uris);
        }
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let context = context_obj(&mut env)?;
        let array = vec_to_jstring_array(&mut env, &uris)?;
        let result = env
            .call_static_method(
                RESOLVER_CLASS,
                "resolveContentUris",
                "(Landroid/content/Context;[Ljava/lang/String;)[Ljava/lang/String;",
                &[JValue::Object(&context), JValue::Object(&array)],
            )
            .map_err(|e| e.to_string())?;
        let obj = result.l().map_err(|e| e.to_string())?;
        jstring_array_to_vec(&mut env, JObjectArray::from(obj))
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
        let result = env
            .call_static_method(
                RESOLVER_CLASS,
                "publishToMediaStore",
                "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                &[
                    JValue::Object(&context),
                    JValue::Object(&staged_j),
                    JValue::Object(&filename_j),
                    JValue::Object(&mime_j),
                    JValue::Object(&bucket_j),
                ],
            )
            .map_err(|e| e.to_string())?;
        let obj = result.l().map_err(|e| e.to_string())?;
        let jstr = JString::from(obj);
        let value: String = env
            .get_string(&jstr)
            .map_err(|e| e.to_string())?
            .into();
        Ok(value)
    }

    pub fn take_pending_shared_files() -> Result<Vec<String>, String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let result = env
            .call_static_method(
                RESOLVER_CLASS,
                "takePendingSharedFiles",
                "()[Ljava/lang/String;",
                &[],
            )
            .map_err(|e| e.to_string())?;
        let obj = result.l().map_err(|e| e.to_string())?;
        jstring_array_to_vec(&mut env, JObjectArray::from(obj))
    }

    pub fn open_system_folder(bucket: &str) -> Result<(), String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let context = context_obj(&mut env)?;
        let bucket_j = env.new_string(bucket).map_err(|e| e.to_string())?;
        env.call_static_method(
            RESOLVER_CLASS,
            "openSystemFolder",
            "(Landroid/content/Context;Ljava/lang/String;)V",
            &[JValue::Object(&context), JValue::Object(&bucket_j)],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Best-effort sweep of staged cache files older than `older_than_ms`.
    pub fn sweep_staging_older_than(older_than_ms: u128) -> Result<i32, String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let context = context_obj(&mut env)?;
        let cutoff: i64 = older_than_ms.try_into().map_err(|_| "cutoff overflows i64".to_string())?;
        let removed = env
            .call_static_method(
                RESOLVER_CLASS,
                "sweepStagingOlderThan",
                "(Landroid/content/Context;J)I",
                &[JValue::Object(&context), JValue::Long(cutoff)],
            )
            .map_err(|e| e.to_string())?
            .i()
            .map_err(|e| e.to_string())?;
        Ok(removed)
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
pub async fn resolve_content_uris(uris: Vec<String>) -> Result<Vec<String>, String> {
    #[cfg(target_os = "android")]
    {
        android::resolve_content_uris(uris)
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
pub async fn open_android_bucket(bucket: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android::open_system_folder(&bucket)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = bucket;
        Err("open_android_bucket is only available on Android".into())
    }
}
