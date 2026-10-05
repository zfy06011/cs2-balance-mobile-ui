package com.cs2balance.assistant.mvp.domain

import java.math.BigDecimal
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.time.Instant
import kotlinx.serialization.Serializable

@Serializable data class PublicFeeListing(
    val steamHashName: String, val sourceUrl: String, val collectedAt: String,
    val originalCurrencyId: Int, val convertedCurrencyId: Int, val publisherAppId: Int,
    val publisherFeePercent: String, val assetHashConfirmed: Boolean,
    val sellerReceivesCents: Long, val buyerPaysCents: Long,
    val steamFeeCents: Long, val publisherFeeCents: Long,
)
@Serializable data class PublicFeeEvidence(
    val evidenceType: String, val currency: String, val viewPreference: String,
    val observedAt: String, val wallet: Wallet, val observations: List<PublicFeeListing>,
)

// Only bundled, source-reviewed evidence uses this path; external imports retain their manual attestation gate.
object PublicFees {
    const val EVIDENCE_TYPE = "steam_public_original_cny_listings"
    fun validate(input: PublicFeeEvidence, raw: String): FeeProfile {
        if (input.evidenceType != EVIDENCE_TYPE || input.currency != "CNY" ||
            input.viewPreference != "bMarketOptOut=1" || input.observations.size !in 6..50)
            throw DomainError("fee_source_unverified")
        val observed = parseTime(input.observedAt)
        val rows = input.observations
        if (rows.map { it.sellerReceivesCents }.distinct().size < 6 ||
            rows.none { it.sellerReceivesCents <= 20 } || rows.none { it.sellerReceivesCents >= 10000 })
            throw DomainError("fee_coverage")
        rows.forEach { row ->
            val collected = parseTime(row.collectedAt)
            if (collected > observed || collected < observed.minusSeconds(900) ||
                row.originalCurrencyId != 2023 || row.convertedCurrencyId != 2023 ||
                row.publisherAppId != 730 || !row.assetHashConfirmed || !validSource(row))
                throw DomainError("fee_source_unverified")
            val percent = row.publisherFeePercent.toBigDecimalOrNull() ?: throw DomainError("fee_source_unverified")
            if ((percent - BigDecimal("0.10")).abs() > BigDecimal("0.00000001"))
                throw DomainError("fee_source_unverified")
            val fee = Money.feeTotal(row.sellerReceivesCents, input.wallet)
            if (fee.netCents != row.sellerReceivesCents || fee.grossCents != row.buyerPaysCents ||
                fee.steamFeeCents != row.steamFeeCents || fee.publisherFeeCents != row.publisherFeeCents)
                throw DomainError("fee_mismatch")
        }
        if (rows.maxOf { parseTime(it.collectedAt) } != observed) throw DomainError("fee_source_unverified")
        val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return FeeProfile(input.wallet, true, EVIDENCE_TYPE, input.observedAt, rows.size, digest)
    }
    private fun parseTime(value: String): Instant = try { Instant.parse(value)
    } catch (_: Exception) { throw DomainError("fee_source_unverified") }
    private fun validSource(row: PublicFeeListing): Boolean = try {
        val uri = URI(row.sourceUrl)
        val hash = row.steamHashName
        val pairs = uri.rawQuery.orEmpty().split('&').map { part ->
            val split = part.split('=', limit = 2)
            URLDecoder.decode(split[0], "UTF-8") to URLDecoder.decode(split.getOrElse(1) { "" }, "UTF-8")
        }
        val query = pairs.toMap()
        hash.isNotBlank() && hash.length <= 200 && '/' !in hash && hash.none { it.isISOControl() } &&
            uri.scheme == "https" && uri.host == "steamcommunity.com" && uri.port == -1 &&
            uri.userInfo == null && uri.fragment == null && uri.path == "/market/listings/730/$hash/render/" &&
            pairs.size == 6 && query.keys == setOf("query", "start", "count", "country", "language", "currency") &&
            query["query"] == "" && query["country"] == "CN" && query["language"] == "schinese" &&
            query["currency"] == "23" && query["count"] == "10" && (query["start"]?.toIntOrNull() ?: -1) in 0..20
    } catch (_: Exception) { false }
}
