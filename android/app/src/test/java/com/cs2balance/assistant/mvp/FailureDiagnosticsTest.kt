package com.cs2balance.assistant.mvp

import com.cs2balance.assistant.mvp.data.NetworkFailures
import com.cs2balance.assistant.mvp.domain.Quote
import com.cs2balance.assistant.mvp.ui.quoteFailureHeadline
import java.io.IOException
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import org.junit.Assert.*
import org.junit.Test

class FailureDiagnosticsTest {
    @Test fun networkTypesProduceSafeSpecificCodes() {
        val cases = listOf(UnknownHostException() to "dns_failed", SSLHandshakeException("test-only") to "tls_failed",
            SocketTimeoutException() to "timeout", ConnectException() to "connect_failed",
            SocketException() to "connection_interrupted", SecurityException() to "network_permission")
        cases.forEach { (error, expected) -> assertEquals(expected, NetworkFailures.code(error)) }
        val wrapped = IOException("https://example.invalid?app-key=synthetic-sensitive-value", UnknownHostException("private-name"))
        assertEquals("dns_failed", NetworkFailures.code(wrapped))
        assertEquals("network", NetworkFailures.code(IOException("never-display-raw-message")))
    }
    @Test fun failureHeadlineAlwaysIncludesReasonAndNumericDiagnostics() {
        val network = quoteFailureHeadline(Quote("c5", "test", failure = "tls_failed"))
        assertTrue(network.startsWith("[C5 / TLS_FAILED]")); assertTrue(network.contains("HTTPS"))
        val access = quoteFailureHeadline(Quote("c5", "test", failure = "credential_invalid", httpStatus = 200, businessCode = 400001))
        assertTrue(access.contains("HTTP 200")); assertTrue(access.contains("API 400001")); assertTrue(access.contains("凭证"))
        val unknown = quoteFailureHeadline(Quote("c5", "test"))
        assertTrue(unknown.contains("UNKNOWN")); assertTrue(unknown.contains("失败原因未上报"))
    }
    @Test fun unknownFailureAndSourceNeverEchoPrivateValues() {
        val text = quoteFailureHeadline(Quote("synthetic-sensitive-value", "test",
            failure = "https://example.invalid?app-key=synthetic-sensitive-value", httpStatus = -1))
        assertFalse(text.contains("synthetic-sensitive-value")); assertFalse(text.contains("https://")); assertFalse(text.contains("HTTP -1"))
    }
}
