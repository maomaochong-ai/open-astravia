import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { verifyMarketplacePublication } from "./check-plugin-marketplace-publication.mjs";

const bytes = Buffer.from("plugin zip bytes");
const digest = createHash("sha256").update(bytes).digest("hex");

function manifest() {
	return {
		schemaVersion: 3,
		repository: "https://github.com/example/market",
		abilities: [{
			type: "plugin",
			slug: "demo",
			releases: [{
				version: "1.2.0",
				minAppVersion: "0.5.58",
				pluginApiVersion: "^2.5.0",
				artifact: { url: "https://api.github.com/repos/example/market/releases/assets/123", sha256: digest },
			}],
		}],
	};
}

function fixture({ published = true, apiVersion = "2.5.0", schemaVersion = 3, archive = bytes } = {}) {
	const requests = [];
	const fetcher = async (input, init) => {
		const url = String(input);
		requests.push({ url, authorization: new Headers(init?.headers).get("authorization") });
		if (url.endsWith("/releases/tags/v0.5.58")) {
			return Response.json({
				tag_name: "v0.5.58",
				draft: false,
				prerelease: false,
				published_at: published ? "2026-09-18T00:00:00Z" : null,
				assets: [{ id: 1 }],
			});
		}
		if (url.includes("/contents/apps/desktop/src/main/plugins/plugin-api-version.ts")) {
			return Response.json({
				encoding: "base64",
				content: Buffer.from(`export const PLUGIN_API_VERSION = "${apiVersion}";`).toString("base64"),
			});
		}
		if (url.includes("/contents/apps/desktop/src/main/abilities/open-marketplace/marketplace-schema.ts")) {
			return Response.json({
				encoding: "base64",
				content: Buffer.from(schemaVersion === 3
					? "export const MARKETPLACE_SCHEMA_VERSION = 3;\nschemaVersion: z.literal(MARKETPLACE_SCHEMA_VERSION)"
					: "schemaVersion: z.union([z.literal(1), z.literal(2)])").toString("base64"),
			});
		}
		if (url.endsWith("/releases/assets/123")) {
			return new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/demo.zip" } });
		}
		if (url === "https://release-assets.githubusercontent.com/demo.zip") return new Response(new Uint8Array(archive));
		throw new Error(`Unexpected request: ${url}`);
	};
	return { fetcher, requests };
}

test("accepts an immutable plugin artifact only after its required App release contains the required API", async () => {
	const { fetcher, requests } = fixture();
	const result = await verifyMarketplacePublication(manifest(), { fetcher, token: "secret" });
	assert.deepEqual(result, { releases: 1, appVersions: ["0.5.58"] });
	assert.deepEqual(requests.map((request) => request.authorization), ["Bearer secret", "Bearer secret", "Bearer secret", "Bearer secret", null]);
});

test("blocks a plugin before its minimum App version is publicly released", async () => {
	await assert.rejects(verifyMarketplacePublication(manifest(), { fetcher: fixture({ published: false }).fetcher }), /not a completed stable/);
});

test("blocks a plugin whose declared minimum App lacks the Plugin API", async () => {
	await assert.rejects(verifyMarketplacePublication(manifest(), { fetcher: fixture({ apiVersion: "2.4.0" }).fetcher }), /unavailable in published Desktop/);
});

test("blocks a released App that cannot read marketplace schema v3", async () => {
	await assert.rejects(verifyMarketplacePublication(manifest(), { fetcher: fixture({ schemaVersion: 2 }).fetcher }), /does not support marketplace schema v3/);
});

test("blocks a missing or changed artifact even when App compatibility is valid", async () => {
	await assert.rejects(verifyMarketplacePublication(manifest(), { fetcher: fixture({ archive: Buffer.from("changed") }).fetcher }), /SHA-256 mismatch/);
});

test("checks releases of bundle-only plugins before publication", async () => {
	const source = manifest();
	const plugin = source.abilities[0];
	source.abilities = [{ type: "bundle", slug: "starter", config: { members: [{ type: "plugin", slug: plugin.slug, source: { path: "abilities/plugins/demo" }, releases: plugin.releases }] } }];
	assert.deepEqual(await verifyMarketplacePublication(source, { fetcher: fixture().fetcher }), { releases: 1, appVersions: ["0.5.58"] });
});
