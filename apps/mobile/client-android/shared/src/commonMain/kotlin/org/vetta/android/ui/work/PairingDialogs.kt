package org.vetta.android.ui.work

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.isValidHostPort
import org.vetta.android.domain.remote.protocol.InviteCode
import org.vetta.android.resources.Res
import org.vetta.android.resources.cancel
import org.vetta.android.resources.pair_connect
import org.vetta.android.resources.pair_invite
import org.vetta.android.resources.pair_invite_code
import org.vetta.android.resources.pair_invite_code_invalid
import org.vetta.android.resources.pair_invite_hint
import org.vetta.android.resources.pair_invite_password
import org.vetta.android.resources.pair_invite_password_invalid
import org.vetta.android.resources.pair_invite_relay
import org.vetta.android.resources.pair_invite_relay_toggle
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

/**
 * Asks for the connection code and password the computer shows under its QR code
 * (ADR-0136), and, only for a computer on its own relay, that relay's address. Checks
 * their shape before anything goes on the network.
 */
@Composable
fun CodePairDialog(
    onConnect: (code: String, password: String, relayBaseUrl: String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var ownRelay by remember { mutableStateOf(false) }
    var relay by remember { mutableStateOf("") }
    var codeInvalid by remember { mutableStateOf(false) }
    var passwordInvalid by remember { mutableStateOf(false) }
    val submit = {
        val normalized = InviteCode.normalize(code)
        codeInvalid = normalized == null
        passwordInvalid = !InviteCode.isValidPassword(password.trim())
        if (normalized != null && !passwordInvalid) onConnect(normalized, password.trim(), relay.trim().takeIf { ownRelay && it.isNotEmpty() })
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.pair_invite)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(Res.string.pair_invite_hint), style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = code,
                    onValueChange = {
                        code = it.take(12)
                        codeInvalid = false
                    },
                    label = { Text(stringResource(Res.string.pair_invite_code)) },
                    placeholder = { Text("K7Q2-9MXD") },
                    singleLine = true,
                    isError = codeInvalid,
                    supportingText = if (codeInvalid) ({ Text(stringResource(Res.string.pair_invite_code_invalid)) }) else null,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                    keyboardOptions =
                        KeyboardOptions(
                            capitalization = KeyboardCapitalization.Characters,
                            keyboardType = KeyboardType.Ascii,
                            imeAction = ImeAction.Next,
                            autoCorrectEnabled = false,
                        ),
                    modifier = Modifier.fillMaxWidth().testTag("pair.invite.code"),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { typed ->
                        password = typed.filter { it in '0'..'9' }.take(InviteCode.PASSWORD_LENGTH)
                        passwordInvalid = false
                    },
                    label = { Text(stringResource(Res.string.pair_invite_password)) },
                    singleLine = true,
                    isError = passwordInvalid,
                    supportingText = if (passwordInvalid) ({ Text(stringResource(Res.string.pair_invite_password_invalid)) }) else null,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { submit() }),
                    modifier = Modifier.fillMaxWidth().testTag("pair.invite.password"),
                )
                Row(
                    Modifier.fillMaxWidth().testTag("pair.invite.ownRelay"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(stringResource(Res.string.pair_invite_relay_toggle), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    Switch(checked = ownRelay, onCheckedChange = { ownRelay = it })
                }
                if (ownRelay) {
                    OutlinedTextField(
                        value = relay,
                        onValueChange = { relay = it },
                        label = { Text(stringResource(Res.string.pair_invite_relay)) },
                        placeholder = { Text(InviteCode.DEFAULT_RELAY_BASE_URL) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                        modifier = Modifier.fillMaxWidth().testTag("pair.invite.relay"),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = submit, enabled = code.isNotBlank() && password.isNotBlank(), modifier = Modifier.testTag("pair.invite.connect")) {
                Text(stringResource(Res.string.pair_connect))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.cancel)) } },
    )
}

