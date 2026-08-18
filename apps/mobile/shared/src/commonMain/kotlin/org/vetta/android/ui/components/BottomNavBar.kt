package org.vetta.android.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.PersonOutline
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.navigation.MainTab
import org.vetta.android.ui.theme.vettaExtra

@Composable
fun VettaBottomBar(
    selected: MainTab,
    onSelect: (MainTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val items =
        listOf(
            TabItem(MainTab.Home, Str.tabHome, Icons.Outlined.Home, Icons.Filled.Home),
            TabItem(MainTab.Sessions, Str.tabSessions, Icons.Outlined.ChatBubbleOutline, Icons.Filled.ChatBubbleOutline),
            TabItem(MainTab.Discover, Str.tabDiscover, Icons.Outlined.Explore, Icons.Filled.Explore),
            TabItem(MainTab.Me, Str.tabMe, Icons.Outlined.PersonOutline, Icons.Filled.PersonOutline),
        )
    NavigationBar(
        modifier = modifier.fillMaxWidth(),
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        items.forEach { item ->
            val selectedTab = item.tab == selected
            NavigationBarItem(
                selected = selectedTab,
                onClick = { onSelect(item.tab) },
                icon = {
                    Icon(
                        imageVector = if (selectedTab) item.selectedIcon else item.icon,
                        contentDescription = item.label,
                    )
                },
                label = {
                    Text(item.label, style = MaterialTheme.typography.labelSmall)
                },
                colors =
                    NavigationBarItemDefaults.colors(
                        selectedIconColor = MaterialTheme.colorScheme.onSurface,
                        selectedTextColor = MaterialTheme.colorScheme.onSurface,
                        unselectedIconColor = MaterialTheme.vettaExtra.secondaryText,
                        unselectedTextColor = MaterialTheme.vettaExtra.secondaryText,
                        indicatorColor = MaterialTheme.vettaExtra.chipBackground,
                    ),
            )
        }
    }
}

private data class TabItem(
    val tab: MainTab,
    val label: String,
    val icon: ImageVector,
    val selectedIcon: ImageVector,
)
