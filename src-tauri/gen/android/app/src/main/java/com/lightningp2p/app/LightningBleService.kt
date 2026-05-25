package com.lightningp2p.app

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Experimental Lightning P2P BLE proximity discovery.
 *
 * BLE carries only a nearby-presence beacon with the local iroh NodeId. Actual
 * transfer bytes still move through iroh QUIC and iroh-blobs. The 32-byte
 * NodeId is split into small service-data frames so each advertisement fits
 * the legacy BLE payload limit used by Android devices.
 */
object LightningBleService {
    private const val TAG = "LightningBleService"
    private const val PROTOCOL_VERSION: Byte = 1
    private const val CHUNK_DATA_BYTES = 9
    private const val ROTATION_MS = 900L
    private const val PERMISSION_REQUEST_CODE = 2405
    private const val PARTIAL_STALE_MS = 20_000L

    val SERVICE_UUID: UUID = UUID.fromString("4c50324c-7032-7032-7032-4c6967687431")

    private val serviceParcelUuid = ParcelUuid(SERVICE_UUID)
    private val advertiseHandler = Handler(Looper.getMainLooper())

    private var advertiser: BluetoothLeAdvertiser? = null
    private var advertiseCallback: AdvertiseCallback? = null
    private var advertisePayloads: List<ByteArray> = emptyList()
    private var advertiseIndex = 0
    private var advertising = false

    private var scanner: BluetoothLeScanner? = null
    private var scanCallback: ScanCallback? = null
    private var scanning = false

    @Volatile
    private var permissionRequestIssued = false

    @Volatile
    private var lastError: String? = null

    /** full-node-id-hex -> last-seen epoch millis. */
    private val discoveries = ConcurrentHashMap<String, Long>()
    private val partialDiscoveries = ConcurrentHashMap<String, PartialNodeId>()

    private val rotateRunnable = object : Runnable {
        override fun run() {
            startCurrentAdvertisement()
            if (advertising && advertisePayloads.isNotEmpty()) {
                advertiseHandler.postDelayed(this, ROTATION_MS)
            }
        }
    }

    @JvmStatic
    @Synchronized
    fun advertiseNodeId(context: Context, nodeIdHex: String): Boolean {
        if (!ensureRuntimePermissions(context)) return false
        val adapter = bluetoothAdapter(context) ?: return fail("BLE adapter unavailable")
        if (!isAdapterEnabled(adapter)) return fail("BLE adapter is off")
        val ad = adapter.bluetoothLeAdvertiser ?: return fail("BLE advertiser unavailable")
        val payloads = buildNodeIdPayloads(nodeIdHex)
        if (payloads.isEmpty()) return fail("Invalid iroh NodeId for BLE advertisement")

        stopAdvertising()
        advertiser = ad
        advertisePayloads = payloads
        advertiseIndex = 0
        lastError = null
        startCurrentAdvertisement()
        advertiseHandler.postDelayed(rotateRunnable, ROTATION_MS)
        return advertising
    }

    @JvmStatic
    @Synchronized
    fun stopAdvertising() {
        advertiseHandler.removeCallbacks(rotateRunnable)
        stopActiveAdvertisement()
        advertiser = null
        advertisePayloads = emptyList()
        advertiseIndex = 0
        advertising = false
    }

    @JvmStatic
    @Synchronized
    fun startScan(context: Context): Boolean {
        if (!ensureRuntimePermissions(context)) return false
        val adapter = bluetoothAdapter(context) ?: return fail("BLE adapter unavailable")
        if (!isAdapterEnabled(adapter)) return fail("BLE adapter is off")
        val sc = adapter.bluetoothLeScanner ?: return fail("BLE scanner unavailable")
        stopScan()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED)
            .build()

        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult?) {
                handleResult(result)
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>?) {
                results?.forEach(::handleResult)
            }

            override fun onScanFailed(errorCode: Int) {
                scanning = false
                val message = "BLE scan failed: $errorCode"
                lastError = message
                Log.w(TAG, message)
            }
        }

        return try {
            sc.startScan(emptyList<ScanFilter>(), settings, cb)
            scanner = sc
            scanCallback = cb
            scanning = true
            lastError = null
            true
        } catch (error: SecurityException) {
            fail("BLE scan permission rejected: ${error.message}")
        } catch (error: Throwable) {
            fail("BLE scan threw: ${error.message}")
        }
    }

    @JvmStatic
    @Synchronized
    fun stopScan() {
        val sc = scanner
        val cb = scanCallback
        if (sc != null && cb != null) {
            try {
                sc.stopScan(cb)
            } catch (error: Throwable) {
                val message = "stopScan threw: ${error.message}"
                lastError = message
                Log.w(TAG, message)
            }
        }
        scanner = null
        scanCallback = null
        scanning = false
    }

    @JvmStatic
    fun drainDiscoveries(): Array<String> {
        val out = ArrayList<String>(discoveries.size * 2)
        val snapshot = HashMap(discoveries)
        discoveries.clear()
        for ((hex, ts) in snapshot) {
            out.add(hex)
            out.add(ts.toString())
        }
        return out.toTypedArray()
    }

    @JvmStatic
    fun permissionState(context: Context): String {
        val required = requiredBlePermissions()
        if (required.isEmpty() || hasRequiredPermissions(context, required)) {
            return "granted"
        }
        return if (permissionRequestIssued) "denied" else "not_requested"
    }

    @JvmStatic
    fun adapterState(context: Context): String {
        val required = requiredBlePermissions()
        if (!hasRequiredPermissions(context, required)) {
            return "unknown"
        }
        val adapter = bluetoothAdapter(context) ?: return "unavailable"
        return if (isAdapterEnabled(adapter) && adapter.bluetoothLeScanner != null) {
            "available"
        } else {
            "unavailable"
        }
    }

    @JvmStatic
    fun isScanning(): Boolean = scanning

    @JvmStatic
    fun isAdvertising(): Boolean = advertising

    @JvmStatic
    fun lastError(): String? = lastError

    @Synchronized
    private fun startCurrentAdvertisement() {
        val ad = advertiser ?: return
        if (advertisePayloads.isEmpty()) return

        stopActiveAdvertisement()
        val payload = advertisePayloads[advertiseIndex % advertisePayloads.size]
        advertiseIndex = (advertiseIndex + 1) % advertisePayloads.size

        val cb = object : AdvertiseCallback() {
            override fun onStartFailure(errorCode: Int) {
                advertising = false
                val message = "BLE advertise failed: $errorCode"
                lastError = message
                Log.w(TAG, message)
            }

            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                advertising = true
                lastError = null
                Log.i(TAG, "BLE advertising chunk started")
            }
        }

        try {
            ad.startAdvertising(advertiseSettings(), advertiseData(payload), cb)
            advertiseCallback = cb
            advertising = true
        } catch (error: SecurityException) {
            fail("BLE advertise permission rejected: ${error.message}")
        } catch (error: Throwable) {
            fail("BLE advertise threw: ${error.message}")
        }
    }

    private fun stopActiveAdvertisement() {
        val ad = advertiser
        val cb = advertiseCallback
        if (ad != null && cb != null) {
            try {
                ad.stopAdvertising(cb)
            } catch (error: Throwable) {
                val message = "stopAdvertising threw: ${error.message}"
                lastError = message
                Log.w(TAG, message)
            }
        }
        advertiseCallback = null
    }

    private fun advertiseSettings(): AdvertiseSettings =
        AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_LOW)
            .setConnectable(false)
            .build()

    private fun advertiseData(payload: ByteArray): AdvertiseData =
        AdvertiseData.Builder()
            .addServiceData(serviceParcelUuid, payload)
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .build()

    private fun handleResult(result: ScanResult?) {
        if (result == null) return
        val record = result.scanRecord ?: return
        val payload = record.serviceData?.get(serviceParcelUuid) ?: return
        if (payload.size < 3 || payload[0] != PROTOCOL_VERSION) return

        val index = payload[1].toInt() and 0xff
        val total = payload[2].toInt() and 0xff
        if (total <= 0 || total > 8 || index >= total) return

        val address = result.device?.address ?: return
        val now = System.currentTimeMillis()
        val chunk = payload.copyOfRange(3, payload.size)
        val partial = partialDiscoveries.compute(address) { _, existing ->
            if (existing == null || existing.total != total) PartialNodeId(total) else existing
        } ?: return
        partial.chunks[index] = chunk
        partial.lastSeenMs = now

        val joined = partial.joinedBytes()
        if (joined.size >= 32) {
            discoveries[bytesToHex(joined.copyOfRange(0, 32))] = now
            partialDiscoveries.remove(address)
        }
        prunePartialDiscoveries(now)
    }

    private fun prunePartialDiscoveries(now: Long) {
        partialDiscoveries.entries.removeIf { (_, value) ->
            now - value.lastSeenMs > PARTIAL_STALE_MS
        }
    }

    private fun buildNodeIdPayloads(nodeIdHex: String): List<ByteArray> {
        val bytes = hexToBytes(nodeIdHex) ?: return emptyList()
        if (bytes.size < 32) return emptyList()
        val nodeIdBytes = bytes.copyOfRange(0, 32)
        val total = (nodeIdBytes.size + CHUNK_DATA_BYTES - 1) / CHUNK_DATA_BYTES
        return (0 until total).map { index ->
            val start = index * CHUNK_DATA_BYTES
            val end = minOf(start + CHUNK_DATA_BYTES, nodeIdBytes.size)
            val payload = ByteArray(3 + (end - start))
            payload[0] = PROTOCOL_VERSION
            payload[1] = index.toByte()
            payload[2] = total.toByte()
            System.arraycopy(nodeIdBytes, start, payload, 3, end - start)
            payload
        }
    }

    private fun ensureRuntimePermissions(context: Context): Boolean {
        val required = requiredBlePermissions()
        if (hasRequiredPermissions(context, required)) return true
        requestRuntimePermissions(context, required)
        return false
    }

    private fun requiredBlePermissions(): Array<String> {
        return when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
            )
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M -> arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
            )
            else -> emptyArray()
        }
    }

    private fun hasRequiredPermissions(
        context: Context,
        permissions: Array<String>,
    ): Boolean {
        return permissions.all { permission ->
            ContextCompat.checkSelfPermission(context, permission) ==
                PackageManager.PERMISSION_GRANTED
        }
    }

    private fun requestRuntimePermissions(context: Context, permissions: Array<String>) {
        if (permissions.isEmpty()) return
        permissionRequestIssued = true
        val activity = context as? Activity
        if (activity == null) {
            fail("BLE permissions are not granted and cannot be requested from this context")
            return
        }
        ActivityCompat.requestPermissions(activity, permissions, PERMISSION_REQUEST_CODE)
        fail("BLE permission is required. Grant Nearby devices, then enable discovery again.")
    }

    private fun bluetoothAdapter(context: Context): BluetoothAdapter? {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE)
            as? BluetoothManager ?: return null
        return manager.adapter
    }

    private fun isAdapterEnabled(adapter: BluetoothAdapter): Boolean {
        return try {
            adapter.isEnabled
        } catch (error: SecurityException) {
            fail("BLE adapter permission rejected: ${error.message}")
            false
        }
    }

    private fun hexToBytes(hex: String): ByteArray? {
        val trimmed = hex.filterNot { it.isWhitespace() || it == ':' || it == '-' }
            .lowercase()
            .trim()
        if (trimmed.length < 64 || trimmed.length % 2 != 0) return null
        val out = ByteArray(trimmed.length / 2)
        var i = 0
        while (i < trimmed.length) {
            val high = Character.digit(trimmed[i], 16)
            val low = Character.digit(trimmed[i + 1], 16)
            if (high < 0 || low < 0) return null
            out[i / 2] = ((high shl 4) + low).toByte()
            i += 2
        }
        return out
    }

    private fun bytesToHex(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            sb.append(String.format("%02x", b.toInt() and 0xff))
        }
        return sb.toString()
    }

    private fun fail(message: String): Boolean {
        lastError = message
        Log.w(TAG, message)
        return false
    }

    private class PartialNodeId(val total: Int) {
        val chunks = ConcurrentHashMap<Int, ByteArray>()

        @Volatile
        var lastSeenMs: Long = System.currentTimeMillis()

        fun joinedBytes(): ByteArray {
            if (chunks.size < total) return ByteArray(0)
            val out = ByteArrayOutputStream(total * CHUNK_DATA_BYTES)
            for (index in 0 until total) {
                val chunk = chunks[index] ?: return ByteArray(0)
                out.write(chunk)
            }
            return out.toByteArray()
        }
    }
}
