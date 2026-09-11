package com.tabakpp.app.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class VersionCodeParserTest {

    @Test
    fun parseNormalVersion() {
        val parsed = VersionCodeParser.parse("1.2.3")
        assertEquals("1.2.3", parsed.versionName)
        assertEquals(10203, parsed.versionCode)
        assertEquals(1, parsed.major)
        assertEquals(2, parsed.minor)
        assertEquals(3, parsed.patch)
    }

    @Test
    fun parseLeadingV() {
        val parsed = VersionCodeParser.parse("v1.0.5")
        assertEquals("1.0.5", parsed.versionName)
        assertEquals(10005, parsed.versionCode)
        assertEquals(1, parsed.major)
        assertEquals(0, parsed.minor)
        assertEquals(5, parsed.patch)
    }

    @Test
    fun parseDevFallbackWhenNullOrBlank() {
        val parsedNull = VersionCodeParser.parse(null, isRelease = false)
        assertEquals("0.0.0-dev", parsedNull.versionName)
        assertEquals(1, parsedNull.versionCode)

        val parsedBlank = VersionCodeParser.parse("   ", isRelease = false)
        assertEquals("0.0.0-dev", parsedBlank.versionName)
        assertEquals(1, parsedBlank.versionCode)
    }

    @Test
    fun rejectNullOrBlankInRelease() {
        assertFailsWith<IllegalArgumentException> {
            VersionCodeParser.parse(null, isRelease = true)
        }
        assertFailsWith<IllegalArgumentException> {
            VersionCodeParser.parse("  ", isRelease = true)
        }
    }

    @Test
    fun parsePatch99() {
        val parsed = VersionCodeParser.parse("1.0.99")
        assertEquals(10099, parsed.versionCode)
    }

    @Test
    fun rejectPatch100DueToCollision() {
        // In 2-digit packing, 1.0.100 would collide with 1.1.0 (both 10100)
        assertFailsWith<IllegalArgumentException> {
            VersionCodeParser.parse("1.0.100")
        }
    }

    @Test
    fun parseMinor99() {
        val parsed = VersionCodeParser.parse("1.99.0")
        assertEquals(19900, parsed.versionCode)
    }

    @Test
    fun rejectMinor100DueToCollision() {
        // In 2-digit packing, 1.100.0 would collide with 2.0.0 (both 20000)
        assertFailsWith<IllegalArgumentException> {
            VersionCodeParser.parse("1.100.0")
        }
    }

    @Test
    fun rejectMalformedSegments() {
        assertFailsWith<IllegalArgumentException> {
            VersionCodeParser.parse("1.2.alpha")
        }
        assertFailsWith<IllegalArgumentException> {
            VersionCodeParser.parse("v1.x.3")
        }
        assertFailsWith<IllegalArgumentException> {
            VersionCodeParser.parse("abc")
        }
    }

    @Test
    fun rejectMissingSegments() {
        assertFailsWith<IllegalArgumentException> {
            VersionCodeParser.parse("1.0")
        }
        assertFailsWith<IllegalArgumentException> {
            VersionCodeParser.parse("1")
        }
        assertFailsWith<IllegalArgumentException> {
            VersionCodeParser.parse("1.0.0.1")
        }
    }

    @Test
    fun rejectPrereleaseTags() {
        assertFailsWith<IllegalArgumentException> {
            VersionCodeParser.parse("1.0.0-beta.1")
        }
        assertFailsWith<IllegalArgumentException> {
            VersionCodeParser.parse("v1.0.0-rc1")
        }
    }

    @Test
    fun rejectVeryLargeMajorExceedingAndroidLimit() {
        // Max Android versionCode is 2,100,000,000.
        // Major 210001 -> 2100010000 > 2,100,000,000
        assertFailsWith<IllegalArgumentException> {
            VersionCodeParser.parse("210001.0.0")
        }
    }
}
