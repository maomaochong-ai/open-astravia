import { posix } from "node:path";
import { z } from "zod";
import { compareAppVersions, isValidAppVersion } from "./marketplace-compatibility.js";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const appVersionSchema = z.string().trim().refine(isValidAppVersion, "Must be a semantic app version");
const stableVersionSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);

export const marketplaceMetaEntrySchema = z
	.object({
		key: z.enum(["homepage", "repository", "docs", "license"]).optional(),
		label: z.string().min(1).optional(),
		value: z.string().min(1),
	})
	.passthrough();

const showcaseSchema = z
	.object({
		template: z.enum(["chat-over-canvas", "chat-thread", "canvas-hero", "prompt-result", "spotlight", "workbench"]),
		user_prompt: z.string(),
		assistant_reply: z.string(),
		canvas: z.enum(["design", "code", "docs", "generic", "browser", "terminal", "board"]).optional(),
		brand_icon_url: z.string().optional(),
		brand_name: z.string().optional(),
	})
	.passthrough();

export const marketplaceDetailBlockSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("hero"),
		eyebrow: z.string().optional(),
		title: z.string().min(1),
		description: z.string().optional(),
		image: z.string().min(1).optional(),
		image_alt: z.string().optional(),
		layout: z.enum(["split", "stacked"]).default("split"),
		badges: z.array(z.string().min(1)).max(8).optional(),
	}),
	z.object({
		type: z.literal("feature-grid"),
		title: z.string().optional(),
		items: z
			.array(
				z.object({
					title: z.string().min(1),
					description: z.string(),
					icon: z.string().optional(),
				}),
			)
			.min(1),
	}),
	z.object({
		type: z.literal("steps"),
		title: z.string().optional(),
		items: z.array(z.object({ title: z.string().min(1), description: z.string().optional() })).min(1),
	}),
	z.object({ type: z.literal("showcase"), showcase: showcaseSchema }),
	z.object({
		type: z.literal("image"),
		src: z.string().min(1),
		alt: z.string().optional(),
		caption: z.string().optional(),
	}),
	z.object({
		type: z.literal("gallery"),
		title: z.string().optional(),
		items: z
			.array(
				z.object({
					src: z.string().min(1),
					alt: z.string().optional(),
					caption: z.string().optional(),
				}),
			)
			.min(1)
			.max(8),
	}),
	z.object({
		type: z.literal("stats"),
		title: z.string().optional(),
		items: z
			.array(
				z.object({
					value: z.string().min(1),
					label: z.string().min(1),
					description: z.string().optional(),
				}),
			)
			.min(1)
			.max(6),
	}),
	z.object({
		type: z.literal("comparison"),
		title: z.string().optional(),
		left: z.object({
			title: z.string().min(1),
			items: z.array(z.string().min(1)).min(1).max(8),
			tone: z.enum(["neutral", "accent"]).default("neutral"),
		}),
		right: z.object({
			title: z.string().min(1),
			items: z.array(z.string().min(1)).min(1).max(8),
			tone: z.enum(["neutral", "accent"]).default("accent"),
		}),
	}),
	z.object({
		type: z.literal("callout"),
		tone: z.enum(["info", "success", "warning"]).default("info"),
		title: z.string().optional(),
		content: z.string(),
	}),
	z.object({ type: z.literal("markdown"), content: z.string() }),
	z.object({
		type: z.literal("links"),
		title: z.string().optional(),
		items: z.array(z.object({ label: z.string().min(1), href: z.string().url() })).min(1),
	}),
]);

const detailLocaleSchema = z
	.object({
		name: z.string().optional(),
		description: z.string().optional(),
		content: z.string().optional(),
		showcases: z.array(showcaseSchema).optional(),
		meta: z.array(marketplaceMetaEntrySchema).optional(),
		blocks: z.array(marketplaceDetailBlockSchema).optional(),
	})
	.passthrough();

export const marketplaceDetailSchema = detailLocaleSchema.extend({
	license: z.string().optional(),
	author: z.string().optional(),
	icon: z.string().optional(),
	tags: z.array(z.string()).optional(),
	i18n: z.record(z.string(), detailLocaleSchema).optional(),
});

const sourceSchema = z.object({ path: z.string().min(1) }).passthrough();
const pluginReleaseSchema = z.object({
	version: stableVersionSchema,
	minAppVersion: stableVersionSchema,
	pluginApiVersion: z.string().regex(/^\^\d+\.\d+\.\d+$/),
	permissions: z.array(z.string()).default([]),
	commands: z.array(z.string()).default([]),
	artifact: z.object({
		url: z
			.string()
			.url()
			.refine((value) => {
				const url = new URL(value);
				return url.protocol === "https:" && !url.username && !url.password && !url.hash;
			}, "Plugin artifact must use HTTPS without credentials or fragment"),
		sha256: z.string().regex(/^[a-f0-9]{64}$/),
	}),
});
const abilityBaseSchema = z
	.object({
		slug: z.string().regex(SLUG_PATTERN),
		name: z.string().min(1),
		description: z.string().default(""),
		version: z.string().regex(VERSION_PATTERN),
		configVersion: z.number().int().positive().default(1),
		license: z.string().default(""),
		author: z.string().default(""),
		icon: z.string().default(""),
		category: z.string().default(""),
		categoryI18n: z.record(z.string(), z.string()).optional(),
		tags: z.array(z.string()).default([]),
		detail: marketplaceDetailSchema.default({}),
	})
	.passthrough();

const skillAbilitySchema = abilityBaseSchema.extend({
	type: z.literal("skill"),
	source: sourceSchema,
	config: z.object({}).passthrough().default({}),
});
const sceneAbilitySchema = abilityBaseSchema.extend({
	type: z.literal("scene"),
	source: sourceSchema,
	config: z.object({}).passthrough().default({}),
});
const pluginAbilitySchema = abilityBaseSchema.extend({
	type: z.literal("plugin"),
	source: sourceSchema,
	/** Schema v3: immutable archives; source.path contains presentation assets only. */
	releases: z.array(pluginReleaseSchema).min(1).optional(),
	config: z
		.object({
			api_version: z.string().optional(),
			permissions: z.array(z.string()).optional(),
			commands: z.array(z.string()).optional(),
		})
		.passthrough()
		.default({}),
});
const mcpAbilitySchema = abilityBaseSchema.extend({
	type: z.literal("mcp"),
	source: sourceSchema,
	config: z
		.object({ mcp: z.record(z.string(), z.unknown()).optional() })
		.passthrough()
		.default({}),
});
const bundleMemberSchema = z.object({
	type: z.enum(["skill", "scene", "mcp", "plugin"]),
	slug: z.string().regex(SLUG_PATTERN),
	source: sourceSchema.optional(),
	/** Schema v3 bundle-only plugins keep release metadata in the index. */
	releases: z.array(pluginReleaseSchema).min(1).optional(),
});
const bundleAbilitySchema = abilityBaseSchema.extend({
	type: z.literal("bundle"),
	source: sourceSchema.optional(),
	config: z.object({ members: z.array(bundleMemberSchema).min(1) }).passthrough(),
});

export const marketplaceAbilitySchema = z.discriminatedUnion("type", [
	skillAbilitySchema,
	sceneAbilitySchema,
	mcpAbilitySchema,
	pluginAbilitySchema,
	bundleAbilitySchema,
]);

export const MARKETPLACE_SCHEMA_VERSION = 3;

export const marketplaceManifestSchema = z
	.object({
		schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(MARKETPLACE_SCHEMA_VERSION)]),
		name: z.string().regex(SLUG_PATTERN),
		displayName: z.string().min(1).optional(),
		marketplaceVersion: z.string().regex(VERSION_PATTERN),
		repository: z.string().url(),
		minAppVersion: appVersionSchema,
		abilities: z.array(marketplaceAbilitySchema),
	})
	.passthrough();

export type MarketplaceManifest = z.infer<typeof marketplaceManifestSchema>;
export type MarketplaceAbilityManifest = z.infer<typeof marketplaceAbilitySchema>;
export type MarketplacePluginRelease = z.infer<typeof pluginReleaseSchema>;
export type MarketplaceBundleMember = z.infer<typeof bundleMemberSchema>;

export function normalizeMarketplaceSourcePath(value: string): string {
	const slashPath = value.replace(/\\/g, "/");
	if (slashPath.includes("\0") || slashPath.startsWith("/") || /^[a-zA-Z]:/.test(slashPath)) {
		throw new Error(`Ability source path must be relative: ${value}`);
	}
	const normalized = posix.normalize(slashPath).replace(/^\.\//, "").replace(/\/$/, "");
	if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
		throw new Error(`Ability source path escapes marketplace root: ${value}`);
	}
	return normalized;
}

export function parseMarketplaceManifest(input: unknown): MarketplaceManifest {
	if (input != null && typeof input === "object" && !Array.isArray(input)) {
		const abilities = (input as Record<string, unknown>).abilities;
		if (Array.isArray(abilities)) {
			for (const ability of abilities) {
				if (
					ability != null &&
					typeof ability === "object" &&
					!Array.isArray(ability) &&
					(ability as Record<string, unknown>).type === "mcp" &&
					"config" in ability
				) {
					throw new Error("MCP configuration must be stored in source.path/mcp.json");
				}
			}
		}
	}
	const manifest = marketplaceManifestSchema.parse(input);
	const seen = new Set<string>();
	for (const ability of manifest.abilities) {
		if (seen.has(ability.slug)) throw new Error(`Duplicate ability slug in marketplace: ${ability.slug}`);
		seen.add(ability.slug);
		if (ability.type === "plugin") {
			assertPluginReleases(
				manifest.schemaVersion,
				manifest.minAppVersion,
				ability.slug,
				ability.releases,
				ability.version,
			);
		}
		const source = ability.source;
		if (source) source.path = normalizeMarketplaceSourcePath(source.path);
	}
	const bySlug = new Map(manifest.abilities.map((ability) => [ability.slug, ability]));
	const bundlePluginReleases = new Map<string, string>();
	for (const ability of manifest.abilities) {
		if (ability.type !== "bundle") continue;
		const memberIds = new Set<string>();
		for (const member of ability.config.members) {
			if (member.releases && (member.type !== "plugin" || !member.source)) {
				throw new Error(`Only bundle-only plugin members can declare releases: ${member.slug}`);
			}
			if (member.type === "plugin" && member.source) {
				assertPluginReleases(manifest.schemaVersion, manifest.minAppVersion, member.slug, member.releases);
			}
			if (member.source) {
				if (manifest.schemaVersion === 1)
					throw new Error("Package bundle members require schemaVersion 2 or newer");
				member.source.path = normalizeMarketplaceSourcePath(member.source.path);
			}
			const memberId = `${member.type}:${member.slug}`;
			if (memberIds.has(memberId)) throw new Error(`Duplicate bundle member: ${memberId}`);
			memberIds.add(memberId);
			const target = bySlug.get(member.slug);
			if (member.releases) {
				if (target) throw new Error(`Listed plugin must keep releases on its own entry: ${member.slug}`);
				const signature = JSON.stringify(member.releases);
				const previous = bundlePluginReleases.get(member.slug);
				if (previous && previous !== signature)
					throw new Error(`Conflicting bundle plugin releases: ${member.slug}`);
				bundlePluginReleases.set(member.slug, signature);
			}
			if ((!target && !member.source) || (target && target.type !== member.type)) {
				throw new Error(`Bundle member not found in marketplace: ${memberId}`);
			}
		}
	}
	return manifest;
}

function assertPluginReleases(
	schemaVersion: number,
	minAppVersion: string,
	slug: string,
	releases: MarketplacePluginRelease[] | undefined,
	catalogVersion?: string,
): void {
	if (schemaVersion !== 3) {
		if (releases) throw new Error("Plugin releases require schemaVersion 3");
		return;
	}
	if (!releases) throw new Error(`Plugin ${slug} has no versioned releases`);
	const versions = new Set<string>();
	for (const release of releases) {
		if (versions.has(release.version)) throw new Error(`Duplicate plugin release: ${slug}@${release.version}`);
		versions.add(release.version);
		if (compareAppVersions(release.minAppVersion, minAppVersion) < 0) {
			throw new Error(`Plugin release requires an app older than its marketplace: ${slug}@${release.version}`);
		}
	}
	if (catalogVersion) {
		const latest = releases.reduce((left, right) =>
			compareAppVersions(left.version, right.version) >= 0 ? left : right,
		);
		if (catalogVersion !== latest.version)
			throw new Error(`Plugin catalog version does not match latest release: ${slug}`);
	}
}
