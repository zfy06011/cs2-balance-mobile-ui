package com.cs2balance.assistant.mvp

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.cs2balance.assistant.mvp.data.AndroidTransport
import com.cs2balance.assistant.mvp.data.CacheStore
import com.cs2balance.assistant.mvp.data.CredentialStore
import com.cs2balance.assistant.mvp.data.MarketClient
import com.cs2balance.assistant.mvp.data.Providers
import com.cs2balance.assistant.mvp.data.Scanner
import com.cs2balance.assistant.mvp.domain.AppCache
import com.cs2balance.assistant.mvp.domain.Candidates
import com.cs2balance.assistant.mvp.domain.DomainError
import com.cs2balance.assistant.mvp.domain.FeeObservations
import com.cs2balance.assistant.mvp.domain.Money
import com.cs2balance.assistant.mvp.domain.ScanSnapshot
import com.cs2balance.assistant.mvp.domain.record
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

data class AppState(
    val cache: AppCache? = null, val loading: Boolean = true, val scanning: Boolean = false,
    val busy: Boolean = false, val credentialConfigured: Boolean = false,
    val credentialProblem: Boolean = false,
    val error: String? = null, val notice: String? = null,
)

class BalanceViewModel(application: Application) : AndroidViewModel(application) {
    private val cacheStore = CacheStore(application)
    private val credentialStore = CredentialStore(application)
    private val writes = Mutex()
    private var scanJob: Job? = null
    private val mutable = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = mutable.asStateFlow()
    init { load() }
    fun dismissMessage() { mutable.update { it.copy(error = null, notice = null) } }
    private fun load() = viewModelScope.launch {
        try {
            val cache = withContext(Dispatchers.IO) { cacheStore.load() }
            mutable.update { it.copy(cache = cache) }
            val configured = withContext(Dispatchers.IO) { credentialStore.read() != null }
            mutable.update { it.copy(cache = cache, loading = false, credentialConfigured = configured) }
        } catch (e: DomainError) { mutable.update { it.copy(loading = false, error = e.code,
            credentialProblem = e.code == "credential_unreadable") }
        } catch (_: Exception) { mutable.update { it.copy(loading = false, error = "cache_unreadable") } }
    }
    private suspend fun updateCache(transform: (AppCache) -> AppCache) = writes.withLock {
        val current = mutable.value.cache ?: throw DomainError("cache_unreadable")
        val updated = transform(current)
        withContext(Dispatchers.IO) { cacheStore.save(updated) }
        mutable.update { it.copy(cache = updated) }
    }
    private fun mutate(operation: suspend () -> Unit) {
        if (mutable.value.scanning || mutable.value.busy || mutable.value.loading) return
        mutable.update { it.copy(busy = true, error = null, notice = null) }
        viewModelScope.launch {
            try { operation()
            } catch (e: CancellationException) { throw e
            } catch (e: DomainError) { mutable.update { it.copy(error = e.code,
                credentialProblem = it.credentialProblem || e.code == "credential_unreadable") }
            } catch (_: Exception) { mutable.update { it.copy(error = "local_error") }
            } finally { mutable.update { it.copy(busy = false) } }
        }
    }
    fun addCandidate(category: String, label: String, hash: String) = mutate {
        updateCache { it.copy(candidates = Candidates.add(it.candidates, category, label, hash)) }
        mutable.update { it.copy(notice = "candidate_added") }
    }
    fun removeCandidate(id: String) = mutate {
        updateCache { cache -> cache.copy(candidates = cache.candidates.filterNot { it.id == id },
            completeResults = cache.completeResults - id) }
    }
    fun saveCredential(value: String) = mutate {
        withContext(Dispatchers.IO) { credentialStore.save(value) }
        mutable.update { it.copy(credentialConfigured = true, credentialProblem = false, notice = "credential_saved") }
    }
    fun deleteCredential() = mutate {
        withContext(Dispatchers.IO) { credentialStore.delete() }
        mutable.update { it.copy(credentialConfigured = false, credentialProblem = false, notice = "credential_deleted") }
    }
    fun importFees(uri: Uri) = mutate {
        val raw = withContext(Dispatchers.IO) {
            val input = getApplication<Application>().contentResolver.openInputStream(uri)
                ?: throw DomainError("fee_file_unreadable")
            input.use {
                val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                while (true) {
                    val count = it.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > 256_000) throw DomainError("fee_file_too_large")
                    output.write(buffer, 0, count)
                }
                output.toString(Charsets.UTF_8.name())
            }
        }
        val input = try { Providers.json.decodeFromString<FeeObservations>(raw)
        } catch (_: Exception) { throw DomainError("fee_observations_missing") }
        val profile = Money.validateObservations(input, raw)
        updateCache { it.copy(feeProfile = profile) }
        mutable.update { it.copy(notice = "fee_imported") }
    }
    fun startScan(itemId: String? = null) {
        val initial = mutable.value
        if (initial.loading || initial.busy || initial.scanning || scanJob?.isActive == true) return
        val cache = initial.cache ?: return
        val items = cache.candidates.filter { itemId == null || it.id == itemId }.toList()
        if (items.isEmpty()) { mutable.update { it.copy(error = "empty_pool") }; return }
        if (initial.credentialProblem) { mutable.update { it.copy(error = "credential_unreadable") }; return }
        if (!initial.credentialConfigured) { mutable.update { it.copy(error = "credential_missing") }; return }
        if (cache.cooldowns.any { (source, until) -> source in setOf("c5", "steam") && until > System.currentTimeMillis() }) {
            mutable.update { it.copy(error = "cooldown") }; return
        }
        mutable.update { it.copy(scanning = true, error = null, notice = null) }
        scanJob = viewModelScope.launch {
            try {
                val key = withContext(Dispatchers.IO) { credentialStore.read() } ?: throw DomainError("credential_missing")
                val batch = UUID.randomUUID().toString()
                updateCache { it.copy(latest = ScanSnapshot(batch, Instant.now().toString(), itemsRequested = items.size)) }
                val client = MarketClient(AndroidTransport(), cache.cooldowns, cache.lastRequests, onCooldown = { source, until ->
                    updateCache { it.copy(cooldowns = it.cooldowns + (source to until)) }
                }, onRequestStarted = { source, started ->
                    updateCache { it.copy(lastRequests = it.lastRequests + (source to started)) }
                })
                Scanner(client).scan(items, batch, key, cache.feeProfile) { row ->
                    updateCache { it.record(row) }
                }
                updateCache { it.copy(latest = it.latest?.copy(completedAt = Instant.now().toString())) }
                mutable.update { it.copy(notice = "scan_finished") }
            } catch (e: CancellationException) { throw e
            } catch (e: DomainError) { mutable.update { it.copy(error = e.code,
                credentialProblem = it.credentialProblem || e.code == "credential_unreadable") }
            } catch (_: Exception) { mutable.update { it.copy(error = "local_error") }
            } finally { mutable.update { it.copy(scanning = false) } }
        }
    }
}
