package com.cs2balance.assistant.mvp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.cs2balance.assistant.mvp.data.CredentialStore
import com.cs2balance.assistant.mvp.data.ResponseDecoder
import com.cs2balance.assistant.mvp.domain.DomainError
import java.io.ByteArrayInputStream
import java.io.File
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CredentialStoreTest {
    @Test fun keystoreRoundTripReloadOverwriteAndDelete() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val id = UUID.randomUUID().toString()
        val alias = "test-c5-$id"; val name = "test-c5-$id.enc"
        val store = CredentialStore(context, alias, name)
        val synthetic = "synthetic-test-value-0123456789"
        try {
            assertNull(store.read())
            store.save(" $synthetic ")
            assertEquals(synthetic, CredentialStore(context, alias, name).read())
            assertFalse(File(context.noBackupFilesDir, name).readBytes().toString(Charsets.UTF_8).contains(synthetic))
            store.save("synthetic-replacement-0123456789")
            assertEquals("synthetic-replacement-0123456789", store.read())
            store.delete()
            assertNull(store.read())
        } finally { store.delete() }
    }

    @Test fun tamperedCiphertextIsRejected() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val id = UUID.randomUUID().toString()
        val name = "test-c5-$id.enc"; val store = CredentialStore(context, "test-c5-$id", name)
        try {
            store.save("synthetic-test-value-0123456789")
            val file = File(context.noBackupFilesDir, name)
            val bytes = file.readBytes(); bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
            file.writeBytes(bytes)
            try { store.read(); fail("tampered credentials must fail") }
            catch (e: DomainError) { assertEquals("credential_unreadable", e.code) }
        } finally { store.delete() }
    }

    @Test fun androidNativeZstdAndBrotliDecodersLoad() {
        // Frames generated independently with Node's zlib, containing the UTF-8 string 'codec-check'.
        assertEquals("codec-check", ResponseDecoder.text(ByteArrayInputStream(
            android.util.Base64.decode("KLUv/SALWQAAY29kZWMtY2hlY2s=", android.util.Base64.DEFAULT)), "zstd"))
        assertEquals("codec-check", ResponseDecoder.text(ByteArrayInputStream(
            android.util.Base64.decode("CwWAY29kZWMtY2hlY2sD", android.util.Base64.DEFAULT)), "br"))
    }
}
