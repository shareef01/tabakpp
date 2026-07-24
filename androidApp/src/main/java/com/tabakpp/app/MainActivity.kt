package com.tabakpp.app

import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.tabakpp.app.composeapp.App
import com.tabakpp.app.data.ActivityHolder

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        ActivityHolder.set(this)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT)
        )
        val reducedMotion =
            Settings.Global.getFloat(
                contentResolver,
                Settings.Global.ANIMATOR_DURATION_SCALE,
                1f
            ) == 0f
        setContent {
            App(reducedMotion = reducedMotion)
        }
    }

    override fun onResume() {
        super.onResume()
        ActivityHolder.set(this)
    }

    override fun onDestroy() {
        if (ActivityHolder.get() === this) {
            ActivityHolder.set(null)
        }
        super.onDestroy()
    }
}
