package com.lightningp2p.app

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
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
import java.lang.ref.WeakReference
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
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
    private val CHAT_SERVICE_UUID: UUID =
        UUID.fromString("f47b5e2d-4a9e-4c5a-9b3f-8e1d2c3a4b5c")
    private val CHAT_CHARACTERISTIC_UUID: UUID =
        UUID.fromString("a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d")
    private val CLIENT_CONFIGURATION_UUID: UUID =
        UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

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

    private var chatGattServer: BluetoothGattServer? = null
    private var chatLocalCharacteristic: BluetoothGattCharacteristic? = null
    private var chatAdvertiser: BluetoothLeAdvertiser? = null
    private var chatAdvertiseCallback: AdvertiseCallback? = null
    private var chatMeshRunning = false
    private val chatServerPeers = ConcurrentHashMap<String, BluetoothDevice>()
    private val chatRemoteGatts = ConcurrentHashMap<String, BluetoothGatt>()
    private val chatConnecting = ConcurrentHashMap.newKeySet<String>()
    private val chatPackets = ConcurrentLinkedQueue<String>()

    @Volatile
    private var permissionRequestIssued = false

    @Volatile
    private var activityRef: WeakReference<Activity>? = null

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

    /** Keeps a non-owning reference to the resumed activity for permission prompts. */
    @JvmStatic
    @Synchronized
    fun attachActivity(activity: Activity) {
        activityRef = WeakReference(activity)
    }

    /** Drops the permission host without retaining a destroyed activity. */
    @JvmStatic
    @Synchronized
    fun detachActivity(activity: Activity) {
        if (activityRef?.get() === activity) {
            activityRef = null
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

    /** Starts the connectable GATT transport used by native Lightning Chat. */
    @JvmStatic
    @Synchronized
    fun startChatMesh(context: Context): Boolean {
        if (!ensureRuntimePermissions(context)) return false
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE)
            as? BluetoothManager ?: return fail("Bluetooth manager unavailable")
        val adapter = manager.adapter ?: return fail("BLE adapter unavailable")
        if (!isAdapterEnabled(adapter)) return fail("BLE adapter is off")

        stopChatMesh()
        val characteristic = BluetoothGattCharacteristic(
            CHAT_CHARACTERISTIC_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or
                BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ or
                BluetoothGattCharacteristic.PERMISSION_WRITE,
        )
        characteristic.addDescriptor(
            BluetoothGattDescriptor(
                CLIENT_CONFIGURATION_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or
                    BluetoothGattDescriptor.PERMISSION_WRITE,
            ),
        )
        val service = BluetoothGattService(
            CHAT_SERVICE_UUID,
            BluetoothGattService.SERVICE_TYPE_PRIMARY,
        )
        service.addCharacteristic(characteristic)

        return try {
            val server = manager.openGattServer(context, chatServerCallback)
                ?: return fail("Could not open the chat GATT server")
            if (!server.addService(service)) {
                server.close()
                return fail("Could not publish the chat GATT service")
            }
            chatGattServer = server
            chatLocalCharacteristic = characteristic
            chatMeshRunning = true
            startChatAdvertisement(adapter)
            lastError = null
            true
        } catch (error: SecurityException) {
            fail("Chat Bluetooth permission rejected: ${error.message}")
        } catch (error: Throwable) {
            fail("Chat Bluetooth startup failed: ${error.message}")
        }
    }

    @JvmStatic
    @Synchronized
    fun stopChatMesh() {
        val ad = chatAdvertiser
        val callback = chatAdvertiseCallback
        if (ad != null && callback != null) {
            try {
                ad.stopAdvertising(callback)
            } catch (_: Throwable) {
                // The adapter may already be stopping.
            }
        }
        chatAdvertiseCallback = null
        chatAdvertiser = null
        chatRemoteGatts.values.forEach { gatt ->
            try {
                gatt.disconnect()
                gatt.close()
            } catch (_: Throwable) {
                // Best-effort teardown.
            }
        }
        chatRemoteGatts.clear()
        chatConnecting.clear()
        chatServerPeers.clear()
        try {
            chatGattServer?.close()
        } catch (_: Throwable) {
            // Best-effort teardown.
        }
        chatGattServer = null
        chatLocalCharacteristic = null
        chatMeshRunning = false
    }

    /** Broadcasts one hex-encoded mesh frame over every available GATT path. */
    @JvmStatic
    fun sendChatMeshPacket(frameHex: String): Boolean {
        val bytes = hexToBytes(frameHex) ?: return fail("Invalid chat mesh frame")
        if (bytes.isEmpty() || bytes.size > 2048) {
            return fail("Chat mesh frame is outside size limits")
        }
        var attempted = false
        val server = chatGattServer
        val local = chatLocalCharacteristic
        if (server != null && local != null) {
            local.value = bytes
            chatServerPeers.values.forEach { device ->
                try {
                    attempted = server.notifyCharacteristicChanged(device, local, false) || attempted
                } catch (_: Throwable) {
                    // Keep the other links alive.
                }
            }
        }
        chatRemoteGatts.values.forEach { gatt ->
            val remote = gatt.getService(CHAT_SERVICE_UUID)
                ?.getCharacteristic(CHAT_CHARACTERISTIC_UUID) ?: return@forEach
            try {
                remote.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                remote.value = bytes
                attempted = gatt.writeCharacteristic(remote) || attempted
            } catch (_: Throwable) {
                // Keep the other links alive.
            }
        }
        return chatMeshRunning || attempted
    }

    @JvmStatic
    fun drainChatMeshPackets(): Array<String> {
        val out = ArrayList<String>()
        while (true) {
            val packet = chatPackets.poll() ?: break
            out.add(packet)
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
        if (record.serviceUuids?.any { it.uuid == CHAT_SERVICE_UUID } == true) {
            connectChatPeer(result.device)
        }
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

    private fun connectChatPeer(device: BluetoothDevice?) {
        if (!chatMeshRunning || device == null) return
        val address = try {
            device.address
        } catch (_: SecurityException) {
            return
        }
        if (chatRemoteGatts.containsKey(address) || !chatConnecting.add(address)) return
        val context = activityRef?.get()?.applicationContext ?: run {
            chatConnecting.remove(address)
            return
        }
        try {
            val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                device.connectGatt(context, false, chatGattCallback, BluetoothDevice.TRANSPORT_LE)
            } else {
                device.connectGatt(context, false, chatGattCallback)
            }
            if (gatt == null) chatConnecting.remove(address)
        } catch (_: Throwable) {
            chatConnecting.remove(address)
        }
    }

    private fun startChatAdvertisement(adapter: BluetoothAdapter) {
        val ad = adapter.bluetoothLeAdvertiser ?: return
        val callback = object : AdvertiseCallback() {
            override fun onStartFailure(errorCode: Int) {
                Log.w(TAG, "Chat BLE advertise failed: $errorCode")
            }
        }
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(true)
            .build()
        val data = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(CHAT_SERVICE_UUID))
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .build()
        ad.startAdvertising(settings, data, callback)
        chatAdvertiser = ad
        chatAdvertiseCallback = callback
    }

    private val chatServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(
            device: BluetoothDevice?,
            status: Int,
            newState: Int,
        ) {
            val peer = device ?: return
            val address = try {
                peer.address
            } catch (_: SecurityException) {
                return
            }
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                chatServerPeers[address] = peer
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                chatServerPeers.remove(address)
            }
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice?,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic?,
        ) {
            if (characteristic?.uuid != CHAT_CHARACTERISTIC_UUID || device == null) return
            val value = characteristic.value ?: ByteArray(0)
            val slice = if (offset in 0..value.size) value.copyOfRange(offset, value.size)
                else ByteArray(0)
            chatGattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, slice)
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice?,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic?,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
            if (characteristic?.uuid == CHAT_CHARACTERISTIC_UUID && offset == 0 && value != null) {
                chatPackets.add(bytesToHex(value))
            }
            if (responseNeeded && device != null) {
                chatGattServer?.sendResponse(
                    device,
                    requestId,
                    BluetoothGatt.GATT_SUCCESS,
                    0,
                    null,
                )
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice?,
            requestId: Int,
            descriptor: BluetoothGattDescriptor?,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
            if (descriptor?.uuid == CLIENT_CONFIGURATION_UUID) descriptor.value = value
            if (responseNeeded && device != null) {
                chatGattServer?.sendResponse(
                    device,
                    requestId,
                    BluetoothGatt.GATT_SUCCESS,
                    0,
                    null,
                )
            }
        }
    }

    private val chatGattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
            val connection = gatt ?: return
            val address = try {
                connection.device.address
            } catch (_: SecurityException) {
                connection.close()
                return
            }
            if (status == BluetoothGatt.GATT_SUCCESS &&
                newState == BluetoothProfile.STATE_CONNECTED
            ) {
                chatConnecting.remove(address)
                chatRemoteGatts[address] = connection
                try {
                    connection.requestMtu(247)
                    connection.discoverServices()
                } catch (_: Throwable) {
                    chatRemoteGatts.remove(address)
                    connection.close()
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                chatConnecting.remove(address)
                chatRemoteGatts.remove(address)
                connection.close()
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS || gatt == null) return
            val characteristic = gatt.getService(CHAT_SERVICE_UUID)
                ?.getCharacteristic(CHAT_CHARACTERISTIC_UUID) ?: return
            try {
                gatt.setCharacteristicNotification(characteristic, true)
                val descriptor = characteristic.getDescriptor(CLIENT_CONFIGURATION_UUID)
                descriptor?.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                if (descriptor != null) gatt.writeDescriptor(descriptor)
            } catch (_: Throwable) {
                // Writes can still work when notifications are unavailable.
            }
        }

        @Deprecated("Used on Android API levels below 33")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt?,
            characteristic: BluetoothGattCharacteristic?,
        ) {
            val value = characteristic?.value ?: return
            if (characteristic.uuid == CHAT_CHARACTERISTIC_UUID) {
                chatPackets.add(bytesToHex(value))
            }
        }
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
        if (hasRequiredPermissions(context, required)) {
            permissionRequestIssued = false
            return true
        }
        requestRuntimePermissions(required)
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

    private fun requestRuntimePermissions(permissions: Array<String>) {
        if (permissions.isEmpty() || permissionRequestIssued) return
        val activity = activityRef?.get()
        if (activity == null || activity.isFinishing || activity.isDestroyed) {
            fail("BLE permissions cannot be requested without an active Activity")
            return
        }
        permissionRequestIssued = true
        activity.runOnUiThread {
            val currentActivity = activityRef?.get()
            if (currentActivity !== activity || activity.isFinishing || activity.isDestroyed) {
                permissionRequestIssued = false
                fail("BLE permission request lost its active Activity")
                return@runOnUiThread
            }
            try {
                ActivityCompat.requestPermissions(activity, permissions, PERMISSION_REQUEST_CODE)
            } catch (error: Throwable) {
                permissionRequestIssued = false
                fail("BLE permission request failed: ${error.message}")
            }
        }
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
