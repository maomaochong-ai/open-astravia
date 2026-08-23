import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAstraviaHomePath } from "@astravia/action-rpc";
import { atomicWriteJSON } from "@astravia/toolkit/atomic-write";
import { isLanguagePreference, type LanguagePreference } from "../../shared/i18n/config.js";
import { normalizeShortcutsConfig, type ShortcutsConfig } from "../../shared/shortcuts.js";

export interface ProjectEntry {
	path: string;
	name?: string;
}

/** 实验性功能开关分组（设置页「Agent配置 → 扩展功能」）。新增实验项只加一个键。 */
export interface ExperimentalConfig {
	/** Astravia CLI 提示词：开启后仅注入桌面端对话会话。缺省开。 */
	astraviaCli?: boolean;
	/** 输入预测：每轮正常回答后预测用户下一个可能输入的 prompt。缺省关。 */
	promptPrediction?: boolean;
	/** 适配通用 Agent Skill。缺省开。 */
	agentSkills?: boolean;
}

/**
 * 感知范围类型（B2.10-W4-①）。
 * all：全部连接全表注入（现状默认）；connections：仅白名单连接；tables：仅白名单「连接.表」。
 */
export type SchemaInjectionScopeKind = "all" | "connections" | "tables";

/** 感知范围配置（schemaInjection 开启时生效；缺省 all）。 */
export interface SchemaInjectionScopeConfig {
	scope: SchemaInjectionScopeKind;
	/** scope=connections 时生效：允许注入的连接名白名单。 */
	connections: string[];
	/** scope=tables 时生效：允许注入的「连接.表」白名单。 */
	tables: Array<{ connection: string; table: string }>;
}

/**
 * 数据库能力配置（B2.5/B2.10）。
 * schemaInjection：AI 对话会话创建时注入连接 schema 上下文（感知）。缺省关。
 * schemaInjectionScope：感知范围（B2.10-W4-①），缺省 all（全部连接全表）。
 * dbxToolEnabled：AI 访问开关——控制 dbx MCP 工具是否注册进对话工具集（访问）。缺省关；
 * 关闭时 AI 无法调用 dbx 工具执行 SQL，与感知开关相互独立（B2.10-W2 权限分离）。
 */
export interface DatabaseConfig {
	schemaInjection?: boolean;
	schemaInjectionScope?: SchemaInjectionScopeConfig;
	dbxToolEnabled?: boolean;
	/** 连接环境标记（W4-②）：连接名 → "prod" | "dev"（缺省 dev）。 */
	connectionEnv?: Record<string, "prod" | "dev">;
	/** 生产写授权（W4-②）：连接名 → 已显式授权允许生产写操作。 */
	prodWriteApproved?: Record<string, boolean>;
	/** 安全执行模式（B3.1-①-B）：strict 所有连接写操作需显式授权（缺省）；relaxed 仅 prod 拦截。 */
	safetyMode?: "strict" | "relaxed";
	/** 查询结果行数上限（B3.1-②-A，缺省 100，与引擎 max 100 一致）。 */
	rowLimit?: number;
	/** 查询执行超时（B3.1-②-B，毫秒，缺省 30s）。 */
	queryTimeoutMs?: number;
	/** 连接级「允许 AI 访问」白名单（B3.1-①-C）：连接名 → 允许（缺省按 connectionEnv：prod 关 / dev 开）。 */
	connectionAiAccess?: Record<string, boolean>;
}

export interface DesktopConfig {
	projects: ProjectEntry[];
	archivedProjects: ProjectEntry[];
	workspacePath: string;
	defaultExecutionMode: "sandbox" | "full-access";
	debugMode?: boolean;
	astraviaAppPath?: string;
	astraviaCliAppPath?: string;
	notificationsEnabled?: boolean;
	language?: LanguagePreference;
	agentMode?: "work" | "coding";
	experimental?: ExperimentalConfig;
	knowledgeBase?: KnowledgeBaseConfig;
	shortcuts?: ShortcutsConfig;
	quickPanel?: QuickPanelConfig;
	appshot?: AppshotConfig;
	database?: DatabaseConfig;
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

export const DEFAULT_CONVERSATION_CWD = join(getAstraviaHomePath(), "conversation");
export const DEFAULT_CONVERSATION_SESSION_DIR = join(DEFAULT_CONVERSATION_CWD, ".astravia", "sessions");
export const DEFAULT_IM_CONVERSATION_CWD = join(getAstraviaHomePath(), "im-gateway", "conversation");
export const DEFAULT_IM_CONVERSATION_SESSION_DIR = join(DEFAULT_IM_CONVERSATION_CWD, ".astravia", "sessions");
export const KB_PROCESSING_CWD = join(getAstraviaHomePath(), "knowledges", "processing_records");
export const KB_PROCESSING_SESSION_DIR = join(KB_PROCESSING_CWD, ".astravia", "sessions");

const CONFIG_PATH = join(getAstraviaHomePath(), "desktop-config.json");
const DEFAULT_CONFIG: DesktopConfig = {
	projects: [],
	archivedProjects: [],
	workspacePath: join(getAstraviaHomePath(), "workspace"),
	defaultExecutionMode: "full-access",
	agentMode: "work",
	debugMode: false,
	notificationsEnabled: true,
	experimental: { astraviaCli: true, agentSkills: true },
	shortcuts: { bindings: {} },
	quickPanel: { trigger: "none", postSendBehavior: "foreground" },
	appshot: { enabled: false, gesture: "both-shift" },
	database: {
		schemaInjection: false,
		dbxToolEnabled: false,
		connectionEnv: {},
		prodWriteApproved: {},
		safetyMode: "strict",
		rowLimit: 100,
		queryTimeoutMs: 30_000,
		connectionAiAccess: {},
	},
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

export function normalizeAgentMode(value: unknown): "work" | "coding" {
	return value === "coding" ? "coding" : "work";
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
			astraviaCli: true,
			promptPrediction: false,
			agentSkills: true,
		};
	}
	const input = value as Record<string, unknown>;
	return {
		astraviaCli: typeof input.astraviaCli === "boolean" ? input.astraviaCli : true,
		promptPrediction: typeof input.promptPrediction === "boolean" ? input.promptPrediction : false,
		agentSkills: typeof input.agentSkills === "boolean" ? input.agentSkills : true,
	};
}

/** 归一化感知范围配置；非法/缺失返回 undefined（调用方按 all 处理）。 */
export function normalizeSchemaInjectionScope(value: unknown): SchemaInjectionScopeConfig | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const input = value as Record<string, unknown>;
	const scope: SchemaInjectionScopeKind =
		input.scope === "connections" || input.scope === "tables" ? input.scope : "all";
	const connections = Array.isArray(input.connections)
		? [...new Set(input.connections.filter((c): c is string => typeof c === "string" && c.length > 0))].slice(0, 200)
		: [];
	const tables = Array.isArray(input.tables)
		? input.tables
				.filter(
					(t): t is { connection: string; table: string } =>
						typeof t === "object" &&
						t !== null &&
						typeof (t as { connection?: unknown }).connection === "string" &&
						typeof (t as { table?: unknown }).table === "string",
				)
				.slice(0, 500)
		: [];
	return { scope, connections, tables };
}

/** 归一化连接环境标记：只保留合法连接名与 prod/dev 值。 */
export function normalizeConnectionEnv(value: unknown): Record<string, "prod" | "dev"> {
	if (typeof value !== "object" || value === null) return {};
	const out: Record<string, "prod" | "dev"> = {};
	for (const [name, env] of Object.entries(value as Record<string, unknown>)) {
		if (name.length > 0 && (env === "prod" || env === "dev")) out[name] = env;
	}
	return out;
}

/** 归一化生产写授权：只保留合法连接名与 true 值。 */
export function normalizeProdWriteApproved(value: unknown): Record<string, boolean> {
	if (typeof value !== "object" || value === null) return {};
	const out: Record<string, boolean> = {};
	for (const [name, ok] of Object.entries(value as Record<string, unknown>)) {
		if (name.length > 0 && ok === true) out[name] = true;
	}
	return out;
}

const ROW_LIMIT_VALUES = [50, 100, 200, 500];

/** 归一化连接级「允许 AI 访问」白名单：只保留合法连接名与 true 值。 */
export function normalizeConnectionAiAccess(value: unknown): Record<string, boolean> {
	if (typeof value !== "object" || value === null) return {};
	const out: Record<string, boolean> = {};
	for (const [name, allowed] of Object.entries(value as Record<string, unknown>)) {
		if (name.length > 0 && allowed === true) out[name] = true;
	}
	return out;
}

export function normalizeDatabase(value: unknown): DatabaseConfig {
	if (typeof value !== "object" || value === null) {
		return {
			schemaInjection: false,
			dbxToolEnabled: false,
			connectionEnv: {},
			prodWriteApproved: {},
			safetyMode: "strict",
			rowLimit: 100,
			queryTimeoutMs: 30_000,
			connectionAiAccess: {},
		};
	}
	const input = value as Record<string, unknown>;
	const rowLimit = typeof input.rowLimit === "number" ? input.rowLimit : 100;
	const queryTimeoutMs =
		typeof input.queryTimeoutMs === "number" && input.queryTimeoutMs > 0 ? input.queryTimeoutMs : 30_000;
	return {
		schemaInjection: input.schemaInjection === true,
		schemaInjectionScope: normalizeSchemaInjectionScope(input.schemaInjectionScope),
		dbxToolEnabled: input.dbxToolEnabled === true,
		connectionEnv: normalizeConnectionEnv(input.connectionEnv),
		prodWriteApproved: normalizeProdWriteApproved(input.prodWriteApproved),
		safetyMode: input.safetyMode === "relaxed" ? "relaxed" : "strict",
		rowLimit: ROW_LIMIT_VALUES.includes(rowLimit) ? rowLimit : 100,
		queryTimeoutMs,
		connectionAiAccess: normalizeConnectionAiAccess(input.connectionAiAccess),
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
		agentMode: normalizeAgentMode(parsed.agentMode),
		debugMode: typeof parsed.debugMode === "boolean" ? parsed.debugMode : false,
		astraviaAppPath: typeof parsed.astraviaAppPath === "string" ? parsed.astraviaAppPath : undefined,
		astraviaCliAppPath: typeof parsed.astraviaCliAppPath === "string" ? parsed.astraviaCliAppPath : undefined,
		notificationsEnabled: typeof parsed.notificationsEnabled === "boolean" ? parsed.notificationsEnabled : true,
		language: isLanguagePreference(parsed.language) ? parsed.language : undefined,
		experimental: normalizeExperimental(parsed.experimental),
		knowledgeBase: normalizeKnowledgeBase(parsed.knowledgeBase),
		shortcuts: normalizeShortcuts(parsed.shortcuts),
		quickPanel: normalizeQuickPanel(parsed.quickPanel),
		appshot: normalizeAppshot(parsed.appshot),
		database: normalizeDatabase(parsed.database),
	};
}

export async function writeDesktopConfig(config: DesktopConfig): Promise<void> {
	atomicWriteJSON(CONFIG_PATH, config);
}

/** 合并 database 配置 patch（用于 config.set 部分更新）。 */
export function mergeDatabaseConfig(current: DatabaseConfig | undefined, patch: unknown): DatabaseConfig {
	return normalizeDatabase({ ...(current ?? {}), ...(patch as Record<string, unknown>) });
}

export async function persistAstraviaCliPaths(paths: {
	astraviaAppPath: string;
	astraviaCliAppPath: string;
}): Promise<void> {
	const config = await readDesktopConfig();
	if (config.astraviaAppPath === paths.astraviaAppPath && config.astraviaCliAppPath === paths.astraviaCliAppPath)
		return;
	await writeDesktopConfig({ ...config, ...paths });
}

export function expandTildePath(path: string): string {
	if (path.startsWith("~/") || path === "~") {
		return join(homedir(), path.slice(1));
	}
	return path;
}
