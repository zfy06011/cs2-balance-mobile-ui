package com.cs2balance.assistant.mvp.domain

import java.util.UUID

object Candidates {
    fun validate(items: List<Candidate>) {
        if (items.size > 50 || items.map { it.id }.distinct().size != items.size ||
            items.map { it.steamHashName }.distinct().size != items.size) throw DomainError("invalid_pool")
        items.forEach {
            if (it.id.isBlank() || it.displayName.isBlank() || it.displayName.length > 120 ||
                it.steamHashName.isBlank() || it.steamHashName.length > 200 ||
                it.steamHashName != it.steamHashName.trim() || !supported(it.category, it.steamHashName))
                throw DomainError("unsupported_candidate")
        }
    }
    private fun supported(category: String, hash: String) = when (category) {
        "case" -> hash.endsWith(" Case")
        "capsule" -> hash.contains("Capsule") || Regex("^20\\d{2} RMR (Legends|Challengers|Contenders)$").matches(hash)
        "sticker" -> hash.startsWith("Sticker | ") && hash.length > "Sticker | ".length
        else -> false
    }
    fun add(items: List<Candidate>, category: String, label: String, hash: String): List<Candidate> {
        if (items.size >= 50) throw DomainError("pool_full")
        if (items.any { it.steamHashName == hash.trim() }) throw DomainError("duplicate_candidate")
        val updated = items + Candidate(UUID.randomUUID().toString(), category, label.trim(), hash.trim())
        validate(updated)
        return updated
    }
}
