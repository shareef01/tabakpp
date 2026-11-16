package com.tabakpp.app.composeapp.ui.screens

import kotlin.test.Test
import kotlin.test.assertEquals

/** Audit 2026-11-16 TABAK-008/009: saved cost settings stay within firestore.rules bounds. */
class CostSettingsInputTest {
    private fun pack(price: String, qty: String) = costSettingsFromInput("PACK", price, qty, "", "")
    private fun pouch(price: String, yield: String) = costSettingsFromInput("POUCH", "", "20", price, yield)

    @Test fun packCommaPrice() = assertEquals(0.325, pack("6,50", "20").unitPrice, 1e-9)
    @Test fun packQuantityIsClamped() = assertEquals(1000, pack("8", "5000").unitsPerPack)
    @Test fun packUnitPriceIsCappedAtRuleLimit() = assertEquals(1000.0, pack("99999", "1").unitPrice)
    @Test fun emptyPackPriceIsZero() = assertEquals(0.0, pack("", "20").unitPrice)

    @Test fun pouchPriceIsCappedAtRuleLimit() = assertEquals(10_000.0, pouch("25000", "60").pouchPrice)
    @Test fun pouchYieldIsCappedAtRuleLimit() = assertEquals(10_000, pouch("9", "99999").estimatedYield)
    @Test fun pouchYieldZeroBecomesOne() = assertEquals(1, pouch("9", "0").estimatedYield)
    @Test fun pouchUnitPriceIsCappedAtRuleLimit() = assertEquals(1000.0, pouch("10000", "1").unitPrice)
    @Test fun normalPouchIsUnchanged() {
        val s = pouch("9,20", "46")
        assertEquals(9.2, s.pouchPrice, 1e-9)
        assertEquals(46, s.estimatedYield)
        assertEquals(0.2, s.unitPrice, 1e-9)
        assertEquals(20, s.unitsPerPack)
    }
}
