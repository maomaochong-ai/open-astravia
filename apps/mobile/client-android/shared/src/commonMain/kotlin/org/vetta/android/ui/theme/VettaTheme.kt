package org.vetta.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.vetta.android.app.ThemeMode

/**
 * The iPhone app's palette (`Theme.swift`), carried over from the Expo design: dark
 * emphasises white, light emphasises black, and every surface has a light and a dark value.
 */
private object Palette {
    val PageLight = Color(0xFFF4F5F7)
    val PageDark = Color(0xFF0A0B0D)
    val CardLight = Color(0xFFFFFFFF)
    val CardDark = Color(0xFF15171A)
    val Card2Light = Color(0xFFF0F1F3)
    val Card2Dark = Color(0xFF1C1F23)
    val LineLight = Color(0xFFE3E5E8)
    val LineDark = Color(0xFF24272C)
    val InkLight = Color(0xFF0B0C0E)
    val InkDark = Color(0xFFF4F5F6)
    val DimLight = Color(0xFF6B7077)
    val DimDark = Color(0xFF8B9096)
    val RedLight = Color(0xFFDC2626)
    val RedDark = Color(0xFFF0524F)
    val GreenLight = Color(0xFF16A34A)
    val GreenDark = Color(0xFF22C55E)
}

@Immutable
data class VettaExtraColors(
    val pageBackground: Color,
    val secondaryText: Color,
    val border: Color,
    val chipBackground: Color,
    val success: Color,
)

private val LightExtra =
    VettaExtraColors(
        pageBackground = Palette.PageLight,
        secondaryText = Palette.DimLight,
        border = Palette.LineLight,
        chipBackground = Palette.Card2Light,
        success = Palette.GreenLight,
    )

private val DarkExtra =
    VettaExtraColors(
        pageBackground = Palette.PageDark,
        secondaryText = Palette.DimDark,
        border = Palette.LineDark,
        chipBackground = Palette.Card2Dark,
        success = Palette.GreenDark,
    )

val LocalVettaExtra = staticCompositionLocalOf { LightExtra }

private val LightScheme =
    lightColorScheme(
        primary = Palette.InkLight,
        onPrimary = Palette.CardLight,
        primaryContainer = Palette.Card2Light,
        onPrimaryContainer = Palette.InkLight,
        secondary = Palette.DimLight,
        onSecondary = Palette.CardLight,
        secondaryContainer = Palette.Card2Light,
        onSecondaryContainer = Palette.InkLight,
        background = Palette.PageLight,
        onBackground = Palette.InkLight,
        surface = Palette.CardLight,
        onSurface = Palette.InkLight,
        surfaceVariant = Palette.Card2Light,
        onSurfaceVariant = Palette.DimLight,
        surfaceContainerLow = Palette.PageLight,
        surfaceContainer = Palette.CardLight,
        surfaceContainerHigh = Palette.CardLight,
        outline = Palette.LineLight,
        outlineVariant = Palette.LineLight,
        error = Palette.RedLight,
        onError = Palette.CardLight,
    )

private val DarkScheme =
    darkColorScheme(
        primary = Palette.InkDark,
        onPrimary = Palette.PageDark,
        primaryContainer = Palette.Card2Dark,
        onPrimaryContainer = Palette.InkDark,
        secondary = Palette.DimDark,
        onSecondary = Palette.PageDark,
        secondaryContainer = Palette.Card2Dark,
        onSecondaryContainer = Palette.InkDark,
        background = Palette.PageDark,
        onBackground = Palette.InkDark,
        surface = Palette.CardDark,
        onSurface = Palette.InkDark,
        surfaceVariant = Palette.Card2Dark,
        onSurfaceVariant = Palette.DimDark,
        surfaceContainerLow = Palette.PageDark,
        surfaceContainer = Palette.CardDark,
        surfaceContainerHigh = Palette.Card2Dark,
        outline = Palette.LineDark,
        outlineVariant = Palette.LineDark,
        error = Palette.RedDark,
        onError = Palette.InkDark,
    )

/** 设计规范：标题 17/20 Medium · 正文 14/20 Regular · 辅助 12/16 Regular */
private val VettaTypography =
    Typography(
        headlineSmall =
            TextStyle(
                fontWeight = FontWeight.SemiBold,
                fontSize = 22.sp,
                lineHeight = 28.sp,
            ),
        titleLarge =
            TextStyle(
                fontWeight = FontWeight.Medium,
                fontSize = 17.sp,
                lineHeight = 22.sp,
            ),
        titleMedium =
            TextStyle(
                fontWeight = FontWeight.Medium,
                fontSize = 17.sp,
                lineHeight = 20.sp,
            ),
        titleSmall =
            TextStyle(
                fontWeight = FontWeight.Medium,
                fontSize = 15.sp,
                lineHeight = 20.sp,
            ),
        bodyLarge =
            TextStyle(
                fontWeight = FontWeight.Normal,
                fontSize = 16.sp,
                lineHeight = 22.sp,
            ),
        bodyMedium =
            TextStyle(
                fontWeight = FontWeight.Normal,
                fontSize = 14.sp,
                lineHeight = 20.sp,
            ),
        bodySmall =
            TextStyle(
                fontWeight = FontWeight.Normal,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            ),
        labelLarge =
            TextStyle(
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
                lineHeight = 18.sp,
            ),
        labelMedium =
            TextStyle(
                fontWeight = FontWeight.Medium,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            ),
        labelSmall =
            TextStyle(
                fontWeight = FontWeight.Normal,
                fontSize = 11.sp,
                lineHeight = 14.sp,
            ),
    )

private val VettaShapes =
    Shapes(
        extraSmall = RoundedCornerShape(8.dp),
        small = RoundedCornerShape(10.dp),
        medium = RoundedCornerShape(14.dp),
        large = RoundedCornerShape(18.dp),
        extraLarge = RoundedCornerShape(24.dp),
    )

@Composable
fun VettaTheme(
    themeMode: ThemeMode,
    content: @Composable () -> Unit,
) {
    val dark =
        when (themeMode) {
            ThemeMode.System -> isSystemInDarkTheme()
            ThemeMode.Light -> false
            ThemeMode.Dark -> true
        }
    val extra = if (dark) DarkExtra else LightExtra
    androidx.compose.runtime.CompositionLocalProvider(LocalVettaExtra provides extra) {
        MaterialTheme(
            colorScheme = if (dark) DarkScheme else LightScheme,
            typography = VettaTypography,
            shapes = VettaShapes,
            content = content,
        )
    }
}

val MaterialTheme.vettaExtra: VettaExtraColors
    @Composable
    get() = LocalVettaExtra.current
