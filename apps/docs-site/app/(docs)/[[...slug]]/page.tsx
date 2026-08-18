import { getMDXComponents } from "@/components/mdx";
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

const sectionLabels: Record<string, string> = {
	"getting-started": "01 / 开始使用",
	core: "02 / 核心工作流",
	product: "03 / 使用指南",
	plugins: "04 / 插件开发",
	themes: "05 / 主题开发",
	developers: "06 / 开发者",
	reference: "07 / 参考",
	troubleshooting: "08 / 支持",
};

export default async function Page({ params }: PageProps) {
	const { slug } = await params;
	const page = source.getPage(slug);

	if (!page) notFound();

	const MDX = page.data.body;
	const isHome = page.slugs.length === 0;

	if (isHome) {
		return (
			<DocsPage full breadcrumb={{ enabled: false }} footer={{ enabled: false }} className="docs-home-page">
				<DocsBody className="docs-home-body">
					<MDX components={getMDXComponents()} />
				</DocsBody>
			</DocsPage>
		);
	}

	const sectionLabel = sectionLabels[page.slugs[0] ?? ""] ?? "VETTA / DOCUMENTATION";

	return (
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
	);
}

export function generateStaticParams() {
	return source.generateParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
	const { slug } = await params;
	const page = source.getPage(slug);

	if (!page) notFound();

	return {
		title: page.slugs.length === 0 ? "Vetta 文档" : `${page.data.title} | Vetta 文档`,
		description: page.data.description,
		alternates: { canonical: page.url },
	};
}
