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
 * Foreground service that keeps the app process alive while transfers are in
 * flight. Startup is defensive: foreground-service failures are logged locally
 * and the service stops itself instead of crashing the activity.
 */
class TransferForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    AndroidDiagnostics.install(applicationContext)
    return try {
      val activeCount = intent?.getIntExtra(EXTRA_ACTIVE_COUNT, 1) ?: 1
      AndroidDiagnostics.info(this, "TransferForegroundService start activeCount=$activeCount")
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
      START_STICKY
    } catch (error: Throwable) {
      AndroidDiagnostics.error(this, "TransferForegroundService failed to enter foreground", error)
      stopSelf(startId)
      START_NOT_STICKY
    }
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

    val text = if (activeCount > 0) {
      resources.getQuantityString(
        R.plurals.transfer_notification_active,
        activeCount,
        activeCount,
      )
    } else {
      getString(R.string.transfer_notification_idle)
    }

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(getString(R.string.transfer_notification_title))
      .setContentText(text)
      .setSmallIcon(R.drawable.ic_stat_transfer)
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

    @JvmStatic
    fun start(context: Context, activeCount: Int) {
      try {
        AndroidDiagnostics.install(context)
        val intent = Intent(context, TransferForegroundService::class.java)
          .putExtra(EXTRA_ACTIVE_COUNT, activeCount.coerceAtLeast(0))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (error: Throwable) {
        AndroidDiagnostics.error(context, "Failed to request transfer foreground service start", error)
      }
    }

    @JvmStatic
    fun stop(context: Context) {
      try {
        val intent = Intent(context, TransferForegroundService::class.java)
        context.stopService(intent)
      } catch (error: Throwable) {
        AndroidDiagnostics.warn(context, "Failed to stop transfer foreground service", error)
      }
    }
  }
}
