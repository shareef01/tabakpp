package com.tabakpp.app.data

interface LocalSettings {
    fun getString(key: String, defaultValue: String): String
    fun putString(key: String, value: String)
}
