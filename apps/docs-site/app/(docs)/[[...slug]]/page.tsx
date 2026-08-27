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
				<header className="mt-3.5 border-b border-fd-border pb-[1.8rem] md:pb-[2.1rem]">
					<DocsKicker>{sectionLabel}</DocsKicker>
					<DocsTitle className="m-0 max-w-none font-display text-[2.2rem] font-semibold leading-[1.18] tracking-[-0.02em] text-pretty md:max-w-[16ch] md:text-[3.15rem]">
						{page.data.title}
					</DocsTitle>
					<DocsDescription className="mt-[1.05rem] max-w-[38rem] text-base leading-[1.75] text-fd-muted-foreground md:text-[1.06rem]">
						{page.data.description}
					</DocsDescription>
					<PageToolbar dateModified={dateModified} />
				</header>
				<DocsBody className="docs-article-body max-w-[48rem] pt-5">
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
