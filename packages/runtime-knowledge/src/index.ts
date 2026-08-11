export { rebuildManifest, rebuildTagsIndex, type WikiPageRef } from "./domain/derived-indexes.js";
export {
	type ParsedWikiPage,
	parseWikiPage,
	serializeWikiPage,
	validateWikiFrontmatter,
	WikiFrontmatterError,
} from "./domain/frontmatter.js";
export { buildIndexMap } from "./domain/index-map.js";
export { resolveUpsert, type UpsertDecision, type UpsertInput, type UpsertLookup } from "./domain/page-upsert.js";
export {
	type AttemptedFile,
	applyQuarantine,
	attemptedFiles,
	clearFailures,
	EMPTY_FAILURES,
	type FailureEntry,
	type FailuresRecord,
	KB_MAX_PROCESSING_ATTEMPTS,
	quarantinedPaths,
	reconcileFailures,
} from "./domain/processing-failures.js";
export {
	type AddedChange,
	type ChangedChange,
	type DeletedChange,
	diffNeedsProcessing,
	diffRaws,
	isEmptyDiff,
	type MovedChange,
	type OrphanPlan,
	planOrphans,
	type RawsDiff,
} from "./domain/raw-diff.js";
export { filterByTags, type TaggedPage, type TagQuery } from "./domain/tag-filter.js";
export * from "./domain/types.js";
export { type BatchPlanOptions, planProcessingBatches } from "./processing/batch-planner.js";
export {
	finalizeRound,
	type PreparedRound,
	prepareRound,
	type RebuildResult,
	rebuildAllCaches,
	reconcileRoundFailures,
} from "./processing/ingest-round.js";
export { buildProcessingPrompt, KB_PROCESSING_GUIDE } from "./processing/processing-prompt.js";
export { type FilteredPage, listAvailableTags, queryByTags, type TagCount } from "./query/knowledge-query.js";
export {
	deleteWikiPage,
	ensureKnowledgeDirs,
	failuresPath,
	generatePageId,
	hashContent,
	indexesDir,
	indexMapPath,
	manifestPath,
	processingRecordsCwd,
	pruneEmptyWikiDirs,
	rawsDir,
	rawsExists,
	readFailures,
	readManifest,
	readTagsIndex,
	type ScannedWikiPage,
	scanRaws,
	scanWikiPages,
	tagsPath,
	type WikiScanResult,
	wikiDir,
	writeFailures,
	writeIndexMap,
	writeManifest,
	writeTagsIndex,
	writeWikiPage,
} from "./storage/file-knowledge-store.js";
export {
	createKnowledgePageWriter,
	type KnowledgePageWriter,
	type WritePageRequest,
	type WritePageResult,
	writeKnowledgePage,
} from "./writer/knowledge-page-writer.js";
