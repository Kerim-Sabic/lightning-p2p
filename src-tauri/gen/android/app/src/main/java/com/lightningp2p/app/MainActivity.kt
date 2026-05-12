package com.lightningp2p.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  private var multicastLock: WifiManager.MulticastLock? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    acquireMulticastLock()
    ensureTransferNotificationChannel()
    requestPostNotificationsIfNeeded()
    // Start the foreground service for the activity lifetime so any in-flight
    // iroh transfer survives backgrounding. The notification is silent +
    // IMPORTANCE_LOW so it stays unobtrusive when nothing is happening.
    try {
      TransferForegroundService.start(applicationContext, 0)
    } catch (error: Throwable) {
      Log.w(TAG, "Failed to start transfer foreground service: ${error.message}")
    }
  }

  /**
   * Android 13+ gates the foreground-service notification behind a runtime
   * permission. Without the grant, the notification stays hidden — the service
   * still runs but the OS becomes more aggressive about throttling the process
   * under battery optimization. We ask once on first launch; a declined grant
   * is respected and not re-prompted.
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
      Log.w(TAG, "Failed to request POST_NOTIFICATIONS: ${error.message}")
    }
  }

  override fun onDestroy() {
    releaseMulticastLock()
    try {
      TransferForegroundService.stop(applicationContext)
    } catch (error: Throwable) {
      Log.w(TAG, "Failed to stop transfer foreground service: ${error.message}")
    }
    super.onDestroy()
  }

  /**
   * Without an explicit [WifiManager.MulticastLock] most Android devices
   * silently drop the multicast packets iroh's mDNS discovery relies on, so
   * nearby Wi-Fi peers would simply never appear. We acquire it for the
   * lifetime of the activity to keep discovery instant.
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
    } catch (error: Throwable) {
      Log.w(TAG, "Failed to acquire multicast lock: ${error.message}")
    }
  }

  private fun releaseMulticastLock() {
    val lock = multicastLock ?: return
    if (lock.isHeld) {
      try {
        lock.release()
      } catch (error: Throwable) {
        Log.w(TAG, "Failed to release multicast lock: ${error.message}")
      }
    }
    multicastLock = null
  }

  /**
   * Creates the foreground-service notification channel once, idempotently.
   * The channel must exist before [TransferForegroundService] calls
   * [startForeground] on Android 8+.
   */
  private fun ensureTransferNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(TransferForegroundService.CHANNEL_ID) != null) {
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
  }

  private companion object {
    private const val TAG = "LightningP2P"
    private const val MULTICAST_LOCK_TAG = "lightning-p2p-mdns"
    private const val POST_NOTIFICATIONS_REQUEST_CODE = 1001
  }
}
