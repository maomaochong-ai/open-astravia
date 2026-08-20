import assert from "node:assert/strict";
import test from "node:test";
import { resolveUpdateFeedBase, verifyUpdateFeed } from "./verify-update-feed.mjs";

const version = "0.5.46";
const metadata = {
	"latest.yml": `version: ${version}\npath: Vetta-Setup-${version}.exe\nfiles:\n  - url: Vetta-Setup-${version}.exe\n`,
	"latest-mac.yml": `version: ${version}\nfiles:\n  - url: Vetta-${version}.zip\n    sha512: test\n`,
	"latest-linux.yml": `version: ${version}\npath: Vetta-${version}.AppImage\nfiles:\n  - url: Vetta-${version}.AppImage\n`,
};

function createFetch() {
	const calls = [];
	return {
		calls,
		fetchImpl: async (url, init) => {
			calls.push({ url, method: init.method });
			const fileName = new URL(url).pathname.split("/").at(-1);
			if (fileName in metadata) return { ok: true, status: 200, text: async () => metadata[fileName] };
			return { ok: true, status: 200, text: async () => "" };
		},
	};
}

test("resolves provider-specific public feed bases", () => {
	assert.equal(
		resolveUpdateFeedBase({
			env: { VETTA_UPDATE_PROVIDER: "generic", VETTA_UPDATE_URL: "https://updates.example.com/desktop/stable" },
			version,
		}),
		"https://updates.example.com/desktop/stable/",
	);
	assert.equal(
		resolveUpdateFeedBase({
			env: { VETTA_UPDATE_PROVIDER: "github", VETTA_UPDATE_GITHUB_OWNER: "openvetta", VETTA_UPDATE_GITHUB_REPO: "open-vetta" },
			version,
		}),
		"https://github.com/openvetta/open-vetta/releases/download/v0.5.46/",
	);
});

test("accepts a Git tag version with the leading v", () => {
	assert.equal(
		resolveUpdateFeedBase({
			env: { VETTA_UPDATE_PROVIDER: "github", VETTA_UPDATE_GITHUB_OWNER: "openvetta", VETTA_UPDATE_GITHUB_REPO: "open-vetta" },
		version: "v0.5.46",
		}),
		"https://github.com/openvetta/open-vetta/releases/download/v0.5.46/",
	);
});

test("verifies all platform metadata and referenced artifacts", async () => {
	const fake = createFetch();
	const result = await verifyUpdateFeed({
		env: { VETTA_UPDATE_PROVIDER: "generic", VETTA_UPDATE_URL: "https://updates.example.com/desktop/stable" },
		version,
		fetchImpl: fake.fetchImpl,
		retryDelayMs: 0,
	});
	assert.equal(result.metadataFiles.length, 3);
	assert.equal(result.artifacts.length, 3);
	assert.equal(fake.calls.filter((call) => call.method === "GET").length, 3);
	assert.equal(fake.calls.filter((call) => call.method === "HEAD").length, 3);
});

test("falls back to a ranged GET when a CDN rejects HEAD", async () => {
	const fake = createFetch();
	const fetchImpl = async (url, init) => {
		if (init.method === "HEAD") return { ok: false, status: 405, text: async () => "" };
		return fake.fetchImpl(url, init);
	};
	await verifyUpdateFeed({
		env: { VETTA_UPDATE_PROVIDER: "generic", VETTA_UPDATE_URL: "https://updates.example.com/desktop/stable" },
		version,
		metadataFiles: ["latest-linux.yml"],
		fetchImpl,
		retryDelayMs: 0,
	});
	assert.ok(fake.calls.some((call) => call.method === "GET"));
});

test("rejects a feed that serves a different release version", async () => {
	const fake = createFetch();
	assert.rejects(
		verifyUpdateFeed({
			env: { VETTA_UPDATE_PROVIDER: "generic", VETTA_UPDATE_URL: "https://updates.example.com/desktop/stable" },
			version: "0.5.47",
			metadataFiles: ["latest.yml"],
			fetchImpl: fake.fetchImpl,
			retryDelayMs: 0,
		}),
		/expected 0\.5\.47/,
	);
});
