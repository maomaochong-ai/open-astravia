import { getLLMText } from "@/lib/get-llm-text";
import { getRequestLanguage, isDocsLanguage, type DocsLanguage } from "@/lib/i18n";
import { source } from "@/lib/source";

export const revalidate = false;

export async function GET(request: Request): Promise<Response> {
	const requested = new URL(request.url).searchParams.get("lang");
	const language: DocsLanguage = requested && isDocsLanguage(requested) ? requested : getRequestLanguage(request);
	const pages = await Promise.all(source.getPages(language).map(getLLMText));
	return new Response(pages.join("\n\n---\n\n"), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}
