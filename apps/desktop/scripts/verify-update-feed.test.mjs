import assert from "node:assert/strict";
import test from "node:test";
import { resolveUpdateFeedBase, verifyUpdateFeed } from "./verify-update-feed.mjs";

const version = "0.5.46";
const metadata = {
	"latest.yml": `version: ${version}\npath: Astravia-Setup-${version}.exe\nfiles:\n  - url: Astravia-Setup-${version}.exe\n`,
	"latest-mac.yml": `version: ${version}\nfiles:\n  - url: Astravia-${version}.zip\n    sha512: test\n`,
	"latest-linux.yml": `version: ${version}\npath: Astravia-${version}.AppImage\nfiles:\n  - url: Astravia-${version}.AppImage\n`,
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
			env: { ASTRAVIA_UPDATE_PROVIDER: "generic", ASTRAVIA_UPDATE_URL: "https://updates.example.com/desktop/stable" },
			version,
		}),
		"https://updates.example.com/desktop/stable/",
	);
	assert.equal(
		resolveUpdateFeedBase({
			env: { ASTRAVIA_UPDATE_PROVIDER: "github", ASTRAVIA_UPDATE_GITHUB_OWNER: "maomaochong-ai", ASTRAVIA_UPDATE_GITHUB_REPO: "open-astravia" },
			version,
		}),
		"https://github.com/maomaochong-ai/open-astravia/releases/download/v0.5.46/",
	);
});

test("accepts a Git tag version with the leading v", () => {
	assert.equal(
		resolveUpdateFeedBase({
			env: { ASTRAVIA_UPDATE_PROVIDER: "github", ASTRAVIA_UPDATE_GITHUB_OWNER: "maomaochong-ai", ASTRAVIA_UPDATE_GITHUB_REPO: "open-astravia" },
		version: "v0.5.46",
		}),
		"https://github.com/maomaochong-ai/open-astravia/releases/download/v0.5.46/",
	);
});

test("verifies all platform metadata and referenced artifacts", async () => {
	const fake = createFetch();
	const result = await verifyUpdateFeed({
		env: { ASTRAVIA_UPDATE_PROVIDER: "generic", ASTRAVIA_UPDATE_URL: "https://updates.example.com/desktop/stable" },
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
		env: { ASTRAVIA_UPDATE_PROVIDER: "generic", ASTRAVIA_UPDATE_URL: "https://updates.example.com/desktop/stable" },
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
			env: { ASTRAVIA_UPDATE_PROVIDER: "generic", ASTRAVIA_UPDATE_URL: "https://updates.example.com/desktop/stable" },
			version: "0.5.47",
			metadataFiles: ["latest.yml"],
			fetchImpl: fake.fetchImpl,
			retryDelayMs: 0,
		}),
		/expected 0\.5\.47/,
	);
});
