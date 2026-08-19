import type { Model } from "@vetta/ai";
import type { CodingAgentModelRuntime } from "@vetta/coding-agent/host-services";
import { waitForSignal } from "./wait-for-signal.js";

export interface ProviderModelListDependencies {
	readonly models: Pick<CodingAgentModelRuntime, "getAvailable" | "isRemote" | "loadRemoteModels">;
}

export async function listAvailableProviderModels(
	dependencies: ProviderModelListDependencies,
	signal?: AbortSignal,
): Promise<Readonly<Record<string, unknown>>> {
	const remoteLoadStatus = await waitForSignal(dependencies.models.loadRemoteModels(), signal);
	const models = dependencies.models
		.getAvailable()
		.map((model) => projectModel(model, dependencies.models.isRemote(model)))
		.sort((left, right) => left.modelKey.localeCompare(right.modelKey));
	const remoteModelCount = models.filter((model) => model.source === "remote").length;

	return {
		status: "ready",
		remoteCatalogStatus: remoteLoadStatus === "unauthorized" ? "unauthorized" : "checked",
		modelCount: models.length,
		localModelCount: models.length - remoteModelCount,
		remoteModelCount,
		models,
	};
}

function projectModel(model: Model<string>, remote: boolean) {
	return {
		modelKey: `${model.provider}/${model.id}`,
		provider: model.provider,
		id: model.id,
		name: model.name,
		api: model.api,
		source: remote ? ("remote" as const) : ("local" as const),
		reasoning: model.reasoning,
		input: [...model.input],
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
	};
}
