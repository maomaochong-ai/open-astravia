package org.vetta.android.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.PersonOutline
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.resources.Res
import org.vetta.android.resources.tab_discover
import org.vetta.android.resources.tab_home
import org.vetta.android.resources.tab_me
import org.vetta.android.resources.tab_sessions
import org.vetta.android.resources.tab_work
import org.vetta.android.ui.navigation.MainTab
import org.vetta.android.ui.theme.vettaExtra

@Composable
fun VettaBottomBar(
    selected: MainTab,
    onSelect: (MainTab) -> Unit,
    modifier: Modifier = Modifier,
    /** Desktop sessions waiting on the user, shown on the Work tab. */
    workBadge: Int = 0,
) {
    val items =
        listOf(
            TabItem(MainTab.Home, stringResource(Res.string.tab_home), Icons.Outlined.Home, Icons.Filled.Home),
            TabItem(MainTab.Work, stringResource(Res.string.tab_work), Icons.Outlined.Inbox, Icons.Filled.Inbox),
            TabItem(MainTab.Sessions, stringResource(Res.string.tab_sessions), Icons.Outlined.ChatBubbleOutline, Icons.Filled.ChatBubbleOutline),
            TabItem(MainTab.Discover, stringResource(Res.string.tab_discover), Icons.Outlined.Explore, Icons.Filled.Explore),
            TabItem(MainTab.Me, stringResource(Res.string.tab_me), Icons.Outlined.PersonOutline, Icons.Filled.PersonOutline),
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
                    BadgedBox(
                        badge = {
                            if (item.tab == MainTab.Work && workBadge > 0) Badge { Text("$workBadge") }
                        },
                    ) {
                        Icon(
                            imageVector = if (selectedTab) item.selectedIcon else item.icon,
                            contentDescription = item.label,
                        )
                    }
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
