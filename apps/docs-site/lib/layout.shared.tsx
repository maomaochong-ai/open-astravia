import { BrandMark } from "@/components/brand-mark";
import { DiscordGlyph } from "@/components/discord";
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
				url: site.discordUrl,
				text: "Discord",
				label: "Discord",
				icon: <DiscordGlyph />,
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
