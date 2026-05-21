package com.lightningp2p.app

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
import android.os.ParcelUuid
import android.util.Log
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Experimental Lightning P2P BLE proximity discovery (v0.5.0).
 *
 *   - advertiseNodeId broadcasts the local iroh NodeId short-prefix in the
 *     service data of a 128-bit Lightning P2P service UUID. Other phones
 *     scanning for that UUID can pull the prefix and seed a connection.
 *   - startScan listens for matching beacons and stashes discoveries in a
 *     thread-safe map; Rust drains via [drainDiscoveries] over JNI.
 *
 * The protocol layer carries ONLY the discovery beacon — every byte of
 * actual file content still rides on iroh QUIC + iroh-blobs per the project
 * architecture invariant. The advertised payload is intentionally tiny
 * (16 bytes) so we fit inside the 31-byte BLE advertisement frame on every
 * Android version.
 *
 * All methods are `@JvmStatic` so Rust JNI calls them as static methods.
 * Failures are caught and logged — the BLE radio is best-effort.
 */
object LightningBleService {
    private const val TAG = "LightningBleService"

    /**
     * Stable Lightning P2P service UUID. Devices filter on this UUID to
     * detect peers. Generated once and kept constant across releases so
     * older clients can still find newer peers.
     */
    val SERVICE_UUID: UUID = UUID.fromString("4c50324c-7032-7032-7032-4c69676874")

    private val SERVICE_PARCEL_UUID = ParcelUuid(SERVICE_UUID)

    private var advertiser: BluetoothLeAdvertiser? = null
    private var advertiseCallback: AdvertiseCallback? = null

    private var scanner: BluetoothLeScanner? = null
    private var scanCallback: ScanCallback? = null

    /** node-id-prefix-hex -> last-seen epoch millis. */
    private val discoveries = ConcurrentHashMap<String, Long>()

    @JvmStatic
    @Synchronized
    fun advertiseNodeId(context: Context, nodeIdPrefixHex: String): Boolean {
        val adapter = bluetoothAdapter(context) ?: return false
        if (!adapter.isEnabled) {
            Log.i(TAG, "BLE adapter disabled; advertising skipped")
            return false
        }
        val ad = adapter.bluetoothLeAdvertiser ?: run {
            Log.i(TAG, "BLE advertiser unavailable")
            return false
        }
        stopAdvertising()

        val payload = hexToBytes(nodeIdPrefixHex)
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_LOW)
            .setConnectable(false)
            .build()
        val data = AdvertiseData.Builder()
            .addServiceUuid(SERVICE_PARCEL_UUID)
            .addServiceData(SERVICE_PARCEL_UUID, payload)
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .build()

        val cb = object : AdvertiseCallback() {
            override fun onStartFailure(errorCode: Int) {
                Log.w(TAG, "BLE advertise failed: $errorCode")
            }
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                Log.i(TAG, "BLE advertising started")
            }
        }
        return try {
            ad.startAdvertising(settings, data, cb)
            advertiser = ad
            advertiseCallback = cb
            true
        } catch (error: SecurityException) {
            Log.w(TAG, "BLE advertise rejected: ${error.message}")
            false
        } catch (error: Throwable) {
            Log.w(TAG, "BLE advertise threw: ${error.message}")
            false
        }
    }

    @JvmStatic
    @Synchronized
    fun stopAdvertising() {
        val ad = advertiser
        val cb = advertiseCallback
        if (ad != null && cb != null) {
            try {
                ad.stopAdvertising(cb)
            } catch (error: Throwable) {
                Log.w(TAG, "stopAdvertising threw: ${error.message}")
            }
        }
        advertiser = null
        advertiseCallback = null
    }

    @JvmStatic
    @Synchronized
    fun startScan(context: Context): Boolean {
        val adapter = bluetoothAdapter(context) ?: return false
        if (!adapter.isEnabled) {
            Log.i(TAG, "BLE adapter disabled; scan skipped")
            return false
        }
        val sc = adapter.bluetoothLeScanner ?: run {
            Log.i(TAG, "BLE scanner unavailable")
            return false
        }
        stopScan()

        val filters = listOf(
            ScanFilter.Builder()
                .setServiceUuid(SERVICE_PARCEL_UUID)
                .build(),
        )
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
                Log.w(TAG, "BLE scan failed: $errorCode")
            }
        }
        return try {
            sc.startScan(filters, settings, cb)
            scanner = sc
            scanCallback = cb
            true
        } catch (error: SecurityException) {
            Log.w(TAG, "BLE scan rejected: ${error.message}")
            false
        } catch (error: Throwable) {
            Log.w(TAG, "BLE scan threw: ${error.message}")
            false
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
                Log.w(TAG, "stopScan threw: ${error.message}")
            }
        }
        scanner = null
        scanCallback = null
    }

    private fun handleResult(result: ScanResult?) {
        if (result == null) return
        val record = result.scanRecord ?: return
        val payload = record.serviceData?.get(SERVICE_PARCEL_UUID) ?: return
        if (payload.isEmpty()) return
        val hex = bytesToHex(payload)
        discoveries[hex] = System.currentTimeMillis()
    }

    /**
     * Drain the discovery buffer. Returns flat string array of pairs:
     * [hex0, epochMs0, hex1, epochMs1, ...]. Rust converts each into a
     * NodeId-prefix + last-seen pair to push into the nearby registry.
     */
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

    private fun bluetoothAdapter(context: Context): BluetoothAdapter? {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE)
            as? BluetoothManager ?: return null
        return manager.adapter
    }

    private fun hexToBytes(hex: String): ByteArray {
        val trimmed = hex.lowercase().trim()
        // Keep payload <= 16 bytes so the whole adv frame fits the 31-byte
        // BLE budget (Android caps it; longer payloads silently fail).
        val capped = if (trimmed.length > 32) trimmed.substring(0, 32) else trimmed
        val even = if (capped.length % 2 == 0) capped else "0$capped"
        val out = ByteArray(even.length / 2)
        var i = 0
        while (i < even.length) {
            out[i / 2] = ((Character.digit(even[i], 16) shl 4) +
                Character.digit(even[i + 1], 16)).toByte()
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
}
