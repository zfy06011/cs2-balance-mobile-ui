package com.cs2balance.assistant.mvp.domain

import kotlinx.serialization.Serializable

@Serializable data class Candidate(
    val id: String, val category: String, val displayName: String, val steamHashName: String,
    val c5ItemId: String? = null, val mappingStatus: String = "pending", val mappingEvidence: String? = null,
)
@Serializable data class Quote(
    val source: String, val batchId: String, val collectedAt: String? = null,
    val currency: String = "CNY", val amountCents: Long? = null, val status: String = "failed",
    val failure: String? = null, val itemId: String? = null,
)
@Serializable data class Wallet(
    val minimumCents: Long, val incrementCents: Long = 1,
    val steamBasisPoints: Int = 500, val publisherBasisPoints: Int = 1000,
)
@Serializable data class Fee(
    val netCents: Long, val steamFeeCents: Long, val publisherFeeCents: Long,
    val grossCents: Long, val unrepresentableRemainderCents: Long = 0,
)
@Serializable data class FeeProfile(
    val wallet: Wallet, val verified: Boolean, val evidenceType: String,
    val observedAt: String, val count: Int, val observationsSha256: String,
)
@Serializable data class Ratio(val numeratorCents: String, val denominator: String, val displayCents: Long)
@Serializable data class Comparison(
    val item: Candidate, val batchId: String, val c5: Quote, val steam: Quote,
    val rankable: Boolean = false, val reason: String? = null, val fee: Fee? = null,
    val cashPer100Cny: Ratio? = null,
)
@Serializable data class ScanSnapshot(
    val batchId: String, val startedAt: String, val completedAt: String? = null,
    val itemsRequested: Int, val rows: List<Comparison> = emptyList(),
)
@Serializable data class AppCache(
    val version: Int = 1, val candidates: List<Candidate>, val latest: ScanSnapshot? = null,
    val completeResults: Map<String, Comparison> = emptyMap(),
    val cooldowns: Map<String, Long> = emptyMap(), val lastRequests: Map<String, Long> = emptyMap(),
    val feeProfile: FeeProfile? = null,
)
@Serializable data class FeeObservation(
    val sellerReceivesCents: Long, val buyerPaysCents: Long,
    val steamFeeCents: Long, val publisherFeeCents: Long,
)
@Serializable data class FeeObservations(
    val evidenceType: String, val attestedRealObservations: Boolean,
    val observedAt: String? = null, val walletParametersConfirmed: Boolean,
    val wallet: Wallet, val observations: List<FeeObservation>,
)
class DomainError(val code: String) : Exception(code)
