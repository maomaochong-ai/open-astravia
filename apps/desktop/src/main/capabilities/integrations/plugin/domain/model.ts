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

const OWNED_PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function ownedProviderId(pluginId: string, localProviderId: string): string {
	if (!OWNED_PROVIDER_ID_PATTERN.test(localProviderId)) {
		throw new Error("Plugin-owned model provider id must be 1-32 lowercase slug characters");
	}
	return `${pluginId}.${localProviderId}`;
}

export const pluginModelMethods = {
	upsertOwnedModelProvider(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		providerId: string,
		data: unknown,
	): Promise<ModelProviderConfigSnapshot> {
		const session = this.session(sessionId, { permission: "models.manage" });
		const input = DOMAIN_MODEL_CAPABILITIES.UPSERT_PROVIDER.parseInput({
			provider: ownedProviderId(session.pluginId, providerId),
			data,
		});
		return session.access.client.invoke(DOMAIN_MODEL_CAPABILITIES.UPSERT_PROVIDER, input);
	},

	removeOwnedModelProvider(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		providerId: string,
	): Promise<undefined> {
		const session = this.session(sessionId, { permission: "models.manage" });
		return session.access.client.invoke(DOMAIN_MODEL_CAPABILITIES.REMOVE_PROVIDER, {
			provider: ownedProviderId(session.pluginId, providerId),
		});
	},

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
