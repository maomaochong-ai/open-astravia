import { describe, expect, it } from "vitest";
import { extractCompactionLedger, MAX_LEDGER_FILES } from "./compaction-ledger";

describe("extractCompactionLedger", () => {
	it("returns undefined when the record carries no details", () => {
		expect(extractCompactionLedger(undefined)).toBeUndefined();
		expect(extractCompactionLedger({})).toBeUndefined();
		expect(extractCompactionLedger({ readFiles: ["a.ts"] })).toBeUndefined();
	});

	it("returns undefined when the ledger holds no usable facts", () => {
		// 空账本渲染出来是一块空壳，不如不显示（与 formatMechanicalLedger 的空值约定一致）。
		expect(
			extractCompactionLedger({
				ledger: { readFiles: [], modifiedFiles: [], messageCounts: {}, estimatedTokens: 0 },
			}),
		).toBeUndefined();
	});

	it("surfaces files, counts and the token estimate from a real ledger", () => {
		const view = extractCompactionLedger({
			ledger: {
				readFiles: ["b.ts", "a.ts"],
				modifiedFiles: ["src/main.ts"],
				messageCounts: { user: 3, assistant: 4 },
				estimatedTokens: 12345,
				generatedAt: "2026-10-10T00:00:00.000Z",
			},
		});
		expect(view).toEqual({
			readFiles: ["b.ts", "a.ts"],
			modifiedFiles: ["src/main.ts"],
			messageCount: 7,
			estimatedTokens: 12345,
		});
	});

	it("keeps the ledger bounded when a file list is enormous", () => {
		const many = Array.from({ length: MAX_LEDGER_FILES + 25 }, (_, index) => `file-${index}.ts`);
		const view = extractCompactionLedger({ ledger: { readFiles: many, modifiedFiles: [] } });
		expect(view?.readFiles).toHaveLength(MAX_LEDGER_FILES);
		expect(view?.readFiles.at(-1)).toBe(`file-${MAX_LEDGER_FILES - 1}.ts`);
	});

	it("ignores malformed ledger fields instead of rendering garbage", () => {
		const view = extractCompactionLedger({
			ledger: {
				readFiles: ["ok.ts", 42, null, { path: "x" }],
				modifiedFiles: "not-an-array",
				messageCounts: { user: "many" },
				estimatedTokens: "lots",
			},
		});
		expect(view).toEqual({ readFiles: ["ok.ts"], modifiedFiles: [], messageCount: 0, estimatedTokens: 0 });
	});
});
