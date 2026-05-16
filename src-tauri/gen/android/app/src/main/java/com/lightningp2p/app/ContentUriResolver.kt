package com.lightningp2p.app

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

/**
 * Android-only helpers bridging Rust transfer commands to the Storage Access
 * Framework and MediaStore.
 *
 *  - resolveContentUris streams `content://` URIs into app-private cache
 *    so iroh-blobs can `fs::metadata()` / scan them.
 *  - publishToMediaStore moves a verified received file into the public
 *    Pictures / Movies / Music / Downloads collection scoped storage
 *    exposes on API 29+.
 *  - takePendingSharedFiles drains files dropped here by MainActivity's
 *    SEND / SEND_MULTIPLE intent handler.
 *  - openSystemFolder launches the OS document UI focused on a bucket.
 *  - sweepStagingOlderThan trims stale cache entries on app boot.
 *
 * All methods are `@JvmStatic` so JNI can call them as static methods.
 */
object ContentUriResolver {
    private const val STAGING_DIR = "shared-staging"
    private const val MEDIASTORE_SUBDIR = "Lightning P2P"

    private val pendingSharedFiles = AtomicReference<List<String>>(emptyList())

    @JvmStatic
    fun resolveContentUris(context: Context, uris: Array<String>): Array<String> {
        return uris.map { uri ->
            if (!uri.startsWith("content://")) {
                uri
            } else {
                resolveToCache(context, Uri.parse(uri))
            }
        }.toTypedArray()
    }

    private fun resolveToCache(context: Context, uri: Uri): String {
        val displayName = queryDisplayName(context, uri) ?: "shared-${UUID.randomUUID()}.bin"
        val safeName = displayName.replace(Regex("[/\\\\]"), "_")
        val stagingDir = File(context.cacheDir, STAGING_DIR).also { it.mkdirs() }
        val outFile = File(stagingDir, "${UUID.randomUUID()}-$safeName")
        val resolver = context.contentResolver
        val input = resolver.openInputStream(uri)
            ?: throw IllegalStateException("Could not open input stream for $uri")
        input.use { source ->
            outFile.outputStream().use { sink -> source.copyTo(sink) }
        }
        return outFile.absolutePath
    }

    private fun queryDisplayName(context: Context, uri: Uri): String? {
        val resolver = context.contentResolver
        return resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
    }

    @JvmStatic
    fun publishToMediaStore(
        context: Context,
        stagedPath: String,
        filename: String,
        mime: String,
        bucket: String,
    ): String {
        val staged = File(stagedPath)
        require(staged.exists()) { "Staged file does not exist: $stagedPath" }

        val collection = collectionFor(bucket)
        val relativeDir = "${directoryFor(bucket)}/$MEDIASTORE_SUBDIR"

        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, relativeDir)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }

        val resolver = context.contentResolver
        val uri = resolver.insert(collection, values)
            ?: throw IllegalStateException("MediaStore insert returned null for bucket=$bucket")

        try {
            val output = resolver.openOutputStream(uri)
                ?: throw IllegalStateException("Could not open output stream for $uri")
            output.use { sink ->
                staged.inputStream().use { source -> source.copyTo(sink) }
            }
            val clearPending = ContentValues().apply {
                put(MediaStore.MediaColumns.IS_PENDING, 0)
            }
            resolver.update(uri, clearPending, null, null)
            return uri.toString()
        } catch (error: Throwable) {
            try {
                resolver.delete(uri, null, null)
            } catch (_: Throwable) {
                // best-effort cleanup
            }
            throw error
        }
    }

    private fun collectionFor(bucket: String) = when (bucket) {
        "Pictures" -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        "Movies" -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        "Music" -> MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        "Downloads" -> MediaStore.Downloads.EXTERNAL_CONTENT_URI
        else -> throw IllegalArgumentException("Unknown bucket: $bucket")
    }

    private fun directoryFor(bucket: String) = when (bucket) {
        "Pictures" -> Environment.DIRECTORY_PICTURES
        "Movies" -> Environment.DIRECTORY_MOVIES
        "Music" -> Environment.DIRECTORY_MUSIC
        "Downloads" -> Environment.DIRECTORY_DOWNLOADS
        else -> throw IllegalArgumentException("Unknown bucket: $bucket")
    }

    @JvmStatic
    fun setPendingSharedFiles(paths: Array<String>) {
        pendingSharedFiles.set(paths.toList())
    }

    @JvmStatic
    fun takePendingSharedFiles(): Array<String> {
        return pendingSharedFiles.getAndSet(emptyList()).toTypedArray()
    }

    @JvmStatic
    fun openSystemFolder(context: Context, bucket: String) {
        val authority = "com.android.externalstorage.documents"
        val rawDir = when (bucket) {
            "Pictures" -> "Pictures"
            "Movies" -> "Movies"
            "Music" -> "Music"
            "Downloads" -> "Download"
            else -> "Download"
        }
        val docUri = DocumentsContract.buildDocumentUri(authority, "primary:$rawDir")
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(docUri, "vnd.android.document/directory")
            flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK
        }
        try {
            context.startActivity(intent)
        } catch (_: Throwable) {
            val fallback = Intent(Intent.ACTION_VIEW).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            try {
                context.startActivity(fallback)
            } catch (_: Throwable) {
                // The system has no document handler. Caller treats as soft fail.
            }
        }
    }

    @JvmStatic
    fun sweepStagingOlderThan(context: Context, olderThanEpochMs: Long): Int {
        val dir = File(context.cacheDir, STAGING_DIR)
        if (!dir.exists()) return 0
        var removed = 0
        dir.listFiles()?.forEach { file ->
            if (file.lastModified() < olderThanEpochMs && file.delete()) {
                removed++
            }
        }
        return removed
    }
}
