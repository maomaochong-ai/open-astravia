package org.vetta.android.ui

import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.PluralStringResource
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getPluralString
import org.jetbrains.compose.resources.getString

/** The string as the device's current language shows it, for finding nodes by text. */
fun str(res: StringResource, vararg args: Any): String = runBlocking { getString(res, *args) }

/** A plural for `count`, formatted with the count itself, as the screens show it. */
fun str(res: PluralStringResource, count: Int): String = runBlocking { getPluralString(res, count, count) }
