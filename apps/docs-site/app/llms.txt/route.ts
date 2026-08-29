import { site } from "@/lib/site";
import { getRequestLanguage, isDocsLanguage, type DocsLanguage } from "@/lib/i18n";
import { source } from "@/lib/source";
import { llms } from "fumadocs-core/source";

export const revalidate = false;

export function GET(request: Request): Response {
	const requested = new URL(request.url).searchParams.get("lang");
	const language: DocsLanguage = requested && isDocsLanguage(requested) ? requested : getRequestLanguage(request);
	const index = llms(source).index(language);
	const extras = [
		"",
		language === "en" ? "## Optional" : "## 可选入口",
		"",
		language === "en"
			? `- [Website](${site.marketingUrl}): Product information and downloads`
			: `- [官网](${site.marketingUrl}): 产品介绍与下载`,
		language === "en"
			? `- [Download Vetta](${site.downloadUrl}): Windows / macOS / Linux installers`
			: `- [下载桌面端](${site.downloadUrl}): Windows / macOS / Linux 安装包`,
		`- [GitHub](${site.githubUrl}): 开源仓库`,
		language === "en"
			? "- Append `.md` to any docs page to get Markdown, for example `/product/models.md`"
			: "- 任意文档页可追加 `.md` 获取纯 Markdown，例如 `/product/models.md`",
		"",
	].join("\n");

	return new Response(`${index}${extras}`, {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}
