import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { readPluginJson, writePluginJson } from "./plugin-storage-service.js";

/**
 * 一次性迁移：`contributes.settings` 撤销后（ADR-0105），旧宿主写在
 * `plugin-settings.json` 里的非密钥配置搬进各插件的私有存储。
 *
 * 落点固定为 JSON key `settings`，插件读回后自行归一化——宿主不解释这些值的结构。
 * 密钥不在此文件中（更早就已迁入 CredentialVault，命名空间未变），无需处理。
 */
export const LEGACY_PLUGIN_SETTINGS_STORAGE_KEY = "settings";

const LEGACY_FILE_NAME = "plugin-settings.json";
const MIGRATED_FILE_NAME = "plugin-settings.migrated.json";

interface MigrationLogger {
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, error?: unknown): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 迁移完成后把源文件改名而不是删除：迁移出错时用户仍能找回原值。
 * 已存在同名 storage 记录的插件跳过，避免覆盖插件自己写过的新配置。
 */
export async function migrateLegacyPluginSettings(logger: MigrationLogger): Promise<void> {
	const legacyPath = join(getVettaHomePath(), LEGACY_FILE_NAME);
	if (!existsSync(legacyPath)) return;

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(legacyPath, "utf8"));
	} catch (error) {
		logger.warn("legacy plugin settings are unreadable; skipping migration", error);
		return;
	}
	if (!isRecord(parsed)) return;

	const migrated: string[] = [];
	for (const [pluginId, values] of Object.entries(parsed)) {
		if (!isRecord(values) || Object.keys(values).length === 0) continue;
		try {
			const existing = await readPluginJson<unknown>(pluginId, LEGACY_PLUGIN_SETTINGS_STORAGE_KEY);
			if (existing !== null) continue;
			await writePluginJson(pluginId, LEGACY_PLUGIN_SETTINGS_STORAGE_KEY, values);
			migrated.push(pluginId);
		} catch (error) {
			logger.warn("failed to migrate legacy plugin settings", error);
			return;
		}
	}

	try {
		renameSync(legacyPath, join(getVettaHomePath(), MIGRATED_FILE_NAME));
	} catch (error) {
		logger.warn("failed to archive legacy plugin settings file", error);
		return;
	}
	logger.info("legacy plugin settings migrated to plugin storage", { plugins: migrated });
}
