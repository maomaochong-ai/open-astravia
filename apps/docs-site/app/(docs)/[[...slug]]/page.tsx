import { JsonLd } from "@/components/json-ld";
import { DocsKicker } from "@/components/kicker";
import { getMDXComponents } from "@/components/mdx";
import { PageToolbar } from "@/components/page-toolbar";
import { TocActions } from "@/components/toc-actions";
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
	const dateModified = page.absolutePath ? getGitLastModified(page.absolutePath) : undefined;
	const jsonLd = buildPageJsonLd({
		title: page.data.title,
		description: page.data.description,
		path: page.url,
		isHome,
		dateModified,
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
			<DocsPage
				toc={page.data.toc}
				full={page.data.full}
				className="pb-20"
				tableOfContent={{
					style: "clerk",
					footer: <TocActions path={page.url} />,
				}}
			>
				<header className="mt-2">
					<div className="flex items-center justify-between gap-4">
						<DocsKicker className="mb-0">{sectionLabel}</DocsKicker>
						<PageToolbar dateModified={dateModified} />
					</div>
					<div className="mt-7 grid items-end gap-5 border-b border-fd-border pb-8 md:mt-9 md:grid-cols-[minmax(0,1.2fr)_minmax(12rem,0.8fr)] md:gap-10 md:pb-10">
						<DocsTitle className="m-0 max-w-[18ch] font-display text-[2.35rem] font-semibold leading-[1.14] tracking-[-0.03em] text-pretty md:text-[3.35rem]">
							{page.data.title}
						</DocsTitle>
						<DocsDescription className="m-0 max-w-[26rem] text-[0.95rem] leading-[1.7] text-fd-muted-foreground md:justify-self-end md:text-[1.02rem]">
							{page.data.description}
						</DocsDescription>
					</div>
					<span className="-mb-px block h-0.5 w-14 bg-vetta-coral" aria-hidden="true" />
				</header>
				<DocsBody className="docs-article-body max-w-[54rem] pt-8">
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
