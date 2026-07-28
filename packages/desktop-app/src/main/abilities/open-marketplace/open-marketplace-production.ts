import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { GitHubMarketplaceOrigin } from "../../../preload/api-types/abilities.js";
import { installPluginFromArchive } from "../../plugins/plugin-store.js";
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
import { createOpenMarketplacePluginArchive, validateOpenMarketplacePlugin } from "./open-marketplace-plugin.js";

const dependencies: OpenMarketplaceInstallerDependencies = {
	getBaseDir: getSkillBaseDir,
	tmpBaseDir: join(getVettaHomePath(), "tmp"),
	readManifest: readSkillsManifest,
	writeManifest: writeSkillsManifest,
	recordInstall: (type, slug, version, metadata) => recordAbilityInstall(type, slug, version, metadata),
	recordEvent: recordSkillResourceEvent,
};

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
			grantedPermissions: [],
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
