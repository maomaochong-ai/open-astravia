import { createHmac } from "node:crypto";
import type { WebhookEndpointPublic, WebhookEndpointSecret, WebhookMessage, WebhookSendResult } from "../types.js";
import type { WebhookProvider } from "./registry.js";

const FEISHU_HOOK_PREFIX = "https://open.feishu.cn/open-apis/bot/v2/hook/";
const FEISHU_HOOK_PREFIX_HTTP = "http://open.feishu.cn/open-apis/bot/v2/hook/";
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Feishu HMAC-SHA256 sign per
 * https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot#348211d2
 *
 * Note: key = `timestamp + "\n" + secret`, data = empty. The library expects
 * this peculiar order — using secret as the HMAC key fails verification.
 */
function feishuSign(timestamp: number, secret: string): string {
	const stringToSign = `${timestamp}\n${secret}`;
	return createHmac("sha256", stringToSign).update("").digest("base64");
}

/** Render a level marker emoji (Feishu cards don't have a "level" concept). */
function levelTag(level: WebhookMessage["level"]): string {
	switch (level) {
		case "success":
			return "✅ ";
		case "warn":
			return "⚠️ ";
		case "error":
			return "❌ ";
		default:
			return "";
	}
}

function levelTemplate(level: WebhookMessage["level"]): string {
	switch (level) {
		case "success":
			return "green";
		case "warn":
			return "orange";
		case "error":
			return "red";
		default:
			return "blue";
	}
}

/**
 * Build an interactive card payload so markdown renders properly. Feishu's
 * `msg_type:"text"` is plain text only; the card schema supports markdown
 * (`lark_md`) and gets us bold/italic/link rendering for free.
 */
function buildCardPayload(message: WebhookMessage, mentionAll: boolean): Record<string, unknown> {
	const title = (message.title ?? "").trim();
	const headerTitle = title ? `${levelTag(message.level)}${title}` : `${levelTag(message.level)}消息推送`;

	const text = mentionAll ? `<at id=all></at>\n${message.text}` : message.text;

	return {
		msg_type: "interactive",
		card: {
			config: { wide_screen_mode: true },
			header: {
				template: levelTemplate(message.level),
				title: { tag: "plain_text", content: headerTitle },
			},
			elements: [
				{
					tag: "markdown",
					content: text,
				},
			],
		},
	};
}

function validateFeishuUrl(url: string): string | null {
	const trimmed = url.trim();
	if (!trimmed) return "Webhook URL cannot be empty";
	if (!/^https:\/\//i.test(trimmed)) return "Webhook URL must start with https://";
	if (!trimmed.toLowerCase().startsWith(FEISHU_HOOK_PREFIX)) {
		if (trimmed.toLowerCase().startsWith(FEISHU_HOOK_PREFIX_HTTP)) {
			return "Please use the https:// protocol";
		}
		return "Feishu webhook URL must start with https://open.feishu.cn/open-apis/bot/v2/hook/";
	}
	const token = trimmed.slice(FEISHU_HOOK_PREFIX.length);
	if (!token || token.length < 8) return "URL token is missing or too short";
	return null;
}

async function sendFeishu(
	pub: WebhookEndpointPublic,
	sec: WebhookEndpointSecret,
	message: WebhookMessage,
): Promise<WebhookSendResult> {
	const urlError = validateFeishuUrl(sec.webhookUrl);
	if (urlError) return { ok: false, error: urlError };

	const mentionAll = Boolean(pub.feishu?.mentionAll);
	const payload = buildCardPayload(message, mentionAll);

	if (sec.signSecret) {
		const timestamp = Math.floor(Date.now() / 1000);
		(payload as Record<string, unknown>).timestamp = String(timestamp);
		(payload as Record<string, unknown>).sign = feishuSign(timestamp, sec.signSecret);
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(sec.webhookUrl, {
			method: "POST",
			signal: controller.signal,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			return { ok: false, error: `HTTP ${response.status} ${response.statusText}` };
		}
		const body = (await response.json().catch(() => null)) as {
			code?: number;
			StatusCode?: number;
			msg?: string;
			StatusMessage?: string;
		} | null;
		if (!body) return { ok: false, error: "Response parse failed" };
		const code = body.code ?? body.StatusCode;
		if (code === 0) return { ok: true };
		return { ok: false, error: body.msg ?? body.StatusMessage ?? `Feishu returned code=${code}` };
	} catch (err) {
		if ((err as Error).name === "AbortError") return { ok: false, error: "Request timeout (30s)" };
		return { ok: false, error: (err as Error).message };
	} finally {
		clearTimeout(timer);
	}
}

export const feishuProvider: WebhookProvider = {
	kind: "feishu",
	displayName: "Feishu",
	validateUrl: validateFeishuUrl,
	send: sendFeishu,
};
