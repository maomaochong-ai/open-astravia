import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
	site: process.env.DOCS_SITE_URL ?? "https://docs.openvetta.com",
	integrations: [
		starlight({
			title: "Vetta 文档",
			description: "Vetta 产品使用、插件开发与 SDK 参考文档。",
			favicon: "/favicon.svg",
			logo: {
				src: "./src/assets/vetta-app-icon.webp",
				alt: "Vetta",
			},
			locales: {
				root: {
					label: "简体中文",
					lang: "zh-CN",
				},
			},
			customCss: ["./src/styles/custom.css"],
			components: {
				Header: "./src/components/DocsHeader.astro",
				PageFrame: "./src/components/DocsPageFrame.astro",
				Sidebar: "./src/components/DocsSidebar.astro",
			},
			lastUpdated: true,
			sidebar: [
				{
					label: "开始使用",
					items: ["getting-started", "getting-started/first-task"],
				},
				{
					label: "产品指南",
					items: ["product/overview"],
				},
				{
					label: "插件开发",
					items: ["plugins/overview", "plugins/getting-started"],
				},
				{
					label: "开发者",
					items: ["developers/architecture"],
				},
				{
					label: "参考",
					items: ["reference/documentation-policy", "troubleshooting"],
				},
			],
		}),
	],
});
