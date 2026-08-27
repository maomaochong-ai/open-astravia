import { BrandMark } from "@/components/brand-mark";
import { site } from "@/lib/site";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
	return {
		nav: {
			title: <BrandMark />,
			url: "/",
			transparentMode: "none",
		},
		githubUrl: site.githubUrl,
		links: [
			{
				text: "下载客户端",
				url: site.downloadUrl,
				external: true,
			},
			{
				text: "官网",
				url: site.marketingUrl,
				external: true,
			},
		],
	};
}
