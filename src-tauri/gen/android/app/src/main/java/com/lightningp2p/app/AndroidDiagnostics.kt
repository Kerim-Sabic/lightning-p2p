package com.lightningp2p.app

import android.content.Context
import android.os.Process
import android.util.Log
import java.io.File
import java.io.FileWriter
import java.io.PrintWriter
import java.io.StringWriter
import java.util.Locale
import kotlin.system.exitProcess

object AndroidDiagnostics {
  private const val TAG = "LightningP2P"
  private const val APP_DATA_DIR = "com.lightningp2p.app"
  private const val DIAGNOSTICS_DIR = "diagnostics"
  private const val LOG_FILE_NAME = "android-diagnostics.log"

  @Volatile
  private var installed = false

  fun install(context: Context) {
    val appContext = context.applicationContext
    if (installed) {
      return
    }

    val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      error(appContext, "Uncaught exception on ${thread.name}", throwable)
      if (previousHandler != null) {
        previousHandler.uncaughtException(thread, throwable)
      } else {
        Process.killProcess(Process.myPid())
        exitProcess(10)
      }
    }

    installed = true
    info(appContext, "Android diagnostics installed")
  }

  fun info(context: Context, message: String) {
    Log.i(TAG, message)
    append(context, "INFO", message, null)
  }

  fun warn(context: Context, message: String, error: Throwable? = null) {
    if (error == null) {
      Log.w(TAG, message)
    } else {
      Log.w(TAG, message, error)
    }
    append(context, "WARN", message, error)
  }

  fun error(context: Context, message: String, error: Throwable? = null) {
    if (error == null) {
      Log.e(TAG, message)
    } else {
      Log.e(TAG, message, error)
    }
    append(context, "ERROR", message, error)
  }

  fun appDataDir(context: Context): File =
    File(context.applicationContext.filesDir, APP_DATA_DIR)

  private fun append(context: Context, level: String, message: String, error: Throwable?) {
    try {
      val file = logFile(context.applicationContext)
      FileWriter(file, true).use { writer ->
        writer.append(timestamp())
          .append(' ')
          .append(level)
          .append(' ')
          .append(message)
          .append('\n')
        if (error != null) {
          writer.append(stackTrace(error)).append('\n')
        }
      }
    } catch (writeError: Throwable) {
      Log.w(TAG, "Failed to write Android diagnostics: ${writeError.message}", writeError)
    }
  }

  private fun logFile(context: Context): File {
    val dir = File(appDataDir(context), DIAGNOSTICS_DIR)
    if (!dir.exists()) {
      dir.mkdirs()
    }
    return File(dir, LOG_FILE_NAME)
  }

  private fun stackTrace(error: Throwable): String {
    val output = StringWriter()
    error.printStackTrace(PrintWriter(output))
    return output.toString()
  }

  private fun timestamp(): String =
    String.format(Locale.US, "%d", System.currentTimeMillis())
}
