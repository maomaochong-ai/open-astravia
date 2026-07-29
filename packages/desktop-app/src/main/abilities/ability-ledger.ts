import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import type {
	AbilityInstallMetadata,
	AbilityInstallOrigin,
	AbilityLedger,
	AbilityLedgerEntry,
	AbilityLedgerType,
} from "../../preload/api-types/abilities.js";
import { ABILITY_LEDGER_SCHEMA_VERSION, migrateAbilityLedgerConfig } from "./ability-ledger-migrations.js";

/**
 * 能力安装台账（ADR-0049）。
 *
 * 只记录「装了哪些能力、什么版本」，**不改变任何物理安装位置**：
 * skill → `~/.vetta/skills/<slug>`、scene → `~/.vetta/scene/<slug>`、
 * plugin → `~/.vetta/plugins/<slug>`、mcp → `~/.vetta/agent/mcp.json` 的一个 key。
 * bundle 不进台账（状态由成员派生）。
 *
 * 并发：所有读改写都在**一个同步 tick** 内完成（主进程 JS 单线程 → 不会与其它
 * 写入者交错），落盘走 atomicWriteJSON（临时文件 + rename），崩溃不会留下半截文件。
 *
 * 本模块刻意不依赖 getAppLogger：它被 mcp-settings-service 等带单测的模块引用，
 * 而 logger 会连带 electron-log/main（node 测试环境下加载不了 electron）。
 */
const ledgerPath = join(getVettaHomePath(), "abilities.json");
const skillsBaseDir = join(getVettaHomePath(), "skills");
const sceneBaseDir = join(getVettaHomePath(), "scene");
const pluginsBaseDir = join(getVettaHomePath(), "plugins");
const mcpConfigPath = join(getVettaHomePath(), "agent", "mcp.json");

const LEDGER_TYPES = new Set<string>(["skill", "scene", "plugin", "mcp"]);

interface PersistedAbilityLedger {
	schemaVersion: typeof ABILITY_LEDGER_SCHEMA_VERSION;
	entries: AbilityLedger;
}

function buildAbilityLedgerKey(type: AbilityLedgerType, physicalName: string): string {
	return `${type}:${physicalName}`;
}

function parseAbilityLedgerKey(key: string): { type: AbilityLedgerType; slug: string } | null {
	const separator = key.indexOf(":");
	if (separator <= 0) return null;
	const type = key.slice(0, separator);
	const slug = key.slice(separator + 1);
	if (!slug || !LEDGER_TYPES.has(type)) return null;
	return { type: type as AbilityLedgerType, slug };
}

function parseEntry(value: unknown): AbilityLedgerEntry | null {
	if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
	const entry = value as Record<string, unknown>;
	if (typeof entry.version !== "string" || typeof entry.installedAt !== "string") return null;
	let origin: AbilityInstallOrigin | undefined;
	if (entry.origin != null && typeof entry.origin === "object" && !Array.isArray(entry.origin)) {
		const candidate = entry.origin as Record<string, unknown>;
		if (candidate.kind === "server") {
			origin = { kind: "server" };
		} else if (
			candidate.kind === "github-marketplace" &&
			typeof candidate.marketplace === "string" &&
			typeof candidate.marketplaceVersion === "string" &&
			typeof candidate.repository === "string"
		) {
			origin = {
				kind: "github-marketplace",
				...(typeof candidate.sourceId === "string" ? { sourceId: candidate.sourceId } : {}),
				marketplace: candidate.marketplace,
				marketplaceVersion: candidate.marketplaceVersion,
				repository: candidate.repository,
			};
		}
	}
	const configVersion =
		typeof entry.configVersion === "number" && Number.isInteger(entry.configVersion) && entry.configVersion > 0
			? entry.configVersion
			: undefined;
	const catalogId = typeof entry.catalogId === "string" && entry.catalogId.trim() ? entry.catalogId : undefined;
	const slug = typeof entry.slug === "string" && entry.slug.trim() ? entry.slug : undefined;
	const runtimeName =
		typeof entry.runtimeName === "string" && entry.runtimeName.trim() ? entry.runtimeName : undefined;
	return {
		version: entry.version,
		installedAt: entry.installedAt,
		...(origin ? { origin } : {}),
		...(configVersion ? { configVersion } : {}),
		...(catalogId ? { catalogId } : {}),
		...(slug ? { slug } : {}),
		...(runtimeName ? { runtimeName } : {}),
	};
}

function normalizeLedgerConfig(value: unknown): PersistedAbilityLedger {
	const record =
		value != null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	const rawEntries =
		record.entries != null && typeof record.entries === "object" && !Array.isArray(record.entries)
			? (record.entries as Record<string, unknown>)
			: {};
	const entries: AbilityLedger = {};
	for (const [key, rawEntry] of Object.entries(rawEntries)) {
		if (!parseAbilityLedgerKey(key)) continue;
		const entry = parseEntry(rawEntry);
		if (entry) entries[key] = entry;
	}
	return { schemaVersion: ABILITY_LEDGER_SCHEMA_VERSION, entries };
}

/** 原样读盘（不做漂移剔除），并把旧版扁平台账迁移为带 schemaVersion 的配置。 */
function readLedgerFile(): AbilityLedger {
	if (!existsSync(ledgerPath)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(ledgerPath, "utf-8"));
		const migration = migrateAbilityLedgerConfig(parsed);
		const config = normalizeLedgerConfig(migration.config);
		if (migration.migrated) atomicWriteJSON(ledgerPath, config);
		return config.entries;
	} catch {
		// 台账损坏时按空台账处理：下一次安装会重新写出（与 skills-manifest / plugins-manifest 同惯例）。
		return {};
	}
}

function writeLedgerFile(ledger: AbilityLedger): void {
	atomicWriteJSON(ledgerPath, {
		schemaVersion: ABILITY_LEDGER_SCHEMA_VERSION,
		entries: ledger,
	} satisfies PersistedAbilityLedger);
}

/**
 * mcp.json 里当前存在的 server 名集合。
 * 返回 null 表示「读不出来」（文件损坏等）——此时不对 mcp 条目做漂移剔除，
 * 避免一次读取失败就把台账里的 mcp 记录全部清空。
 */
function readMcpServerNames(): Set<string> | null {
	if (!existsSync(mcpConfigPath)) return new Set();
	try {
		const parsed: unknown = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
		if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const servers = (parsed as Record<string, unknown>).mcpServers;
		if (servers == null || typeof servers !== "object" || Array.isArray(servers)) return null;
		return new Set(Object.keys(servers as Record<string, unknown>));
	} catch {
		return null;
	}
}

/** 台账条目对应的产物/配置是否仍然存在（漂移判定）。 */
function isAbilityStillInstalled(type: AbilityLedgerType, slug: string, mcpServerNames: Set<string> | null): boolean {
	switch (type) {
		case "skill":
			return existsSync(join(skillsBaseDir, slug));
		case "scene":
			return existsSync(join(sceneBaseDir, slug));
		case "plugin":
			return existsSync(join(pluginsBaseDir, slug));
		case "mcp":
			return mcpServerNames === null || mcpServerNames.has(slug);
	}
}

/**
 * 读取全量台账，并剔除「台账说装了、实际已不在」的漂移条目（有剔除则立即落盘）。
 */
export function readAbilityLedger(): AbilityLedger {
	const ledger = readLedgerFile();
	const mcpServerNames = readMcpServerNames();
	const alive: AbilityLedger = {};
	let dropped = false;
	for (const [key, entry] of Object.entries(ledger)) {
		const parsed = parseAbilityLedgerKey(key);
		if (parsed && isAbilityStillInstalled(parsed.type, parsed.slug, mcpServerNames)) {
			alive[key] = entry;
		} else {
			dropped = true;
		}
	}
	if (dropped) writeLedgerFile(alive);
	return alive;
}

/**
 * 记录一次安装/升级。已有条目保留原 installedAt；调用方未传 metadata 时也保留已有
 * origin / configVersion，避免插件 reload 等纯版本切换丢失 GitHub 来源。
 * 内置能力（skill-presets、系统插件）不进台账，调用方不应对其调用本函数。
 */
export function recordAbilityInstall(
	type: AbilityLedgerType,
	physicalName: string,
	version: string,
	metadata?: AbilityInstallMetadata,
): void {
	if (!physicalName.trim() || !version.trim()) {
		throw new Error(`Invalid ability ledger entry: ${type}:${physicalName}@${version}`);
	}
	const ledger = readLedgerFile();
	const key = buildAbilityLedgerKey(type, physicalName);
	const previous = ledger[key];
	const configVersion = metadata?.configVersion ?? previous?.configVersion;
	ledger[key] = {
		version,
		installedAt: previous?.installedAt ?? new Date().toISOString(),
		origin: metadata?.origin ?? previous?.origin ?? { kind: "server" },
		...(configVersion ? { configVersion } : {}),
		...((metadata?.catalogId ?? previous?.catalogId)
			? { catalogId: metadata?.catalogId ?? previous?.catalogId }
			: {}),
		...((metadata?.slug ?? previous?.slug) ? { slug: metadata?.slug ?? previous?.slug } : {}),
		...(type === "mcp" ? { runtimeName: metadata?.runtimeName ?? previous?.runtimeName ?? physicalName } : {}),
	};
	writeLedgerFile(ledger);
}

/** 移除条目（卸载路径调用）。条目不存在时不落盘。 */
export function removeAbilityLedgerEntry(type: AbilityLedgerType, slug: string): void {
	const ledger = readLedgerFile();
	const key = buildAbilityLedgerKey(type, slug);
	if (!(key in ledger)) return;
	delete ledger[key];
	writeLedgerFile(ledger);
}
