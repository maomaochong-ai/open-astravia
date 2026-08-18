import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";

/**
 * Non-secret IM bridge configuration. Stored in plaintext under
 *   ~/.vetta/desktop-app/im-config.json
 *
 * Sensitive fields (App Secret, Verification Token, Encrypt Key) live in
 * credential-store.ts; this file only carries the toggles and identifiers
 * the user is willing to expose to the filesystem in plaintext.
 *
 * `transport` selects which IM platform the sidecar will run. Only one
 * transport runs at a time. Switching it persists the new value but does
 * not erase the other transport's credentials, so the user can flip
 * between feishu and wechat without re-binding.
 */
export type ImTransportSelector = "feishu" | "wechat";

/**
 * Optional override telling coding-agent which model to use for IM
 * sessions. When undefined, IM sessions fall back to whatever model the
 * user's agent settings (`~/.vetta/agent/settings.json`) point at — same
 * behaviour as the desktop "对话" page. When set, the spec is forwarded
 * to the spawned agent-rpc subprocess via `--model <provider>:<model>`
 * (or just `<model>` if provider is omitted).
 *
 * Scope decision: one model for ALL IM channels (feishu + wechat). Each
 * channel gets its own card, but the model picker lives at the page
 * top because we don't have a real need yet for per-channel routing.
 */
export interface ImAgentModelRef {
	provider: string;
	model: string;
	/** 推理档位；未设置时按模型 api 预设/默认档。"off" 关闭思考。 */
	reasoningLevel?: string;
}

export interface ImConfig {
	enabled: boolean;
	transport: ImTransportSelector;
	feishu: {
		appId: string;
		baseUrl?: string;
	};
	wechat: {
		// `bound` mirrors the on-disk wechat.json existence — kept here so
		// the renderer can show a quick status without a separate IPC call.
		// Source of truth is still the sidecar's state file; this is just a
		// convenience cache, refreshed on every successful bind / logout.
		bound: boolean;
		ilinkBotId?: string;
		ilinkUserId?: string;
	};
	transportMode: "long-connection";
	agentModel?: ImAgentModelRef;
}

const DEFAULT_PATH = join(getVettaHomePath(), "desktop-app", "im-config.json");

export function defaultImConfigPath(): string {
	return DEFAULT_PATH;
}

export function defaultImConfig(): ImConfig {
	return {
		enabled: false,
		transport: "feishu",
		feishu: { appId: "" },
		wechat: { bound: false },
		transportMode: "long-connection",
	};
}

export function loadImConfig(filePath = DEFAULT_PATH): ImConfig {
	if (!existsSync(filePath)) return defaultImConfig();
	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<ImConfig>;
		const transport: ImTransportSelector = parsed.transport === "wechat" ? "wechat" : "feishu";
		return {
			enabled: Boolean(parsed.enabled),
			transport,
			feishu: {
				appId: parsed.feishu?.appId ?? "",
				baseUrl: parsed.feishu?.baseUrl,
			},
			wechat: {
				bound: Boolean(parsed.wechat?.bound),
				ilinkBotId: parsed.wechat?.ilinkBotId,
				ilinkUserId: parsed.wechat?.ilinkUserId,
			},
			transportMode: "long-connection",
			agentModel:
				parsed.agentModel &&
				typeof parsed.agentModel.provider === "string" &&
				typeof parsed.agentModel.model === "string" &&
				parsed.agentModel.model.trim() !== ""
					? { provider: parsed.agentModel.provider, model: parsed.agentModel.model }
					: undefined,
		};
	} catch {
		return defaultImConfig();
	}
}

export function saveImConfig(config: ImConfig, filePath = DEFAULT_PATH): void {
	atomicWriteJSON(filePath, config);
}

/**
 * Default absolute path the sidecar uses for the wechat credentials JSON.
 * Lives next to im-config.json so all desktop-app vetta state is in one
 * directory and survives reinstalls in the usual place.
 */
export function defaultWechatStatePath(): string {
	return join(getVettaHomePath(), "desktop-app", "im-wechat.json");
}
