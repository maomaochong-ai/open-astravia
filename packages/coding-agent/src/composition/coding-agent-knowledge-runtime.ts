import { join } from "node:path";
import { listAvailableTags, queryByTags, wikiDir, writeKnowledgePage } from "@vetta/runtime-knowledge";
import type {
	KbFilterByTagsOperations,
	KbListTagsOperations,
	KbWritePageOperations,
} from "@vetta/runtime-tools/coding";
import { getKnowledgeDir } from "../config.js";

export type CodingAgentKnowledgeQueryOperations = KbListTagsOperations & KbFilterByTagsOperations;

export function resolveCodingAgentKnowledgeRoot(root?: string): string {
	return root ?? getKnowledgeDir();
}

export function createCodingAgentKnowledgeQueryOperations(root?: string): CodingAgentKnowledgeQueryOperations {
	const resolvedRoot = resolveCodingAgentKnowledgeRoot(root);
	return {
		listAvailableTags: () => listAvailableTags(resolvedRoot),
		queryByTags: async (input) => {
			const pages = await queryByTags(resolvedRoot, input);
			return pages.map((page) => ({ ...page, absolutePath: join(wikiDir(resolvedRoot), page.path) }));
		},
	};
}

export function createCodingAgentKnowledgeWriteOperations(root?: string): KbWritePageOperations {
	const resolvedRoot = resolveCodingAgentKnowledgeRoot(root);
	return {
		write: (request, now) => writeKnowledgePage(resolvedRoot, request, now),
		resolveAbsolutePath: (relativeWikiPath) => join(wikiDir(resolvedRoot), relativeWikiPath),
	};
}
