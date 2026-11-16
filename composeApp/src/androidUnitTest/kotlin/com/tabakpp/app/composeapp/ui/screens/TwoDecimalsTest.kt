package com.tabakpp.app.composeapp.ui.screens

import kotlin.test.Test
import kotlin.test.assertEquals

/** Settings money display rounds exact halves up, not to even. */
class TwoDecimalsTest {
    @Test fun halfCentRoundsUp() = assertEquals("0.33", twoDecimals(6.5 / 20))
    @Test fun anotherEvenHalfRoundsUp() = assertEquals("0.13", twoDecimals(0.125))
    @Test fun oddHalfRoundsUp() = assertEquals("0.38", twoDecimals(0.375))
    @Test fun belowHalfRoundsDown() = assertEquals("0.32", twoDecimals(0.3249))
    @Test fun wholeAmountsKeepTwoDecimals() = assertEquals("10.00", twoDecimals(10.0))
    @Test fun packPriceRoundTrips() = assertEquals("8.00", twoDecimals(0.4 * 20))
    @Test fun zero() = assertEquals("0.00", twoDecimals(0.0))
    @Test fun negativeHalfRoundsAwayFromZero() = assertEquals("-0.33", twoDecimals(-0.325))
}
