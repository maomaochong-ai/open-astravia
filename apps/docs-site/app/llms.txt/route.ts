import { site } from "@/lib/site";
import { getDocsMessages, getRequestLanguage, isDocsLanguage, type DocsLanguage } from "@/lib/i18n";
import { source } from "@/lib/source";
import { llms } from "fumadocs-core/source";

export const revalidate = false;

export function GET(request: Request): Response {
	const requested = new URL(request.url).searchParams.get("lang");
	const language: DocsLanguage = requested && isDocsLanguage(requested) ? requested : getRequestLanguage(request);
	const text = getDocsMessages(language);
	const index = llms(source).index(language);
	const extras = [
		"",
		`## ${text.optional}`,
		"",
		`- [${text.website}](${site.marketingUrl}): ${text.websiteDescription}`,
		`- [${text.downloadApp}](${site.downloadUrl}): ${text.downloadDescription}`,
		`- [GitHub](${site.githubUrl}): ${text.githubDescription}`,
		`- ${text.markdownDescription}`,
		"",
	].join("\n");

	return new Response(`${index}${extras}`, {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}
