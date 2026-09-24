import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSessionPins } from "../../shared/session-pins.js";
import {
	forgetSessionPins,
	importSessionPins,
	listSessionPins,
	onSessionPinsChanged,
	pinSession,
	resetSessionPinsCache,
} from "./session-pins-store.js";

const roots: string[] = [];

function tempFile(): string {
	const root = mkdtempSync(join(tmpdir(), "vetta-pins-"));
	roots.push(root);
	resetSessionPinsCache();
	return join(root, "session-pins.json");
}

function onDisk(filePath: string): Map<string, number> {
	return parseSessionPins(JSON.parse(readFileSync(filePath, "utf-8")) as unknown);
}

afterEach(() => {
	resetSessionPinsCache();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("session pins store", () => {
	it("persists pins and forgets deleted sessions", () => {
		const filePath = tempFile();
		pinSession({ path: "/a.jsonl", pinned: true }, filePath);
		pinSession({ path: "/b.jsonl", pinned: true }, filePath);
		forgetSessionPins(["/a.jsonl"], filePath);
		expect([...onDisk(filePath).keys()]).toEqual(["/b.jsonl"]);
		resetSessionPinsCache();
		expect([...listSessionPins(filePath).keys()]).toEqual(["/b.jsonl"]);
	});

	it("tells listeners about changes but not about no-ops", () => {
		const filePath = tempFile();
		const seen: string[][] = [];
		const off = onSessionPinsChanged((pins) => seen.push([...pins.keys()]));
		try {
			pinSession({ path: "/a.jsonl", pinned: false }, filePath);
			forgetSessionPins(["/missing.jsonl"], filePath);
			pinSession({ path: "/a.jsonl", pinned: true }, filePath);
			pinSession({ path: "/a.jsonl", pinned: false }, filePath);
		} finally {
			off();
		}
		expect(seen).toEqual([["/a.jsonl"], []]);
	});

	it("imports pins an older version kept in the renderer", () => {
		const filePath = tempFile();
		writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, pins: [{ path: "/a.jsonl", pinnedAt: 9 }] }));
		importSessionPins(
			new Map([
				["/a.jsonl", 3],
				["/b.jsonl", 4],
			]),
			filePath,
		);
		expect(Array.from(onDisk(filePath)).sort()).toEqual([
			["/a.jsonl", 9],
			["/b.jsonl", 4],
		]);
	});

	it("starts empty when the file is missing or corrupt", () => {
		const filePath = tempFile();
		expect(listSessionPins(filePath).size).toBe(0);
		writeFileSync(filePath, "{not json");
		resetSessionPinsCache();
		expect(listSessionPins(filePath).size).toBe(0);
	});
});
