package org.vetta.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.VisualTransformation
import org.vetta.android.domain.error.UiError
import org.vetta.android.domain.error.UiErrorAction
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.theme.vettaExtra

/** 统一输入层级、边框和高度，避免各页面自行拼接 Material 输入框。 */
@Composable
fun VettaTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: (@Composable (() -> Unit))? = null,
    label: (@Composable (() -> Unit))? = null,
    leadingIcon: (@Composable (() -> Unit))? = null,
    trailingIcon: (@Composable (() -> Unit))? = null,
    singleLine: Boolean = true,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.heightIn(min = 52.dp),
        singleLine = singleLine,
        placeholder = placeholder,
        label = label,
        leadingIcon = leadingIcon,
        trailingIcon = trailingIcon,
        visualTransformation = visualTransformation,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        shape = RoundedCornerShape(14.dp),
        colors =
            OutlinedTextFieldDefaults.colors(
                unfocusedBorderColor = MaterialTheme.vettaExtra.border,
                focusedBorderColor = MaterialTheme.colorScheme.onSurface,
            ),
    )
}

@Composable
fun VettaConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(confirmLabel) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(Str.cancel) }
        },
    )
}

@Composable
fun VettaChoiceDialog(
    title: String,
    message: String,
    primaryLabel: String,
    onPrimary: () -> Unit,
    secondaryLabel: String,
    onSecondary: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = {
            TextButton(onClick = onPrimary) { Text(primaryLabel) }
        },
        dismissButton = {
            Column(horizontalAlignment = Alignment.End) {
                TextButton(onClick = onSecondary) { Text(secondaryLabel) }
                TextButton(onClick = onDismiss) { Text(Str.cancel) }
            }
        },
    )
}

@Composable
fun VettaInfoDialog(
    title: String,
    message: String,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(Str.close) }
        },
    )
}

@Composable
fun VettaTextInputDialog(
    title: String,
    value: String,
    label: String,
    onValueChange: (String) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            VettaTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text(label) },
                singleLine = true,
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = value.isNotBlank()) { Text(Str.save) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(Str.cancel) }
        },
    )
}

@Composable
fun VettaErrorBanner(
    error: UiError,
    onDismiss: (() -> Unit)? = null,
    onAction: ((UiErrorAction) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.vettaExtra.chipBackground,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, MaterialTheme.vettaExtra.border),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(error.title, style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(4.dp))
            Text(error.message, style = MaterialTheme.typography.bodyMedium)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (onDismiss != null) {
                    TextButton(onClick = onDismiss) { Text(Str.close) }
                }
                val actionLabel =
                    when (error.action) {
                        UiErrorAction.Retry -> Str.actionRetry
                        UiErrorAction.OpenPlan -> Str.actionOpenPlan
                        UiErrorAction.ReLogin -> Str.actionRelogin
                        UiErrorAction.OpenSettings -> Str.actionOpenSettings
                        UiErrorAction.None -> null
                    }
                if (actionLabel != null && onAction != null) {
                    Button(onClick = { onAction(error.action) }) {
                        Text(actionLabel)
                    }
                }
            }
        }
    }
}

@Composable
fun QuotaMeter(
    label: String,
    limit: Double,
    consumed: Double,
    resetAt: String?,
    modifier: Modifier = Modifier,
) {
    val progress =
        if (limit <= 0.0) {
            0f
        } else {
            (consumed / limit).toFloat().coerceIn(0f, 1f)
        }
    val remaining = (limit - consumed).coerceAtLeast(0.0)
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(label, style = MaterialTheme.typography.labelLarge)
            Text(
                "${Str.remaining} ${formatQuota(remaining)} / ${formatQuota(limit)}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(6.dp))
        LinearProgressIndicator(
            progress = { progress },
            modifier = Modifier.fillMaxWidth().height(8.dp),
        )
        if (!resetAt.isNullOrBlank()) {
            Spacer(Modifier.height(4.dp))
            Text(
                "${Str.resetAt}：$resetAt",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun LoadingBlock(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.padding(24.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(12.dp))
        Text(Str.loading, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
fun EmptyState(
    title: String,
    subtitle: String? = null,
    icon: ImageVector? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.padding(horizontal = 24.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.vettaExtra.secondaryText,
                modifier = Modifier.size(36.dp),
            )
            Spacer(Modifier.height(12.dp))
        }
        Text(title, style = MaterialTheme.typography.titleMedium)
        if (!subtitle.isNullOrBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(
                subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(16.dp))
            SecondaryOutlineButton(
                text = actionLabel,
                onClick = onAction,
                modifier = Modifier.widthIn(max = 220.dp),
            )
        }
    }
}

private fun formatQuota(value: Double): String =
    if (value >= 100) {
        value.toInt().toString()
    } else {
        ((value * 10).toInt() / 10.0).toString()
    }
