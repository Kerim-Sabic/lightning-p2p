package com.lightningp2p.app

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service that keeps the app process — and therefore the iroh
 * endpoint — alive while transfers are in flight. Without this, Android can
 * freeze the process within seconds of the user switching apps, killing any
 * in-progress download.
 *
 * The Rust side starts/stops the service through [Helper] whenever the
 * active-transfer count transitions across zero.
 */
class TransferForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val activeCount = intent?.getIntExtra(EXTRA_ACTIVE_COUNT, 1) ?: 1
    val notification = buildNotification(activeCount)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_STICKY
  }

  private fun buildNotification(activeCount: Int): Notification {
    val launchIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    val text = resources.getQuantityString(
      R.plurals.transfer_notification_active,
      activeCount,
      activeCount,
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(getString(R.string.transfer_notification_title))
      .setContentText(text)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setContentIntent(contentIntent)
      .build()
  }

  companion object {
    const val CHANNEL_ID = "lightning_p2p_transfers"
    private const val NOTIFICATION_ID = 1
    private const val EXTRA_ACTIVE_COUNT = "active_count"

    /**
     * Helper invoked from Rust (via JNI) when the active-transfer count
     * transitions across zero. Both [start] and [stop] are safe to call
     * repeatedly — Android coalesces the underlying lifecycle changes.
     */
    object Helper {
      @JvmStatic
      fun start(context: Context, activeCount: Int) {
        val intent = Intent(context, TransferForegroundService::class.java)
          .putExtra(EXTRA_ACTIVE_COUNT, activeCount.coerceAtLeast(1))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      }

      @JvmStatic
      fun stop(context: Context) {
        val intent = Intent(context, TransferForegroundService::class.java)
        context.stopService(intent)
      }
    }
  }
}
