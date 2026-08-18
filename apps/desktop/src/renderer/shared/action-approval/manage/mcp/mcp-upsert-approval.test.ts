import { describe, expect, it } from "vitest";
import { parseKeyValueLines } from "./McpUpsertApproval";

describe("parseKeyValueLines", () => {
	it("parses KEY=VALUE lines and ignores blanks", () => {
		expect(parseKeyValueLines("API_KEY=abc\n\nTOKEN=xyz\n")).toEqual({
			API_KEY: "abc",
			TOKEN: "xyz",
		});
	});

	it("allows empty values and values containing =", () => {
		expect(parseKeyValueLines("EMPTY=\nURL=a=b=c")).toEqual({
			EMPTY: "",
			URL: "a=b=c",
		});
	});

	it("returns undefined for empty input", () => {
		expect(parseKeyValueLines("")).toBeUndefined();
		expect(parseKeyValueLines("\n\n")).toBeUndefined();
		expect(parseKeyValueLines("no-equals")).toBeUndefined();
	});
});
