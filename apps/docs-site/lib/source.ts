import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";
import { docsI18n } from "./i18n";

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
	source: docs.toFumadocsSource(),
});
