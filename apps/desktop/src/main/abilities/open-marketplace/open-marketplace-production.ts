import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { GitHubMarketplaceOrigin } from "../../../preload/api-types/abilities.js";
import type { McpServerConfigData } from "../../../preload/api-types/mcp.js";
import { installPluginFromArchive } from "../../plugins/plugin-catalog.js";
import {
	getSkillBaseDir,
	readSkillsManifest,
	recordSkillResourceEvent,
	writeSkillsManifest,
} from "../../skills/skill-service.js";
import { recordAbilityInstall } from "../ability-ledger.js";
import type { MarketplaceAbilityManifest } from "./marketplace-schema.js";
import {
	installOpenMarketplaceAbility,
	type OpenMarketplaceInstallerDependencies,
} from "./open-marketplace-installer.js";
import { readOpenMarketplaceMcpPackage } from "./open-marketplace-mcp.js";
import { OpenMarketplaceMcpRuntimeInstaller } from "./open-marketplace-mcp-runtime.js";
import { createOpenMarketplacePluginArchive, validateOpenMarketplacePlugin } from "./open-marketplace-plugin.js";

const dependencies: OpenMarketplaceInstallerDependencies = {
	getBaseDir: getSkillBaseDir,
	tmpBaseDir: join(getVettaHomePath(), "tmp"),
	readManifest: readSkillsManifest,
	writeManifest: writeSkillsManifest,
	recordInstall: (type, slug, version, metadata) => recordAbilityInstall(type, slug, version, metadata),
	recordEvent: recordSkillResourceEvent,
};

const mcpRuntimeInstaller = new OpenMarketplaceMcpRuntimeInstaller({
	rootDir: join(getVettaHomePath(), "abilities", "mcp"),
});

export async function prepareOpenMarketplaceMcpInDesktop(
	snapshotRoot: string,
	ability: Extract<MarketplaceAbilityManifest, { type: "mcp" }>,
	sourceId: string,
): Promise<McpServerConfigData> {
	const sourceDir = join(snapshotRoot, ability.source.path);
	const mcpPackage = readOpenMarketplaceMcpPackage(sourceDir, ability);
	if (!mcpPackage.runtime) return mcpPackage.server;
	return mcpRuntimeInstaller.prepare({
		sourceId,
		slug: ability.slug,
		version: ability.version,
		runtime: mcpPackage.runtime,
		server: mcpPackage.server,
	});
}

/**
 * 安装后步骤的完成状态。未声明步骤返回 undefined —— 调用方据此区分
 * 「不需要额外配置」与「需要但还没做」。
 */
export function readOpenMarketplaceMcpSetupStatusInDesktop(
	snapshotRoot: string,
	ability: Extract<MarketplaceAbilityManifest, { type: "mcp" }>,
	sourceId: string,
): boolean | undefined {
	const sourceDir = join(snapshotRoot, ability.source.path);
	const { setup } = readOpenMarketplaceMcpPackage(sourceDir, ability);
	if (!setup) return undefined;
	return mcpRuntimeInstaller.isSetupComplete(sourceId, ability.slug, setup.completedWhen.dataFile);
}

export function removeOpenMarketplaceMcpRuntimeInDesktop(sourceId: string, slug: string): Promise<void> {
	return mcpRuntimeInstaller.remove(sourceId, slug);
}

export async function installOpenMarketplaceAbilityInDesktop(
	snapshotRoot: string,
	ability: MarketplaceAbilityManifest,
	origin: GitHubMarketplaceOrigin,
): Promise<void> {
	if (ability.type === "bundle") throw new Error("Bundles are installed through their members");
	if (ability.type === "mcp") throw new Error("MCP abilities are installed through MCP settings");
	if (ability.type === "plugin") {
		const sourceDir = join(snapshotRoot, ability.source.path);
		validateOpenMarketplacePlugin(sourceDir, ability);
		const installed = await installPluginFromArchive(createOpenMarketplacePluginArchive(sourceDir), {
			source: "remote",
			enable: false,
			// Omit grants: fresh installs default to none; updates retain the user's existing consent.
		});
		recordAbilityInstall("plugin", installed.id, installed.activeVersion, {
			origin,
			configVersion: ability.configVersion,
			catalogId: `github:${origin.sourceId ?? origin.repository}:plugin:${ability.slug}`,
			slug: ability.slug,
		});
		return;
	}
	await installOpenMarketplaceAbility(snapshotRoot, ability, origin, dependencies);
}
