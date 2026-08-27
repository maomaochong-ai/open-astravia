import { cn } from "@/lib/cn";
import { displaySerif } from "@/lib/fonts";
import { buildRootMetadata } from "@/lib/seo/metadata";
import { site } from "@/lib/site";
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
	"Last updated on(page footer)": "更新于",
	"Copy Markdown(page actions)": "复制 Markdown",
	"View as Markdown(page actions)": "查看 Markdown",
	"Open(page actions)": "打开",
	"Open in ChatGPT(page actions)": "在 ChatGPT 中打开",
	"Open in Claude(page actions)": "在 Claude 中打开",
	"No Headings(table of contents)": "本页没有标题",
	"Hide Sidebar(sidebar)": "隐藏侧栏",
	"Show Sidebar(sidebar)": "显示侧栏",
	"Collapse Sidebar(sidebar)(aria-label)": "折叠侧栏",
};

export const metadata: Metadata = buildRootMetadata();

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html
			lang={site.locale}
			className={cn(displaySerif.variable, "scroll-smooth border-t-2 border-vetta-coral")}
			suppressHydrationWarning
		>
			<body className="flex min-h-screen flex-col bg-fd-background text-fd-foreground">
				<RootProvider i18n={{ locale: site.locale, translations }}>{children}</RootProvider>
			</body>
		</html>
	);
}
