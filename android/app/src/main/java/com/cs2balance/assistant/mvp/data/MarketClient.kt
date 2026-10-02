package com.cs2balance.assistant.mvp.data

import com.cs2balance.assistant.mvp.domain.DomainError
import java.io.ByteArrayOutputStream
import java.net.SocketTimeoutException
import java.net.URL
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.zip.GZIPInputStream
import java.util.zip.InflaterInputStream
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

data class HttpResponse(val status: Int, val retryAfter: String?, val text: String)
fun interface HttpTransport {
    suspend fun send(url: String, body: String?): HttpResponse
}

class AndroidTransport : HttpTransport {
    override suspend fun send(url: String, body: String?): HttpResponse = withContext(Dispatchers.IO) {
        val connection = URL(url).openConnection() as HttpsURLConnection
        try {
            connection.connectTimeout = 20_000
            connection.readTimeout = 20_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("User-Agent", "BalanceAssistantMVP/0.1.0")
            connection.setRequestProperty("Accept", "application/json")
            // Only advertise encodings implemented by this Android transport.
            connection.setRequestProperty("Accept-Encoding", "gzip, deflate")
            if (body != null) {
                connection.requestMethod = "POST"; connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val retryAfter = connection.getHeaderField("Retry-After")
            if (status !in 200..299) return@withContext HttpResponse(status, retryAfter, "")
            val raw = connection.inputStream
            val stream = when (connection.getHeaderField("Content-Encoding")?.lowercase()) {
                null, "", "identity" -> raw
                "gzip" -> GZIPInputStream(raw)
                "deflate" -> InflaterInputStream(raw)
                else -> { raw.close(); throw DomainError("encoding") }
            }
            val text = stream.use { input ->
                val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > 3_000_000) throw DomainError("response_too_large")
                    output.write(buffer, 0, count)
                }
                output.toString(Charsets.UTF_8.name())
            }
            HttpResponse(status, retryAfter, text)
        } catch (e: CancellationException) { throw e
        } catch (e: DomainError) { throw e
        } catch (_: SocketTimeoutException) { throw DomainError("timeout")
        } catch (_: Exception) { throw DomainError("network")
        } finally { connection.disconnect() }
    }
}

class MarketClient(
    private val transport: HttpTransport,
    initialCooldowns: Map<String, Long> = emptyMap(),
    initialLastRequests: Map<String, Long> = emptyMap(),
    private val onCooldown: suspend (String, Long) -> Unit = { _, _ -> },
    private val onRequestStarted: suspend (String, Long) -> Unit = { _, _ -> },
    private val clock: () -> Long = System::currentTimeMillis,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    private val queue = Mutex(); private val guard = Mutex()
    private val inflight = mutableMapOf<String, Deferred<String>>()
    private val last = initialLastRequests.toMutableMap()
    private val cooldowns = initialCooldowns.toMutableMap()
    private val stopped = mutableSetOf<String>()
    suspend fun request(source: String, key: String, url: String, body: String? = null): String = coroutineScope {
        val identity = "$source:$key"
        val job = guard.withLock {
            inflight[identity] ?: async { queue.withLock { execute(source, url, body) } }
                .also { inflight[identity] = it }
        }
        try { job.await() }
        finally { withContext(NonCancellable) {
            guard.withLock { if (job.isCompleted && inflight[identity] === job) inflight.remove(identity) }
        } }
    }
    private suspend fun execute(source: String, url: String, body: String?): String {
        if (source in stopped || (cooldowns[source] ?: 0) > clock()) throw DomainError("cooldown")
        repeat(3) { attempt ->
            last[source]?.let { time ->
                val wait = 3000 - (clock() - time)
                if (wait > 0) sleep(minOf(wait, 3000))
            }
            last[source] = clock()
            onRequestStarted(source, last.getValue(source))
            val response = transport.send(url, body)
            if (response.status == 429) {
                stop(source, maxOf(retryAfterMillis(response.retryAfter, clock()) ?: 900_000, 1000))
                throw DomainError("rate_limited")
            }
            if (response.status in 500..599 && attempt < 2) {
                val wait = maxOf(retryAfterMillis(response.retryAfter, clock()) ?: 0, 2000L shl attempt)
                if (wait > 60_000) { stop(source, wait); throw DomainError("server_cooldown") }
                sleep(wait)
            } else {
                if (response.status !in 200..299) throw DomainError(
                    if (response.status == 401 || response.status == 403) "auth_or_access" else "http")
                return response.text
            }
        }
        throw DomainError("http")
    }
    private suspend fun stop(source: String, wait: Long) {
        val now = clock(); val until = if (wait > Long.MAX_VALUE - now) Long.MAX_VALUE else now + wait
        stopped += source; cooldowns[source] = until; onCooldown(source, until)
    }
    companion object {
        fun retryAfterMillis(value: String?, now: Long): Long? {
            if (value == null) return null
            if (Regex("^\\d+$").matches(value.trim())) {
                val seconds = value.trim().toLongOrNull() ?: return Long.MAX_VALUE
                return if (seconds > Long.MAX_VALUE / 1000) Long.MAX_VALUE else seconds * 1000
            }
            return try { maxOf(0, ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() - now)
            } catch (_: Exception) { null }
        }
    }
}
