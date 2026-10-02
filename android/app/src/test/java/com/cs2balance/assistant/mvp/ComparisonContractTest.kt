package com.cs2balance.assistant.mvp

import com.cs2balance.assistant.mvp.data.C5Value
import com.cs2balance.assistant.mvp.data.HttpResponse
import com.cs2balance.assistant.mvp.data.HttpTransport
import com.cs2balance.assistant.mvp.data.MarketClient
import com.cs2balance.assistant.mvp.data.Providers
import com.cs2balance.assistant.mvp.data.Scanner
import com.cs2balance.assistant.mvp.domain.Candidate
import com.cs2balance.assistant.mvp.domain.AppCache
import com.cs2balance.assistant.mvp.domain.Candidates
import com.cs2balance.assistant.mvp.domain.Comparison
import com.cs2balance.assistant.mvp.domain.DomainError
import com.cs2balance.assistant.mvp.domain.FeeObservations
import com.cs2balance.assistant.mvp.domain.FeeProfile
import com.cs2balance.assistant.mvp.domain.Money
import com.cs2balance.assistant.mvp.domain.Quote
import com.cs2balance.assistant.mvp.domain.Wallet
import com.cs2balance.assistant.mvp.domain.ScanSnapshot
import com.cs2balance.assistant.mvp.domain.record
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.*
import org.junit.Test

class ComparisonContractTest {
    private fun resource(name: String) = javaClass.classLoader!!.getResourceAsStream(name)!!.bufferedReader().use { it.readText() }
    private val contract = Providers.json.parseToJsonElement(resource("comparison-contract.json")).jsonObject
    private val wallet = Providers.json.decodeFromString<Wallet>(contract.getValue("wallet").toString())
    private val profile = FeeProfile(wallet, true, "controlled_fixture", "2026-10-02T00:00:00Z", 0, "test-only")
    private fun JsonObject.string(name: String, fallback: String) = this[name]?.jsonPrimitive?.content ?: fallback
    private fun calculate(input: JsonObject, id: String): Comparison = Money.compare(
        Candidate(id, "case", id, "Fixture Case", "100", "verified"), "current",
        Quote("c5", "current", amountCents = input.getValue("c5Cents").jsonPrimitive.long, status = "success", itemId = "100"),
        Quote("steam", input.string("steamBatchId", "current"), currency = input.string("steamCurrency", "CNY"),
            amountCents = input.getValue("steamBuyerCents").jsonPrimitive.longOrNull,
            status = if (input["steamFailure"] == null) "success" else "failed", failure = input["steamFailure"]?.jsonPrimitive?.content),
        if (input["feeVerified"]?.jsonPrimitive?.booleanOrNull == false) null else profile,
    )

    @Test fun compareLiteralContract() {
        assertEquals("controlled_fixture", contract.getValue("evidenceType").jsonPrimitive.content)
        contract.getValue("comparisonCases").jsonArray.forEach {
            val input = it.jsonObject; val expected = input.getValue("expected").jsonObject
            val name = input.getValue("name").jsonPrimitive.content
            val row = calculate(input, name)
            assertEquals(name, expected.getValue("rankable").jsonPrimitive.boolean, row.rankable)
            if (!row.rankable) assertEquals(name, expected.getValue("reason").jsonPrimitive.content, row.reason)
            else {
                val fee = row.fee!!; val ratio = row.cashPer100Cny!!
                assertEquals(name, expected.getValue("netCents").jsonPrimitive.long, fee.netCents)
                assertEquals(name, expected.getValue("steamFeeCents").jsonPrimitive.long, fee.steamFeeCents)
                assertEquals(name, expected.getValue("publisherFeeCents").jsonPrimitive.long, fee.publisherFeeCents)
                assertEquals(name, expected.getValue("numeratorCents").jsonPrimitive.content, ratio.numeratorCents)
                assertEquals(name, expected.getValue("denominator").jsonPrimitive.content, ratio.denominator)
                assertEquals(name, expected.getValue("displayCents").jsonPrimitive.long, ratio.displayCents)
            }
        }
    }
    @Test fun exactRatiosAndSharedObjects() {
        contract.getValue("rankingCases").jsonArray.forEach {
            val input = it.jsonObject
            val rows = input.getValue("items").jsonArray.map { item -> calculate(item.jsonObject, item.jsonObject.getValue("id").jsonPrimitive.content) }
            val ranking = Money.rank(rows)
            assertTrue(rows.all { row -> row.rankable })
            assertEquals(input.getValue("expectedIds").jsonArray.map { id -> id.jsonPrimitive.content }, ranking.map { row -> row.item.id })
            assertEquals(input.getValue("expectedDisplayCents").jsonArray.map { amount -> amount.jsonPrimitive.long }, ranking.map { row -> row.cashPer100Cny!!.displayCents })
            ranking.forEach { row -> assertTrue(rows.any { candidate -> candidate === row }) }
        }
    }
    @Test fun partialScanDoesNotUsePreviousSide() = runTest {
        val input = contract.getValue("partialScan").jsonObject
        val expected = input.getValue("expected").jsonObject
        val items = input.getValue("items").jsonArray.map {
            val value = it.jsonObject
            Candidate(value.getValue("id").jsonPrimitive.content, "case", "Controlled fixture", value.getValue("steamHashName").jsonPrimitive.content)
        }
        val steam = input.getValue("steam").jsonArray
        var call = 0; var now = 0L
        val client = MarketClient(HttpTransport { _, _ ->
            when (call++) {
                0 -> HttpResponse(200, null, input.getValue("c5").toString())
                1 -> HttpResponse(200, null, steam[0].toString())
                else -> throw DomainError(steam[1].jsonObject.getValue("failure").jsonPrimitive.content)
            }
        }, clock = { now }, sleep = { now += it })
        val rows = mutableListOf<Comparison>()
        val previous = input.getValue("previous").jsonObject
        val prior = Money.compare(items[1].copy(c5ItemId = previous.getValue("c5ItemId").jsonPrimitive.content,
            mappingStatus = "verified"), "previous",
            Quote("c5", "previous", amountCents = previous.getValue("c5Cents").jsonPrimitive.long, status = "success",
                itemId = previous.getValue("c5ItemId").jsonPrimitive.content),
            Quote("steam", "previous", amountCents = previous.getValue("steamBuyerCents").jsonPrimitive.long, status = "success"), profile)
        assertTrue(prior.rankable)
        var cache = AppCache(candidates = items, latest = ScanSnapshot("current", "2026-10-02T00:00:00Z", itemsRequested = 2),
            completeResults = mapOf(prior.item.id to prior))
        Scanner(client).scan(items, "current", "controlled-fixture-key", profile) { rows += it; cache = cache.record(it) }
        val failed = rows.first { it.item.id == expected.getValue("failedItemId").jsonPrimitive.content }
        assertEquals(expected.getValue("rankingIds").jsonArray.map { it.jsonPrimitive.content }, Money.rank(rows).map { it.item.id })
        assertEquals(expected.getValue("currentC5Cents").jsonPrimitive.long, failed.c5.amountCents ?: -1L)
        assertNull(failed.steam.amountCents)
        assertEquals("timeout", failed.steam.failure)
        assertFalse(failed.rankable)
        assertSame(prior, cache.completeResults[prior.item.id])
        assertEquals(2, cache.latest!!.rows.size)
        assertEquals("previous", cache.completeResults[prior.item.id]!!.batchId)
        assertEquals("mixed_batches", failure { cache.record(rows[0].copy(batchId = "other")) })
        assertEquals(3, call)
    }
    @Test fun candidateRulesProtectScopeAndBuiltinIdentities() {
        val all = Providers.json.decodeFromString<List<Candidate>>(resource("candidate-pool.json"))
        assertEquals(50, all.size); Candidates.validate(all)
        assertTrue(all.all { it.c5ItemId == null && it.mappingStatus == "pending" })
        assertEquals("duplicate_candidate", failure { Candidates.add(all.take(20), "case", "重复", all[0].steamHashName) })
        assertEquals("unsupported_candidate", failure { Candidates.add(emptyList(), "case", "皮肤", "AK-47 | Redline (Field-Tested)") })
        assertEquals("pool_full", failure { Candidates.add(all, "case", "新商品", "Fixture Case") })
        assertEquals("invalid_pool", failure { Candidates.validate(listOf(all[0], all[0])) })
    }
    @Test fun untouchedObservationTemplateNeverVerifiesFees() {
        val raw = resource("fee-observations.example.json")
        val input = Providers.json.decodeFromString<FeeObservations>(raw)
        assertEquals("fee_observations_missing", failure { Money.validateObservations(input, raw) })
        assertEquals("invalid_money", failure { Money.feeTotal(Money.MAX_CENTS, wallet) })
        assertEquals("nonpositive_or_invalid_quote", Money.compare(
            Candidate("a", "case", "A", "Fixture Case", "100", "verified"), "b",
            Quote("c5", "b", amountCents = 0, status = "success", itemId = "100"),
            Quote("steam", "b", amountCents = 117, status = "success"), profile).reason)
    }
    @Test fun providersRejectCurrencyAndUnsafeNumericIds() {
        assertEquals(167L, Providers.steam("""{"success":true,"lowest_price":"¥ 1.67"}"""))
        assertEquals("currency_or_price_format", failure { Providers.steam("""{"success":true,"lowest_price":"HK$ 1.67"}""") })
        val unsafe = """{"success":true,"data":{"A":{"itemId":1098192327056363520,"marketHashName":"A","price":1.23,"count":1}}}"""
        assertEquals("mapping_or_availability", Providers.c5(unsafe, listOf("A"))["A"]!!.failure)
        val safe = unsafe.replace("1098192327056363520", "\"1098192327056363520\"")
        assertEquals(C5Value(123, "1098192327056363520"), Providers.c5(safe, listOf("A"))["A"])
    }
    private fun failure(block: () -> Any?): String = try { block(); fail("expected DomainError"); "" }
        catch (e: DomainError) { e.code }
}

class MarketClientTest {
    @Test fun newScanHonorsPersistedRequestStarts() = runTest {
        var clock = 1000L; var started = -1L
        val client = MarketClient(HttpTransport { _, _ -> HttpResponse(200, null, "ok") },
            initialLastRequests = mapOf("steam" to 0L), onRequestStarted = { _, time -> started = time },
            clock = { clock }, sleep = { clock += it })
        assertEquals("ok", client.request("steam", "a", "https://example.invalid"))
        assertEquals(3000L, started)
    }
    @Test fun cooldownStopsSourceAndPersists() = runTest {
        var calls = 0; val saved = mutableMapOf<String, Long>(); var clock = 10_000L
        val client = MarketClient(HttpTransport { _, _ -> calls++; HttpResponse(429, "120", "") },
            onCooldown = { source, until -> saved[source] = until }, clock = { clock }, sleep = { clock += it })
        assertEquals("rate_limited", failure { client.request("steam", "a", "https://example.invalid") })
        clock += 130_000 // A stopped source stays stopped for the current batch, even when time advances.
        assertEquals("cooldown", failure { client.request("steam", "b", "https://example.invalid") })
        assertEquals(1, calls); assertEquals(130_000L, saved["steam"] ?: -1L)
        val restarted = MarketClient(HttpTransport { _, _ -> fail("must not send"); HttpResponse(200, null, "") },
            initialCooldowns = saved, clock = { 20_000 })
        assertEquals("cooldown", failure { restarted.request("steam", "a", "https://example.invalid") })
    }
    @Test fun retryIsBoundedAndIntervalIsObserved() = runTest {
        var calls = 0; var clock = 0L; val starts = mutableListOf<Long>()
        val client = MarketClient(HttpTransport { _, _ -> calls++; starts += clock; HttpResponse(503, null, "") },
            clock = { clock }, sleep = { clock += it })
        assertEquals("http", failure { client.request("c5", "a", "https://example.invalid?app-key=never-log-this") })
        assertEquals(3, calls); assertTrue(starts.zipWithNext().all { (a, b) -> b - a >= 3000 })
        assertEquals(Long.MAX_VALUE, MarketClient.retryAfterMillis("999999999999999999999999", 0) ?: -1L)
    }
    @Test fun concurrentSameKeyHasOneTransportRequest() = runTest {
        val response = CompletableDeferred<HttpResponse>(); var calls = 0
        val client = MarketClient(HttpTransport { _, _ -> calls++; response.await() })
        val first = async { client.request("steam", "a", "https://example.invalid") }
        val second = async { client.request("steam", "a", "https://example.invalid") }
        while (calls == 0) yield()
        response.complete(HttpResponse(200, null, "ok"))
        assertEquals("ok", first.await()); assertEquals("ok", second.await()); assertEquals(1, calls)
    }
    private suspend fun failure(block: suspend () -> String): String = try { block(); fail("expected DomainError"); "" }
        catch (e: DomainError) { e.code }
}
