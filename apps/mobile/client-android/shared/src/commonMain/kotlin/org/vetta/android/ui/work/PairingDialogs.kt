package org.vetta.android.ui.work

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.isValidHostPort
import org.vetta.android.resources.Res
import org.vetta.android.resources.cancel
import org.vetta.android.resources.pair_connect
import org.vetta.android.resources.pair_manual_hint
import org.vetta.android.resources.pair_manual_invalid
import org.vetta.android.resources.pair_manual_placeholder
import org.vetta.android.resources.pair_manual_title

/** Asks for the `host:port` the computer shows; checks its shape before connecting. */
@Composable
fun ManualPairDialog(
    onConnect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var endpoint by remember { mutableStateOf("") }
    var invalid by remember { mutableStateOf(false) }
    val submit = {
        val trimmed = endpoint.trim()
        if (isValidHostPort(trimmed)) onConnect(trimmed) else invalid = true
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.pair_manual_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(Res.string.pair_manual_hint), style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = endpoint,
                    onValueChange = {
                        endpoint = it
                        invalid = false
                    },
                    placeholder = { Text(stringResource(Res.string.pair_manual_placeholder)) },
                    singleLine = true,
                    isError = invalid,
                    supportingText = if (invalid) ({ Text(stringResource(Res.string.pair_manual_invalid)) }) else null,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                    keyboardActions = KeyboardActions(onGo = { submit() }),
                    modifier = Modifier.fillMaxWidth().testTag("pair.endpoint"),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = submit, enabled = endpoint.isNotBlank(), modifier = Modifier.testTag("pair.connect")) {
                Text(stringResource(Res.string.pair_connect))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.cancel)) } },
    )
}
