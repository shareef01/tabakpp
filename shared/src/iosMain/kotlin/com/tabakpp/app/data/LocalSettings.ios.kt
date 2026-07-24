package com.tabakpp.app.data

import platform.Foundation.NSUserDefaults

class IosLocalSettings : LocalSettings {
    private val defaults = NSUserDefaults.standardUserDefaults

    override fun getString(key: String, defaultValue: String): String {
        return defaults.stringForKey(key) ?: defaultValue
    }

    override fun putString(key: String, value: String) {
        defaults.setObject(value, forKey = key)
    }
}
