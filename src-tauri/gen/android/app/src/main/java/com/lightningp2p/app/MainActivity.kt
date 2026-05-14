package com.lightningp2p.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.system.Os
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  private var multicastLock: WifiManager.MulticastLock? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    AndroidDiagnostics.install(this)
    AndroidDiagnostics.info(this, "MainActivity.onCreate start")

    try {
      safeStep("prepare Rust app data directory") { prepareRustAppDataDir() }
      enableEdgeToEdge()
      super.onCreate(savedInstanceState)
      safeStep("acquire multicast lock") { acquireMulticastLock() }
      safeStep("ensure transfer notification channel") { ensureTransferNotificationChannel() }
      safeStep("request notification permission") { requestPostNotificationsIfNeeded() }
      safeStep("start idle foreground service") {
        TransferForegroundService.start(applicationContext, 0)
      }
      AndroidDiagnostics.info(this, "MainActivity.onCreate complete")
    } catch (error: Throwable) {
      AndroidDiagnostics.error(this, "MainActivity.onCreate failed", error)
      throw error
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
  }
}
