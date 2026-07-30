package com.tabakpp.app.data

import android.content.Context
import android.content.SharedPreferences

/** Provided via Koin (see Koin.android.kt) because it needs a Context. */
class AndroidLocalSettings(context: Context) : LocalSettings {
    private val prefs: SharedPreferences = context.getSharedPreferences("tabakpp_prefs", Context.MODE_PRIVATE)

    override fun getString(key: String, defaultValue: String): String {
        return prefs.getString(key, defaultValue) ?: defaultValue
    }

    override fun putString(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }
}
