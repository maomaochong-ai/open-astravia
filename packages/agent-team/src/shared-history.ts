import type { TeamContextImportRecord } from "./collaboration.js";
import { stableTeamEventId } from "./context-projector.js";

export interface TeamSharedHistoryCursor {
	readonly snapshotId: string;
	readonly throughEntryId: string;
	readonly nextEntryId: string;
	/** UTF-16 offset into the normalized public record, never inside a surrogate pair. */
	readonly offset: number;
}

export interface TeamSharedHistoryQuery {
	readonly entryId?: string;
	readonly cursor?: TeamSharedHistoryCursor;
	readonly maxRecords?: number;
	readonly maxContentCharacters?: number;
}

export interface TeamSharedHistoryPage {
	readonly snapshotId: string;
	readonly records: readonly (TeamContextImportRecord & {
		readonly offset: number;
		readonly totalCharacters: number;
	})[];
	readonly nextCursor?: TeamSharedHistoryCursor;
}

export interface TeamSharedHistoryPort {
	readSharedHistory(
		input: TeamSharedHistoryQuery & {
			readonly sourceRuntimeSessionId: string;
			readonly signal: AbortSignal;
		},
	): Promise<TeamSharedHistoryPage>;
}

/** Paginates an already-authorized projection; a cursor can never grant access to more records. */
export function pageTeamSharedHistory(input: {
	readonly scope: readonly string[];
	readonly records: readonly TeamContextImportRecord[];
	readonly query: TeamSharedHistoryQuery;
}): TeamSharedHistoryPage {
	const { query } = input;
	const maxRecords = requireLimit(query.maxRecords ?? 20, 1, 50);
	const maxCharacters = requireLimit(query.maxContentCharacters ?? 12_000, 2, 32_000);
	if (query.entryId !== undefined && query.cursor !== undefined)
		throw new Error("Choose a shared history entry or a cursor, not both");
	if (new Set(input.records.map((record) => record.sourceEntryId)).size !== input.records.length)
		throw new Error("Shared history contains duplicate source identities");
	const throughIndex = query.cursor
		? input.records.findIndex((record) => record.sourceEntryId === query.cursor?.throughEntryId)
		: input.records.length - 1;
	if (query.cursor && throughIndex < 0) throw new Error("Shared history cursor expired; restart the read");
	const records = input.records.slice(0, throughIndex + 1);
	const snapshotId = stableTeamEventId(["shared-history-v1", ...input.scope, ...records.map(serializeRecord)]);
	if (query.cursor && query.cursor.snapshotId !== snapshotId)
		throw new Error("Shared history changed or its policy changed; restart the read");
	const startId = query.cursor?.nextEntryId ?? query.entryId;
	let index = startId === undefined ? 0 : records.findIndex((record) => record.sourceEntryId === startId);
	if (index < 0) throw new Error("Shared history entry is unavailable in this projection");
	let offset = query.cursor?.offset ?? 0;
	if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid shared history cursor offset");
	const page: TeamSharedHistoryPage["records"][number][] = [];
	let remaining = maxCharacters;
	while (index < records.length && page.length < maxRecords) {
		const record = records[index]!;
		if (offset > record.content.length || splitsSurrogate(record.content, offset))
			throw new Error("Invalid shared history cursor offset");
		let end = Math.min(record.content.length, offset + remaining);
		if (splitsSurrogate(record.content, end)) end -= 1;
		if (end === offset && offset < record.content.length) break;
		page.push({
			...record,
			content: record.content.slice(offset, end),
			offset,
			totalCharacters: record.content.length,
		});
		remaining -= end - offset;
		if (end < record.content.length) {
			offset = end;
			break;
		}
		index += 1;
		offset = 0;
		if (remaining === 0) break;
	}
	return {
		snapshotId,
		records: page,
		...(index < records.length
			? {
					nextCursor: {
						snapshotId,
						throughEntryId: records[records.length - 1]!.sourceEntryId,
						nextEntryId: records[index]!.sourceEntryId,
						offset,
					},
				}
			: {}),
	};
}

function serializeRecord(record: TeamContextImportRecord): string {
	return JSON.stringify([
		record.sourceEntryId,
		record.sourceTurnId,
		record.sourceAuthorId,
		record.kind,
		record.content,
		record.sourceTimestamp,
		record.projectionPolicyId,
	]);
}

function requireLimit(value: number, minimum: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
		throw new Error(`Shared history limit must be between ${minimum} and ${maximum}`);
	return value;
}

function splitsSurrogate(value: string, offset: number): boolean {
	const previous = value.charCodeAt(offset - 1);
	const current = value.charCodeAt(offset);
	return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff;
}
