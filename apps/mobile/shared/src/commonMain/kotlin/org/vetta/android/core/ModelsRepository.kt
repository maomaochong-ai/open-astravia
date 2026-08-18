package org.vetta.android.core

import org.vetta.android.core.api.VettaApi
import org.vetta.android.core.model.LlmModel
import org.vetta.android.core.model.ModelsCatalog

class ModelsRepository internal constructor(
    private val api: VettaApi,
) {
    suspend fun fetchGoModelsCatalog(): ModelsCatalog = api.goModels()

    suspend fun listGoModels(): List<LlmModel> = api.goModels().goModels()

    suspend fun listAllModels(): List<LlmModel> = api.goModels().allModels()
}
