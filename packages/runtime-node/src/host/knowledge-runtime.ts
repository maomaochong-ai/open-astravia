import { join } from "node:path";
import {
	type FilteredPage,
	listAvailableTags,
	queryByTags,
	type TagCount,
	type TagQuery,
	type WritePageRequest,
	type WritePageResult,
	wikiDir,
	writeKnowledgePage,
} from "@vetta/runtime-knowledge";

export interface NodeKnowledgePage extends FilteredPage {
	readonly absolutePath: string;
}

export interface NodeKnowledgeRuntime {
	readonly query: {
		listAvailableTags(): Promise<readonly TagCount[]>;
		queryByTags(input: TagQuery): Promise<readonly NodeKnowledgePage[]>;
	};
	readonly write: {
		write(request: WritePageRequest, now: string): Promise<WritePageResult>;
		resolveAbsolutePath(relativeWikiPath: string): string;
	};
}

export function createNodeKnowledgeRuntime(root: string): NodeKnowledgeRuntime {
	return {
		query: {
			listAvailableTags: () => listAvailableTags(root),
			queryByTags: async (input) => {
				const pages = await queryByTags(root, input);
				return pages.map((page) => ({
					...page,
					absolutePath: join(wikiDir(root), page.path),
				}));
			},
		},
		write: {
			write: (request, now) => writeKnowledgePage(root, request, now),
			resolveAbsolutePath: (relativeWikiPath) => join(wikiDir(root), relativeWikiPath),
		},
	};
}
