package com.cs2balance.assistant.mvp

import com.cs2balance.assistant.mvp.data.Providers
import com.cs2balance.assistant.mvp.domain.Money
import org.junit.Assert.*
import org.junit.Test

class C5MoneyTest {
    private fun quote(price: String) = Providers.c5(
        """{"success":true,"data":{"A":{"itemId":"1097999762394030080","marketHashName":"A","price":$price,"count":1}}}""",
        listOf("A"),
    ).getValue("A")

    @Test fun numericJsonSpellingDoesNotChangeTheExactPrice() {
        listOf("1.010000" to 101L, "101e-2" to 101L, "1.01e+0" to 101L,
            "0.9700" to 97L, "9.7E-1" to 97L, "1" to 100L, "1.000000" to 100L).forEach { (value, expected) ->
            assertEquals(value, expected, quote(value).amountCents ?: -1L)
            assertNull(value, quote(value).failure)
        }
        assertEquals(101L, quote("\"1.01\"").amountCents ?: -1L)
        assertEquals(Money.MAX_CENTS, quote("90071992547409.9100").amountCents ?: -1L)
    }

    @Test fun invalidOrSubcentValuesNeverBecomeRoundedQuotes() {
        listOf("1.001", "0.009", "1.0100000000000001", "90071992547409.92", "-1.00", "true", "null",
            "1e999999999", "\"1.010000\"", "\"NaN\"", "\"1,01\"", "\" 1.01\"").forEach { value ->
            assertEquals(value, "invalid_money", quote(value).failure)
            assertNull(value, quote(value).amountCents)
        }
        assertEquals("empty_quote", quote("0.000000").failure)
        assertEquals("empty_quote", quote("{}").failure)
        assertEquals("invalid_money", quote("0." + "0".repeat(129)).failure)
    }
}
