package com.cs2balance.assistant.mvp.data

import com.cs2balance.assistant.mvp.domain.Candidate
import com.cs2balance.assistant.mvp.domain.Comparison
import com.cs2balance.assistant.mvp.domain.DomainError
import com.cs2balance.assistant.mvp.domain.FeeProfile
import com.cs2balance.assistant.mvp.domain.Money
import com.cs2balance.assistant.mvp.domain.Quote
import java.net.URLEncoder
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class Scanner(private val client: MarketClient) {
    suspend fun scan(items: List<Candidate>, batchId: String, key: String, profile: FeeProfile?,
        progress: suspend (Comparison) -> Unit) {
        val frozen = items.toList()
        if (frozen.isEmpty() || frozen.size > 50 || frozen.map { it.id }.distinct().size != frozen.size ||
            frozen.map { it.steamHashName }.distinct().size != frozen.size) throw DomainError("invalid_pool")
        var c5Failure: String? = null; var c5Time: String? = null
        val c5 = try {
            val body = buildJsonObject {
                put("appId", "730"); put("marketHashNames", JsonArray(frozen.map { JsonPrimitive(it.steamHashName) }))
            }.toString()
            val text = client.request("c5", batchId,
                "https://openapi.c5game.com/merchant/product/price/batch?app-key=${encode(key)}", body)
            val result = Providers.c5(text, frozen.map { it.steamHashName })
            c5Time = Instant.now().toString(); result
        } catch (e: CancellationException) { throw e
        } catch (e: DomainError) { c5Failure = e.code; emptyMap() }
        frozen.forEach { seed ->
            currentCoroutineContext().ensureActive()
            val value = c5[seed.steamHashName]
            val failure = c5Failure ?: value?.failure ?: if (value == null) "empty_quote" else null
            val item = if (value?.itemId != null && failure == null) seed.copy(c5ItemId = value.itemId,
                mappingStatus = "verified", mappingEvidence = "c5_batch_exact_hash_and_item_id") else seed
            val buy = Quote("c5", batchId, c5Time, amountCents = value?.amountCents,
                status = if (failure == null) "success" else "failed", failure = failure, itemId = value?.itemId)
            val steam = try {
                val text = client.request("steam", seed.steamHashName,
                    "https://steamcommunity.com/market/priceoverview/?appid=730&currency=23&market_hash_name=${encode(seed.steamHashName)}")
                Quote("steam", batchId, Instant.now().toString(), amountCents = Providers.steam(text), status = "success")
            } catch (e: CancellationException) { throw e
            } catch (e: DomainError) { Quote("steam", batchId, failure = e.code) }
            progress(Money.compare(item, batchId, buy, steam, profile))
        }
    }
    private fun encode(value: String) = URLEncoder.encode(value, Charsets.UTF_8.name())
}
