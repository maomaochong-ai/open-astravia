import { isPluginApiCompatible } from "@vetta-org/plugin-sdk/manifest";
import { compareAppVersions, isAppVersionCompatible } from "./marketplace-compatibility.js";
import type { MarketplaceAbilityManifest } from "./marketplace-schema.js";

/** Resolve once for both catalog presentation and installation. */
export function selectMarketplacePluginReleases(
	abilities: readonly MarketplaceAbilityManifest[],
	appVersion: string,
	hostApiVersion: string,
): MarketplaceAbilityManifest[] {
	const selected = abilities.flatMap((ability): MarketplaceAbilityManifest[] => {
		if (ability.type !== "plugin" || !ability.releases) return [ability];
		const compatible = ability.releases
			.filter(
				(release) =>
					isAppVersionCompatible(appVersion, release.minAppVersion) &&
					isPluginApiCompatible(hostApiVersion, release.pluginApiVersion),
			)
			.sort((left, right) => compareAppVersions(right.version, left.version));
		const release = compatible[0];
		if (!release) return [];
		return [
			{
				...ability,
				version: release.version,
				releases: [release],
				config: {
					api_version: release.pluginApiVersion,
					permissions: release.permissions,
					commands: release.commands,
				},
			},
		];
	});
	const available = new Set(selected.map((ability) => `${ability.type}:${ability.slug}`));
	return selected.filter(
		(ability) =>
			ability.type !== "bundle" ||
			ability.config.members.every((member) => available.has(`${member.type}:${member.slug}`)),
	);
}
