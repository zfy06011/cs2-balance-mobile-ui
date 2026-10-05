package com.cs2balance.assistant.mvp.domain

import java.math.BigInteger
import java.security.MessageDigest
import java.time.Instant

object Money {
    const val MAX_CENTS = 9_007_199_254_740_991L
    private val max = BigInteger.valueOf(MAX_CENTS)
    fun cents(value: String): Long {
        if (!Regex("^(0|[1-9]\\d*)(\\.\\d{1,2})?$").matches(value)) throw DomainError("invalid_money")
        val parts = value.split('.')
        val result = parts[0].toBigInteger() * 100.toBigInteger() +
            parts.getOrElse(1) { "" }.padEnd(2, '0').toBigInteger()
        if (result > max) throw DomainError("invalid_money")
        return result.toLong()
    }
    fun steamCny(value: String): Long {
        if (!Regex("^[¥￥]\\s*(\\d{1,3}(,\\d{3})*|\\d+)\\.\\d{2}$").matches(value))
            throw DomainError("currency_or_price_format")
        return cents(value.drop(1).trim().replace(",", ""))
    }
    private fun parts(net: Long, wallet: Wallet): List<BigInteger> {
        if (net !in 1..MAX_CENTS || wallet.minimumCents !in 1..MAX_CENTS || wallet.incrementCents != 1L ||
            wallet.steamBasisPoints != 500 || wallet.publisherBasisPoints != 1000)
            throw DomainError("unsupported_fee_parameters")
        val n = net.toBigInteger(); val minimum = wallet.minimumCents.toBigInteger()
        return listOf(n.max(minimum), (n * 500.toBigInteger() / 10000.toBigInteger()).max(minimum),
            (n * 1000.toBigInteger() / 10000.toBigInteger()).max(minimum))
    }
    fun feeTotal(net: Long, wallet: Wallet): Fee {
        val (base, steam, publisher) = parts(net, wallet)
        val gross = base + steam + publisher
        if (gross > max) throw DomainError("invalid_money")
        return Fee(base.toLong(), steam.toLong(), publisher.toLong(), gross.toLong())
    }
    fun sellerNet(gross: Long, wallet: Wallet): Fee {
        if (gross !in 1..MAX_CENTS) throw DomainError("invalid_money")
        parts(1, wallet)
        var low = wallet.minimumCents; var high = gross; var best: Fee? = null
        while (low <= high) {
            val mid = low + (high - low) / 2
            if (parts(mid, wallet).reduce(BigInteger::add) <= gross.toBigInteger()) {
                best = feeTotal(mid, wallet); low = mid + 1
            } else high = mid - 1
        }
        val result = best ?: throw DomainError("below_market_minimum")
        return result.copy(unrepresentableRemainderCents = gross - result.grossCents)
    }
    fun compare(item: Candidate, batch: String, c5: Quote, steam: Quote, profile: FeeProfile?): Comparison {
        val row = Comparison(item, batch, c5, steam)
        fun excluded(reason: String) = row.copy(reason = reason)
        if (c5.status != "success" || steam.status != "success") return excluded("missing_current_quote")
        if (c5.batchId != batch || steam.batchId != batch) return excluded("mixed_batches")
        if (c5.currency != "CNY" || steam.currency != "CNY") return excluded("currency_mismatch")
        val cost = c5.amountCents ?: 0; val gross = steam.amountCents ?: 0
        if (cost !in 1..MAX_CENTS || gross !in 1..MAX_CENTS) return excluded("nonpositive_or_invalid_quote")
        if (item.mappingStatus != "verified" || item.c5ItemId == null || item.c5ItemId != c5.itemId)
            return excluded("mapping_unverified")
        if (profile?.verified != true) return excluded("fee_unverified")
        return try {
            val fee = sellerNet(gross, profile.wallet)
            // Conservative ranking policy for fee rounding gaps; it is not proof that Steam's net is ambiguous.
            if (fee.unrepresentableRemainderCents != 0L) row.copy(fee = fee, reason = "fee_inverse_ambiguous")
            else {
                val numerator = cost.toBigInteger() * 10000.toBigInteger()
                val denominator = fee.netCents.toBigInteger()
                val display = (numerator + denominator / 2.toBigInteger()) / denominator
                if (display > max) excluded("invalid_money")
                else row.copy(rankable = true, fee = fee,
                    cashPer100Cny = Ratio(numerator.toString(), denominator.toString(), display.toLong()))
            }
        } catch (e: DomainError) { excluded(e.code) }
    }
    fun rank(rows: List<Comparison>): List<Comparison> = rows.filter { it.rankable }.sortedWith { a, b ->
        val left = a.c5.amountCents!!.toBigInteger() * b.fee!!.netCents.toBigInteger()
        val right = b.c5.amountCents!!.toBigInteger() * a.fee!!.netCents.toBigInteger()
        val order = left.compareTo(right)
        if (order != 0) order else a.item.id.compareTo(b.item.id)
    }
    fun validateObservations(input: FeeObservations, raw: String): FeeProfile {
        if (input.evidenceType != "manual_steam_cny_sell_dialog" || !input.attestedRealObservations ||
            input.observedAt == null || input.observations.size < 6) throw DomainError("fee_observations_missing")
        try { Instant.parse(input.observedAt) } catch (_: Exception) { throw DomainError("fee_observations_missing") }
        if (!input.walletParametersConfirmed) throw DomainError("wallet_unconfirmed")
        val rows = input.observations
        if (rows.map { it.sellerReceivesCents }.distinct().size < 6 || rows.none { it.sellerReceivesCents <= 20 } ||
            rows.none { it.sellerReceivesCents >= 10000 }) throw DomainError("fee_coverage")
        rows.forEach {
            val fee = feeTotal(it.sellerReceivesCents, input.wallet)
            if (fee.netCents != it.sellerReceivesCents || fee.grossCents != it.buyerPaysCents ||
                fee.steamFeeCents != it.steamFeeCents || fee.publisherFeeCents != it.publisherFeeCents)
                throw DomainError("fee_mismatch")
        }
        val hash = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return FeeProfile(input.wallet, true, input.evidenceType, input.observedAt, rows.size, hash)
    }
}
