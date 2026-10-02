package com.cs2balance.assistant.mvp.domain

fun AppCache.record(row: Comparison): AppCache {
    val snapshot = latest ?: throw DomainError("missing_scan")
    if (row.batchId != snapshot.batchId) throw DomainError("mixed_batches")
    if (snapshot.rows.any { it.item.id == row.item.id } || snapshot.rows.size >= snapshot.itemsRequested)
        throw DomainError("invalid_progress")
    return copy(latest = snapshot.copy(rows = snapshot.rows + row),
        completeResults = if (row.rankable) completeResults + (row.item.id to row) else completeResults)
}
