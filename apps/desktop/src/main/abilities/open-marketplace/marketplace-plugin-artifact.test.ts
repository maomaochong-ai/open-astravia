import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { fetchVerifiedMarketplacePluginArtifact } from "./marketplace-plugin-artifact";
import type { MarketplacePluginRelease } from "./marketplace-schema";

function fixture() {
	const zip = new AdmZip();
	zip.addFile(
		"plugin.json",
		Buffer.from(
			JSON.stringify({
				id: "demo",
				name: "Demo",
				version: "1.2.0",
				pluginApiVersion: "^2.5.0",
				entry: "dist/index.js",
				moduleFederation: { remoteName: "demo", expose: "./plugin" },
				permissions: ["storage.read"],
			}),
		),
	);
	zip.addFile("dist/index.js", Buffer.from("export default {};"));
	const bytes = zip.toBuffer();
	const release: MarketplacePluginRelease = {
		version: "1.2.0",
		minAppVersion: "0.5.58",
		pluginApiVersion: "^2.5.0",
		permissions: ["storage.read"],
		commands: [],
		artifact: {
			url: "https://api.github.com/repos/example/market/releases/assets/123",
			sha256: createHash("sha256").update(bytes).digest("hex"),
		},
	};
	return { bytes, release };
}

describe("marketplace plugin artifact", () => {
	it("downloads an authenticated GitHub asset, verifies its bytes and drops authorization on redirect", async () => {
		const { bytes, release } = fixture();
		const requests: Array<{ url: string; authorization: string | undefined }> = [];
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			requests.push({ url, authorization: new Headers(init?.headers).get("authorization") ?? undefined });
			return requests.length === 1
				? new Response(null, {
						status: 302,
						headers: { location: "https://release-assets.githubusercontent.com/demo.zip" },
					})
				: new Response(new Uint8Array(bytes), { status: 200 });
		};
		const actual = await fetchVerifiedMarketplacePluginArtifact(
			release,
			"demo",
			"https://github.com/example/market",
			"secret",
			fetcher,
		);
		expect(actual).toEqual(bytes);
		expect(requests.map((request) => request.authorization)).toEqual(["Bearer secret", undefined]);
	});

	it("rejects a changed archive before installing it", async () => {
		const { bytes, release } = fixture();
		const fetcher: typeof fetch = async () => new Response(new Uint8Array(bytes), { status: 200 });
		await expect(
			fetchVerifiedMarketplacePluginArtifact(
				{ ...release, artifact: { ...release.artifact, sha256: "b".repeat(64) } },
				"demo",
				"https://github.com/example/market",
				undefined,
				fetcher,
			),
		).rejects.toThrow(/SHA-256 mismatch/);
	});

	it("rejects metadata that disagrees with the archive manifest", async () => {
		const { bytes, release } = fixture();
		const fetcher: typeof fetch = async () => new Response(new Uint8Array(bytes), { status: 200 });
		await expect(
			fetchVerifiedMarketplacePluginArtifact(
				{ ...release, permissions: [] },
				"demo",
				"https://github.com/example/market",
				undefined,
				fetcher,
			),
		).rejects.toThrow(/contract does not match/);
	});
});
