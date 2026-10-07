package com.cs2balance.assistant.mvp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.cs2balance.assistant.mvp.ui.BalanceApp
import com.cs2balance.assistant.mvp.ui.BalanceTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            BalanceTheme {
                val model: BalanceViewModel = viewModel()
                BalanceApp(model)
            }
        }
    }
}
