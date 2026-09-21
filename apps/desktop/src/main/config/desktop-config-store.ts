import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { SshHost } from "@vetta/ssh-transport";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import { isLanguagePreference, type LanguagePreference } from "../../shared/i18n/config.js";
import { normalizeShortcutsConfig, type ShortcutsConfig } from "../../shared/shortcuts.js";
import { isAgentMode } from "../agent-modes/index.js";
import { DEFAULT_PROXY_CONFIG, type DesktopProxyConfig, normalizeProxyConfig } from "../proxy/proxy-settings.js";

export interface ProjectEntry {
	path: string;
	name?: string;
}

/** 实验性功能开关分组（设置页「Agent配置 → 扩展功能」）。新增实验项只加一个键。 */
export interface ExperimentalConfig {
	/** Vetta CLI 提示词：开启后仅注入桌面端对话会话。缺省开。 */
	vettaCli?: boolean;
	/** 输入预测：每轮正常回答后预测用户下一个可能输入的 prompt。缺省关。 */
	promptPrediction?: boolean;
	/** 适配通用 Agent Skill。缺省开。 */
	agentSkills?: boolean;
}

/** Agent 图片生成 Provider 偏好；未设置时沿用内置 Provider 优先策略。 */
export interface ImageGenerationConfig {
	textToImageProviderId?: string;
	textToImageModelId?: string;
	imageToImageProviderId?: string;
	imageToImageModelId?: string;
}

export interface DesktopConfig {
	projects: ProjectEntry[];
	archivedProjects: ProjectEntry[];
	workspacePath: string;
	defaultExecutionMode: "sandbox" | "full-access";
	debugMode?: boolean;
	vettaAppPath?: string;
	vettaCliAppPath?: string;
	notificationsEnabled?: boolean;
	language?: LanguagePreference;
	/** 新建会话的默认工作模式（合法值来自 main/agent-modes 模式注册表，ADR-0071）。会话创建时固化进会话，改这里只影响之后新建的会话。 */
	defaultAgentMode?: string;
	experimental?: ExperimentalConfig;
	/** 应用代理（设置 → 通用设置 → 网络代理）。缺省不启用。 */
	proxy?: DesktopProxyConfig;
	imageGeneration?: ImageGenerationConfig;
	knowledgeBase?: KnowledgeBaseConfig;
	shortcuts?: ShortcutsConfig;
	quickPanel?: QuickPanelConfig;
	appshot?: AppshotConfig;
	remoteControl?: {
		relayBaseUrl?: string;
		pairingId?: string;
		inputEnabled?: boolean;
	};
	/**
	 * 可作为远程项目宿主的 SSH 主机（ADR-0124）。
	 *
	 * 注意与上面的 `remoteControl` 是两件事：那个是「手机遥控本机」，这个是
	 * 「本机连到远端主机上开发」，方向相反。
	 */
	sshHosts?: SshHost[];
}

export type AppshotGesture = "both-shift" | "both-mod" | "both-alt";

export interface AppshotConfig {
	enabled?: boolean;
	gesture?: AppshotGesture;
}

export type QuickPanelTrigger = "none" | "mod" | "alt" | "shift";

export interface QuickPanelConfig {
	trigger?: QuickPanelTrigger;
	postSendBehavior?: "foreground" | "background";
}

export interface KnowledgeBaseConfig {
	enabled?: boolean;
	pollIntervalMinutes?: number;
	processingModelKey?: string;
	processingModelReasoningLevel?: string;
	agentConcurrency?: number;
	ocrConcurrency?: number;
}

export const DEFAULT_CONVERSATION_CWD = join(getVettaHomePath(), "conversation");
export const DEFAULT_CONVERSATION_SESSION_DIR = join(DEFAULT_CONVERSATION_CWD, ".vetta", "sessions");
export const DEFAULT_IM_CONVERSATION_CWD = join(getVettaHomePath(), "im-gateway", "conversation");
export const DEFAULT_IM_CONVERSATION_SESSION_DIR = join(DEFAULT_IM_CONVERSATION_CWD, ".vetta", "sessions");
export const KB_PROCESSING_CWD = join(getVettaHomePath(), "knowledges", "processing_records");
export const KB_PROCESSING_SESSION_DIR = join(KB_PROCESSING_CWD, ".vetta", "sessions");

const CONFIG_PATH = join(getVettaHomePath(), "desktop-config.json");
const DEFAULT_CONFIG: DesktopConfig = {
	projects: [],
	archivedProjects: [],
	workspacePath: join(getVettaHomePath(), "workspace"),
	defaultExecutionMode: "full-access",
	defaultAgentMode: "work",
	debugMode: false,
	notificationsEnabled: true,
	experimental: { vettaCli: true, agentSkills: true },
	proxy: { ...DEFAULT_PROXY_CONFIG },
	imageGeneration: {},
	shortcuts: { bindings: {} },
	quickPanel: { trigger: "none", postSendBehavior: "foreground" },
	appshot: { enabled: false, gesture: "both-shift" },
};

function migrateProjectEntries(entries: unknown): ProjectEntry[] {
	if (!Array.isArray(entries) || entries.length === 0) return [];
	if (typeof entries[0] === "string") {
		return (entries as string[]).map((path) => ({ path }));
	}
	return entries as ProjectEntry[];
}

export function normalizeExecutionMode(value: unknown): "sandbox" | "full-access" {
	return value === "sandbox" ? "sandbox" : "full-access";
}

export function normalizeAgentMode(value: unknown): string {
	// 合法模式由 main/agent-modes 的 modes/*.md 注册表定义（ADR-0071）；无效值回落 work。
	return isAgentMode(value) ? value : "work";
}

const KB_POLL_INTERVALS = [3, 5, 10, 30];

export function normalizeKnowledgeBase(value: unknown): KnowledgeBaseConfig {
	if (typeof value !== "object" || value === null) {
		return { enabled: false, pollIntervalMinutes: 5 };
	}
	const input = value as Record<string, unknown>;
	const interval = typeof input.pollIntervalMinutes === "number" ? input.pollIntervalMinutes : 5;
	const clampInt = (candidate: unknown, fallback: number, min: number): number =>
		typeof candidate === "number" && Number.isFinite(candidate) && candidate >= min
			? Math.floor(candidate)
			: fallback;
	return {
		enabled: input.enabled === true,
		pollIntervalMinutes: interval === 0 || KB_POLL_INTERVALS.includes(interval) ? interval : 5,
		processingModelKey: typeof input.processingModelKey === "string" ? input.processingModelKey : undefined,
		processingModelReasoningLevel:
			typeof input.processingModelReasoningLevel === "string" ? input.processingModelReasoningLevel : undefined,
		agentConcurrency: clampInt(input.agentConcurrency, 3, 1),
		ocrConcurrency: clampInt(input.ocrConcurrency, 1, 1),
	};
}

export function normalizeQuickPanel(value: unknown): QuickPanelConfig {
	if (typeof value !== "object" || value === null) {
		return { trigger: "none", postSendBehavior: "foreground" };
	}
	const input = value as Record<string, unknown>;
	const trigger: QuickPanelTrigger =
		input.trigger === "mod" || input.trigger === "alt" || input.trigger === "shift" ? input.trigger : "none";
	return {
		trigger,
		postSendBehavior: input.postSendBehavior === "background" ? "background" : "foreground",
	};
}

export function normalizeShortcuts(value: unknown): ShortcutsConfig {
	return normalizeShortcutsConfig(value);
}

export function normalizeAppshot(value: unknown): AppshotConfig {
	if (typeof value !== "object" || value === null) return { enabled: false, gesture: "both-shift" };
	const input = value as Record<string, unknown>;
	const gesture: AppshotGesture =
		input.gesture === "both-shift" || input.gesture === "both-mod" || input.gesture === "both-alt"
			? input.gesture
			: "both-shift";
	return {
		enabled: input.enabled === true,
		gesture,
	};
}

export function normalizeExperimental(value: unknown): ExperimentalConfig {
	if (typeof value !== "object" || value === null) {
		return {
			vettaCli: true,
			promptPrediction: false,
			agentSkills: true,
		};
	}
	const input = value as Record<string, unknown>;
	return {
		vettaCli: typeof input.vettaCli === "boolean" ? input.vettaCli : true,
		promptPrediction: typeof input.promptPrediction === "boolean" ? input.promptPrediction : false,
		agentSkills: typeof input.agentSkills === "boolean" ? input.agentSkills : true,
	};
}

export function normalizeImageGeneration(value: unknown): ImageGenerationConfig {
	if (typeof value !== "object" || value === null) return {};
	const input = value as Record<string, unknown>;
	return {
		textToImageProviderId:
			typeof input.textToImageProviderId === "string" && input.textToImageProviderId.trim().length > 0
				? input.textToImageProviderId
				: undefined,
		textToImageModelId:
			typeof input.textToImageModelId === "string" && input.textToImageModelId.trim().length > 0
				? input.textToImageModelId
				: undefined,
		imageToImageProviderId:
			typeof input.imageToImageProviderId === "string" && input.imageToImageProviderId.trim().length > 0
				? input.imageToImageProviderId
				: undefined,
		imageToImageModelId:
			typeof input.imageToImageModelId === "string" && input.imageToImageModelId.trim().length > 0
				? input.imageToImageModelId
				: undefined,
	};
}

export async function readDesktopConfig(): Promise<DesktopConfig> {
	try {
		const raw = await readFile(CONFIG_PATH, "utf8");
		return parseDesktopConfig(JSON.parse(raw) as Record<string, unknown>);
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function readConfigSync(): DesktopConfig {
	try {
		const raw = readFileSync(CONFIG_PATH, "utf8");
		return parseDesktopConfig(JSON.parse(raw) as Record<string, unknown>);
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

function parseDesktopConfig(parsed: Record<string, unknown>): DesktopConfig {
	return {
		projects: migrateProjectEntries(parsed.projects),
		archivedProjects: migrateProjectEntries(parsed.archivedProjects),
		workspacePath:
			typeof parsed.workspacePath === "string"
				? expandTildePath(parsed.workspacePath)
				: DEFAULT_CONFIG.workspacePath,
		defaultExecutionMode: normalizeExecutionMode(parsed.defaultExecutionMode),
		// 兼容 0.x 的旧字段名 agentMode（当时语义是全局工作模式），老用户配置不丢。
		defaultAgentMode: normalizeAgentMode(parsed.defaultAgentMode ?? parsed.agentMode),
		debugMode: typeof parsed.debugMode === "boolean" ? parsed.debugMode : false,
		vettaAppPath: typeof parsed.vettaAppPath === "string" ? parsed.vettaAppPath : undefined,
		vettaCliAppPath: typeof parsed.vettaCliAppPath === "string" ? parsed.vettaCliAppPath : undefined,
		notificationsEnabled: typeof parsed.notificationsEnabled === "boolean" ? parsed.notificationsEnabled : true,
		language: isLanguagePreference(parsed.language) ? parsed.language : undefined,
		experimental: normalizeExperimental(parsed.experimental),
		proxy: normalizeProxyConfig(parsed.proxy),
		imageGeneration: normalizeImageGeneration(parsed.imageGeneration),
		knowledgeBase: normalizeKnowledgeBase(parsed.knowledgeBase),
		shortcuts: normalizeShortcuts(parsed.shortcuts),
		quickPanel: normalizeQuickPanel(parsed.quickPanel),
		appshot: normalizeAppshot(parsed.appshot),
		remoteControl: normalizeRemoteControl(parsed.remoteControl),
		sshHosts: normalizeSshHosts(parsed.sshHosts),
	};
}

function normalizeRemoteControl(value: unknown): DesktopConfig["remoteControl"] {
	if (typeof value !== "object" || value === null) return undefined;
	const input = value as Record<string, unknown>;
	return {
		relayBaseUrl: typeof input.relayBaseUrl === "string" ? input.relayBaseUrl : undefined,
		pairingId: typeof input.pairingId === "string" ? input.pairingId : undefined,
		inputEnabled: input.inputEnabled === true,
	};
}

/**
 * 逐条校验持久化的 SSH 主机。
 *
 * 配置文件可能被用户手工编辑，也可能来自更旧的版本。缺 id 或缺连接目标的条目直接
 * 丢弃而不是补默认值——一个指向错误主机的条目会让远程项目静默连到别的机器上。
 */
function normalizeSshHosts(value: unknown): SshHost[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const hosts: SshHost[] = [];
	for (const raw of value) {
		if (typeof raw !== "object" || raw === null) continue;
		const input = raw as Record<string, unknown>;
		const id = typeof input.id === "string" ? input.id.trim() : "";
		const target = typeof input.target === "string" ? input.target.trim() : "";
		if (id.length === 0 || target.length === 0) continue;
		const port = typeof input.port === "number" && Number.isInteger(input.port) ? input.port : undefined;
		hosts.push({
			id,
			label: typeof input.label === "string" && input.label.trim().length > 0 ? input.label.trim() : target,
			target,
			...(port !== undefined && port > 0 && port <= 65535 ? { port } : {}),
			...(typeof input.identityFile === "string" && input.identityFile.trim().length > 0
				? { identityFile: input.identityFile.trim() }
				: {}),
			source: input.source === "ssh-config" ? "ssh-config" : "manual",
			...(typeof input.credentialRef === "string" && input.credentialRef.length > 0
				? { credentialRef: input.credentialRef }
				: {}),
		});
	}
	return hosts;
}

/**
 * 整文件写回，但保留磁盘上本版本不认识的字段。
 *
 * 新旧版本共用同一份 `~/.vetta`（开发版与已安装的正式版、或升级后又回退）。读路径
 * {@link parseDesktopConfig} 是字段白名单，不认识的字段不进内存；若写回时整份覆盖，
 * 旧版任何一次保存都会把新版的字段抹掉——0.5.58 启动时顺手写回 CLI 路径，就这样清空了
 * sshHosts，远程项目随之全部报「Unknown SSH host」。已知字段仍以传入值为准：显式给
 * `undefined` 的键在序列化时被丢掉，删除语义不变。
 */
export async function writeDesktopConfig(config: DesktopConfig): Promise<void> {
	atomicWriteJSON(CONFIG_PATH, { ...readRawConfigSync(), ...config });
}

function readRawConfigSync(): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

export async function persistVettaCliPaths(paths: { vettaAppPath: string; vettaCliAppPath: string }): Promise<void> {
	const config = await readDesktopConfig();
	if (config.vettaAppPath === paths.vettaAppPath && config.vettaCliAppPath === paths.vettaCliAppPath) return;
	await writeDesktopConfig({ ...config, ...paths });
}

export function expandTildePath(path: string): string {
	if (path.startsWith("~/") || path === "~") {
		return join(homedir(), path.slice(1));
	}
	return path;
}
