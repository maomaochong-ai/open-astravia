import { describe, expect, it } from "vitest";
import { analyzeLegacySessionImport } from "../../src/conversation/legacy-session-import-analyzer.js";

describe("Legacy session import analyzer", () => {
	it.each([undefined, 1, 2, 3] as const)("accepts a lossless v%s record matrix", (version) => {
		const records = completeLegacyRecords(version);

		const analysis = analyzeLegacySessionImport(jsonLines(records));

		expect(analysis).toMatchObject({
			status: "representable",
			recordCount: records.length,
			sourceVersion: version ?? 1,
			issues: [],
		});
		if (analysis.status !== "representable") throw new Error("Expected representable analysis");
		expect(analysis.source.document.entries).toHaveLength(records.length - 1);
		expect(analysis.source.document.name).toBe("Strict import");
	});

	it("preserves an unsupported future header version for host compatibility policy", () => {
		const analysis = analyzeLegacySessionImport(jsonLines([header(4)]));

		expect(analysis).toEqual({
			status: "not-representable",
			recordCount: 1,
			sourceVersion: 4,
			issues: [{ line: 1, code: "invalid-header" }],
		});
	});

	it.each([
		{
			name: "invalid header",
			content: jsonLines([{ ...header(3), id: "" }]),
			issue: { line: 1, code: "invalid-header" },
		},
		{
			name: "malformed JSON",
			content: `${JSON.stringify(header(3))}\n{broken}\n`,
			issue: { line: 2, code: "malformed-json" },
		},
		{
			name: "invalid entry envelope",
			content: jsonLines([header(3), { type: "message", id: "missing-timestamp", parentId: null }]),
			issue: { line: 2, code: "invalid-envelope", recordType: "message" },
		},
		{
			name: "unknown record",
			content: jsonLines([header(3), entry(3, "future_entry", { value: true })]),
			issue: { line: 2, code: "unsupported-record", recordType: "future_entry" },
		},
		{
			name: "extra lossy field",
			content: jsonLines([header(3), entry(3, "session_info", { name: "name", future: true })]),
			issue: { line: 2, code: "invalid-payload", recordType: "session_info" },
		},
		{
			name: "broken parent",
			content: jsonLines([
				header(3),
				{
					...entry(3, "session_info", { name: "name" }),
					parentId: "missing",
				},
			]),
			issue: { line: 2, code: "broken-parent-reference", recordType: "session_info" },
		},
		{
			name: "duplicate entry id",
			content: jsonLines([
				header(3),
				{ ...entry(3, "session_info", { name: "one" }), id: "duplicate", parentId: null },
				{ ...entry(3, "session_info", { name: "two" }), id: "duplicate", parentId: null },
			]),
			issue: { line: 3, code: "duplicate-entry-id", recordType: "session_info" },
		},
		{
			name: "cyclic parents",
			content: jsonLines([
				header(3),
				{ ...entry(3, "session_info", { name: "one" }), id: "one", parentId: "two" },
				{ ...entry(3, "session_info", { name: "two" }), id: "two", parentId: "one" },
			]),
			issue: { line: 2, code: "cyclic-parent-reference", recordType: "session_info" },
		},
		{
			name: "invalid semantic reference",
			content: jsonLines([
				header(3),
				{ ...entry(3, "label", { targetId: "missing", label: "missing" }), parentId: null },
			]),
			issue: { line: 2, code: "invalid-entry-reference", recordType: "label" },
		},
	])("rejects $name without including record content", ({ content, issue }) => {
		const analysis = analyzeLegacySessionImport(content);

		expect(analysis).toMatchObject({ status: "not-representable", issues: expect.arrayContaining([issue]) });
		expect(JSON.stringify(analysis)).not.toContain('broken"');
	});

	it("accepts a normalized known entry while preserving its tree identity", () => {
		const source = entry(3, "message", {
			message: { role: "product-context", content: "context", timestamp: 1 },
		});
		const analysis = analyzeLegacySessionImport(jsonLines([header(3), source]), {
			entryNormalizer: (record) => {
				const { message: _message, ...entryBase } = record;
				return {
					...entryBase,
					type: "custom_message",
					customType: "test.product-context",
					content: "context",
					display: false,
					modelVisible: true,
				};
			},
		});

		expect(analysis).toMatchObject({ status: "representable", issues: [] });
		if (analysis.status !== "representable") throw new Error("Expected representable analysis");
		expect(analysis.source.document.entries[0]).toMatchObject({
			type: "custom_message",
			id: Reflect.get(source as object, "id"),
			parentId: null,
			modelVisible: true,
		});
	});

	it("rejects a normalizer that changes the persisted tree identity", () => {
		const analysis = analyzeLegacySessionImport(
			jsonLines([header(3), entry(3, "message", { message: { role: "user", content: "hello", timestamp: 1 } })]),
			{ entryNormalizer: (record) => ({ ...record, id: "rewritten" }) },
		);

		expect(analysis).toMatchObject({
			status: "not-representable",
			issues: [{ line: 2, code: "invalid-payload", recordType: "message" }],
		});
	});
});

function completeLegacyRecords(version: 1 | 2 | 3 | undefined): unknown[] {
	const user = entry(version, "message", {
		message: { role: "user", content: "hello", timestamp: 1 },
	});
	const userId = readId(user, 1);
	const assistant = entry(version, "message", {
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } }],
			api: "openai-responses",
			provider: "test",
			model: "test-model",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 2,
		},
	});
	const assistantId = readId(assistant, 2);
	return [
		header(version),
		user,
		assistant,
		entry(version, "message", {
			message: {
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "content" }],
				isError: false,
				timestamp: 3,
			},
		}),
		entry(version, "thinking_level_change", { thinkingLevel: "medium" }),
		entry(version, "model_change", { provider: "test", modelId: "test-model" }),
		entry(version, "compaction", {
			summary: "summary",
			firstKeptEntryId: userId,
			tokensBefore: 100,
		}),
		entry(version, "branch_summary", { fromId: assistantId, summary: "branch" }),
		entry(version, "custom", { customType: "fixture", data: { value: true } }),
		entry(version, "custom_message", {
			customType: "fixture-message",
			content: "context",
			display: true,
		}),
		entry(version, "label", { targetId: userId, label: "start" }),
		entry(version, "session_info", { name: "Strict import" }),
		entry(version, "tool_timing", {
			toolCallId: "call-1",
			toolName: "read",
			startedAt: 1,
			durationMs: 2,
			phases: [{ label: "execute", atMs: 1 }],
		}),
	];
}

function header(version: number | undefined) {
	return {
		type: "session",
		...(version === undefined ? {} : { version }),
		id: "legacy-source",
		timestamp: "2026-01-01T00:00:00.000Z",
		cwd: "C:/workspace",
	};
}

let entrySequence = 0;

function entry(version: 1 | 2 | 3 | undefined, type: string, fields: Readonly<Record<string, unknown>>) {
	entrySequence += 1;
	return {
		type,
		...(version === undefined || version === 1
			? {}
			: { id: `entry-${entrySequence}`, parentId: entrySequence === 1 ? null : `entry-${entrySequence - 1}` }),
		timestamp: `2026-01-01T00:00:${String(entrySequence).padStart(2, "0")}.000Z`,
		...fields,
	};
}

function readId(value: unknown, legacyIndex: number): string {
	if (typeof value === "object" && value !== null) {
		const id = Reflect.get(value, "id");
		if (typeof id === "string") return id;
	}
	return `legacy-${legacyIndex}`;
}

function jsonLines(records: readonly unknown[]): string {
	entrySequence = 0;
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}
