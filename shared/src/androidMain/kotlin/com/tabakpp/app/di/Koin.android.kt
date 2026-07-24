package com.tabakpp.app.di

import com.tabakpp.app.data.AndroidGoogleSignInHelper
import com.tabakpp.app.data.AndroidLocalSettings
import com.tabakpp.app.data.AndroidNetworkObserver
import com.tabakpp.app.data.GoogleSignInHelper
import com.tabakpp.app.data.LocalSettings
import com.tabakpp.app.data.NetworkObserver
import org.koin.android.ext.koin.androidContext
import org.koin.dsl.module

actual fun platformModule() = module {
    single<LocalSettings> { AndroidLocalSettings(get()) }
    single<NetworkObserver> { AndroidNetworkObserver(get()) }
    single<GoogleSignInHelper> { AndroidGoogleSignInHelper(androidContext()) }
}
