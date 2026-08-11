import { Value } from "@sinclair/typebox/value";
import type { Api, Model } from "@vetta/ai";
import { type RemoteModelsResponse, RemoteModelsResponseSchema } from "../configuration/model-config-schema.js";

export interface RemoteModelLoadResult {
	readonly status: "loaded" | "unauthorized" | "unavailable";
	readonly models: readonly Model<Api>[];
	readonly modelKeys: ReadonlySet<string>;
}

export interface RemoteModelSourceOptions {
	readonly fetch?: typeof globalThis.fetch;
	readonly timeoutMs?: number;
}

export async function loadRemoteModelSource(
	serverUrl: string,
	token: string,
	options: RemoteModelSourceOptions = {},
): Promise<RemoteModelLoadResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
	try {
		const response = await (options.fetch ?? globalThis.fetch)(
			`${serverUrl.replace(/\/$/, "")}/providers/models.json`,
			{
				signal: controller.signal,
				headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
			},
		);
		if (response.status === 401) return unavailable("unauthorized");
		if (!response.ok) return unavailable("unavailable");
		const body: unknown = await response.json();
		if (!Value.Check(RemoteModelsResponseSchema, body) || body.code !== 0) return unavailable("unavailable");
		return parseRemoteModels(body);
	} catch {
		return unavailable("unavailable");
	} finally {
		clearTimeout(timeout);
	}
}

function parseRemoteModels(response: RemoteModelsResponse): RemoteModelLoadResult {
	const models: Model<Api>[] = [];
	const modelKeys = new Set<string>();
	for (const [providerName, provider] of Object.entries(response.data.providers)) {
		for (const definition of provider.models) {
			const api = definition.api || provider.api;
			if (!api) continue;
			modelKeys.add(`${providerName}/${definition.id}`);
			const raw = definition as typeof definition & { upstreamBaseUrl?: string };
			const gatewayUrl = provider.baseUrl || "";
			models.push({
				id: definition.id,
				modelId: definition.modelId ?? definition.id,
				name: definition.name || definition.id,
				api: api as Api,
				provider: providerName,
				baseUrl: raw.upstreamBaseUrl || gatewayUrl,
				gatewayUrl: raw.upstreamBaseUrl ? gatewayUrl : undefined,
				reasoning: definition.reasoning ?? false,
				input: (definition.input ?? ["text"]) as ("text" | "image")[],
				cost: definition.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: definition.contextWindow ?? 128_000,
				maxTokens: definition.maxTokens ?? 16_384,
				headers: provider.headers,
			});
		}
	}
	return { status: "loaded", models, modelKeys };
}

function unavailable(status: "unauthorized" | "unavailable"): RemoteModelLoadResult {
	return { status, models: [], modelKeys: new Set() };
}
