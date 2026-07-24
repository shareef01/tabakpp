package com.tabakpp.app.data

object InputSanitizer {
    fun displayName(value: String): String = text(value, maxLength = 100)

    fun trackerName(value: String): String = text(value, maxLength = 80)

    fun counts(values: Map<String, Double>): Map<String, Double> =
        values.entries
            .asSequence()
            .filter { (_, value) -> value.isFinite() && value in 0.0..10_000.0 }
            .take(50)
            .associate { it.toPair() }

    private fun text(value: String, maxLength: Int): String =
        value
            .filterNot { it.isISOControl() || it == '<' || it == '>' }
            .trim()
            .take(maxLength)
}
