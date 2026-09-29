package org.vetta.android.ui.work

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteSkillOption
import org.vetta.android.domain.work.SkillCatalog
import org.vetta.android.domain.work.SkillReference
import org.vetta.android.domain.work.matching
import org.vetta.android.resources.Res
import org.vetta.android.resources.skills_empty
import org.vetta.android.resources.skills_failed
import org.vetta.android.resources.skills_loading
import org.vetta.android.resources.skills_remove
import org.vetta.android.resources.skills_retry
import org.vetta.android.resources.skills_scene
import org.vetta.android.resources.skills_search
import org.vetta.android.resources.skills_title
import org.vetta.android.ui.theme.vettaExtra

/**
 * What the composer needs to reference the desktop's skills (ADR-0137): the list for the
 * prompt's project, a way to refresh it (each time the picker opens), and the desktop's
 * name for a picked skill.
 */
class ComposerSkills(
    val catalog: SkillCatalog,
    val onLoad: () -> Unit,
    val displayName: (SkillReference) -> String = { it.name },
)

/**
 * The desktop's skills and scenes to reference, in the desktop composer's order, with a
 * search over name and description. The list refreshes each time the sheet opens; the
 * last one stays meanwhile.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SkillSheet(skills: ComposerSkills, picked: List<SkillReference>, onPick: (SkillReference) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { skills.onLoad() }
    val catalog = skills.catalog
    val shown = catalog.options.orEmpty().matching(query)
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 12.dp).testTag("skills.sheet")) {
            Text(stringResource(Res.string.skills_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                placeholder = { Text(stringResource(Res.string.skills_search)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("skills.search"),
            )
            when {
                catalog.options == null && catalog.loading -> Status { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp); Text(stringResource(Res.string.skills_loading)) }
                catalog.options == null && catalog.failed ->
                    Status {
                        Text(stringResource(Res.string.skills_failed))
                        TextButton(onClick = skills.onLoad, modifier = Modifier.testTag("skills.retry")) { Text(stringResource(Res.string.skills_retry)) }
                    }
                shown.isEmpty() -> Status { Text(stringResource(Res.string.skills_empty)) }
                else ->
                    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp).padding(top = 8.dp)) {
                        items(shown, key = { it.id }) { option ->
                            val reference = SkillReference(option.kind, option.name)
                            SkillRow(option, chosen = reference in picked) {
                                onPick(reference)
                                onDismiss()
                            }
                        }
                    }
            }
        }
    }
}

@Composable
private fun Status(content: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) { content() }
}

@Composable
private fun SkillRow(option: RemoteSkillOption, chosen: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .background(if (chosen) MaterialTheme.workColors.card2 else MaterialTheme.colorScheme.surface.copy(alpha = 0f))
            .padding(horizontal = 8.dp, vertical = 10.dp)
            .testTag("skills.option.${option.id}"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Filled.AutoAwesome, contentDescription = null, modifier = Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(option.displayName, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (option.kind == RemoteSkillOption.Kind.Scene) {
                    Text(
                        stringResource(Res.string.skills_scene),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(MaterialTheme.workColors.card2).padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
            if (option.description.isNotBlank()) {
                Text(option.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** The skills a draft references, as chips above the field; each can be taken off. */
@Composable
fun SkillChips(skills: List<SkillReference>, name: (SkillReference) -> String, onRemove: (String) -> Unit) {
    LazyRow(Modifier.fillMaxWidth().padding(bottom = 8.dp).testTag("composer.skills"), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(skills, key = { it.id }) { skill ->
            val label = name(skill)
            val remove = stringResource(Res.string.skills_remove, label)
            Row(
                Modifier.clip(RoundedCornerShape(50)).background(MaterialTheme.workColors.card2).padding(start = 10.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(Icons.Filled.AutoAwesome, contentDescription = null, modifier = Modifier.size(14.dp))
                Text(label, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 160.dp))
                Box(
                    Modifier
                        .size(24.dp)
                        .clip(RoundedCornerShape(50))
                        .clickable { onRemove(skill.id) }
                        .semantics { contentDescription = remove }
                        .testTag("composer.skill.remove.${skill.id}"),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.Close, contentDescription = null, modifier = Modifier.size(14.dp)) }
            }
        }
    }
}

/** A referenced skill inside a message bubble. */
@Composable
fun SkillBadge(label: String) {
    Row(
        Modifier.clip(RoundedCornerShape(50)).background(MaterialTheme.workColors.card2).padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(Icons.Filled.AutoAwesome, contentDescription = null, modifier = Modifier.size(14.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
