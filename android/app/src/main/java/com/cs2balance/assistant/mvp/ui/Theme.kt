package com.cs2balance.assistant.mvp.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

object Space { val small = 8.dp; val medium = 16.dp; val large = 24.dp; val huge = 32.dp }
private val Light = lightColorScheme(
    primary = Color(0xFF006B5F), onPrimary = Color.White,
    primaryContainer = Color(0xFF9BF2DE), onPrimaryContainer = Color(0xFF00201B),
    secondary = Color(0xFF4A635B), onSecondary = Color.White,
    secondaryContainer = Color(0xFFCCE8DD), onSecondaryContainer = Color(0xFF07201A),
    background = Color(0xFFF6FBF8), onBackground = Color(0xFF17201D),
    surface = Color(0xFFF6FBF8), onSurface = Color(0xFF17201D),
    surfaceVariant = Color(0xFFDDE5E0), onSurfaceVariant = Color(0xFF414945),
    outline = Color(0xFF707974), error = Color(0xFFBA1A1A),
    surfaceContainer = Color(0xFFEBF1ED), surfaceContainerLow = Color(0xFFF1F7F3), surfaceContainerHigh = Color(0xFFE5EBE7),
)
private val Dark = darkColorScheme(
    primary = Color(0xFF80D6C2), onPrimary = Color(0xFF00382F),
    primaryContainer = Color(0xFF005046), onPrimaryContainer = Color(0xFF9BF2DE),
    secondary = Color(0xFFB0CDC2), onSecondary = Color(0xFF1D352C),
    secondaryContainer = Color(0xFF334C42), onSecondaryContainer = Color(0xFFCCE8DD),
    background = Color(0xFF0F1512), onBackground = Color(0xFFDEE5DF),
    surface = Color(0xFF0F1512), onSurface = Color(0xFFDEE5DF),
    surfaceVariant = Color(0xFF414945), onSurfaceVariant = Color(0xFFBFC9C3),
    outline = Color(0xFF89938D), error = Color(0xFFFFB4AB),
    surfaceContainer = Color(0xFF1B211E), surfaceContainerLow = Color(0xFF171D1A), surfaceContainerHigh = Color(0xFF252B28),
)
@Composable fun BalanceTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, typography = Typography(),
        shapes = Shapes(small = RoundedCornerShape(8.dp), medium = RoundedCornerShape(12.dp),
            large = RoundedCornerShape(16.dp)), content = content)
}
