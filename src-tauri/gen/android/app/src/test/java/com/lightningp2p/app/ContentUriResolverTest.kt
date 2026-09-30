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

    @Test
    fun folderPublishSuffixesExistingAndSameFolderNameCollisions() {
        val reserved = mutableSetOf("report.txt", "report (1).txt")
        val nextName = ContentUriResolver.uniqueDisplayName("report.txt", reserved::contains)

        assertEquals("report (2).txt", nextName)
        reserved.add(nextName)
        assertEquals(
            "report (3).txt",
            ContentUriResolver.uniqueDisplayName("report.txt", reserved::contains),
        )
    }

    @Test
    fun collisionSuffixPreservesExtensionsAndTreatsDotfilesAsNames() {
        assertEquals(
            "archive.tar (1).gz",
            ContentUriResolver.uniqueDisplayName("archive.tar.gz") { it == "archive.tar.gz" },
        )
        assertEquals(
            ".config (1)",
            ContentUriResolver.uniqueDisplayName(".config") { it == ".config" },
        )
    }
}
