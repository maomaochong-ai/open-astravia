import { site } from "@/lib/site";
import { source } from "@/lib/source";
import { llms } from "fumadocs-core/source";

export const revalidate = false;

export function GET(): Response {
	const index = llms(source).index();
	const extras = [
		"",
		"## Optional",
		"",
		`- [官网](${site.marketingUrl}): 产品介绍与下载`,
		`- [下载桌面端](${site.downloadUrl}): Windows / macOS / Linux 安装包`,
		`- [GitHub](${site.githubUrl}): 开源仓库`,
		"- 任意文档页可追加 `.md` 获取纯 Markdown，例如 `/product/models.md`",
		"",
	].join("\n");

	return new Response(`${index}${extras}`, {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}
