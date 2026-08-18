import type {
	WebhookEndpointPublic,
	WebhookEndpointSecret,
	WebhookKind,
	WebhookMessage,
	WebhookSendResult,
} from "../types.js";
import { dingtalkProvider } from "./dingtalk.js";
import { feishuProvider } from "./feishu.js";

/**
 * Contract every webhook provider must implement. Adding a new channel
 * (WeCom, Slack, Discord, ...) only requires writing a provider file and
 * registering it here — the manager, IPC, storage and UI list logic stay
 * untouched.
 */
export interface WebhookProvider {
	kind: WebhookKind;
	displayName: string;
	iconClass?: string;
	validateUrl(url: string): string | null;
	send(pub: WebhookEndpointPublic, sec: WebhookEndpointSecret, message: WebhookMessage): Promise<WebhookSendResult>;
}

export const WEBHOOK_PROVIDERS: Record<WebhookKind, WebhookProvider> = {
	feishu: feishuProvider,
	dingtalk: dingtalkProvider,
};

export function getProvider(kind: WebhookKind): WebhookProvider {
	const provider = WEBHOOK_PROVIDERS[kind];
	if (!provider) throw new Error(`unknown webhook kind: ${kind}`);
	return provider;
}

export interface WebhookProviderDescriptor {
	kind: WebhookKind;
	displayName: string;
	iconClass?: string;
}

export function listProviderDescriptors(): WebhookProviderDescriptor[] {
	return Object.values(WEBHOOK_PROVIDERS).map((p) => ({
		kind: p.kind,
		displayName: p.displayName,
		...(p.iconClass ? { iconClass: p.iconClass } : {}),
	}));
}
