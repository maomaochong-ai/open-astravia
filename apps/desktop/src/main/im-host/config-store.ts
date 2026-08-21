import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import { type ImTransportSelector, isImTransportSelector } from "./channels.js";

/**
 * Non-secret IM bridge configuration. Stored in plaintext under
 *   ~/.vetta/desktop-app/im-config.json
 *
 * Sensitive fields (App Secret, Verification Token, Encrypt Key, bot
 * tokens) live in credential-store.ts; this file only carries the toggles
 * and identifiers the user is willing to expose to the filesystem in
 * plaintext.
 *
 * `transport` selects which IM platform the sidecar will run. Only one
 * transport runs at a time. Switching it persists the new value but does
 * not erase the other transports' credentials, so the user can flip
 * between channels without re-entering tokens or re-binding.
 */
export type { ImTransportSelector };

/**
 * Optional override telling coding-agent which model to use for IM
 * sessions. When undefined, IM sessions fall back to whatever model the
 * user's agent settings (`~/.vetta/agent/settings.json`) point at — same
 * behaviour as the desktop "对话" page. When set, the spec is forwarded
 * to the spawned agent-rpc subprocess via `--model <provider>:<model>`
 * (or just `<model>` if provider is omitted).
 *
 * Scope decision: one model for ALL IM channels. Each channel gets its
 * own card, but the model picker lives at the page top because we don't
 * have a real need yet for per-channel routing.
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
	telegram: {
		allowedUserIds?: number[];
	};
	slack: {
		allowedUserIds?: string[];
		allowedChannelIds?: string[];
	};
	discord: {
		allowedUserIds?: string[];
		allowedGuildIds?: string[];
	};
	signal: {
		// Nothing secret lives here — signal-cli owns the Signal
		// credentials either way.
		//
		// Managed mode (the default): every field below is empty and the
		// sidecar finds signal-cli, links the device via QR, and runs the
		// daemon itself. `bound` caches "a device is linked" so the
		// renderer can show it without waiting for the sidecar.
		bound: boolean;
		// Advanced escape hatch: point at a daemon the user runs
		// themselves. Setting `endpoint` switches off managed mode, and
		// then `account` is required.
		endpoint?: string;
		account?: string;
		// Explicit signal-cli executable, for installs outside PATH and
		// the well-known package-manager locations.
		cliPath?: string;
		allowedNumbers?: string[];
		attachmentsDir?: string;
	};
	whatsapp: {
		// Same convenience-cache semantics as `wechat.bound`.
		bound: boolean;
		allowedNumbers?: string[];
	};
	imessage: {
		dbPath?: string;
		allowedHandles?: string[];
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
		telegram: {},
		slack: {},
		discord: {},
		signal: { bound: false },
		whatsapp: { bound: false },
		imessage: {},
		transportMode: "long-connection",
	};
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const filtered = value.filter((v): v is string => typeof v === "string");
	return filtered.length > 0 ? filtered : undefined;
}

function optionalNumberArray(value: unknown): number[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const filtered = value.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
	return filtered.length > 0 ? filtered : undefined;
}

export function loadImConfig(filePath = DEFAULT_PATH): ImConfig {
	if (!existsSync(filePath)) return defaultImConfig();
	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<ImConfig>;
		// Unknown / legacy transport values fall back to feishu.
		const transport: ImTransportSelector = isImTransportSelector(parsed.transport) ? parsed.transport : "feishu";
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
			telegram: {
				allowedUserIds: optionalNumberArray(parsed.telegram?.allowedUserIds),
			},
			slack: {
				allowedUserIds: optionalStringArray(parsed.slack?.allowedUserIds),
				allowedChannelIds: optionalStringArray(parsed.slack?.allowedChannelIds),
			},
			discord: {
				allowedUserIds: optionalStringArray(parsed.discord?.allowedUserIds),
				allowedGuildIds: optionalStringArray(parsed.discord?.allowedGuildIds),
			},
			signal: {
				bound: parsed.signal?.bound === true,
				endpoint: optionalString(parsed.signal?.endpoint),
				account: optionalString(parsed.signal?.account),
				cliPath: optionalString(parsed.signal?.cliPath),
				allowedNumbers: optionalStringArray(parsed.signal?.allowedNumbers),
				attachmentsDir: optionalString(parsed.signal?.attachmentsDir),
			},
			whatsapp: {
				bound: Boolean(parsed.whatsapp?.bound),
				allowedNumbers: optionalStringArray(parsed.whatsapp?.allowedNumbers),
			},
			imessage: {
				dbPath: optionalString(parsed.imessage?.dbPath),
				allowedHandles: optionalStringArray(parsed.imessage?.allowedHandles),
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

/**
 * Default absolute path for the whatsapp session store (a sqlite database
 * owned by whatsmeow inside the sidecar). Same placement rationale as
 * defaultWechatStatePath().
 */
export function defaultWhatsappStatePath(): string {
	return join(getVettaHomePath(), "desktop-app", "im-whatsapp.db");
}

/**
 * Default `--config` directory handed to signal-cli in managed mode.
 *
 * Deliberately NOT signal-cli's own default (~/.local/share/signal-cli):
 * keeping Vetta's linked device in a directory we own means unbinding here
 * can clear it without touching a signal-cli install the user set up for
 * their own purposes.
 */
export function defaultSignalConfigDir(): string {
	return join(getVettaHomePath(), "desktop-app", "im-signal-cli");
}
