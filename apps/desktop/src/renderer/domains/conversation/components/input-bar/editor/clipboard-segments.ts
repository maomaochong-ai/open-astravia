import { type InputSegment, segmentsToText } from "@shared/lib/input-tokens";

/** Private renderer-to-renderer format. HTML below is the standard-format fallback. */
export const INPUT_SEGMENTS_CLIPBOARD_MIME = "application/x-vetta-input-segments";
const INPUT_SEGMENTS_CLIPBOARD_VERSION = 1;
const INPUT_SEGMENTS_CLIPBOARD_ATTRIBUTE = "data-vetta-input-segments";
const INPUT_SEGMENTS_CLIPBOARD_PAYLOAD_ATTRIBUTE = "data-vetta-input-segments-payload";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function optionalString(record: Record<string, unknown>, key: string): boolean {
	return record[key] === undefined || typeof record[key] === "string";
}

function isInputSegment(value: unknown): value is InputSegment {
	if (!isRecord(value) || typeof value.kind !== "string") return false;
	switch (value.kind) {
		case "text":
			return typeof value.text === "string";
		case "member":
			return (
				typeof value.memberId === "string" &&
				typeof value.handle === "string" &&
				typeof value.label === "string" &&
				optionalString(value, "avatar") &&
				optionalString(value, "meta")
			);
		case "skill":
		case "scene":
			return typeof value.name === "string" && optionalString(value, "alias") && optionalString(value, "icon");
		case "connector":
			return typeof value.name === "string" && optionalString(value, "label") && optionalString(value, "iconUrl");
		case "file":
			return (
				typeof value.path === "string" &&
				(value.isDirectory === undefined || typeof value.isDirectory === "boolean")
			);
		case "image":
			return typeof value.path === "string";
		default:
			return false;
	}
}

function parsePayload(serialized: string): InputSegment[] | null {
	if (!serialized || serialized.length > 10_000_000) return null;
	try {
		const value: unknown = JSON.parse(serialized);
		if (!isRecord(value) || value.version !== INPUT_SEGMENTS_CLIPBOARD_VERSION || !Array.isArray(value.segments)) {
			return null;
		}
		return value.segments.every(isInputSegment) ? value.segments : null;
	} catch {
		return null;
	}
}

function encodePayload(segments: readonly InputSegment[]): string {
	return JSON.stringify({ version: INPUT_SEGMENTS_CLIPBOARD_VERSION, segments });
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

/** Standard HTML clipboard representation for apps that strip custom MIME types. */
export function createInputSegmentsClipboardHtml(segments: readonly InputSegment[]): string {
	const payload = encodeURIComponent(encodePayload(segments));
	return `<span ${INPUT_SEGMENTS_CLIPBOARD_ATTRIBUTE}="${INPUT_SEGMENTS_CLIPBOARD_VERSION}" ${INPUT_SEGMENTS_CLIPBOARD_PAYLOAD_ATTRIBUTE}="${payload}">${escapeHtml(segmentsToText(segments))}</span>`;
}

export interface ClipboardDataReader {
	getData(format: string): string;
}

function getData(data: ClipboardDataReader, format: string): string {
	try {
		return data.getData(format);
	} catch {
		return "";
	}
}

/** Read structured segments from our MIME first, then the HTML marker. */
export function readInputSegmentsFromClipboard(data: ClipboardDataReader): InputSegment[] | null {
	const custom = parsePayload(getData(data, INPUT_SEGMENTS_CLIPBOARD_MIME));
	if (custom) return custom;
	const html = getData(data, "text/html");
	if (
		!new RegExp(`${INPUT_SEGMENTS_CLIPBOARD_ATTRIBUTE}=["']${INPUT_SEGMENTS_CLIPBOARD_VERSION}["']`, "i").test(html)
	) {
		return null;
	}
	const marker = new RegExp(`${INPUT_SEGMENTS_CLIPBOARD_PAYLOAD_ATTRIBUTE}=["']([^"']+)["']`, "i").exec(html);
	if (!marker?.[1]) return null;
	try {
		return parsePayload(decodeURIComponent(marker[1]));
	} catch {
		return null;
	}
}

export function serializeInputSegmentsForClipboard(segments: readonly InputSegment[]): string {
	return encodePayload(segments);
}

/** Context-menu copy path: HTML is a standard clipboard type and preserves the metadata in Chromium. */
export async function writeInputSegmentsToClipboard(segments: readonly InputSegment[]): Promise<void> {
	const text = segmentsToText(segments);
	if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function") {
		const item = new ClipboardItem({
			"text/plain": new Blob([text], { type: "text/plain" }),
			"text/html": new Blob([createInputSegmentsClipboardHtml(segments)], { type: "text/html" }),
		});
		try {
			await navigator.clipboard.write([item]);
			return;
		} catch {
			// Permission or platform restrictions may reject rich writes; retain the
			// ordinary copy contract instead of making the context menu fail silently.
		}
	}
	await navigator.clipboard.writeText(text);
}
