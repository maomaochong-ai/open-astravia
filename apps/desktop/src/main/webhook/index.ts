import { WebhookManager } from "./manager.js";

let instance: WebhookManager | undefined;

export function getWebhookManager(): WebhookManager {
	if (!instance) instance = new WebhookManager();
	return instance;
}

export function disposeWebhookManager(): void {
	instance = undefined;
}

export type { WebhookProviderDescriptor } from "./providers/registry.js";
export type {
	WebhookCreateInput,
	WebhookDispatchResult,
	WebhookEndpointPublic,
	WebhookKind,
	WebhookMessage,
	WebhookSendResult,
	WebhookUpdatePatch,
} from "./types.js";
export { WEBHOOK_KINDS } from "./types.js";
