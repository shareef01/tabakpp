package com.tabakpp.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Audit 2026-11-16 TABAK-008: a decimal comma must not be dropped from a price. */
class DecimalInputTest {
    @Test fun commaBecomesTheSeparator() = assertEquals("6.50", InputSanitizer.decimalInput("6,50"))
    @Test fun dotIsKept() = assertEquals("6.50", InputSanitizer.decimalInput("6.50"))
    @Test fun onlyTheFirstSeparatorIsKept() = assertEquals("1.23", InputSanitizer.decimalInput("1.2,3"))
    @Test fun otherCharactersAreDropped() = assertEquals("12.5", InputSanitizer.decimalInput("€ 12,5-"))

    @Test fun parsesComma() = assertEquals(6.5, InputSanitizer.parseDecimal("6,50"))
    @Test fun parsesDot() = assertEquals(6.5, InputSanitizer.parseDecimal("6.50"))
    @Test fun emptyIsNull() = assertNull(InputSanitizer.parseDecimal(""))
    @Test fun loneSeparatorIsNull() = assertNull(InputSanitizer.parseDecimal(","))

    @Test fun typedCommaPriceRoundTrips() =
        assertEquals(6.5, InputSanitizer.parseDecimal(InputSanitizer.decimalInput("6,50")))
}
