import { getLLMText } from "@/lib/get-llm-text";
import { source } from "@/lib/source";

export const revalidate = false;

interface RouteContext {
	params: Promise<{ slug?: string[] }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
	const { slug } = await context.params;
	const pageSlug = slug?.length === 1 && slug[0] === "index" ? undefined : slug;
	const page = source.getPage(pageSlug);

	if (!page) {
		return new Response("Not found", { status: 404 });
	}

	return new Response(await getLLMText(page), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
}
