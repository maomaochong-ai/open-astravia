import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { mergeMarketplaceDetail } from "./marketplace-detail.js";
import type { MarketplaceAbilityManifest, MarketplaceManifest } from "./marketplace-schema.js";
import { marketplaceDetailSchema } from "./marketplace-schema.js";
import { validateOpenMarketplaceMcp } from "./open-marketplace-mcp.js";
import { validateOpenMarketplacePlugin } from "./open-marketplace-plugin.js";
import { loadOpenMarketplacePresentation, readMarketplaceMemberMetadata } from "./open-marketplace-presentation.js";
import { assertSafeSkillTree, validateSkillPackage } from "./skill-package.js";

export interface ResolvedMarketplaceCatalog {
	/** Includes bundle-only packages so every installation uses the same identity and validators. */
	abilities: MarketplaceAbilityManifest[];
	listedSlugs: ReadonlySet<string>;
}

function packageDirectory(root: string, path: string): string {
	const directory = resolve(root, path);
	const rel = relative(root, directory);
	if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
		throw new Error(`Unsafe ability source: ${path}`);
	}
	const realRelative = relative(realpathSync(root), realpathSync(directory));
	if (
		lstatSync(directory).isSymbolicLink() ||
		isAbsolute(realRelative) ||
		realRelative === ".." ||
		realRelative.startsWith(`..${sep}`)
	) {
		throw new Error(`Unsafe ability source: ${path}`);
	}
	return directory;
}

/** Resolve references once, then validate all packages before publishing or activating any of them. */
export function loadMarketplaceCatalog(root: string, manifest: MarketplaceManifest): ResolvedMarketplaceCatalog {
	const abilities = structuredClone(manifest.abilities);
	const bySlug = new Map(abilities.map((ability) => [ability.slug, ability]));
	const listedSlugs = new Set(bySlug.keys());
	for (const bundle of manifest.abilities) {
		if (bundle.type !== "bundle") continue;
		for (const member of bundle.config.members) {
			const existing = bySlug.get(member.slug);
			if (existing) {
				if (existing.type !== member.type || (member.source && existing.source?.path !== member.source.path)) {
					throw new Error(`Conflicting bundle member source: ${member.type}:${member.slug}`);
				}
				continue;
			}
			if (!member.source) throw new Error(`Bundle member not found: ${member.type}:${member.slug}`);
			const directory = packageDirectory(root, member.source.path);
			assertSafeSkillTree(directory);
			const ability = readMarketplaceMemberMetadata(directory, member);
			abilities.push(ability);
			bySlug.set(ability.slug, ability);
		}
	}
	for (const ability of abilities) {
		if (!ability.source) continue;
		const sourceDir = packageDirectory(root, ability.source.path);
		if (ability.type === "mcp") {
			ability.config = validateOpenMarketplaceMcp(sourceDir, ability);
		} else if (ability.type === "plugin") {
			ability.config = validateOpenMarketplacePlugin(sourceDir, ability);
		} else if (ability.type !== "bundle") {
			validateSkillPackage(sourceDir, ability);
		}
		const presentation = loadOpenMarketplacePresentation(sourceDir, ability, manifest.marketplaceVersion);
		if (presentation) {
			ability.icon = presentation.icon ?? ability.icon;
			ability.detail = marketplaceDetailSchema.parse({
				...mergeMarketplaceDetail(ability.detail, presentation.detail),
				icon: presentation.icon ?? ability.detail.icon,
			});
		}
	}
	return { abilities, listedSlugs };
}
