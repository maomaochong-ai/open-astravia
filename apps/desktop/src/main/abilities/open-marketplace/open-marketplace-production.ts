import { basename, join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type {
	GitHubMarketplaceOrigin,
	OpenMarketplaceMcpRuntimeProgress,
} from "../../../preload/api-types/abilities.js";
import type { McpServerConfigData } from "../../../preload/api-types/mcp.js";
import { recordAppMonitorEvent } from "../../app-monitor/app-monitor-service.js";
import { installPluginFromArchive } from "../../plugins/plugin-catalog.js";
import {
	getSkillBaseDir,
	readSkillsManifest,
	recordSkillResourceEvent,
	writeSkillsManifest,
} from "../../skills/skill-service.js";
import { recordAbilityInstall } from "../ability-ledger.js";
import {
	type AbilityArtifactKind,
	type AbilityLifecycleLogContext,
	logAbilityInstallFailed,
	logAbilityInstallStarted,
} from "../ability-lifecycle-log.js";
import { fetchVerifiedMarketplacePluginArtifact } from "./marketplace-plugin-artifact.js";
import type { MarketplaceAbilityManifest } from "./marketplace-schema.js";
import {
	installOpenMarketplaceAbility,
	type OpenMarketplaceInstallerDependencies,
} from "./open-marketplace-installer.js";
import { readOpenMarketplaceMcpPackage } from "./open-marketplace-mcp.js";
import {
	getRecordedOpenMarketplaceMcpSetupStatus,
	openMarketplaceMcpRuntimeInstaller,
	removeOpenMarketplaceManagedMcpRuntime,
	stopOpenMarketplaceManagedMcpRuntime,
} from "./open-marketplace-mcp-runtime-host.js";
import { createOpenMarketplacePluginArchive, validateOpenMarketplacePlugin } from "./open-marketplace-plugin.js";

const dependencies: OpenMarketplaceInstallerDependencies = {
	getBaseDir: getSkillBaseDir,
	tmpBaseDir: join(getVettaHomePath(), "tmp"),
	readManifest: readSkillsManifest,
	writeManifest: writeSkillsManifest,
	recordInstall: (type, slug, version, metadata) => recordAbilityInstall(type, slug, version, metadata),
	recordEvent: (input) => recordSkillResourceEvent(input),
};

function artifactKindFromUrl(url: string): AbilityArtifactKind {
	const pathname = new URL(url).pathname.toLowerCase();
	if (pathname.endsWith(".vettapkg")) return "vettapkg";
	if (pathname.endsWith(".zip")) return "legacy-zip";
	return "remote-archive";
}

function marketplaceInstallContext(
	ability: Exclude<MarketplaceAbilityManifest, { type: "bundle" }>,
	origin: GitHubMarketplaceOrigin,
): AbilityLifecycleLogContext {
	const release = ability.type === "plugin" ? ability.releases?.[0] : undefined;
	const artifactUrl = release?.artifact.url;
	return {
		version: ability.version,
		installMode: "marketplace",
		artifactKind: artifactUrl ? artifactKindFromUrl(artifactUrl) : "snapshot-source",
		...(artifactUrl
			? {
					artifactName: basename(new URL(artifactUrl).pathname),
					artifactUrl: new URL(artifactUrl).origin + new URL(artifactUrl).pathname,
				}
			: {}),
		...(release?.artifact.sha256 ? { artifactSha256: release.artifact.sha256 } : {}),
		...(origin.sourceId ? { marketplaceSourceId: origin.sourceId } : {}),
		marketplaceName: origin.marketplace,
		marketplaceVersion: origin.marketplaceVersion,
		marketplaceRepository: origin.repository,
		...(origin.ref ? { marketplaceRef: origin.ref } : {}),
	};
}

export async function prepareOpenMarketplaceMcpInDesktop(
	snapshotRoot: string,
	ability: Extract<MarketplaceAbilityManifest, { type: "mcp" }>,
	sourceId: string,
	onProgress?: (progress: OpenMarketplaceMcpRuntimeProgress) => void,
): Promise<McpServerConfigData> {
	const sourceDir = join(snapshotRoot, ability.source.path);
	const mcpPackage = readOpenMarketplaceMcpPackage(sourceDir, ability);
	if (!mcpPackage.runtime) return mcpPackage.server;
	await stopOpenMarketplaceManagedMcpRuntime(openMarketplaceMcpRuntimeInstaller.runtimeId(sourceId, ability.slug));
	return openMarketplaceMcpRuntimeInstaller.prepare({
		sourceId,
		slug: ability.slug,
		version: ability.version,
		runtime: mcpPackage.runtime,
		server: mcpPackage.server,
		setup: mcpPackage.setup,
		parameters: mcpPackage.parameters,
		onProgress,
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
	return getRecordedOpenMarketplaceMcpSetupStatus(
		openMarketplaceMcpRuntimeInstaller.runtimeId(sourceId, ability.slug),
	);
}

export async function removeOpenMarketplaceMcpRuntimeInDesktop(sourceId: string, slug: string): Promise<void> {
	await removeOpenMarketplaceManagedMcpRuntime(sourceId, slug);
}

export async function installOpenMarketplaceAbilityInDesktop(
	snapshotRoot: string,
	ability: MarketplaceAbilityManifest,
	origin: GitHubMarketplaceOrigin,
	accessToken?: string,
): Promise<void> {
	if (ability.type === "bundle") throw new Error("Bundles are installed through their members");
	if (ability.type === "mcp") throw new Error("MCP abilities are installed through MCP settings");
	const logContext = marketplaceInstallContext(ability, origin);
	logAbilityInstallStarted({ abilityType: ability.type, abilityId: ability.slug, ...logContext });
	try {
		if (ability.type === "plugin") {
			const release = ability.releases?.[0];
			if (!release) validateOpenMarketplacePlugin(join(snapshotRoot, ability.source.path), ability);
			const archive = release
				? await fetchVerifiedMarketplacePluginArtifact(release, ability.slug, origin.repository, accessToken)
				: createOpenMarketplacePluginArchive(join(snapshotRoot, ability.source.path));
			const installed = await installPluginFromArchive(archive, {
				source: "remote",
				enable: false,
				expectedId: ability.slug,
				expectedVersion: ability.version,
				...(release ? { expectedSha256: release.artifact.sha256 } : {}),
				// Omit grants: fresh installs default to none; updates retain the user's existing consent.
			});
			recordAbilityInstall("plugin", installed.id, installed.activeVersion, {
				origin,
				configVersion: ability.configVersion,
				catalogId: `github:${origin.sourceId ?? origin.repository}:plugin:${ability.slug}`,
				slug: ability.slug,
			});
			try {
				recordAppMonitorEvent(
					{
						type: "resource.lifecycle",
						resourceKind: "plugin",
						resourceId: installed.id,
						operation: installed.installedAt === installed.updatedAt ? "installed" : "updated",
						source: "remote",
					},
					logContext,
				);
			} catch {
				// Monitoring and logging must not affect a completed installation.
			}
			return;
		}
		await installOpenMarketplaceAbility(snapshotRoot, ability, origin, dependencies);
	} catch (error) {
		logAbilityInstallFailed({ abilityType: ability.type, abilityId: ability.slug, ...logContext }, error);
		throw error;
	}
}
