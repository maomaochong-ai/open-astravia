import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";
import { docsI18n, englishPageDescriptions, englishPageTitles } from "./i18n";

const docs = defineDocs({
	dir: "content/docs",
	docs: {
		postprocess: {
			includeProcessedMarkdown: true,
		},
	},
});

export const source = loader({
	baseUrl: "/",
	i18n: docsI18n,
	pageTree: {
		transformers: [
			{
				file(node, file) {
					if (this.locale !== "en" || !file) return node;
					const key = file.replace(/\.(?:mdx?|md)$/u, "");
					const title = englishPageTitles[key];
					const description = englishPageDescriptions[key];
					return title || description ? { ...node, name: title ?? node.name, description: description ?? node.description } : node;
				},
			},
		],
	},
	source: docs.toFumadocsSource(),
});
