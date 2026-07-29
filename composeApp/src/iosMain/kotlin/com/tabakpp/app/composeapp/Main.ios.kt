package com.tabakpp.app.composeapp

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.ComposeUIViewController
import platform.UIKit.UIViewController

/**
 * iOS is not a supported release target: Firebase, Koin, and Google Sign-In are
 * not bootstrapped here. Show an explicit gate instead of launching [App], which
 * would crash on missing DI / Auth.
 */
fun MainViewController(): UIViewController =
    ComposeUIViewController { UnsupportedIosScreen() }

@Composable
private fun UnsupportedIosScreen() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF09090B))
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "tabak++",
            color = Color(0xFFFF5F5F),
            fontSize = 28.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = 1.sp
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "iOS is not supported yet",
            color = Color.White,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "Use the Android app or the web PWA. " +
                "This shell does not initialize Firebase or sign-in.",
            color = Color.White.copy(alpha = 0.55f),
            fontSize = 14.sp,
            textAlign = TextAlign.Center,
            lineHeight = 20.sp
        )
    }
}
