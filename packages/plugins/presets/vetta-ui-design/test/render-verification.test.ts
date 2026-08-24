import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { beforeEach, expect, it } from "vitest";
import {
	designSourceFingerprints,
	planVerificationSheet,
	recordVerificationCapture,
	resetRenderVerificationState,
	resolveScreenshotSelection,
	summarizeRenderVerification,
} from "../src/vetd/render-verification";

beforeEach(() => resetRenderVerificationState());

it("keeps the single-frame contract and normalizes batch selections", () => {
	expect(resolveScreenshotSelection({ frame: "login.tsx" }, ["login", "detail"])).toEqual({
		frameIds: ["login"],
		single: true,
	});
	expect(resolveScreenshotSelection({ frames: ["login", "detail.tsx", "login"] }, ["login", "detail"])).toEqual({
		frameIds: ["login", "detail"],
		single: false,
	});
	expect(resolveScreenshotSelection({ all: true }, ["login", "detail"])).toEqual({
		frameIds: ["login", "detail"],
		single: false,
	});
});

it("rejects ambiguous or empty selections", () => {
	expect(() => resolveScreenshotSelection({}, ["login"])).toThrow("exactly one");
	expect(() => resolveScreenshotSelection({ frame: "login", all: true }, ["login"])).toThrow("exactly one");
	expect(() => resolveScreenshotSelection({ frames: [] }, ["login"])).toThrow("No frames");
	expect(() =>
		resolveScreenshotSelection(
			{ all: true },
			Array.from({ length: 13 }, (_, index) => `frame-${index}`),
		),
	).toThrow("limited to 12");
});

it("stops a third blind edit when image and issues repeat", () => {
	const issue = { file: "frames/login.tsx", line: 8, rule: "unintended-wrap", message: "wrap" };
	const first = recordVerificationCapture({
		vetdPath: "design.vetd",
		frameId: "login",
		dataUrl: "data:image/jpeg;base64,SAME",
		issues: [issue],
		sourceFingerprint: "source-a",
		capturedAt: 1,
	});
	const second = recordVerificationCapture({
		vetdPath: "design.vetd",
		frameId: "login",
		dataUrl: "data:image/jpeg;base64,SAME",
		issues: [issue],
		sourceFingerprint: "source-b",
		capturedAt: 2,
	});
	expect(first.stalled).toBe(false);
	expect(second).toMatchObject({ imageUnchanged: true, repeatedIssueCount: 2, stalled: true });
});

it("marks prior captures stale after the design sources change", () => {
	recordVerificationCapture({
		vetdPath: "design.vetd",
		frameId: "login",
		dataUrl: "image-a",
		issues: [],
		sourceFingerprint: "source-a",
		capturedAt: 1,
	});
	expect(
		summarizeRenderVerification(
			"design.vetd",
			["login", "detail"],
			new Map([
				["login", "source-a"],
				["detail", "source-a"],
			]),
		),
	).toMatchObject({
		status: "partial",
		verifiedFrames: ["login"],
		unverifiedFrames: ["detail"],
	});
	expect(summarizeRenderVerification("design.vetd", ["login"], new Map([["login", "source-b"]]))).toMatchObject({
		status: "stale",
		staleFrames: ["login"],
	});
});

it("only invalidates another frame when shared inputs change", async () => {
	const files = new Map([
		["/design/frames/login.tsx", "login-a"],
		["/design/frames/detail.tsx", "detail-a"],
		["/design/components/Nav.tsx", "shared-a"],
		["/design/theme.css", "theme-a"],
		["/design/package.json", "package-a"],
		["/design/design.json", "manifest-a"],
	]);
	const fs = {
		readDir: async (dirPath: string) =>
			[...files.keys()]
				.filter((path) => path.startsWith(`${dirPath}/`) && !path.slice(dirPath.length + 1).includes("/"))
				.map((path) => ({
					name: path.slice(dirPath.length + 1),
					path,
					isDirectory: false,
					size: 1,
					modifiedAt: 1,
				})),
		readFile: async (path: string) => {
			const content = files.get(path);
			if (content === undefined) throw new Error("missing");
			return { content, encoding: "utf8" as const };
		},
	} as unknown as PluginFsApi;
	const before = await designSourceFingerprints(fs, "/design", ["login", "detail"]);
	files.set("/design/frames/detail.tsx", "detail-b");
	const detailChanged = await designSourceFingerprints(fs, "/design", ["login", "detail"]);
	expect(detailChanged.get("login")).toBe(before.get("login"));
	expect(detailChanged.get("detail")).not.toBe(before.get("detail"));

	files.set("/design/components/Nav.tsx", "shared-b");
	const sharedChanged = await designSourceFingerprints(fs, "/design", ["login", "detail"]);
	expect(sharedChanged.get("login")).not.toBe(detailChanged.get("login"));
	expect(sharedChanged.get("detail")).not.toBe(detailChanged.get("detail"));
});

it("plans one bounded contact sheet for multiple frame sizes", () => {
	const plan = planVerificationSheet(
		Array.from({ length: 9 }, (_, index) => ({ id: `mobile-${index}`, width: 390, height: 844 })),
	);
	expect(plan).not.toBeNull();
	expect(plan?.pieces).toHaveLength(9);
	expect(Math.max(plan?.width ?? 0, plan?.height ?? 0)).toBeLessThanOrEqual(3_000);
	expect(plan?.scale).toBeLessThanOrEqual(1);
});
