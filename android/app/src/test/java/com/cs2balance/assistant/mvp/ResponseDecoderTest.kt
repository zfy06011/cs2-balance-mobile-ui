package com.cs2balance.assistant.mvp

import com.cs2balance.assistant.mvp.data.Providers
import com.cs2balance.assistant.mvp.data.ResponseDecoder
import com.cs2balance.assistant.mvp.domain.DomainError
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.zip.GZIPOutputStream
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class ResponseDecoderTest {
    @Test fun allAdvertisedEncodingsDecodeIndependentFixtures() {
        val raw = javaClass.classLoader!!.getResourceAsStream("response-encodings.json")!!
            .bufferedReader().use { it.readText() }
        val fixture = Providers.json.parseToJsonElement(raw).jsonObject
        val expected = fixture.getValue("text").jsonPrimitive.content
        fixture.getValue("encodings").jsonObject.forEach { (encoding, value) ->
            val stream = ByteArrayInputStream(Base64.getDecoder().decode(value.jsonPrimitive.content))
            assertEquals(encoding, expected, ResponseDecoder.text(stream, encoding))
        }
        assertEquals(expected, ResponseDecoder.text(ByteArrayInputStream(expected.toByteArray()), null))
    }

    @Test fun malformedEncodingAndOversizedDecodedResponseAreRejected() {
        assertEquals("encoding", failure { ResponseDecoder.text(ByteArrayInputStream(byteArrayOf()), "unknown") })
        listOf("gzip", "br", "zstd", "deflate").forEach { encoding ->
            assertEquals(encoding, "decode", failure { ResponseDecoder.text(ByteArrayInputStream(byteArrayOf(1, 2, 3)), encoding) })
        }
        assertEquals("response_too_large", failure {
            ResponseDecoder.text(ByteArrayInputStream(ByteArray(3_000_001)), "identity")
        })
        val compressed = ByteArrayOutputStream()
        GZIPOutputStream(compressed).use { it.write(ByteArray(3_000_001)) }
        assertEquals("response_too_large", failure {
            ResponseDecoder.text(ByteArrayInputStream(compressed.toByteArray()), "gzip")
        })
    }
    private fun failure(block: () -> Any?): String = try { block(); fail("expected DomainError"); "" }
        catch (e: DomainError) { e.code }
}
