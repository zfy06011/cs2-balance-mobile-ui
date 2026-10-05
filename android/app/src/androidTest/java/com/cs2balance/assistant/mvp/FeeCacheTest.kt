package com.cs2balance.assistant.mvp

import android.content.Context
import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.cs2balance.assistant.mvp.data.CacheStore
import com.cs2balance.assistant.mvp.domain.FeeProfile
import com.cs2balance.assistant.mvp.domain.PublicFees
import com.cs2balance.assistant.mvp.domain.ScanSnapshot
import java.io.File
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FeeCacheTest {
    @Test fun bundledFeesLoadAndOldCacheKeepsItsDataAndExistingProfile() {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(target.cacheDir, "fee-cache-test-${UUID.randomUUID()}")
        assertTrue(directory.mkdirs())
        val context: Context = object : ContextWrapper(target) {
            override fun getNoBackupFilesDir(): File = directory
        }
        val store = CacheStore(context)
        val first = store.load()
        assertEquals(20, first.candidates.size)
        val publicProfile = requireNotNull(first.feeProfile)
        assertTrue(publicProfile.verified); assertEquals(6, publicProfile.count)
        assertEquals(PublicFees.EVIDENCE_TYPE, publicProfile.evidenceType)
        val old = first.copy(feeProfile = null, cooldowns = mapOf("steam" to 123L),
            latest = ScanSnapshot("controlled-old", "2026-10-01T00:00:00Z", itemsRequested = 20))
        store.save(old)
        val loaded = store.load()
        assertEquals(old.candidates, loaded.candidates); assertEquals(old.cooldowns, loaded.cooldowns)
        assertEquals(old.latest, loaded.latest); assertEquals(publicProfile, loaded.feeProfile)
        val manual = loaded.copy(feeProfile = FeeProfile(publicProfile.wallet, true, "controlled_fixture", "2026-10-01T00:00:00Z", 6, "test-only"))
        store.save(manual)
        assertEquals(manual, store.load())
        // The isolated cloud-test cache does not touch the application's actual no-backup directory.
    }
}
