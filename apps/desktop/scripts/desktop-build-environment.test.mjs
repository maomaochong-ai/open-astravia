import assert from "node:assert/strict";
import test from "node:test";
import {
	createOpenSourceBuildEnvironment,
	validateDesktopBuildEnvironment,
} from "./desktop-build-environment.mjs";
import { resolveMacSigningConfig } from "./mac-signing-config.mjs";

const commercialEnv = {
	ASTRAVIA_CLOUD_ENABLED: "true",
	ASTRAVIA_SERVER_URL: "https://api.example.com/api/v1",
	ASTRAVIA_UPDATE_PROVIDER: "generic",
	ASTRAVIA_VENDOR_PLATFORM: "win32-x64",
};

const openSourceEnv = createOpenSourceBuildEnvironment({
	ASTRAVIA_VENDOR_PLATFORM: "linux-x64",
});

test("accepts a commercial Windows build with the default generic updater", () => {
	const config = validateDesktopBuildEnvironment({ env: commercialEnv, platform: "win32", arch: "x64" });
	assert.equal(config.edition, "commercial");
	assert.equal(config.updateConfig.provider, "generic");
	assert.deepEqual(config.platformTags, ["win32-x64"]);
});

test("creates deterministic open-source defaults while preserving fork coordinates", () => {
	const env = createOpenSourceBuildEnvironment({
		ASTRAVIA_CLOUD_ENABLED: "true",
		ASTRAVIA_SERVER_URL: "https://commercial.example.com",
		ASTRAVIA_UPDATE_GITHUB_OWNER: "example",
		ASTRAVIA_UPDATE_GITHUB_REPO: "example-desktop",
		ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY: "example/marketplace",
	});
	assert.equal(env.ASTRAVIA_CLOUD_ENABLED, "false");
	assert.equal(env.ASTRAVIA_SERVER_URL, "");
	assert.equal(env.ASTRAVIA_UPDATE_PROVIDER, "github");
	assert.equal(env.ASTRAVIA_UPDATE_GITHUB_OWNER, "example");
	assert.equal(env.ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY, "example/marketplace");
});

test("accepts an open-source Linux build", () => {
	const config = validateDesktopBuildEnvironment({ env: openSourceEnv, platform: "linux", arch: "x64" });
	assert.equal(config.edition, "opensource");
	assert.equal(config.updateConfig.provider, "github");
	assert.deepEqual(config.platformTags, ["linux-x64"]);
});

test("does not supply a hard-coded marketplace in open-source build environments", () => {
	assert.equal(createOpenSourceBuildEnvironment({}).ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY, undefined);
	assert.equal(createOpenSourceBuildEnvironment({ ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY: "" }).ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY, "");
});

test("validates GitHub source overrides independently of the cloud edition", () => {
	for (const env of [commercialEnv, openSourceEnv]) {
		assert.doesNotThrow(() => validateDesktopBuildEnvironment({ env: { ...env, ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY: "example/catalog" } }));
		assert.throws(() => validateDesktopBuildEnvironment({ env: { ...env, ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY: "https://invalid.example/catalog" } }), /ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY/);
		assert.doesNotThrow(() => validateDesktopBuildEnvironment({ env: { ...env, ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY: "" } }));
	}
});

test("rejects an implicit edition and reports all independent problems", () => {
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: {
					ASTRAVIA_POSTHOG_REPLAY_ENABLED: "yes",
					ASTRAVIA_SENTRY_TRACES_SAMPLE_RATE: "2",
					ASTRAVIA_VENDOR_PLATFORM: "win32-arm64",
				},
			}),
		(error) => {
			assert.match(error.message, /ASTRAVIA_CLOUD_ENABLED/);
			assert.match(error.message, /ASTRAVIA_POSTHOG_REPLAY_ENABLED/);
			assert.match(error.message, /ASTRAVIA_SENTRY_TRACES_SAMPLE_RATE/);
			assert.match(error.message, /win32-arm64/);
			return true;
		},
	);
});

test("rejects commercial and open-source configuration mixing", () => {
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: { ...commercialEnv, ASTRAVIA_UPDATE_PROVIDER: "github", ASTRAVIA_UPDATE_GITHUB_OWNER: "x", ASTRAVIA_UPDATE_GITHUB_REPO: "y" },
			}),
		/commercial builds must use.*generic/,
	);
	assert.throws(
		() => validateDesktopBuildEnvironment({ env: { ...openSourceEnv, ASTRAVIA_SERVER_URL: "https://api.example.com" } }),
		/ASTRAVIA_SERVER_URL must be empty/,
	);
});

test("requires HTTPS service URLs for production builds", () => {
	assert.throws(
		() => validateDesktopBuildEnvironment({ env: { ...commercialEnv, ASTRAVIA_SERVER_URL: "http://api.example.com" } }),
		/ASTRAVIA_SERVER_URL must use https/,
	);
	assert.doesNotThrow(() =>
		validateDesktopBuildEnvironment({
			env: { ...commercialEnv, ASTRAVIA_SERVER_URL: "http://localhost:3000" },
			mode: "test",
		}),
	);
});

test("requires a secure production updater and valid GitHub coordinates", () => {
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: { ...commercialEnv, ASTRAVIA_UPDATE_URL: "http://releases.example.com/desktop/stable" },
			}),
		/ASTRAVIA_UPDATE_URL must use https/,
	);
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: { ...openSourceEnv, ASTRAVIA_UPDATE_GITHUB_OWNER: "invalid/owner" },
			}),
		/ASTRAVIA_UPDATE_GITHUB_OWNER/,
	);
});

test("rejects partial macOS signing credentials and supports signed local iteration", () => {
	assert.throws(() => resolveMacSigningConfig({ CSC_NAME: "Developer ID" }), /APPLE_TEAM_ID/);
	assert.deepEqual(
		resolveMacSigningConfig({
			CSC_NAME: "Developer ID",
			APPLE_TEAM_ID: "TEAM123",
			ASTRAVIA_SKIP_NOTARIZE: "1",
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
					ASTRAVIA_VENDOR_PLATFORM: "darwin-arm64",
					CSC_NAME: "Developer ID",
					APPLE_TEAM_ID: "TEAM123",
					ASTRAVIA_SKIP_NOTARIZE: "1",
					ASTRAVIA_REQUIRE_MAC_SIGNATURE: "1",
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
			env: { ...commercialEnv, ASTRAVIA_SENTRY_DSN: "https://public-key@sentry.example.com/1" },
		}),
	);
	assert.throws(
		() =>
			validateDesktopBuildEnvironment({
				env: { ...commercialEnv, ASTRAVIA_SENTRY_AUTH_TOKEN: "do-not-print" },
			}),
		(error) => {
			assert.match(error.message, /ASTRAVIA_SENTRY_ORG/);
			assert.doesNotMatch(error.message, /do-not-print/);
			return true;
		},
	);
});
