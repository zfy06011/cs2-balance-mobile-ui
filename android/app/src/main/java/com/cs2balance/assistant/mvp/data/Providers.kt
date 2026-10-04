package com.cs2balance.assistant.mvp.data

import com.cs2balance.assistant.mvp.domain.DomainError
import com.cs2balance.assistant.mvp.domain.Money
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

data class C5Value(val amountCents: Long? = null, val itemId: String? = null, val failure: String? = null)

object Providers {
    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private fun objectFrom(text: String): JsonObject = try { json.parseToJsonElement(text).jsonObject
    } catch (_: Exception) { throw DomainError("schema") }
    fun steam(text: String): Long {
        val value = objectFrom(text)
        if ((value["success"] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull != true) throw DomainError("unavailable")
        val price = (value["lowest_price"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
            ?: throw DomainError("empty_quote")
        return Money.steamCny(price)
    }
    fun c5(text: String, hashes: List<String>): Map<String, C5Value> {
        val root = objectFrom(text)
        if ((root["success"] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull != true) {
            val code = (root["errorCode"] as? JsonPrimitive)?.contentOrNull
            throw DomainError(if (code == "400001") "credential_invalid" else "c5_rejected")
        }
        val data = root["data"] as? JsonObject ?: throw DomainError("schema")
        return hashes.associateWith { hash ->
            try {
                val value = data[hash] as? JsonObject ?: throw DomainError("empty_quote")
                val item = value["itemId"] as? JsonPrimitive ?: throw DomainError("mapping_or_availability")
                val identity = item.content
                val count = (value["count"] as? JsonPrimitive)?.takeUnless { it.isString }?.longOrNull ?: 0
                val marketHash = (value["marketHashName"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                if (marketHash != hash || !Regex("^[1-9]\\d*$").matches(identity) ||
                    (!item.isString && (item.longOrNull ?: 0) !in 1..Money.MAX_CENTS) ||
                    count !in 1..Money.MAX_CENTS) throw DomainError("mapping_or_availability")
                val price = value["price"]?.jsonPrimitive?.content ?: throw DomainError("empty_quote")
                val amount = Money.cents(price)
                if (amount == 0L) throw DomainError("empty_quote")
                C5Value(amount, identity)
            } catch (e: DomainError) { C5Value(failure = e.code)
            } catch (_: Exception) { C5Value(failure = "schema") }
        }
    }
}
