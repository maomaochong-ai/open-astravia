import assert from "node:assert/strict";
import test from "node:test";
import { resolveUpdatePublishConfig } from "./resolve-update-publish-config.mjs";

const DEFAULT_UPDATE_URL = "https://releases.openvetta.com/desktop/stable";

test("defaults packaged builds to the official stable update feed", () => {
	assert.deepEqual(resolveUpdatePublishConfig({}), {
		provider: "generic",
		url: DEFAULT_UPDATE_URL,
		useMultipleRangeRequest: true,
	});
});

test("allows an explicit update URL to override the stable default", () => {
	assert.deepEqual(
		resolveUpdatePublishConfig({
			VETTA_UPDATE_URL: "https://releases.example.com/desktop/test/",
		}),
		{
			provider: "generic",
			url: "https://releases.example.com/desktop/test",
			useMultipleRangeRequest: true,
		},
	);
});

test("rejects a package without an update provider", () => {
	assert.throws(
		() => resolveUpdatePublishConfig({ VETTA_UPDATE_PROVIDER: "none" }),
		/expected generic or github/,
	);
});

test("still requires GitHub coordinates for the GitHub provider", () => {
	assert.throws(
		() => resolveUpdatePublishConfig({ VETTA_UPDATE_PROVIDER: "github" }),
		/VETTA_UPDATE_GITHUB_OWNER is required/,
	);
});
