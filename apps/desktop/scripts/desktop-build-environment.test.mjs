import assert from "node:assert/strict";
import test from "node:test";
import {
	createOpenSourceBuildEnvironment,
	validateDesktopBuildEnvironment,
} from "./desktop-build-environment.mjs";
import { resolveMacSigningConfig } from "./mac-signing-config.mjs";

const commercialEnv = {
	VETTA_CLOUD_ENABLED: "true",
	VETTA_SERVER_URL: "https://api.example.com/api/v1",
	VETTA_UPDATE_PROVIDER: "generic",
	VETTA_VENDOR_PLATFORM: "win32-x64",
};

const openSourceEnv = createOpenSourceBuildEnvironment({
	VETTA_VENDOR_PLATFORM: "linux-x64",
});

test("accepts a commercial Windows build with the default generic updater", () => {
	const config = validateDesktopBuildEnvironment({ env: commercialEnv, platform: "win32", arch: "x64" });
	assert.equal(config.edition, "commercial");
	assert.equal(config.updateConfig.provider, "generic");
	assert.deepEqual(config.platformTags, ["win32-x64"]);
});

test("creates deterministic open-source defaults while preserving fork coordinates", () => {
	const env = createOpenSourceBuildEnvironment({
		VETTA_CLOUD_ENABLED: "true",
		VETTA_SERVER_URL: "https://commercial.example.com",
		VETTA_UPDATE_GITHUB_OWNER: "example",
		VETTA_UPDATE_GITHUB_REPO: "example-desktop",
		VETTA_OPEN_MARKETPLACE_REPOSITORY: "example/marketplace",
	});
	assert.equal(env.VETTA_CLOUD_ENABLED, "false");
	assert.equal(env.VETTA_SERVER_URL, "");
	assert.equal(env.VETTA_UPDATE_PROVIDER, "github");
	assert.equal(env.VETTA_UPDATE_GITHUB_OWNER, "example");
	assert.equal(env.VETTA_OPEN_MARKETPLACE_REPOSITORY, "example/marketplace");
});

test("accepts an open-source Linux build", () => {
	const config = validateDesktopBuildEnvironment({ env: openSourceEnv, platform: "linux", arch: "x64" });
	assert.equal(config.edition, "opensource");
	assert.equal(config.updateConfig.provider, "github");
	assert.deepEqual(config.platformTags, ["linux-x64"]);
});

test("rejects an implicit edition and reports all independent problems", () => {
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: {
					VETTA_POSTHOG_REPLAY_ENABLED: "yes",
					VETTA_SENTRY_TRACES_SAMPLE_RATE: "2",
					VETTA_VENDOR_PLATFORM: "win32-arm64",
				},
			}),
		(error) => {
			assert.match(error.message, /VETTA_CLOUD_ENABLED/);
			assert.match(error.message, /VETTA_POSTHOG_REPLAY_ENABLED/);
			assert.match(error.message, /VETTA_SENTRY_TRACES_SAMPLE_RATE/);
			assert.match(error.message, /win32-arm64/);
			return true;
		},
	);
});

test("rejects commercial and open-source configuration mixing", () => {
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: { ...commercialEnv, VETTA_UPDATE_PROVIDER: "github", VETTA_UPDATE_GITHUB_OWNER: "x", VETTA_UPDATE_GITHUB_REPO: "y" },
			}),
		/commercial builds must use.*generic/,
	);
	assert.throws(
		() => validateDesktopBuildEnvironment({ env: { ...openSourceEnv, VETTA_SERVER_URL: "https://api.example.com" } }),
		/VETTA_SERVER_URL must be empty/,
	);
});

test("requires HTTPS service URLs for production builds", () => {
	assert.throws(
		() => validateDesktopBuildEnvironment({ env: { ...commercialEnv, VETTA_SERVER_URL: "http://api.example.com" } }),
		/VETTA_SERVER_URL must use https/,
	);
	assert.doesNotThrow(() =>
		validateDesktopBuildEnvironment({
			env: { ...commercialEnv, VETTA_SERVER_URL: "http://localhost:3000" },
			mode: "test",
		}),
	);
});

test("requires a secure production updater and valid GitHub coordinates", () => {
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: { ...commercialEnv, VETTA_UPDATE_URL: "http://releases.example.com/desktop/stable" },
			}),
		/VETTA_UPDATE_URL must use https/,
	);
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: { ...openSourceEnv, VETTA_UPDATE_GITHUB_OWNER: "invalid/owner" },
			}),
		/VETTA_UPDATE_GITHUB_OWNER/,
	);
});

test("rejects partial macOS signing credentials and supports signed local iteration", () => {
	assert.throws(() => resolveMacSigningConfig({ CSC_NAME: "Developer ID" }), /APPLE_TEAM_ID/);
	assert.deepEqual(
		resolveMacSigningConfig({
			CSC_NAME: "Developer ID",
			APPLE_TEAM_ID: "TEAM123",
			VETTA_SKIP_NOTARIZE: "1",
		}),
		{ enabled: true, notarize: false, teamId: "TEAM123" },
	);
});

test("requires notarization when macOS signature verification is mandatory", () => {
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: {
					...openSourceEnv,
					VETTA_VENDOR_PLATFORM: "darwin-arm64",
					CSC_NAME: "Developer ID",
					APPLE_TEAM_ID: "TEAM123",
					VETTA_SKIP_NOTARIZE: "1",
					VETTA_REQUIRE_MAC_SIGNATURE: "1",
				},
				platform: "darwin",
				arch: "arm64",
			}),
		/requires macOS signing and notarization/,
	);
});

test("rejects incomplete Sentry source-map upload settings without exposing values", () => {
	assert.doesNotThrow(() =>
		validateDesktopBuildEnvironment({
			env: { ...commercialEnv, VETTA_SENTRY_DSN: "https://public-key@sentry.example.com/1" },
		}),
	);
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: { ...commercialEnv, VETTA_SENTRY_AUTH_TOKEN: "do-not-print" },
			}),
		(error) => {
			assert.match(error.message, /VETTA_SENTRY_ORG/);
			assert.doesNotMatch(error.message, /do-not-print/);
			return true;
		},
	);
});
