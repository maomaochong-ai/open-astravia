import type { FilteredPage, TagCount, TagQuery, WritePageRequest, WritePageResult } from "@vetta/runtime-knowledge";

export interface CodingAgentKnowledgePage extends FilteredPage {
	readonly absolutePath: string;
}

export interface CodingAgentKnowledgeQueryOperations {
	listAvailableTags(): Promise<readonly TagCount[]>;
	queryByTags(input: TagQuery): Promise<readonly CodingAgentKnowledgePage[]>;
}

export interface CodingAgentKnowledgeWriteOperations {
	write(request: WritePageRequest, now: string): Promise<WritePageResult>;
	resolveAbsolutePath(relativeWikiPath: string): string;
}

export interface CodingAgentKnowledgeRuntime {
	readonly query: CodingAgentKnowledgeQueryOperations;
	readonly write: CodingAgentKnowledgeWriteOperations;
}
