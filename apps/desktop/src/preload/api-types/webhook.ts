// =============================================================================
// Webhook
// =============================================================================

export type WebhookKind = "feishu" | "dingtalk";

export interface WebhookEndpointPublic {
	id: string;
	kind: WebhookKind;
	name: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	urlMask?: string;
	hasSignSecret?: boolean;
	feishu?: { mentionAll?: boolean };
	dingtalk?: { mentionAll?: boolean; atMobiles?: string[]; keyword?: string };
}

export interface WebhookProviderDescriptor {
	kind: WebhookKind;
	displayName: string;
	iconClass?: string;
}

export interface WebhookCreateInput {
	kind: WebhookKind;
	name: string;
	webhookUrl: string;
	signSecret?: string;
	enabled?: boolean;
	feishu?: WebhookEndpointPublic["feishu"];
	dingtalk?: WebhookEndpointPublic["dingtalk"];
}

export interface WebhookUpdatePatch {
	name?: string;
	enabled?: boolean;
	webhookUrl?: string;
	signSecret?: string;
	feishu?: WebhookEndpointPublic["feishu"];
	dingtalk?: WebhookEndpointPublic["dingtalk"];
}

export interface WebhookMessage {
	title?: string;
	text: string;
	level?: "info" | "warn" | "error" | "success";
}

export interface WebhookSendResult {
	ok: boolean;
	error?: string;
}

export interface WebhookMutationResult {
	ok: boolean;
	endpoint?: WebhookEndpointPublic;
	error?: string;
}

export interface DesktopWebhookApi {
	list(): Promise<WebhookEndpointPublic[]>;
	listProviders(): Promise<WebhookProviderDescriptor[]>;
	create(input: WebhookCreateInput): Promise<WebhookMutationResult>;
	update(id: string, patch: WebhookUpdatePatch): Promise<WebhookMutationResult>;
	delete(id: string): Promise<{ ok: boolean }>;
	toggle(id: string, enabled: boolean): Promise<WebhookMutationResult>;
	test(id: string): Promise<WebhookSendResult>;
	send(id: string, message: WebhookMessage): Promise<WebhookSendResult>;
}
