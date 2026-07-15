package com.lightningp2p.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.wifi.WifiManager
import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.NfcAdapter
import android.os.Build
import android.os.Bundle
import android.os.Parcelable
import android.system.Os
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  private var multicastLock: WifiManager.MulticastLock? = null

  /**
   * Installs the process JavaVM and application Context into Rust's typed JNI
   * bridge. Must run before any Rust code that can touch Android APIs.
   */
  private external fun initRustAndroidContext(context: Context): Boolean

  override fun onCreate(savedInstanceState: Bundle?) {
    AndroidDiagnostics.install(this)
    AndroidDiagnostics.info(this, "MainActivity.onCreate start")

    try {
      safeStep("prepare Rust app data directory") { prepareRustAppDataDir() }
      safeStep("init Rust Android context") {
        check(initRustAndroidContext(applicationContext)) {
          "Rust Android context initialization returned false"
        }
        AndroidDiagnostics.info(this, "Rust Android context ready")
      }
      enableEdgeToEdge()
      super.onCreate(savedInstanceState)
      safeStep("acquire multicast lock") { acquireMulticastLock() }
      safeStep("ensure transfer notification channel") { ensureTransferNotificationChannel() }
      safeStep("request notification permission") { requestPostNotificationsIfNeeded() }
      safeStep("start idle foreground service") {
        TransferForegroundService.start(applicationContext, 0)
      }
      safeStep("handle cold-start share intent") { handleShareIntent(intent) }
      safeStep("handle cold-start NFC intent") { handleNfcIntent(intent) }
      AndroidDiagnostics.info(this, "MainActivity.onCreate complete")
    } catch (error: Throwable) {
      AndroidDiagnostics.error(this, "MainActivity.onCreate failed", error)
      throw error
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    safeStep("handle warm share intent") { handleShareIntent(intent) }
    safeStep("handle warm NFC intent") { handleNfcIntent(intent) }
  }

  override fun onResume() {
    super.onResume()
    LightningBleService.attachActivity(this)
  }

  override fun onPause() {
    LightningBleService.detachActivity(this)
    super.onPause()
  }

  /**
   * Parse a Lightning P2P NFC ticket. The NFC source embeds the iroh receive
   * ticket in an NDEF record with MIME `application/vnd.lightning-p2p.ticket`;
   * we extract the UTF-8 payload and stash it on [ContentUriResolver] for
   * the JS layer to drain on focus.
   */
  private fun handleNfcIntent(intent: Intent?) {
    if (intent == null) return
    if (intent.action != NfcAdapter.ACTION_NDEF_DISCOVERED) return
    try {
      val rawMessages = extractNdefMessages(intent) ?: return
      for (raw in rawMessages) {
        val msg = raw as? NdefMessage ?: continue
        for (record in msg.records) {
          if (record.tnf != NdefRecord.TNF_MIME_MEDIA) continue
          val mime = String(record.type, Charsets.US_ASCII)
          if (mime != "application/vnd.lightning-p2p.ticket") continue
          val ticket = String(record.payload, Charsets.UTF_8).trim()
          if (ticket.isEmpty()) continue
          ContentUriResolver.setPendingSharedTicket(ticket)
          AndroidDiagnostics.info(this, "Stashed NFC-received ticket (${ticket.length} chars)")
          return
        }
      }
    } catch (error: Throwable) {
      AndroidDiagnostics.error(this, "Failed to parse NFC NDEF intent", error)
    }
  }

  @Suppress("DEPRECATION")
  private fun extractNdefMessages(intent: Intent): Array<Parcelable>? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES, Parcelable::class.java)
    } else {
      intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES)
    }
  }

  /**
   * Inspect an incoming Intent for ACTION_SEND / ACTION_SEND_MULTIPLE and,
   * when present, resolve the EXTRA_STREAM URIs into app-private cache and
   * stash them on [ContentUriResolver] for the JS layer to drain.
   */
  private fun handleShareIntent(intent: Intent?) {
    if (intent == null) return
    val uriStrings = extractShareUris(intent)
    if (uriStrings.isEmpty()) return
    try {
      val resolved = ContentUriResolver.resolveContentUris(
        applicationContext,
        uriStrings.toTypedArray(),
      )
      ContentUriResolver.setPendingSharedFiles(resolved)
      AndroidDiagnostics.info(this, "Stashed ${resolved.size} shared file(s) for drain")
    } catch (error: Throwable) {
      AndroidDiagnostics.error(this, "Failed to resolve shared files", error)
    }
  }

  private fun extractShareUris(intent: Intent): List<String> {
    return when (intent.action) {
      Intent.ACTION_SEND -> {
        val uri = extractSingleStream(intent)
        if (uri != null) listOf(uri.toString()) else emptyList()
      }
      Intent.ACTION_SEND_MULTIPLE -> {
        extractStreamList(intent).map { it.toString() }
      }
      else -> emptyList()
    }
  }

  @Suppress("DEPRECATION")
  private fun extractSingleStream(intent: Intent): Uri? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
    }
  }

  @Suppress("DEPRECATION")
  private fun extractStreamList(intent: Intent): List<Uri> {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
    } else {
      intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
    }
  }

  private fun prepareRustAppDataDir() {
    val dataDir = AndroidDiagnostics.appDataDir(applicationContext)
    if (!dataDir.exists() && !dataDir.mkdirs()) {
      AndroidDiagnostics.warn(this, "Android app data directory could not be created")
    }
    Os.setenv("LIGHTNING_P2P_DATA_DIR", dataDir.absolutePath, true)
    AndroidDiagnostics.info(this, "Rust app data directory prepared")
  }

  /**
   * Android 13+ gates the foreground-service notification behind a runtime
   * permission. Without the grant, the notification stays hidden and the OS can
   * throttle the process more aggressively under battery optimization.
   */
  private fun requestPostNotificationsIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      return
    }
    val granted = ContextCompat.checkSelfPermission(
      this,
      Manifest.permission.POST_NOTIFICATIONS,
    ) == PackageManager.PERMISSION_GRANTED
    if (granted) {
      return
    }
    try {
      ActivityCompat.requestPermissions(
        this,
        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
        POST_NOTIFICATIONS_REQUEST_CODE,
      )
    } catch (error: Throwable) {
      AndroidDiagnostics.warn(this, "Failed to request POST_NOTIFICATIONS", error)
    }
  }

  override fun onDestroy() {
    AndroidDiagnostics.info(this, "MainActivity.onDestroy")
    LightningBleService.detachActivity(this)
    safeStep("release multicast lock") { releaseMulticastLock() }
    safeStep("stop idle foreground service") { TransferForegroundService.stop(applicationContext) }
    super.onDestroy()
  }

  /**
   * Without an explicit [WifiManager.MulticastLock] most Android devices
   * silently drop the multicast packets iroh's mDNS discovery relies on.
   */
  private fun acquireMulticastLock() {
    if (multicastLock?.isHeld == true) {
      return
    }
    try {
      val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      val lock = wifi.createMulticastLock(MULTICAST_LOCK_TAG)
      lock.setReferenceCounted(false)
      lock.acquire()
      multicastLock = lock
      AndroidDiagnostics.info(this, "Multicast lock acquired")
    } catch (error: Throwable) {
      AndroidDiagnostics.warn(this, "Failed to acquire multicast lock", error)
    }
  }

  private fun releaseMulticastLock() {
    val lock = multicastLock ?: return
    if (lock.isHeld) {
      try {
        lock.release()
      } catch (error: Throwable) {
        AndroidDiagnostics.warn(this, "Failed to release multicast lock", error)
      }
    }
    multicastLock = null
  }

  /**
   * Creates the foreground-service notification channel once, idempotently.
   */
  private fun ensureTransferNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(TransferForegroundService.CHANNEL_ID) != null) {
      AndroidDiagnostics.info(this, "Transfer notification channel already exists")
      return
    }
    val channel = NotificationChannel(
      TransferForegroundService.CHANNEL_ID,
      getString(R.string.transfer_notification_channel_name),
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = getString(R.string.transfer_notification_channel_description)
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
    AndroidDiagnostics.info(this, "Transfer notification channel ready")
  }

  private fun safeStep(name: String, action: () -> Unit) {
    try {
      action()
    } catch (error: Throwable) {
      AndroidDiagnostics.error(this, "Android startup step failed: $name", error)
    }
  }

  private companion object {
    private const val MULTICAST_LOCK_TAG = "lightning-p2p-mdns"
    private const val POST_NOTIFICATIONS_REQUEST_CODE = 1001

    init {
      // Idempotent with the load in generated Rust.kt; needed here because
      // initRustAndroidContext is called before Tauri touches the library.
      // A load failure surfaces later as UnsatisfiedLinkError inside
      // safeStep instead of aborting class initialization.
      runCatching { System.loadLibrary("lightning_p2p_lib") }
    }
  }
}
