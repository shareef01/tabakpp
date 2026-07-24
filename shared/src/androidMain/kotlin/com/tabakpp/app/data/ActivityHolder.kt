package com.tabakpp.app.data

import android.app.Activity
import java.lang.ref.WeakReference

/** Holds the foreground Activity for Credential Manager Google Sign-In. */
object ActivityHolder {
    @Volatile
    private var ref: WeakReference<Activity>? = null

    fun set(activity: Activity?) {
        ref = activity?.let { WeakReference(it) }
    }

    fun get(): Activity? = ref?.get()
}
