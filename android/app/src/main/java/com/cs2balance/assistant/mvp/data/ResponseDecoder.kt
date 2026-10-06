package com.cs2balance.assistant.mvp.data

import com.cs2balance.assistant.mvp.domain.DomainError
import com.github.luben.zstd.ZstdInputStreamNoFinalizer
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.Locale
import java.util.zip.GZIPInputStream
import java.util.zip.InflaterInputStream
import org.brotli.dec.BrotliInputStream

object ResponseDecoder {
    // Required by C5; each advertised encoding is decoded below.
    const val ACCEPT_ENCODING = "gzip, br, zstd, deflate"
    private const val MAX_BYTES = 3_000_000

    fun text(raw: InputStream, encoding: String?): String = raw.use {
        try {
            val stream = when (encoding?.trim()?.lowercase(Locale.ROOT)) {
                null, "", "identity" -> raw
                "gzip" -> GZIPInputStream(raw)
                "br" -> BrotliInputStream(raw)
                "zstd" -> ZstdInputStreamNoFinalizer(raw).setLongMax(23)
                "deflate" -> InflaterInputStream(raw)
                else -> throw DomainError("encoding")
            }
            stream.use { input ->
                val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > MAX_BYTES) throw DomainError("response_too_large")
                    output.write(buffer, 0, count)
                }
                output.toString(Charsets.UTF_8.name())
            }
        } catch (e: DomainError) { throw e
        } catch (_: java.net.SocketTimeoutException) { throw DomainError("timeout")
        } catch (_: javax.net.ssl.SSLException) { throw DomainError("tls_failed")
        } catch (_: java.net.SocketException) { throw DomainError("connection_interrupted")
        } catch (_: java.io.IOException) { throw DomainError("decode")
        } catch (_: LinkageError) { throw DomainError("encoding") }
    }
}
