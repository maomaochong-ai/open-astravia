import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./global.css";

const translations = {
	"Search(search dialog)": "搜索文档",
	"Search(search trigger)": "搜索",
	"No results found(search dialog)": "没有找到结果",
	"On this page(table of contents)": "本页内容",
	"Next Page(pagination)": "下一页",
	"Previous Page(pagination)": "上一页",
	"Open Search(search trigger)(aria-label)": "打开搜索",
	"Open Sidebar(sidebar)(aria-label)": "打开侧栏",
	"Close Sidebar(sidebar)(aria-label)": "关闭侧栏",
	"Toggle Menu(mobile menu)(aria-label)": "切换菜单",
	"Toggle Theme(theme switcher)(aria-label)": "切换主题",
	"Light(theme switcher)(aria-label)": "浅色",
	"Dark(theme switcher)(aria-label)": "深色",
	"System(theme switcher)(aria-label)": "跟随系统",
};

export const metadata: Metadata = {
	metadataBase: new URL(process.env.DOCS_SITE_URL ?? "https://docs.openvetta.com"),
	title: "Vetta 文档",
	description: "使用 Vetta、扩展桌面能力并接入核心 SDK。",
	icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN" suppressHydrationWarning>
			<body className="flex min-h-screen flex-col">
				<RootProvider i18n={{ locale: "zh-CN", translations }}>{children}</RootProvider>
			</body>
		</html>
	);
}
