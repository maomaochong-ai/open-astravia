package org.vetta.android.ui.shell

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.resources.Res
import org.vetta.android.resources.work_title

/** Opens Home from the slot's top-left corner. */
@Composable
fun DrawerButton(onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.testTag("drawer.open")) {
        Icon(Icons.Filled.Menu, contentDescription = stringResource(Res.string.work_title))
    }
}
