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
	marketplaceDetailSchema,
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

const referencedDetailSchema = detailSourceSchema.extend({
	i18n: z.record(z.string(), localizedDetailSourceSchema).optional(),
});

const markdownFileBlockSchema = z.object({
	type: z.literal("markdown"),
	path: z.string().min(1),
});

/**
 * ability.json 的结构化详情允许 Markdown 区块引用包内文件；市场 API 与 Renderer
 * 仍只接收已经解析好的 content，避免把本地路径提升为运行时协议。
 */
const presentationDetailBlockSchema = z
	.unknown()
	.superRefine((value, context) => {
		if (value == null || typeof value !== "object" || Array.isArray(value)) return;
		const block = value as Record<string, unknown>;
		if (block.type !== "markdown") return;
		const hasContent = typeof block.content === "string";
		const hasPath = typeof block.path === "string";
		if (hasContent === hasPath) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Markdown detail block must provide exactly one of content or path",
			});
		}
	})
	.pipe(z.union([marketplaceDetailBlockSchema, markdownFileBlockSchema]));

const inlineDetailLocaleSchema = marketplaceDetailSchema
	.omit({ license: true, author: true, icon: true, tags: true, i18n: true })
	.extend({ blocks: z.array(presentationDetailBlockSchema).optional() });

const inlineDetailSchema = marketplaceDetailSchema.omit({ i18n: true }).extend({
	blocks: z.array(presentationDetailBlockSchema).optional(),
	i18n: z.record(z.string(), inlineDetailLocaleSchema).optional(),
});

const abilityPresentationSchema = z
	.object({
		schemaVersion: z.literal(1),
		type: z.enum(["skill", "scene", "mcp", "plugin", "bundle"]),
		slug: z.string().min(1),
		version: z.string().min(1),
		icon: z.string().min(1).optional(),
		detail: z.union([referencedDetailSchema, inlineDetailSchema]).optional(),
	})
	.passthrough();

const blocksDocumentSchema = z
	.object({
		schemaVersion: z.literal(1),
		blocks: z.array(presentationDetailBlockSchema),
	})
	.passthrough();

type DetailSource = z.infer<typeof detailSourceSchema>;
type PresentationDetailBlock = z.infer<typeof presentationDetailBlockSchema>;
type InlineDetailLocale = z.infer<typeof inlineDetailLocaleSchema>;
type InlineDetail = z.infer<typeof inlineDetailSchema>;
type PresentationAssetUrlResolver = (absolutePath: string, relativePath: string) => string;

export interface AbilityPresentationIdentity {
	type: MarketplaceAbilityManifest["type"];
	slug: string;
	version: string;
}

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
	resolveAssetUrl: PresentationAssetUrlResolver,
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
	return resolveAssetUrl(target, trimmed);
}

function resolveBlockAssets(
	blocks: PresentationDetailBlock[],
	sourceDir: string,
	resolveAssetUrl: PresentationAssetUrlResolver,
): OpenMarketplaceDetailBlock[] {
	return blocks.map((block) => {
		if (block.type === "hero" && block.image) {
			return {
				...block,
				image: resolveImageReference(sourceDir, block.image, resolveAssetUrl, false),
			};
		}
		if (block.type === "feature-grid") {
			return {
				...block,
				items: block.items.map((item) => ({
					...item,
					icon: item.icon ? resolveImageReference(sourceDir, item.icon, resolveAssetUrl, true) : undefined,
				})),
			};
		}
		if (block.type === "showcase" && block.showcase.brand_icon_url) {
			return {
				...block,
				showcase: {
					...block.showcase,
					brand_icon_url: resolveImageReference(sourceDir, block.showcase.brand_icon_url, resolveAssetUrl, false),
				},
			};
		}
		if (block.type === "image") {
			return {
				...block,
				src: resolveImageReference(sourceDir, block.src, resolveAssetUrl, false),
			};
		}
		if (block.type === "gallery") {
			return {
				...block,
				items: block.items.map((item) => ({
					...item,
					src: resolveImageReference(sourceDir, item.src, resolveAssetUrl, false),
				})),
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
		if (block.type === "markdown" && "path" in block) {
			return {
				type: "markdown",
				content: readTextFile(sourceDir, block.path, MAX_DETAIL_BYTES),
			};
		}
		return block;
	});
}

function resolveShowcaseAssets(
	showcases: OpenMarketplaceDetailLocale["showcases"],
	sourceDir: string,
	resolveAssetUrl: PresentationAssetUrlResolver,
): OpenMarketplaceDetailLocale["showcases"] {
	return showcases?.map((showcase) => ({
		...showcase,
		brand_icon_url: showcase.brand_icon_url
			? resolveImageReference(sourceDir, showcase.brand_icon_url, resolveAssetUrl, false)
			: undefined,
	}));
}

function resolveInlineDetailLocale(
	detail: InlineDetailLocale,
	sourceDir: string,
	resolveAssetUrl: PresentationAssetUrlResolver,
): OpenMarketplaceDetailLocale {
	const { blocks, showcases, ...base } = detail;
	return {
		...base,
		blocks: blocks ? resolveBlockAssets(blocks, sourceDir, resolveAssetUrl) : undefined,
		showcases: resolveShowcaseAssets(showcases, sourceDir, resolveAssetUrl),
	};
}

function resolveInlineDetail(
	detail: InlineDetail,
	sourceDir: string,
	resolveAssetUrl: PresentationAssetUrlResolver,
): OpenMarketplaceDetail {
	const { i18n, blocks, showcases, ...base } = detail;
	return {
		...base,
		blocks: blocks ? resolveBlockAssets(blocks, sourceDir, resolveAssetUrl) : undefined,
		showcases: resolveShowcaseAssets(showcases, sourceDir, resolveAssetUrl),
		i18n: i18n
			? Object.fromEntries(
					Object.entries(i18n).map(([locale, localized]) => [
						locale,
						resolveInlineDetailLocale(localized, sourceDir, resolveAssetUrl),
					]),
				)
			: undefined,
	};
}

function loadDetailSource(
	sourceDir: string,
	source: DetailSource,
	resolveAssetUrl: PresentationAssetUrlResolver,
): OpenMarketplaceDetailLocale {
	try {
		if (source.format === "markdown") {
			return { content: readTextFile(sourceDir, source.path, MAX_DETAIL_BYTES), meta: source.meta };
		}
		const document = blocksDocumentSchema.parse(
			JSON.parse(readTextFile(sourceDir, source.path, MAX_DETAIL_BYTES)) as unknown,
		);
		return {
			blocks: resolveBlockAssets(document.blocks, sourceDir, resolveAssetUrl),
			meta: source.meta,
		};
	} catch (error) {
		if (!source.fallback) throw error;
		return { content: readTextFile(sourceDir, source.fallback, MAX_DETAIL_BYTES), meta: source.meta };
	}
}

function isReferencedDetail(
	detail: z.infer<typeof referencedDetailSchema> | z.infer<typeof inlineDetailSchema>,
): detail is z.infer<typeof referencedDetailSchema> {
	return "format" in detail && "path" in detail;
}

/** 读取任意受信任能力包自己的 ability.json；调用方决定本地资源应映射到哪种协议。 */
export function loadAbilityPackagePresentation(
	sourceDir: string,
	identity: AbilityPresentationIdentity,
	assetVersion: string,
	assetUrlResolver?: PresentationAssetUrlResolver,
): OpenMarketplacePresentation | null {
	const descriptorPath = resolve(sourceDir, ABILITY_PRESENTATION_FILE);
	if (!existsSync(descriptorPath)) return null;
	const descriptor = abilityPresentationSchema.parse(
		JSON.parse(readTextFile(sourceDir, ABILITY_PRESENTATION_FILE, MAX_DESCRIPTOR_BYTES)) as unknown,
	);
	if (
		descriptor.type !== identity.type ||
		descriptor.slug !== identity.slug ||
		descriptor.version !== identity.version
	) {
		throw new Error(
			`Presentation identity does not match ability: ${identity.type}:${identity.slug}@${identity.version}`,
		);
	}
	const resolveAssetUrl =
		assetUrlResolver ?? ((absolutePath: string) => createLocalAssetUrl(absolutePath, assetVersion));

	let detail: OpenMarketplaceDetail = {};
	if (descriptor.detail) {
		if (isReferencedDetail(descriptor.detail)) {
			const referencedDetail = descriptor.detail;
			detail = loadDetailSource(sourceDir, referencedDetail, resolveAssetUrl);
			if (referencedDetail.i18n) {
				detail.i18n = Object.fromEntries(
					Object.entries(referencedDetail.i18n).map(([locale, localized]) => [
						locale,
						loadDetailSource(
							sourceDir,
							{
								...localized,
								format: localized.format ?? referencedDetail.format,
							},
							resolveAssetUrl,
						),
					]),
				);
			}
		} else {
			detail = resolveInlineDetail(descriptor.detail, sourceDir, resolveAssetUrl);
		}
	}

	return {
		icon: descriptor.icon ? resolveImageReference(sourceDir, descriptor.icon, resolveAssetUrl, true) : undefined,
		detail,
	};
}

export function loadOpenMarketplacePresentation(
	sourceDir: string,
	ability: MarketplaceAbilityManifest,
	marketplaceVersion: string,
): OpenMarketplacePresentation | null {
	return loadAbilityPackagePresentation(sourceDir, ability, marketplaceVersion);
}
