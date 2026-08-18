package org.vetta.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.vetta.android.domain.error.UiError
import org.vetta.android.domain.error.UiErrorAction
import org.vetta.android.ui.i18n.Str

@Composable
fun VettaErrorBanner(
    error: UiError,
    onDismiss: (() -> Unit)? = null,
    onAction: ((UiErrorAction) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors =
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.errorContainer,
                contentColor = MaterialTheme.colorScheme.onErrorContainer,
            ),
        shape = RoundedCornerShape(12.dp),
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
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
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
            OutlinedButton(onClick = onAction) { Text(actionLabel) }
        }
    }
}

private fun formatQuota(value: Double): String =
    if (value >= 100) {
        value.toInt().toString()
    } else {
        ((value * 10).toInt() / 10.0).toString()
    }
