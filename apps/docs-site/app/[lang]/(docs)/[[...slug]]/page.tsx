import { JsonLd } from "@/components/json-ld";
import { DocsKicker } from "@/components/kicker";
import { DocsCallout } from "@/components/reading";
import { getMDXComponents } from "@/components/mdx";
import { PageToolbar } from "@/components/page-toolbar";
import { TocActions } from "@/components/toc-actions";
import { getGitLastModified } from "@/lib/seo/last-modified";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { breadcrumbItemsFromSlugs, buildPageJsonLd } from "@/lib/seo/schema";
import { englishPageDescriptions, englishPageTitles, isDocsLanguage, type DocsLanguage } from "@/lib/i18n";
import { getSectionLabel } from "@/lib/site";
import { source } from "@/lib/source";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

interface PageProps {
	params: Promise<{ lang: string; slug?: string[] }>;
}

function parseLanguage(value: string): DocsLanguage {
	if (!isDocsLanguage(value)) notFound();
	return value;
}

export default async function Page({ params }: PageProps) {
	const { lang, slug } = await params;
	const language = parseLanguage(lang);
	const page = source.getPage(slug, language);

	if (!page) notFound();

	const MDX = page.data.body;
	const isHome = page.slugs.length === 0;
	const pageKey = page.slugs.join("/") || "index";
	const pageTitle = language === "en" ? (englishPageTitles[pageKey] ?? page.data.title) : page.data.title;
	const pageDescription = language === "en" ? (englishPageDescriptions[pageKey] ?? page.data.description) : page.data.description;
	const dateModified = page.absolutePath ? getGitLastModified(page.absolutePath) : undefined;
	const hasEnglishContent = page.absolutePath?.replaceAll("\\", "/").includes("/content/docs/en/") ?? false;
	const jsonLd = buildPageJsonLd({
		title: pageTitle,
		description: pageDescription,
		path: page.url,
		locale: language,
		isHome,
		breadcrumbs: breadcrumbItemsFromSlugs(page.slugs, pageTitle, language),
		dateModified,
	});

	if (isHome) {
		return (
			<>
				<JsonLd data={jsonLd} />
				<DocsPage full breadcrumb={{ enabled: false }} footer={{ enabled: false }} className="docs-home-page">
					<DocsBody className="docs-home-body">
						<MDX components={getMDXComponents(language)} />
					</DocsBody>
				</DocsPage>
			</>
		);
	}

	const sectionLabel = getSectionLabel(page.slugs[0], language);

	return (
		<>
			<JsonLd data={jsonLd} />
			<DocsPage
				toc={page.data.toc}
				full={page.data.full}
				className="pb-20"
				tableOfContent={{
					style: "clerk",
					footer: <TocActions path={page.url} language={language} />,
				}}
			>
				<header className="mt-2">
					<div className="flex items-center justify-between gap-4">
						<DocsKicker className="mb-0">{sectionLabel}</DocsKicker>
						<PageToolbar dateModified={dateModified} locale={language} />
					</div>
					<div className="mt-7 grid items-end gap-5 border-b border-fd-border pb-8 md:mt-9 md:grid-cols-[minmax(0,1.2fr)_minmax(12rem,0.8fr)] md:gap-10 md:pb-10">
						<DocsTitle className="m-0 max-w-[18ch] font-display text-[2.35rem] font-semibold leading-[1.14] tracking-[-0.03em] text-pretty md:text-[3.35rem]">
							{pageTitle}
						</DocsTitle>
						<DocsDescription className="m-0 max-w-[26rem] text-[0.95rem] leading-[1.7] text-fd-muted-foreground md:justify-self-end md:text-[1.02rem]">
							{pageDescription}
						</DocsDescription>
					</div>
					<span className="-mb-px block h-0.5 w-14 bg-vetta-coral" aria-hidden="true" />
				</header>
				<DocsBody className="docs-article-body max-w-[54rem] pt-8">
					{language === "en" && !hasEnglishContent ? (
						<DocsCallout type="info" title="English translation in progress">
							This page is currently shown in Chinese while its English translation is being prepared.
						</DocsCallout>
					) : null}
					<MDX components={getMDXComponents(language)} />
				</DocsBody>
			</DocsPage>
		</>
	);
}

export function generateStaticParams() {
	return source.generateParams("slug", "lang");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
	const { lang, slug } = await params;
	const language = parseLanguage(lang);
	const page = source.getPage(slug, language);

	if (!page) notFound();

	return buildPageMetadata({
		title: language === "en" ? (englishPageTitles[page.slugs.join("/") || "index"] ?? page.data.title) : page.data.title,
		description: language === "en" ? (englishPageDescriptions[page.slugs.join("/") || "index"] ?? page.data.description) : page.data.description,
		path: page.url,
		locale: language,
		isHome: page.slugs.length === 0,
	});
}
