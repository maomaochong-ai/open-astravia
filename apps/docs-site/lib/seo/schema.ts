import { getSiteOrigin, sectionLandingPaths, sectionTitles, site, toAbsoluteUrl, toCanonicalPath } from "../site";

export interface JsonLdNode {
	"@type": string | string[];
	"@id"?: string;
	[key: string]: unknown;
}

export interface JsonLdGraph {
	"@context": "https://schema.org";
	"@graph": JsonLdNode[];
}

export interface BreadcrumbInput {
	name: string;
	path: string;
}

export interface PageSchemaInput {
	title: string;
	description?: string;
	path: string;
	isHome: boolean;
	breadcrumbs: BreadcrumbInput[];
	dateModified?: string;
}

const DEPRECATED_SCHEMA_TYPES = new Set(["HowTo", "FAQPage", "SpecialAnnouncement", "ClaimReview"]);

export function organizationId(origin = getSiteOrigin()): string {
	return `${site.marketingUrl}/#organization`;
}

export function softwareId(): string {
	return `${site.marketingUrl}/#software`;
}

export function websiteId(origin = getSiteOrigin()): string {
	return `${origin}/#website`;
}

export function buildOrganizationNode(origin = getSiteOrigin()): JsonLdNode {
	return {
		"@type": "Organization",
		"@id": organizationId(origin),
		name: site.name,
		url: site.marketingUrl,
		logo: {
			"@type": "ImageObject",
			url: toAbsoluteUrl(site.logoPath, origin),
		},
		sameAs: [site.githubUrl],
	};
}

export function buildSoftwareApplicationNode(origin = getSiteOrigin()): JsonLdNode {
	return {
		"@type": "SoftwareApplication",
		"@id": softwareId(),
		name: site.name,
		url: site.marketingUrl,
		applicationCategory: site.applicationCategory,
		operatingSystem: site.operatingSystem,
		downloadUrl: site.downloadUrl,
		image: toAbsoluteUrl(site.logoPath, origin),
		publisher: { "@id": organizationId(origin) },
	};
}

export function buildWebsiteNode(origin = getSiteOrigin()): JsonLdNode {
	return {
		"@type": "WebSite",
		"@id": websiteId(origin),
		name: site.title,
		url: `${origin}/`,
		inLanguage: site.locale,
		publisher: { "@id": organizationId(origin) },
		about: { "@id": softwareId() },
	};
}

export function buildBreadcrumbList(items: BreadcrumbInput[], origin = getSiteOrigin()): JsonLdNode {
	return {
		"@type": "BreadcrumbList",
		itemListElement: items.map((item, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: item.name,
			item: toAbsoluteUrl(item.path, origin),
		})),
	};
}

export function buildWebPageNode(input: PageSchemaInput, origin = getSiteOrigin()): JsonLdNode {
	const url = toAbsoluteUrl(input.path, origin);
	const node: JsonLdNode = {
		"@type": input.isHome ? "WebPage" : ["WebPage", "TechArticle"],
		"@id": url,
		url,
		name: input.isHome ? site.title : input.title,
		headline: input.isHome ? site.title : input.title,
		description: input.description ?? site.description,
		inLanguage: site.locale,
		isPartOf: { "@id": websiteId(origin) },
		about: { "@id": softwareId() },
		publisher: { "@id": organizationId(origin) },
		author: { "@id": organizationId(origin) },
		image: toAbsoluteUrl(site.logoPath, origin),
	};

	if (input.dateModified) {
		node.dateModified = input.dateModified;
	}

	return node;
}

export function buildPageJsonLd(input: PageSchemaInput, origin = getSiteOrigin()): JsonLdGraph {
	return {
		"@context": "https://schema.org",
		"@graph": [
			buildOrganizationNode(origin),
			buildSoftwareApplicationNode(origin),
			buildWebsiteNode(origin),
			buildWebPageNode(input, origin),
			buildBreadcrumbList(input.breadcrumbs, origin),
		],
	};
}

export function collectSchemaTypes(graph: JsonLdGraph): string[] {
	return graph["@graph"].flatMap((node) => (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]));
}

export function hasDeprecatedSchemaType(graph: JsonLdGraph): boolean {
	return collectSchemaTypes(graph).some((type) => DEPRECATED_SCHEMA_TYPES.has(type));
}

export function breadcrumbItemsFromSlugs(slugs: string[], title: string): BreadcrumbInput[] {
	const items: BreadcrumbInput[] = [{ name: site.title, path: "/" }];
	const section = slugs[0];
	if (!section) return items;

	const sectionPath = sectionLandingPaths[section] ?? `/${section}/`;
	const sectionName = sectionTitles[section] ?? section;
	const pagePath = toCanonicalPath(`/${slugs.join("/")}/`);

	if (pagePath !== sectionPath) {
		items.push({ name: sectionName, path: sectionPath });
	}

	if (pagePath !== "/") {
		items.push({ name: title, path: pagePath });
	}

	return items;
}
