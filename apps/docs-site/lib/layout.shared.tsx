import { BrandMark } from "@/components/brand-mark";
import { CommunityGlyph } from "@/components/community";
import { getDocsMessages, type DocsLanguage } from "@/lib/i18n";
import { site } from "@/lib/site";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(language: DocsLanguage): BaseLayoutProps {
	const text = getDocsMessages(language);

	return {
		nav: {
			title: <BrandMark language={language} />,
			url: "/",
			transparentMode: "none",
		},
		githubUrl: site.githubUrl,
		links: [
			{
				type: "icon",
				url: site.communityUrl,
				text: text.community,
				label: text.community,
				icon: <CommunityGlyph />,
				external: true,
			},
			{
				text: text.downloadApp,
				url: site.downloadUrl,
				external: true,
			},
			{
				text: text.website,
				url: site.marketingUrl,
				external: true,
			},
		],
	};
}
