import assert from "node:assert/strict";
import test from "node:test";
import {
	resolveSpeechInputBuildConfig,
	resolveSpeechInputTargetTags,
} from "./speech-input-build-config.js";

test("enables speech input by default for Windows x64 targets", () => {
	assert.deepEqual(
		resolveSpeechInputBuildConfig({ env: {}, platformTags: ["win32-x64"] }),
		{
			configuredEnabled: true,
			targetSupported: true,
			enabled: true,
			platformTags: ["win32-x64"],
		},
	);
});

test("disables speech input explicitly without changing the target", () => {
	assert.deepEqual(
		resolveSpeechInputBuildConfig({
			env: { VETTA_SPEECH_INPUT_ENABLED: "false" },
			platformTags: ["win32-x64"],
		}),
		{
			configuredEnabled: false,
			targetSupported: true,
			enabled: false,
			platformTags: ["win32-x64"],
		},
	);
});

test("keeps speech input disabled for unsupported targets", () => {
	const config = resolveSpeechInputBuildConfig({
		env: { VETTA_SPEECH_INPUT_ENABLED: "true" },
		platformTags: ["darwin-arm64"],
	});
	assert.equal(config.configuredEnabled, true);
	assert.equal(config.targetSupported, false);
	assert.equal(config.enabled, false);
});

test("rejects ambiguous feature flag values", () => {
	for (const value of ["", "0", "TRUE"]) {
		assert.throws(
			() =>
				resolveSpeechInputBuildConfig({
					env: { VETTA_SPEECH_INPUT_ENABLED: value },
					platformTags: ["win32-x64"],
				}),
			/VETTA_SPEECH_INPUT_ENABLED must be "true" or "false"/,
		);
	}
});

test("uses the existing target environment precedence", () => {
	assert.deepEqual(
		resolveSpeechInputTargetTags({
			VETTA_VENDOR_PLATFORM: "linux-x64",
			VETTA_CLI_TARGET_PLATFORMS: "win32-x64,darwin-arm64",
			VETTA_IM_GATEWAY_TARGET_PLATFORMS: "darwin-x64",
		}),
		["darwin-x64"],
	);
});
