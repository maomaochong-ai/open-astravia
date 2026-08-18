import {
	DOMAIN_WEBHOOK_CAPABILITIES,
	type WebhookEndpoint,
	type WebhookProviderDescriptor,
	type WebhookSendResult,
} from "@vetta/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginWebhookMethods = {
	listWebhookEndpoints(this: PluginCapabilitySessionAccess, sessionId: string): Promise<WebhookEndpoint[]> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_WEBHOOK_CAPABILITIES.LIST_ENDPOINTS, {});
	},

	listWebhookProviders(this: PluginCapabilitySessionAccess, sessionId: string): Promise<WebhookProviderDescriptor[]> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_WEBHOOK_CAPABILITIES.LIST_PROVIDERS, {});
	},

	createWebhookEndpoint(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		data: unknown,
	): Promise<WebhookEndpoint> {
		const input = DOMAIN_WEBHOOK_CAPABILITIES.CREATE_ENDPOINT.parseInput({ data });
		return this.client(sessionId, { official: true }).invoke(DOMAIN_WEBHOOK_CAPABILITIES.CREATE_ENDPOINT, input);
	},

	updateWebhookEndpoint(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		id: string,
		data: unknown,
	): Promise<WebhookEndpoint> {
		const input = DOMAIN_WEBHOOK_CAPABILITIES.UPDATE_ENDPOINT.parseInput({ id, data });
		return this.client(sessionId, { official: true }).invoke(DOMAIN_WEBHOOK_CAPABILITIES.UPDATE_ENDPOINT, input);
	},

	deleteWebhookEndpoint(this: PluginCapabilitySessionAccess, sessionId: string, id: string): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_WEBHOOK_CAPABILITIES.DELETE_ENDPOINT, { id });
	},

	setWebhookEndpointEnabled(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		id: string,
		enabled: boolean,
	): Promise<WebhookEndpoint> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_WEBHOOK_CAPABILITIES.SET_ENABLED, {
			id,
			enabled,
		});
	},

	testWebhookEndpoint(this: PluginCapabilitySessionAccess, sessionId: string, id: string): Promise<WebhookSendResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_WEBHOOK_CAPABILITIES.TEST_ENDPOINT, { id });
	},

	sendWebhookMessage(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		id: string,
		message: unknown,
	): Promise<WebhookSendResult> {
		const input = DOMAIN_WEBHOOK_CAPABILITIES.SEND_MESSAGE.parseInput({ id, message });
		return this.client(sessionId, { official: true }).invoke(DOMAIN_WEBHOOK_CAPABILITIES.SEND_MESSAGE, input);
	},
};

export type PluginWebhookMethods = typeof pluginWebhookMethods;
