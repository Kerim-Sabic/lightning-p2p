package com.lightningp2p.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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
}
