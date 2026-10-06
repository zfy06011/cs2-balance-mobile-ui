package com.cs2balance.assistant.mvp.data

import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

object NetworkFailures {
    // Classify only exception types. Messages and request URLs can contain credentials.
    fun code(error: Throwable): String {
        val causes = generateSequence(error) { it.cause }.take(8).toList()
        return when {
            causes.any { it is UnknownHostException } -> "dns_failed"
            causes.any { it is SSLException } -> "tls_failed"
            causes.any { it is SocketTimeoutException } -> "timeout"
            causes.any { it is ConnectException } -> "connect_failed"
            causes.any { it is SocketException } -> "connection_interrupted"
            causes.any { it is SecurityException } -> "network_permission"
            else -> "network"
        }
    }
}
