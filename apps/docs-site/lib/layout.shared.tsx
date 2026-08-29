import { BrandMark } from "@/components/brand-mark";
import { type DocsLanguage } from "@/lib/i18n";
import { site } from "@/lib/site";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(language: DocsLanguage): BaseLayoutProps {
	return {
		nav: {
			title: <BrandMark language={language} />,
			url: "/",
			transparentMode: "none",
		},
		githubUrl: site.githubUrl,
		links: [
			{
				text: language === "en" ? "Download app" : "下载客户端",
				url: site.downloadUrl,
				external: true,
			},
			{
				text: language === "en" ? "Website" : "官网",
				url: site.marketingUrl,
				external: true,
			},
		],
	};
}
