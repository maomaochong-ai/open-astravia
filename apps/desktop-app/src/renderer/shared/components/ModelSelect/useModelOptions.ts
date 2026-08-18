import type { ModelsConfigData } from "@preload/api";
import { remoteProvidersAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";

export interface ModelOption {
	provider: string;
	modelId: string;
	displayName: string;
	/** "provider/modelId" */
	key: string;
	/** Whether this model comes from the remote server */
	remote?: boolean;
	/** Tags from server config */
	tags?: string[];
	/** Whether this model supports image input */
	supportsImage?: boolean;
	/** API type ("openai-completions" / "openai-responses" / ...), for reasoning preset fallback */
	api?: string;
	/** Whether the model is reasoning-capable */
	reasoning?: boolean;
	/** Configured reasoning levels; empty/undefined falls back to the api-type preset */
	reasoningLevels?: string[];
	/** Default reasoning level when the user has not chosen one */
	defaultReasoningLevel?: string;
	/** Per-model billing multipliers relative to the credit base (undefined for local BYOK) */
	multiplier?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

function flattenModels(config: ModelsConfigData, remote?: boolean): ModelOption[] {
	const result: ModelOption[] = [];
	for (const [provider, providerConfig] of Object.entries(config.providers)) {
		for (const model of providerConfig.models ?? []) {
			const raw = model as Record<string, unknown>;
			result.push({
				provider,
				modelId: model.id,
				displayName: model.name || model.id,
				key: `${provider}/${model.id}`,
				remote,
				tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : undefined,
				supportsImage: model.input?.includes("image") ?? false,
				api: model.api ?? providerConfig.api,
				reasoning: model.reasoning,
				reasoningLevels: model.reasoningLevels,
				defaultReasoningLevel: model.defaultReasoningLevel,
				multiplier: (raw.multiplier as ModelOption["multiplier"]) ?? undefined,
			});
		}
	}
	return result;
}

export interface UseModelOptionsResult {
	/** Merged local + remote options (local wins on duplicate key) */
	options: ModelOption[];
	/** Options grouped by provider, in insertion order */
	grouped: Map<string, ModelOption[]>;
	/** Configured default model key, if any */
	defaultKey: string | undefined;
	/** Resolve a provider's icon symbol (local config / remote provider) */
	iconFor: (provider: string) => string | undefined;
	/** Resolve a provider's display label for group headers */
	labelFor: (provider: string) => string;
}

/**
 * Shared loader for the model picker: reads local models.json + remote provider
 * catalog, merges them (local overrides remote on duplicate key) and exposes
 * grouping + provider label/icon helpers. Used by every model selector so the
 * option list and provider metadata stay consistent across the app.
 */
export function useModelOptions(): UseModelOptionsResult {
	const remoteProviders = useAtomValue(remoteProvidersAtom);
	const [config, setConfig] = useState<ModelsConfigData | null>(null);

	useEffect(() => {
		void window.vetta.models.get().then(setConfig);
	}, []);

	const localModels = useMemo(() => (config ? flattenModels(config) : []), [config]);
	const remoteModels = useMemo(
		() =>
			Object.keys(remoteProviders).length > 0
				? flattenModels({ providers: remoteProviders as ModelsConfigData["providers"] }, true)
				: [],
		[remoteProviders],
	);

	const options = useMemo(() => {
		const localKeys = new Set(localModels.map((m) => m.key));
		return [...localModels, ...remoteModels.filter((m) => !localKeys.has(m.key))];
	}, [localModels, remoteModels]);

	const grouped = useMemo(() => {
		const groups = new Map<string, ModelOption[]>();
		for (const m of options) {
			const list = groups.get(m.provider) ?? [];
			list.push(m);
			groups.set(m.provider, list);
		}
		return groups;
	}, [options]);

	const iconFor = (provider: string): string | undefined => {
		const local = config?.providers[provider] as { icon?: string } | undefined;
		const remote = (remoteProviders as Record<string, { icon?: string }>)[provider];
		return local?.icon ?? remote?.icon;
	};

	const labelFor = (provider: string): string => {
		const local = config?.providers[provider] as { displayName?: string } | undefined;
		const remote = (remoteProviders as Record<string, { displayName?: string }>)[provider];
		if (local?.displayName) return local.displayName;
		if (remote?.displayName) return remote.displayName;
		if (provider === "vetta-go") return "Vetta Go";
		return provider;
	};

	return { options, grouped, defaultKey: config?.defaultModel, iconFor, labelFor };
}
