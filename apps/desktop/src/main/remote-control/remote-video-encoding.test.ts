import { describe, expect, it, vi } from "vitest";
import { configureRemoteVideoEncoding } from "./remote-video-encoding.js";

describe("Windows screen encoder configuration", () => {
	it("disables encoder reuse on the affected Chromium without replacing other feature settings", () => {
		const commandLine = { getSwitchValue: () => "OtherFeature,AnotherFeature<Trial", appendSwitch: vi.fn() };
		configureRemoteVideoEncoding(commandLine, "win32", "132.0.6834.210");
		expect(commandLine.appendSwitch).toHaveBeenCalledWith(
			"disable-features",
			"OtherFeature,AnotherFeature<Trial,KeepEncoderInstanceOnRelease",
		);
	});

	it.each([
		["darwin", "132.0"],
		["linux", "132.0"],
		["win32", "133.0"],
		["win32", ""],
	])("leaves unverified platforms and versions alone: %s %s", (platform, version) => {
		const commandLine = { getSwitchValue: vi.fn(), appendSwitch: vi.fn() };
		configureRemoteVideoEncoding(commandLine, platform, version);
		expect(commandLine.getSwitchValue).not.toHaveBeenCalled();
		expect(commandLine.appendSwitch).not.toHaveBeenCalled();
	});

	it("does not duplicate an existing disabled feature", () => {
		const commandLine = { getSwitchValue: () => "KeepEncoderInstanceOnRelease<ExistingTrial", appendSwitch: vi.fn() };
		configureRemoteVideoEncoding(commandLine, "win32", "132.0");
		expect(commandLine.appendSwitch).not.toHaveBeenCalled();
	});
});
