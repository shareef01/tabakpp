package com.tabakpp.app.data

import android.content.Context
import android.content.SharedPreferences
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject

class AndroidLocalSettings(context: Context) : LocalSettings {
    private val prefs: SharedPreferences = context.getSharedPreferences("tabakpp_prefs", Context.MODE_PRIVATE)

    override fun getString(key: String, defaultValue: String): String {
        return prefs.getString(key, defaultValue) ?: defaultValue
    }

    override fun putString(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }
}

// We'll use Koin to provide this since it needs Context
// For now, providing a way to get it if we manual initialize
// But better to use Koin inject in a common wrapper
