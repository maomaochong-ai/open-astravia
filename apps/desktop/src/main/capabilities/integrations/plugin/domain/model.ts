import {
	DOMAIN_MODEL_CAPABILITIES,
	type ModelConfigSnapshot,
	type ModelDefaultResult,
	type ModelListResult,
	type ModelProbeResult,
	type ModelProviderConfigSnapshot,
	type ModelProviderDetail,
} from "@vetta/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginModelMethods = {
	listModels(this: PluginCapabilitySessionAccess, sessionId: string): Promise<ModelListResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_MODEL_CAPABILITIES.LIST, {});
	},

	getModelConfig(this: PluginCapabilitySessionAccess, sessionId: string): Promise<ModelConfigSnapshot> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_MODEL_CAPABILITIES.GET_CONFIG, {});
	},

	getModelProvider(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		provider: string,
	): Promise<ModelProviderDetail> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_MODEL_CAPABILITIES.GET_PROVIDER, { provider });
	},

	probeModel(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		provider: string,
		model: string,
	): Promise<ModelProbeResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_MODEL_CAPABILITIES.PROBE, {
			provider,
			model,
		});
	},

	validateModelKey(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		modelKey: string,
		operation?: string,
	): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_MODEL_CAPABILITIES.VALIDATE_KEY, {
			modelKey,
			...(operation === undefined ? {} : { operation }),
		});
	},

	setDefaultModel(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		modelKey: string,
	): Promise<ModelDefaultResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_MODEL_CAPABILITIES.SET_DEFAULT, { modelKey });
	},

	upsertModelProvider(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		provider: string,
		data: unknown,
	): Promise<ModelProviderConfigSnapshot> {
		const input = DOMAIN_MODEL_CAPABILITIES.UPSERT_PROVIDER.parseInput({
			provider,
			data,
		});
		return this.client(sessionId, { official: true }).invoke(DOMAIN_MODEL_CAPABILITIES.UPSERT_PROVIDER, input);
	},

	removeModelProvider(this: PluginCapabilitySessionAccess, sessionId: string, provider: string): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_MODEL_CAPABILITIES.REMOVE_PROVIDER, {
			provider,
		});
	},
};

export type PluginModelMethods = typeof pluginModelMethods;
