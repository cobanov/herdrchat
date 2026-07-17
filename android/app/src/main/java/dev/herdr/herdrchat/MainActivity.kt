package dev.herdr.herdrchat

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import dev.herdr.herdrchat.ui.connection.ConnectionStore
import dev.herdr.herdrchat.ui.screens.RootScreen
import dev.herdr.herdrchat.ui.theme.HerdrColors
import dev.herdr.herdrchat.ui.theme.HerdrTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            HerdrTheme {
                val dark = androidx.compose.foundation.isSystemInDarkTheme()
                val store = remember { ConnectionStore(applicationContext) }
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = HerdrColors.background(dark),
                ) {
                    RootScreen(store)
                }
            }
        }
    }
}
