import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type {
	OpenMarketplaceDetail,
	OpenMarketplaceDetailBlock,
	OpenMarketplaceDetailLocale,
} from "../../../preload/api-types/abilities.js";
import {
	type MarketplaceAbilityManifest,
	marketplaceDetailBlockSchema,
	marketplaceMetaEntrySchema,
} from "./marketplace-schema.js";

const ABILITY_PRESENTATION_FILE = "ability.json";
const MAX_DESCRIPTOR_BYTES = 64 * 1024;
const MAX_DETAIL_BYTES = 512 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);

const detailSourceSchema = z
	.object({
		format: z.enum(["blocks", "markdown"]),
		path: z.string().min(1),
		fallback: z.string().min(1).optional(),
		meta: z.array(marketplaceMetaEntrySchema).optional(),
	})
	.passthrough();

const localizedDetailSourceSchema = detailSourceSchema.partial({ format: true }).extend({
	path: z.string().min(1),
});

const abilityPresentationSchema = z
	.object({
		schemaVersion: z.literal(1),
		type: z.enum(["skill", "scene", "mcp", "plugin", "bundle"]),
		slug: z.string().min(1),
		version: z.string().min(1),
		icon: z.string().min(1).optional(),
		detail: detailSourceSchema
			.extend({ i18n: z.record(z.string(), localizedDetailSourceSchema).optional() })
			.optional(),
	})
	.passthrough();

const blocksDocumentSchema = z
	.object({
		schemaVersion: z.literal(1),
		blocks: z.array(marketplaceDetailBlockSchema),
	})
	.passthrough();

type DetailSource = z.infer<typeof detailSourceSchema>;

export interface OpenMarketplacePresentation {
	icon?: string;
	detail: OpenMarketplaceDetail;
}

function isContained(parent: string, target: string): boolean {
	const pathFromParent = relative(parent, target);
	return (
		pathFromParent === "" ||
		(!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent))
	);
}

function resolvePackageFile(sourceDir: string, value: string): string {
	if (!value || value.includes("\0") || isAbsolute(value)) {
		throw new Error(`Presentation path must be relative: ${value}`);
	}
	const target = resolve(sourceDir, value);
	if (!isContained(sourceDir, target)) throw new Error(`Presentation path escapes ability source: ${value}`);
	return target;
}

function readTextFile(sourceDir: string, value: string, maxBytes: number): string {
	const target = resolvePackageFile(sourceDir, value);
	const stats = statSync(target);
	if (!stats.isFile()) throw new Error(`Presentation path is not a file: ${value}`);
	if (stats.size > maxBytes) throw new Error(`Presentation file is too large: ${value}`);
	return readFileSync(target, "utf-8");
}

function createLocalAssetUrl(absolutePath: string, marketplaceVersion: string): string {
	const normalized = absolutePath.replace(/\\/g, "/");
	const pathname = normalized
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	const prefix = pathname.startsWith("/") ? "" : "/";
	return `vetta-file://local${prefix}${pathname}?v=${encodeURIComponent(marketplaceVersion)}`;
}

function resolveImageReference(
	sourceDir: string,
	value: string,
	marketplaceVersion: string,
	allowIconify: boolean,
): string {
	const trimmed = value.trim();
	if (allowIconify && trimmed.startsWith("solar:")) return trimmed;
	if (trimmed.startsWith("https://")) return trimmed;
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
		throw new Error(`Unsupported presentation asset protocol: ${trimmed}`);
	}
	const target = resolvePackageFile(sourceDir, trimmed);
	const extension = extname(target).toLowerCase();
	if (!IMAGE_EXTENSIONS.has(extension)) throw new Error(`Unsupported presentation image type: ${trimmed}`);
	const stats = statSync(target);
	if (!stats.isFile()) throw new Error(`Presentation asset is not a file: ${trimmed}`);
	if (stats.size > MAX_ASSET_BYTES) throw new Error(`Presentation asset is too large: ${trimmed}`);
	return createLocalAssetUrl(target, marketplaceVersion);
}

function resolveBlockAssets(
	blocks: OpenMarketplaceDetailBlock[],
	sourceDir: string,
	marketplaceVersion: string,
): OpenMarketplaceDetailBlock[] {
	return blocks.map((block) => {
		if (block.type === "feature-grid") {
			return {
				...block,
				items: block.items.map((item) => ({
					...item,
					icon: item.icon ? resolveImageReference(sourceDir, item.icon, marketplaceVersion, true) : undefined,
				})),
			};
		}
		if (block.type === "showcase" && block.showcase.brand_icon_url) {
			return {
				...block,
				showcase: {
					...block.showcase,
					brand_icon_url: resolveImageReference(
						sourceDir,
						block.showcase.brand_icon_url,
						marketplaceVersion,
						false,
					),
				},
			};
		}
		if (block.type === "image") {
			return {
				...block,
				src: resolveImageReference(sourceDir, block.src, marketplaceVersion, false),
			};
		}
		if (block.type === "links") {
			for (const item of block.items) {
				const protocol = new URL(item.href).protocol;
				if (protocol !== "https:" && protocol !== "http:") {
					throw new Error(`Unsupported presentation link protocol: ${item.href}`);
				}
			}
		}
		return block;
	});
}

function loadDetailSource(
	sourceDir: string,
	source: DetailSource,
	marketplaceVersion: string,
): OpenMarketplaceDetailLocale {
	try {
		if (source.format === "markdown") {
			return { content: readTextFile(sourceDir, source.path, MAX_DETAIL_BYTES), meta: source.meta };
		}
		const document = blocksDocumentSchema.parse(
			JSON.parse(readTextFile(sourceDir, source.path, MAX_DETAIL_BYTES)) as unknown,
		);
		return {
			blocks: resolveBlockAssets(document.blocks, sourceDir, marketplaceVersion),
			meta: source.meta,
		};
	} catch (error) {
		if (!source.fallback) throw error;
		return { content: readTextFile(sourceDir, source.fallback, MAX_DETAIL_BYTES), meta: source.meta };
	}
}

export function loadOpenMarketplacePresentation(
	sourceDir: string,
	ability: MarketplaceAbilityManifest,
	marketplaceVersion: string,
): OpenMarketplacePresentation | null {
	const descriptorPath = resolve(sourceDir, ABILITY_PRESENTATION_FILE);
	if (!existsSync(descriptorPath)) return null;
	const descriptor = abilityPresentationSchema.parse(
		JSON.parse(readTextFile(sourceDir, ABILITY_PRESENTATION_FILE, MAX_DESCRIPTOR_BYTES)) as unknown,
	);
	if (descriptor.type !== ability.type || descriptor.slug !== ability.slug || descriptor.version !== ability.version) {
		throw new Error(
			`Presentation identity does not match ability: ${ability.type}:${ability.slug}@${ability.version}`,
		);
	}

	const detail: OpenMarketplaceDetail = descriptor.detail
		? loadDetailSource(sourceDir, descriptor.detail, marketplaceVersion)
		: {};
	if (descriptor.detail?.i18n) {
		detail.i18n = Object.fromEntries(
			Object.entries(descriptor.detail.i18n).map(([locale, localized]) => [
				locale,
				loadDetailSource(
					sourceDir,
					{
						...localized,
						format: localized.format ?? descriptor.detail?.format ?? "markdown",
					},
					marketplaceVersion,
				),
			]),
		);
	}

	return {
		icon: descriptor.icon ? resolveImageReference(sourceDir, descriptor.icon, marketplaceVersion, true) : undefined,
		detail,
	};
}
