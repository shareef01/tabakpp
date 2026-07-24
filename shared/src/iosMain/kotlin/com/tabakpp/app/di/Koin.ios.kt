package com.tabakpp.app.di

import com.tabakpp.app.data.GoogleSignInHelper
import com.tabakpp.app.data.IosLocalSettings
import com.tabakpp.app.data.IosNetworkObserver
import com.tabakpp.app.data.LocalSettings
import com.tabakpp.app.data.NetworkObserver
import com.tabakpp.app.data.UnsupportedGoogleSignInHelper
import org.koin.dsl.module

actual fun platformModule() = module {
    single<LocalSettings> { IosLocalSettings() }
    single<NetworkObserver> { IosNetworkObserver() }
    single<GoogleSignInHelper> { UnsupportedGoogleSignInHelper() }
}
