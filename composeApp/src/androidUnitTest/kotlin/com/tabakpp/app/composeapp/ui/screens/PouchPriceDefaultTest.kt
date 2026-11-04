package com.tabakpp.app.composeapp.ui.screens

import kotlin.test.Test
import kotlin.test.assertEquals

/** F-10: a deliberately saved pouch price of 0 must survive reload + resave. */
class PouchPriceDefaultTest {
    @Test fun savedZeroPouchPriceIsKept() = assertEquals("0.00", pouchPriceText("POUCH", 0.0))
    @Test fun savedPouchPriceIsKept() = assertEquals("9.20", pouchPriceText("POUCH", 9.2))
    @Test fun packAccountGetsTheSuggestion() = assertEquals("6.50", pouchPriceText("PACK", 0.0))
    @Test fun unconfiguredGetsTheSuggestion() = assertEquals("6.50", pouchPriceText(null, null))
}
