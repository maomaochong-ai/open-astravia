import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import {
	parsePlatforms,
	preparePromotion,
	verifyLiveFeed,
	verifyStoredArtifacts,
} from "./promote-update-metadata-r2.mjs";

const sha = (text) => Buffer.from(text).toString("base64");
const hex = (text) => Buffer.from(text).toString("hex");

function metadata(version, files) {
	return [
		`version: ${version}`,
		"files:",
		...files.flatMap(({ url, sha512, size }) => [`  - url: ${url}`, `    sha512: ${sha512}`, `    size: ${size}`]),
		`path: ${files[0].url}`,
		`sha512: ${files[0].sha512}`,
	].join("\n");
}

async function withStagedMetadata(files, run) {
	const directory = await mkdtemp(join(tmpdir(), "vetta-promote-test-"));
	try {
		await Promise.all(Object.entries(files).map(([name, text]) => writeFile(join(directory, name), text)));
		await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

const allPlatforms = {
	"latest.yml": metadata("1.2.3", [{ url: "Vetta-1.2.3-win-x64.exe", sha512: sha("win"), size: 3 }]),
	"latest-linux.yml": metadata("1.2.3", [{ url: "Vetta-1.2.3.AppImage", sha512: sha("linux"), size: 5 }]),
	"latest-mac-arm64.yml": metadata("1.2.3", [{ url: "Vetta-1.2.3-arm64-mac.zip", sha512: sha("arm"), size: 3 }]),
	"latest-mac-x64.yml": metadata("1.2.3", [{ url: "Vetta-1.2.3-mac.zip", sha512: sha("x64"), size: 3 }]),
};

test("parsePlatforms deduplicates and rejects unknown platforms", () => {
	assert.deepEqual(parsePlatforms(" Mac, windows,mac "), ["mac", "windows"]);
	assert.throws(() => parsePlatforms("ios"), /unknown platform/);
	assert.throws(() => parsePlatforms(" , "), /no platform selected/);
});

test("preparePromotion merges both macOS architectures and lists referenced installers", async () => {
	await withStagedMetadata(allPlatforms, async (directory) => {
		const plan = await preparePromotion({ directory, version: "1.2.3", platforms: ["windows", "mac", "linux"] });
		assert.deepEqual(
			plan.map(({ fileName, artifacts }) => [fileName, artifacts.map(({ name }) => name)]),
			[
				["latest.yml", ["Vetta-1.2.3-win-x64.exe"]],
				["latest-mac.yml", ["Vetta-1.2.3-mac.zip", "Vetta-1.2.3-arm64-mac.zip"]],
				["latest-linux.yml", ["Vetta-1.2.3.AppImage"]],
			],
		);
		assert.equal(plan[0].artifacts[0].sha512, hex("win"));
		const merged = parse(await readFile(join(directory, "latest-mac.yml"), "utf8"));
		assert.equal(merged.files.length, 2);
		assert.deepEqual((await readdir(directory)).sort(), ["latest-linux.yml", "latest-mac.yml", "latest.yml"]);
	});
});

test("preparePromotion refuses to promote a macOS feed with one architecture missing", async () => {
	const { "latest-mac-x64.yml": _omitted, ...partial } = allPlatforms;
	await withStagedMetadata(partial, async (directory) => {
		await assert.rejects(
			preparePromotion({ directory, version: "1.2.3", platforms: ["mac"] }),
			/missing latest-mac-x64\.yml/,
		);
		const plan = await preparePromotion({ directory, version: "1.2.3", platforms: ["windows"] });
		assert.deepEqual(
			plan.map(({ fileName }) => fileName),
			["latest.yml"],
		);
	});
});

test("preparePromotion rejects staged metadata from another version", async () => {
	await withStagedMetadata(allPlatforms, async (directory) => {
		await assert.rejects(
			preparePromotion({ directory, version: "1.2.4", platforms: ["linux"] }),
			/has version 1\.2\.3, expected 1\.2\.4/,
		);
	});
});

test("verifyStoredArtifacts requires installers on R2 with matching sha512 and size", async () => {
	const plan = [{ fileName: "latest.yml", artifacts: [{ name: "a.exe", sha512: hex("a"), size: 1 }] }];
	await verifyStoredArtifacts(plan, async () => ({ ContentLength: 1, Metadata: { sha512: hex("a") } }));
	await assert.rejects(verifyStoredArtifacts(plan, async () => undefined), /not on R2/);
	await assert.rejects(
		verifyStoredArtifacts(plan, async () => ({ ContentLength: 1, Metadata: { sha512: hex("b") } })),
		/does not match the sha512/,
	);
	await assert.rejects(
		verifyStoredArtifacts(plan, async () => ({ ContentLength: 2, Metadata: { sha512: hex("a") } })),
		/is 2 bytes/,
	);
});

test("verifyLiveFeed retries while the CDN still serves the previous metadata", async () => {
	let calls = 0;
	const delays = [];
	const result = await verifyLiveFeed({
		updateUrl: "https://releases.example.com/desktop/stable",
		version: "1.2.3",
		metadataFiles: ["latest.yml"],
		verify: async ({ env, metadataFiles }) => {
			calls += 1;
			assert.equal(env.VETTA_UPDATE_PROVIDER, "generic");
			assert.deepEqual(metadataFiles, ["latest.yml"]);
			if (calls < 3) throw new Error("latest.yml has version 1.2.2");
			return "ok";
		},
		delay: async (milliseconds) => delays.push(milliseconds),
	});
	assert.equal(result, "ok");
	assert.deepEqual(delays, [20_000, 20_000]);

	await assert.rejects(
		verifyLiveFeed({
			updateUrl: "https://releases.example.com/desktop/stable",
			version: "1.2.3",
			metadataFiles: ["latest.yml"],
			attempts: 2,
			verify: async () => {
				throw new Error("still stale");
			},
			delay: async () => undefined,
		}),
		/still stale/,
	);
});
