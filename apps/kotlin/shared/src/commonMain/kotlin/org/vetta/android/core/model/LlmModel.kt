package org.vetta.android.core.model

/**
 * 来自 `/providers/go-models.json` 的模型条目。
 *
 * [id] 在 Vetta Go 网关模式下是路由 key（客户端请求 body.model 必须用它），
 * [modelId] 是上游真实模型名。
 */
data class LlmModel(
    val id: String,
    val modelId: String,
    val name: String,
    val providerName: String,
    val api: String? = null,
    val baseUrl: String? = null,
    val reasoning: Boolean = false,
    val input: List<String> = emptyList(),
    val contextWindow: Long? = null,
    val maxTokens: Long? = null,
    val multiplier: Double? = null,
    val tags: List<String> = emptyList(),
    val reasoningLevels: List<String> = emptyList(),
    val defaultReasoningLevel: String? = null,
)

data class ModelsCatalog(
    val providers: Map<String, ProviderModels> = emptyMap(),
) {
    fun allModels(): List<LlmModel> =
        providers.values.flatMap { it.models }

    fun goModels(): List<LlmModel> =
        providers["vetta-go"]?.models.orEmpty()
}

data class ProviderModels(
    val name: String,
    val api: String? = null,
    val baseUrl: String? = null,
    val models: List<LlmModel> = emptyList(),
)
