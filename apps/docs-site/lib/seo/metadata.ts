import type { Metadata } from "next";
import type { DocsLanguage } from "../i18n";
import { getLocalizedSite, getSiteOrigin, site, toAbsoluteUrl, toCanonicalPath, toMarkdownPath } from "../site";

export interface PageMetadataInput {
	title: string;
	description?: string;
	path: string;
	isHome: boolean;
	locale?: DocsLanguage;
}

function socialImages(origin = getSiteOrigin()) {
	return [
		{
			url: toAbsoluteUrl(site.ogImagePath, origin),
			width: 1200,
			height: 630,
			alt: `${site.name} Documentation`,
		},
	];
}

export function buildRootMetadata(origin = getSiteOrigin()): Metadata {
	return {
		metadataBase: new URL(origin),
		title: {
			default: site.title,
			template: `%s | ${site.title}`,
		},
		description: site.description,
		applicationName: site.name,
		authors: [{ name: site.name, url: site.marketingUrl }],
		creator: site.name,
		publisher: site.name,
		category: "technology",
		robots: {
			index: true,
			follow: true,
			googleBot: {
				index: true,
				follow: true,
				"max-image-preview": "large",
				"max-snippet": -1,
				"max-video-preview": -1,
			},
		},
		icons: {
			icon: "/favicon.svg",
			apple: site.logoPath,
		},
		openGraph: {
			type: "website",
			locale: site.openGraphLocale,
			siteName: site.title,
			title: site.title,
			description: site.description,
			url: "/",
			images: socialImages(origin),
		},
		twitter: {
			card: "summary_large_image",
			title: site.title,
			description: site.description,
			images: [toAbsoluteUrl(site.ogImagePath, origin)],
		},
	};
}

export function buildPageMetadata(input: PageMetadataInput): Metadata {
	const language = input.locale ?? "zh";
	const localized = getLocalizedSite(language);
	const path = toCanonicalPath(input.path);
	const title = input.isHome
		? { absolute: localized.title }
		: language === "en"
			? { absolute: `${input.title} | ${localized.title}` }
			: input.title;
	const displayTitle = input.isHome ? localized.title : input.title;
	const description = input.description ?? localized.description;
	const markdownPath = input.isHome ? undefined : toMarkdownPath(path);
	const origin = getSiteOrigin();

	return {
		title,
		description,
		alternates: {
			canonical: path,
			types: markdownPath ? { "text/markdown": markdownPath } : undefined,
		},
		openGraph: {
			type: input.isHome ? "website" : "article",
			locale: localized.openGraphLocale,
			siteName: localized.title,
			url: path,
			title: displayTitle,
			description,
			images: socialImages(origin),
		},
		twitter: {
			card: "summary_large_image",
			title: displayTitle,
			description,
			images: [toAbsoluteUrl(site.ogImagePath, origin)],
		},
	};
}

export function buildMarkdownAlternateUrl(path: string, origin = getSiteOrigin()): string {
	return toAbsoluteUrl(toMarkdownPath(path), origin);
}
