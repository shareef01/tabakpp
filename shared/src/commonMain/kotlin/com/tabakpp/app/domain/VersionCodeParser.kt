package com.tabakpp.app.domain

/**
 * Validates and transforms a semantic version name into a monotonically increasing
 * Android versionCode (major * 10000 + minor * 100 + patch).
 *
 * Enforces:
 * - Strict v?MAJOR.MINOR.PATCH format (e.g. "1.0.5" or "v1.0.5").
 * - Rejects malformed, incomplete, or non-numeric version segments.
 * - Enforces minor in 0..99 and patch in 0..99 to guarantee collision-free 2-digit packing.
 *   (e.g., 1.0.100 and 1.1.0 would collide under 2-digit packing without this check).
 * - Enforces the derived versionCode fits Android's positive 32-bit integer range (1..2,100,000,000).
 * - Rejects prerelease tags for release versions.
 */
object VersionCodeParser {
    const val DEV_VERSION_NAME = "0.0.0-dev"
    const val DEV_VERSION_CODE = 1
    const val MAX_ANDROID_VERSION_CODE = 2_100_000_000

    data class ParsedVersion(
        val versionName: String,
        val versionCode: Int,
        val major: Int,
        val minor: Int,
        val patch: Int
    )

    fun parse(rawInput: String?, isRelease: Boolean = false): ParsedVersion {
        val trimmed = rawInput?.trim()
        if (trimmed.isNullOrEmpty()) {
            if (isRelease) {
                throw IllegalArgumentException("Release build requires a valid version string, got null or blank.")
            }
            return ParsedVersion(
                versionName = DEV_VERSION_NAME,
                versionCode = DEV_VERSION_CODE,
                major = 0,
                minor = 0,
                patch = 0
            )
        }

        val withoutV = if (trimmed.startsWith("v", ignoreCase = true)) {
            trimmed.substring(1)
        } else {
            trimmed
        }

        if (withoutV.contains("-")) {
            throw IllegalArgumentException(
                "Prerelease tags are not permitted for release versions: '$rawInput'. Expected strict MAJOR.MINOR.PATCH format."
            )
        }

        val parts = withoutV.split('.')
        if (parts.size != 3) {
            throw IllegalArgumentException(
                "Version string must have exactly three numeric segments (MAJOR.MINOR.PATCH): '$rawInput'"
            )
        }

        val major = parts[0].toIntOrNull()
            ?: throw IllegalArgumentException("Major version segment '${parts[0]}' is not a valid non-negative integer in '$rawInput'")
        val minor = parts[1].toIntOrNull()
            ?: throw IllegalArgumentException("Minor version segment '${parts[1]}' is not a valid non-negative integer in '$rawInput'")
        val patch = parts[2].toIntOrNull()
            ?: throw IllegalArgumentException("Patch version segment '${parts[2]}' is not a valid non-negative integer in '$rawInput'")

        if (major < 0) {
            throw IllegalArgumentException("Major version cannot be negative: $major in '$rawInput'")
        }
        if (minor !in 0..99) {
            throw IllegalArgumentException(
                "Minor version ($minor) must be in 0..99 to avoid versionCode collision: '$rawInput'"
            )
        }
        if (patch !in 0..99) {
            throw IllegalArgumentException(
                "Patch version ($patch) must be in 0..99 to avoid versionCode collision: '$rawInput'"
            )
        }

        val derivedCode = major.toLong() * 10000L + minor.toLong() * 100L + patch.toLong()
        if (derivedCode < 1L || derivedCode > MAX_ANDROID_VERSION_CODE.toLong()) {
            throw IllegalArgumentException(
                "Calculated versionCode $derivedCode is outside permitted Android range (1..$MAX_ANDROID_VERSION_CODE): '$rawInput'"
            )
        }

        return ParsedVersion(
            versionName = withoutV,
            versionCode = derivedCode.toInt(),
            major = major,
            minor = minor,
            patch = patch
        )
    }
}
