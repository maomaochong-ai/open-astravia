import { describe, expect, it } from "vitest";
import { isAllowedDesktopMediaRequest } from "./media-permissions.js";

describe("isAllowedDesktopMediaRequest", () => {
	it("allows audio from the main frame of the trusted window", () => {
		expect(
			isAllowedDesktopMediaRequest({
				stage: "request",
				mainWebContentsMatches: true,
				remoteDesktopWebContentsMatches: false,
				isMainFrame: true,
				mediaTypes: ["audio"],
			}),
		).toBe(true);
	});

	it("allows Electron's display media check from the registered remote desktop main frame", () => {
		expect(
			isAllowedDesktopMediaRequest({
				stage: "check",
				mainWebContentsMatches: false,
				remoteDesktopWebContentsMatches: true,
				isMainFrame: true,
				mediaTypes: ["video"],
			}),
		).toBe(true);
	});

	it("allows Electron's empty display media permission request from the registered remote desktop main frame", () => {
		expect(
			isAllowedDesktopMediaRequest({
				stage: "request",
				mainWebContentsMatches: false,
				remoteDesktopWebContentsMatches: true,
				isMainFrame: true,
				mediaTypes: [],
			}),
		).toBe(true);
	});

	it.each([
		{
			stage: "request" as const,
			mainWebContentsMatches: false,
			remoteDesktopWebContentsMatches: false,
			isMainFrame: true,
			mediaTypes: ["audio"] as const,
		},
		{
			stage: "request" as const,
			mainWebContentsMatches: true,
			remoteDesktopWebContentsMatches: false,
			isMainFrame: false,
			mediaTypes: ["audio"] as const,
		},
		{
			stage: "request" as const,
			mainWebContentsMatches: true,
			remoteDesktopWebContentsMatches: false,
			isMainFrame: true,
			mediaTypes: ["video"] as const,
		},
		{
			stage: "request" as const,
			mainWebContentsMatches: false,
			remoteDesktopWebContentsMatches: true,
			isMainFrame: true,
			mediaTypes: ["audio"] as const,
		},
		{
			stage: "check" as const,
			mainWebContentsMatches: false,
			remoteDesktopWebContentsMatches: true,
			isMainFrame: false,
			mediaTypes: ["video"] as const,
		},
		{
			stage: "request" as const,
			mainWebContentsMatches: false,
			remoteDesktopWebContentsMatches: true,
			isMainFrame: true,
			mediaTypes: ["video"] as const,
		},
		{
			stage: "request" as const,
			mainWebContentsMatches: false,
			remoteDesktopWebContentsMatches: true,
			isMainFrame: true,
			mediaTypes: ["audio", "video"] as const,
		},
	])("denies untrusted, subframe, and cross-purpose media requests", (context) => {
		expect(isAllowedDesktopMediaRequest(context)).toBe(false);
	});
});
