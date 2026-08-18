/**
 * Public webhook types — non-sensitive fields safe to send to the renderer.
 *
 * Sensitive fields (webhookUrl, signSecret) live in credential-store.ts; this
 * file only declares what the renderer is allowed to see.
 */

export type WebhookKind = "feishu" | "dingtalk";

export const WEBHOOK_KINDS: readonly WebhookKind[] = ["feishu", "dingtalk"] as const;

export interface WebhookEndpointPublic {
	id: string;
	kind: WebhookKind;
	name: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	/** Masked URL for display — never the raw URL. */
	urlMask?: string;
	/** True if a sign secret is stored. UI displays a hint without exposing the value. */
	hasSignSecret?: boolean;
	feishu?: {
		mentionAll?: boolean;
	};
	dingtalk?: {
		mentionAll?: boolean;
		atMobiles?: string[];
		/** Keyword required by DingTalk custom robot's keyword check; prepended to text. */
		keyword?: string;
	};
}

export interface WebhookEndpointSecret {
	webhookUrl: string;
	signSecret?: string;
}

/**
 * Generic message contract. Providers map this to their native schema.
 *
 * `text` is markdown. Each provider decides whether to render it as a card,
 * a markdown message, or fall back to plain text.
 */
export interface WebhookMessage {
	title?: string;
	text: string;
	level?: "info" | "warn" | "error" | "success";
}

export interface WebhookSendResult {
	ok: boolean;
	error?: string;
}

export interface WebhookDispatchResult extends WebhookSendResult {
	id: string;
	kind: WebhookKind;
	name: string;
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
	/** Pass empty string to clear; pass undefined to leave unchanged. */
	signSecret?: string;
	feishu?: WebhookEndpointPublic["feishu"];
	dingtalk?: WebhookEndpointPublic["dingtalk"];
}
