package com.tabakpp.app.data

object InputSanitizer {
    private val countKeyRegex = Regex("^[A-Za-z0-9_-]{1,64}$")

    fun displayName(value: String): String = text(value, maxLength = 100)

    fun trackerName(value: String): String = text(value, maxLength = 80)

    /**
     * Filter stored/caller counts down to what firestore.rules will accept
     * (`validCountMap`: <= 50 entries, `^[A-Za-z0-9_-]{1,64}$` keys, whole
     * numbers in [0, 10000]).
     *
     * The whole-number requirement mirrors the web `normalizeCounts`. It was
     * missing here, so Android could forward a fractional count that the rules
     * reject (`v % 1 == 0`) — surfacing as an opaque permission-denied instead
     * of a validation message — and the two clients disagreed about which
     * values were usable. Real inputs are integer taps, so nothing legitimate
     * is dropped.
     */
    fun counts(values: Map<String, Double>): Map<String, Double> =
        values.entries
            .asSequence()
            .filter { (key, value) ->
                countKeyRegex.matches(key) && value.isFinite() && value in 0.0..10_000.0 && value % 1.0 == 0.0
            }
            .take(50)
            .associate { it.toPair() }

    /**
     * Strict validation for CALLER-SUPPLIED counts (manual entry, historical
     * day/log edits) — web parity with `validateCounts` in registryService.js.
     *
     * [counts] FILTERS, which is right for stored state but wrong for input:
     * a negative value silently dropped from a manual entry leaves a zero-count
     * record that still earns the full target allowance as `saved` (audit
     * 2026-11-12 TABAK-005). This REJECTS instead, with INVALID_COUNT.
     */
    fun validateCounts(values: Map<String, Double>): Map<String, Double> {
        if (values.size > 50) throw IllegalArgumentException("INVALID_COUNT")
        values.forEach { (key, value) ->
            if (!countKeyRegex.matches(key) || !value.isFinite() || value !in 0.0..10_000.0 || value % 1.0 != 0.0) {
                throw IllegalArgumentException("INVALID_COUNT")
            }
        }
        return values
    }

    private fun text(value: String, maxLength: Int): String =
        value
            .filterNot { it.isISOControl() || it == '<' || it == '>' }
            .trim()
            .take(maxLength)
}
