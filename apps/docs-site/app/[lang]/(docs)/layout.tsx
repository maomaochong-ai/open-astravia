import { DocsProvider } from "@/components/docs-provider";
import { StudioBanner } from "@/components/studio-banner";
import { isDocsLanguage } from "@/lib/i18n";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

interface LayoutProps {
	params: Promise<{ lang: string }>;
	children: ReactNode;
}

// The visible URL is shared by both languages; render per request so a shared cache
// cannot serve one locale's HTML to another locale.
export const dynamic = "force-dynamic";

export default async function Layout({ params, children }: LayoutProps) {
	const { lang } = await params;
	if (!isDocsLanguage(lang)) notFound();

	return (
		<DocsProvider language={lang}>
			<DocsLayout
				tree={source.getPageTree(lang)}
				{...baseOptions(lang)}
				sidebar={{
					banner: <StudioBanner language={lang} />,
				}}
			>
				{children}
			</DocsLayout>
		</DocsProvider>
	);
}
