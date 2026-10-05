package com.cs2balance.assistant.mvp

import com.cs2balance.assistant.mvp.data.Providers
import com.cs2balance.assistant.mvp.domain.DomainError
import com.cs2balance.assistant.mvp.domain.FeeObservation
import com.cs2balance.assistant.mvp.domain.FeeObservations
import com.cs2balance.assistant.mvp.domain.Money
import com.cs2balance.assistant.mvp.domain.PublicFeeEvidence
import com.cs2balance.assistant.mvp.domain.PublicFees
import com.cs2balance.assistant.mvp.domain.Wallet
import org.junit.Assert.*
import org.junit.Test

class PublicFeeEvidenceTest {
    private val raw = javaClass.classLoader!!.getResourceAsStream("steam-cny-fee-evidence.json")!!
        .bufferedReader().use { it.readText() }
    private val evidence = Providers.json.decodeFromString<PublicFeeEvidence>(raw)

    @Test fun bundledActualOriginalCnyFeesMatchForwardAndInverseModel() {
        val profile = PublicFees.validate(evidence, raw)
        assertTrue(profile.verified); assertEquals(6, profile.count)
        assertEquals(PublicFees.EVIDENCE_TYPE, profile.evidenceType)
        assertEquals(Wallet(7), profile.wallet)
        assertEquals(64, profile.observationsSha256.length)
        assertEquals(listOf(7L, 46L, 49479L, 49566L, 50000L, 51044L), evidence.observations.map { it.sellerReceivesCents })
        evidence.observations.forEach { row ->
            val inverse = Money.sellerNet(row.buyerPaysCents, profile.wallet)
            assertEquals(row.sellerReceivesCents, inverse.netCents)
            assertEquals(0L, inverse.unrepresentableRemainderCents)
        }
    }
    @Test fun convertedForeignFeesWrongAppOrSourceNeverVerify() {
        val first = evidence.observations.first()
        val changed = listOf(first.copy(originalCurrencyId = 2001), first.copy(publisherAppId = 570),
            first.copy(assetHashConfirmed = false), first.copy(sourceUrl = first.sourceUrl.replace("steamcommunity.com", "example.invalid")),
            first.copy(publisherFeePercent = "0.20"), first.copy(collectedAt = "2026-10-01T00:00:00Z"))
        changed.forEach { row ->
            assertEquals("fee_source_unverified", failure {
                PublicFees.validate(evidence.copy(observations = listOf(row) + evidence.observations.drop(1)), raw)
            })
        }
        assertEquals("fee_mismatch", failure {
            PublicFees.validate(evidence.copy(wallet = evidence.wallet.copy(minimumCents = 1)), raw)
        })
        assertEquals("fee_coverage", failure {
            PublicFees.validate(evidence.copy(observations = List(6) { first }), raw)
        })
    }
    @Test fun externalPublicLabelCannotBypassManualImportGate() {
        val imported = FeeObservations(PublicFees.EVIDENCE_TYPE, true, evidence.observedAt, true, evidence.wallet,
            evidence.observations.map { FeeObservation(it.sellerReceivesCents, it.buyerPaysCents, it.steamFeeCents, it.publisherFeeCents) })
        assertEquals("fee_observations_missing", failure { Money.validateObservations(imported, raw) })
    }
    private fun failure(block: () -> Any?): String = try { block(); fail("expected DomainError"); "" }
        catch (e: DomainError) { e.code }
}
