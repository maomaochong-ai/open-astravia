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

/** 设计规范色板（设计图） */
object VettaPalette {
    val Black = Color(0xFF000000)
    val Gray666 = Color(0xFF666666)
    val GrayE5 = Color(0xFFE5E5E5)
    val White = Color(0xFFFFFFFF)
    val PageBg = Color(0xFFF7F7F8)
    val CardBorder = Color(0xFFE8E8EA)
    val Success = Color(0xFF1A7F37)
    val Danger = Color(0xFFCF222E)
    val ChipBg = Color(0xFFF0F0F2)
}

@Immutable
data class VettaExtraColors(
    val pageBackground: Color,
    val secondaryText: Color,
    val border: Color,
    val chipBackground: Color,
    val success: Color,
)

val LocalVettaExtra =
    staticCompositionLocalOf {
        VettaExtraColors(
            pageBackground = VettaPalette.PageBg,
            secondaryText = VettaPalette.Gray666,
            border = VettaPalette.CardBorder,
            chipBackground = VettaPalette.ChipBg,
            success = VettaPalette.Success,
        )
    }

private val LightScheme =
    lightColorScheme(
        primary = VettaPalette.Black,
        onPrimary = VettaPalette.White,
        primaryContainer = VettaPalette.GrayE5,
        onPrimaryContainer = VettaPalette.Black,
        secondary = VettaPalette.Gray666,
        onSecondary = VettaPalette.White,
        secondaryContainer = VettaPalette.ChipBg,
        onSecondaryContainer = VettaPalette.Black,
        background = VettaPalette.PageBg,
        onBackground = VettaPalette.Black,
        surface = VettaPalette.White,
        onSurface = VettaPalette.Black,
        surfaceVariant = VettaPalette.ChipBg,
        onSurfaceVariant = VettaPalette.Gray666,
        outline = VettaPalette.GrayE5,
        outlineVariant = VettaPalette.CardBorder,
        error = VettaPalette.Danger,
        onError = VettaPalette.White,
    )

private val DarkScheme =
    darkColorScheme(
        primary = VettaPalette.White,
        onPrimary = VettaPalette.Black,
        primaryContainer = Color(0xFF2C2C2E),
        onPrimaryContainer = VettaPalette.White,
        secondary = Color(0xFFAEAEB2),
        onSecondary = VettaPalette.Black,
        background = Color(0xFF000000),
        onBackground = VettaPalette.White,
        surface = Color(0xFF1C1C1E),
        onSurface = VettaPalette.White,
        surfaceVariant = Color(0xFF2C2C2E),
        onSurfaceVariant = Color(0xFFAEAEB2),
        outline = Color(0xFF3A3A3C),
        error = Color(0xFFFF453A),
        onError = VettaPalette.White,
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
    val extra =
        if (dark) {
            VettaExtraColors(
                pageBackground = Color(0xFF000000),
                secondaryText = Color(0xFFAEAEB2),
                border = Color(0xFF3A3A3C),
                chipBackground = Color(0xFF2C2C2E),
                success = Color(0xFF30D158),
            )
        } else {
            VettaExtraColors(
                pageBackground = VettaPalette.PageBg,
                secondaryText = VettaPalette.Gray666,
                border = VettaPalette.CardBorder,
                chipBackground = VettaPalette.ChipBg,
                success = VettaPalette.Success,
            )
        }
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
