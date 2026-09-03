import { describe, expect, it } from "vitest";
import type { TeamContextImportRecord } from "../src/collaboration.js";
import { pageTeamSharedHistory } from "../src/shared-history.js";

describe("Team shared history paging", () => {
	it("keeps a cursor on its original authorized snapshot when newer public records arrive", () => {
		const records = [record("one", "first"), record("two", "second"), record("three", "third")];
		const first = pageTeamSharedHistory({ scope: ["team", "member", "policy"], records, query: { maxRecords: 1 } });
		expect(first.records.map(({ sourceEntryId }) => sourceEntryId)).toEqual(["one"]);
		const second = pageTeamSharedHistory({
			scope: ["team", "member", "policy"],
			records: [...records, record("four", "newer")],
			query: { cursor: first.nextCursor, maxRecords: 2 },
		});
		expect(second.records.map(({ sourceEntryId }) => sourceEntryId)).toEqual(["two", "three"]);
		expect(second.nextCursor).toBeUndefined();
	});

	it("expires a cursor after covered content or policy scope changes", () => {
		const records = [record("one", "first"), record("two", "second")];
		const first = pageTeamSharedHistory({ scope: ["team", "member", "policy"], records, query: { maxRecords: 1 } });
		expect(() =>
			pageTeamSharedHistory({
				scope: ["team", "member", "policy"],
				records: [record("one", "edited"), records[1]!],
				query: { cursor: first.nextCursor },
			}),
		).toThrow(/changed/);
		expect(() =>
			pageTeamSharedHistory({
				scope: ["team", "member", "another-policy"],
				records,
				query: { cursor: first.nextCursor },
			}),
		).toThrow(/changed/);
	});

	it("pages long Unicode records without splitting surrogate pairs", () => {
		const records = [record("one", "a😀b")];
		const first = pageTeamSharedHistory({ scope: ["scope"], records, query: { maxContentCharacters: 2 } });
		expect(first.records[0]).toMatchObject({ content: "a", offset: 0, totalCharacters: 4 });
		const second = pageTeamSharedHistory({
			scope: ["scope"],
			records,
			query: { cursor: first.nextCursor, maxContentCharacters: 2 },
		});
		expect(second.records[0]).toMatchObject({ content: "😀", offset: 1, totalCharacters: 4 });
		const third = pageTeamSharedHistory({
			scope: ["scope"],
			records,
			query: { cursor: second.nextCursor, maxContentCharacters: 2 },
		});
		expect(third.records[0]).toMatchObject({ content: "b", offset: 3, totalCharacters: 4 });
		expect(third.nextCursor).toBeUndefined();
	});

	it("supports source entry starts and rejects ambiguous or invalid projections", () => {
		const records = [record("one", "first"), record("two", "second")];
		expect(
			pageTeamSharedHistory({ scope: ["scope"], records, query: { entryId: "two" } }).records.map(
				({ sourceEntryId }) => sourceEntryId,
			),
		).toEqual(["two"]);
		expect(() => pageTeamSharedHistory({ scope: ["scope"], records, query: { entryId: "missing" } })).toThrow(
			/unavailable/,
		);
		expect(() =>
			pageTeamSharedHistory({
				scope: ["scope"],
				records: [records[0]!, records[0]!],
				query: {},
			}),
		).toThrow(/duplicate/);
	});
});

function record(sourceEntryId: string, content: string): TeamContextImportRecord {
	return {
		sourceEntryId,
		sourceTurnId: `turn-${sourceEntryId}`,
		sourceAuthorId: "author",
		kind: "agent-message",
		content,
		sourceTimestamp: 1,
		projectionPolicyId: "policy",
	};
}
