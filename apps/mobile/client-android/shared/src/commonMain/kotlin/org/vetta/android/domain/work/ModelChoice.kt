package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteModelOption

/** A provider's models, in the order the desktop lists them. */
data class ModelGroup(val provider: String, val models: List<RemoteModelOption>)

/**
 * The model and thinking level picked in the model sheet, which New Session
 * and the chat title share. `null` model is the desktop's default; `null` level
 * leaves the model's own.
 */
data class ModelChoice(
    val modelKey: String? = null,
    val thinkingLevel: String? = null,
) {
    /**
     * Levels the chosen model offers. None for the desktop's default: the phone
     * does not know which model that is.
     */
    fun levels(options: List<RemoteModelOption>): List<String> {
        val key = modelKey ?: return emptyList()
        return options.firstOrNull { it.key == key }?.thinkingLevels.orEmpty()
    }

    /** Switches model, keeping the level only where the new model offers it. */
    fun picking(modelKey: String?, options: List<RemoteModelOption>): ModelChoice {
        val next = copy(modelKey = modelKey)
        return if (thinkingLevel != null && thinkingLevel !in next.levels(options)) next.copy(thinkingLevel = null) else next
    }

    companion object {
        /** Models by provider, providers in the order the desktop lists them. */
        fun groups(options: List<RemoteModelOption>): List<ModelGroup> =
            options.groupBy { it.provider }.map { (provider, models) -> ModelGroup(provider, models) }
    }
}
