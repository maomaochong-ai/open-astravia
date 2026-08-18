import { JsonLd } from "@/components/json-ld";
import { getMDXComponents } from "@/components/mdx";
import { getGitLastModified } from "@/lib/seo/last-modified";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { breadcrumbItemsFromSlugs, buildPageJsonLd } from "@/lib/seo/schema";
import { sectionLabels } from "@/lib/site";
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
	params: Promise<{ slug?: string[] }>;
}

export default async function Page({ params }: PageProps) {
	const { slug } = await params;
	const page = source.getPage(slug);

	if (!page) notFound();

	const MDX = page.data.body;
	const isHome = page.slugs.length === 0;
	const jsonLd = buildPageJsonLd({
		title: page.data.title,
		description: page.data.description,
		path: page.url,
		isHome,
		dateModified: page.absolutePath ? getGitLastModified(page.absolutePath) : undefined,
		breadcrumbs: breadcrumbItemsFromSlugs(page.slugs, page.data.title),
	});

	if (isHome) {
		return (
			<>
				<JsonLd data={jsonLd} />
				<DocsPage full breadcrumb={{ enabled: false }} footer={{ enabled: false }} className="docs-home-page">
					<DocsBody className="docs-home-body">
						<MDX components={getMDXComponents()} />
					</DocsBody>
				</DocsPage>
			</>
		);
	}

	const sectionLabel = sectionLabels[page.slugs[0] ?? ""] ?? "VETTA / DOCUMENTATION";

	return (
		<>
			<JsonLd data={jsonLd} />
			<DocsPage toc={page.data.toc} full={page.data.full} className="docs-article-page">
				<header className="docs-page-header">
					<p className="docs-page-eyebrow">{sectionLabel}</p>
					<DocsTitle className="docs-page-title">{page.data.title}</DocsTitle>
					<DocsDescription className="docs-page-description">{page.data.description}</DocsDescription>
				</header>
				<DocsBody className="docs-article-body">
					<MDX components={getMDXComponents()} />
				</DocsBody>
			</DocsPage>
		</>
	);
}

export function generateStaticParams() {
	return source.generateParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
	const { slug } = await params;
	const page = source.getPage(slug);

	if (!page) notFound();

	return buildPageMetadata({
		title: page.data.title,
		description: page.data.description,
		path: page.url,
		isHome: page.slugs.length === 0,
	});
}
