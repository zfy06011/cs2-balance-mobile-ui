package com.cs2balance.assistant.mvp.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import com.cs2balance.assistant.mvp.domain.AppCache
import com.cs2balance.assistant.mvp.domain.Candidate
import com.cs2balance.assistant.mvp.domain.Candidates
import com.cs2balance.assistant.mvp.domain.DomainError
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.encodeToString

class CacheStore(private val context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "app-cache.json"))
    fun load(): AppCache {
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) {
            val candidates = context.assets.open("candidate-pool.json").bufferedReader().use {
                Providers.json.decodeFromString<List<Candidate>>(it.readText()).take(20)
            }
            Candidates.validate(candidates)
            return AppCache(candidates = candidates)
        }
        return try {
            val cache = Providers.json.decodeFromString<AppCache>(file.readFully().toString(Charsets.UTF_8))
            if (cache.version != 1) throw DomainError("cache_version")
            Candidates.validate(cache.candidates)
            cache
        } catch (e: DomainError) { throw e
        } catch (_: Exception) { throw DomainError("cache_unreadable") }
    }
    fun save(cache: AppCache) {
        var output: java.io.FileOutputStream? = null
        try {
            output = file.startWrite()
            output.write(Providers.json.encodeToString(cache).toByteArray(Charsets.UTF_8))
            file.finishWrite(output)
        } catch (_: Exception) { file.failWrite(output); throw DomainError("cache_write_failed") }
    }
}

class CredentialStore internal constructor(context: Context,
    private val alias: String = "balance-assistant-c5-v1", fileName: String = "credential.enc") {
    private val file = AtomicFile(File(context.noBackupFilesDir, fileName))
    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun key(create: Boolean): SecretKey {
        val store = keyStore()
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        if (!create) throw DomainError("credential_unreadable")
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build())
        return generator.generateKey()
    }
    @Synchronized fun read(): String? {
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) return null
        return try {
            val bytes = file.readFully(); val length = bytes.firstOrNull()?.toInt()?.and(255) ?: 0
            if (length != 12 || bytes.size <= length + 16) throw DomainError("credential_unreadable")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(1, 1 + length)))
            String(cipher.doFinal(bytes.copyOfRange(1 + length, bytes.size)), Charsets.UTF_8)
        } catch (_: Exception) { throw DomainError("credential_unreadable") }
    }
    @Synchronized fun save(value: String) {
        val cleaned = value.trim()
        if (cleaned.length !in 8..256 || cleaned.any { it.isWhitespace() || it.isISOControl() })
            throw DomainError("invalid_credential")
        var output: java.io.FileOutputStream? = null
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key(true))
            val encrypted = cipher.doFinal(cleaned.toByteArray(Charsets.UTF_8))
            output = file.startWrite()
            output.write(cipher.iv.size); output.write(cipher.iv); output.write(encrypted)
            file.finishWrite(output)
        } catch (_: Exception) { file.failWrite(output); throw DomainError("credential_write_failed") }
        // A successful write alone does not prove that AndroidKeyStore can decrypt it.
        if (read() != cleaned) throw DomainError("credential_unreadable")
    }
    @Synchronized fun delete() {
        try { keyStore().deleteEntry(alias); file.delete()
        } catch (_: Exception) { throw DomainError("credential_write_failed") }
    }
}
