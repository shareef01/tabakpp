package com.tabakpp.app.di

import com.tabakpp.app.data.*
import com.tabakpp.app.viewmodels.AuthViewModel
import com.tabakpp.app.viewmodels.RegistryViewModel
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.auth
import dev.gitlive.firebase.firestore.firestore
import org.koin.core.context.startKoin
import org.koin.dsl.KoinAppDeclaration
import org.koin.dsl.module

fun initKoin(appDeclaration: KoinAppDeclaration = {}) =
    startKoin {
        appDeclaration()
        modules(commonModule, platformModule())
    }

// called by iOS
fun initKoin() = initKoin {}

val commonModule = module {
    single { Firebase.auth }
    single { Firebase.firestore }
    single<AuthRepository> { FirebaseAuthRepository(get(), get(), get()) }
    single<RegistryRepository> { FirebaseRegistryRepository(get()) }
    // Singles: these are injected via koinInject at multiple composition sites,
    // which never calls ViewModel.onCleared. A factory here would leak one
    // eagerly-collecting instance per injection site.
    single { AuthViewModel(get(), get()) }
    single {
        RegistryViewModel(get(), get(), get(), get()).apply {
            // OPTION_B routing is decided per account by its SERVER-side
            // financialMode, which only becomes OPTION_B after the trusted
            // functions are deployed and an operator migrates the account. So the
            // route is always on: LEGACY accounts keep their direct writes, and a
            // migrated account goes through the callable instead of hitting rules
            // that deny it every financial write.
            optionBGateway = FirebaseTrustedFinancial()
            optionBLedgerEnabled = true
        }
    }
}

expect fun platformModule(): org.koin.core.module.Module
