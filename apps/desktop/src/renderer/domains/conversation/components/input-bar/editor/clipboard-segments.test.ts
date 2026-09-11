// @vitest-environment jsdom

import type { InputSegment } from "@shared/lib/input-tokens";
import { describe, expect, it } from "vitest";
import {
	createInputSegmentsClipboardHtml,
	INPUT_SEGMENTS_CLIPBOARD_MIME,
	readInputSegmentsFromClipboard,
	serializeInputSegmentsForClipboard,
} from "./clipboard-segments";

const segments: InputSegment[] = [
	{ kind: "text", text: "请检查 " },
	{ kind: "skill", name: "review", alias: "审查", icon: "solar:check" },
	{ kind: "text", text: " 和 " },
	{ kind: "member", memberId: "member-1", handle: "flower", label: "Flower", avatar: "avatar", meta: "研发" },
	{ kind: "text", text: " " },
	{ kind: "file", path: "C:/work/content-creation.json", isDirectory: false },
	{ kind: "text", text: " 1212.com" },
];

function clipboardData(values: Record<string, string>): { getData(format: string): string } {
	return { getData: (format) => values[format] ?? "" };
}

describe("input segment clipboard format", () => {
	it("round-trips rich token metadata through the private format", () => {
		expect(
			readInputSegmentsFromClipboard(
				clipboardData({ [INPUT_SEGMENTS_CLIPBOARD_MIME]: serializeInputSegmentsForClipboard(segments) }),
			),
		).toEqual(segments);
	});

	it("recovers metadata from the standard HTML fallback", () => {
		expect(
			readInputSegmentsFromClipboard(clipboardData({ "text/html": createInputSegmentsClipboardHtml(segments) })),
		).toEqual(segments);
	});

	it("rejects malformed, unsupported, or partially invalid payloads", () => {
		expect(readInputSegmentsFromClipboard(clipboardData({ [INPUT_SEGMENTS_CLIPBOARD_MIME]: "{}" }))).toBeNull();
		expect(
			readInputSegmentsFromClipboard(
				clipboardData({
					[INPUT_SEGMENTS_CLIPBOARD_MIME]: JSON.stringify({ version: 1, segments: [{ kind: "file", path: 123 }] }),
				}),
			),
		).toBeNull();
	});
});
