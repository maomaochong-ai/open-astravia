import { getLLMText } from "@/lib/get-llm-text";
import { getRequestLanguage, isDocsLanguage, type DocsLanguage } from "@/lib/i18n";
import { source } from "@/lib/source";

export const revalidate = false;

interface RouteContext {
	params: Promise<{ slug?: string[] }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
	const { slug } = await context.params;
	const requestedLanguage = slug?.[0];
	const language: DocsLanguage = requestedLanguage && isDocsLanguage(requestedLanguage) ? requestedLanguage : getRequestLanguage(request);
	const pageSlug = requestedLanguage === language ? slug?.slice(1) : slug;
	const normalizedSlug = pageSlug?.length === 1 && pageSlug[0] === "index" ? undefined : pageSlug;
	const page = source.getPage(normalizedSlug, language);

	if (!page) {
		return new Response("Not found", { status: 404 });
	}

	return new Response(await getLLMText(page), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}
