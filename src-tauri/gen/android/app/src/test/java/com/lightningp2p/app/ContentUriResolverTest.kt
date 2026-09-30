package com.lightningp2p.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class ContentUriResolverTest {
    @Test
    fun sharedFileImportPreservesFreeSpaceReserve() {
        val reserve = 128L * 1024 * 1024
        assertTrue(ContentUriResolver.hasSpaceForChunk(reserve + 1024, 1024))
        assertFalse(ContentUriResolver.hasSpaceForChunk(reserve + 1023, 1024))
        assertFalse(ContentUriResolver.hasSpaceForChunk(reserve, 1))
        assertFalse(ContentUriResolver.hasSpaceForChunk(1024, -1))
    }

    @Test
    fun pendingMediaStoreRowMustBeFinalizedBeforeReceiveCanSucceed() {
        assertFalse(ContentUriResolver.hasPublishedMediaStoreRow(0))
        assertTrue(ContentUriResolver.hasPublishedMediaStoreRow(1))
    }

    @Test
    fun folderPublishKeepsFilesInsideItsDownloadsTree() {
        assertEquals(
            "Download/Lightning P2P/Photos/2026/Trips/",
            ContentUriResolver.safeMediaStoreRelativePath("Photos", "2026/Trips"),
        )
        assertThrows(IllegalArgumentException::class.java) {
            ContentUriResolver.safeMediaStoreRelativePath("Photos", "../outside")
        }
    }
}
