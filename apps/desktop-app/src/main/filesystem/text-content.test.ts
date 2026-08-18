import { describe, expect, it } from "vitest";
import { decodeProbableUtf8Text, decodeUtf8Prefix, decodeUtf8Text, isProbablyTextContent } from "./text-content";

describe("decodeUtf8Text", () => {
	it("decodes Unicode and reports a BOM", () => {
		const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("你好")]);

		expect(decodeUtf8Text(bytes)).toEqual({ content: "你好", hasBom: true });
	});

	it("rejects invalid UTF-8", () => {
		expect(decodeUtf8Text(Buffer.from([0xff, 0xfe]))).toBeNull();
	});

	it("allows a bounded prefix to end inside a valid multi-byte character", () => {
		const partialCharacter = Buffer.from("你").subarray(0, 2);

		expect(decodeUtf8Prefix(partialCharacter)).toEqual({ content: "", hasBom: false });
		expect(decodeUtf8Text(partialCharacter)).toBeNull();
	});
});

describe("isProbablyTextContent", () => {
	it("accepts source text, line endings and ANSI log escapes", () => {
		expect(isProbablyTextContent("const answer = 42;\r\n\u001b[31merror\u001b[0m")).toBe(true);
	});

	it("rejects NUL bytes and control-character-heavy content", () => {
		expect(isProbablyTextContent("header\0payload")).toBe(false);
		expect(isProbablyTextContent("\u0001\u0002\u0003value")).toBe(false);
	});

	it("allows an occasional control character without rejecting a long text file", () => {
		expect(isProbablyTextContent(`${"a".repeat(200)}\u0001`)).toBe(true);
	});
});

describe("decodeProbableUtf8Text", () => {
	it("combines strict decoding with the content heuristic", () => {
		expect(decodeProbableUtf8Text(Buffer.from("plain text"))?.content).toBe("plain text");
		expect(decodeProbableUtf8Text(Buffer.from([0x00, 0x01]))).toBeNull();
	});
});
