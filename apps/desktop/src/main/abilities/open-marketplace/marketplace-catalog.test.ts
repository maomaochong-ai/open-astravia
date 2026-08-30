import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMarketplaceCatalog } from "./marketplace-catalog";
import { parseMarketplaceManifest } from "./marketplace-schema";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "vetta-bundle-catalog-test-"));
	roots.push(root);
	const source = { path: "abilities/guide" };
	const directory = join(root, source.path);
	mkdirSync(directory, { recursive: true });
	const metadata = {
		schemaVersion: 1,
		type: "skill",
		slug: "guide",
		version: "1.0.0",
		name: "Research Guide",
		configVersion: 2,
		category: "Social",
		categoryI18n: { zh: "社交", en: "Social" },
		detail: {
			format: "markdown",
			path: "README.md",
			i18n: { zh: { path: "README.zh.md", name: "检索指南", description: "查询来源", tags: ["检索"] } },
		},
	};
	writeFileSync(join(directory, "ability.json"), JSON.stringify(metadata));
	writeFileSync(join(directory, "README.md"), "English guide");
	writeFileSync(join(directory, "README.zh.md"), "中文指南");
	writeFileSync(
		join(directory, "SKILL.md"),
		"---\nname: guide\ndescription: Research guide\nversion: 1.0.0\n---\nGuide",
	);
	const bundle = {
		type: "bundle",
		slug: "research",
		name: "Research",
		version: "1.0.0",
		config: { members: [{ type: "skill", slug: "guide", source }] },
	};
	const raw = {
		schemaVersion: 2,
		name: "test",
		marketplaceVersion: "1",
		repository: "https://github.com/example/market",
		minAppVersion: "0.5.49",
		abilities: [bundle],
	};
	return { root, directory, metadata, bundle, raw };
}

describe("loadMarketplaceCatalog", () => {
	it("resolves unlisted packages and localized presentation without changing the declared listings", () => {
		const { root, raw } = fixture();
		const manifest = parseMarketplaceManifest(raw);
		const before = structuredClone(manifest);
		const catalog = loadMarketplaceCatalog(root, manifest);
		expect(manifest).toEqual(before);
		expect([...catalog.listedSlugs]).toEqual(["research"]);
		expect(catalog.abilities.map((item) => item.slug)).toEqual(["research", "guide"]);
		expect(catalog.abilities[1]).toMatchObject({
			name: "Research Guide",
			configVersion: 2,
			categoryI18n: { zh: "社交" },
			detail: {
				content: "English guide",
				i18n: { zh: { name: "检索指南", description: "查询来源", tags: ["检索"], content: "中文指南" } },
			},
		});
	});

	it("shares one member across bundles and retains identity when it is independently listed", () => {
		const { root, raw, bundle } = fixture();
		const input = { ...raw, abilities: [bundle, { ...bundle, slug: "second" }] };
		expect(loadMarketplaceCatalog(root, parseMarketplaceManifest(input)).abilities).toHaveLength(3);
		const listed = {
			type: "skill",
			slug: "guide",
			name: "Listed Guide",
			version: "1.0.0",
			source: { path: "abilities/guide" },
		};
		const catalog = loadMarketplaceCatalog(
			root,
			parseMarketplaceManifest({ ...input, abilities: [...input.abilities, listed] }),
		);
		expect(catalog.abilities).toHaveLength(3);
		expect(catalog.listedSlugs.has("guide")).toBe(true);
		expect(catalog.abilities.find((item) => item.slug === "guide")?.name).toBe("Listed Guide");
	});

	it("rejects the same identity pointing at different member packages", () => {
		const { root, raw, bundle } = fixture();
		const second = {
			...bundle,
			slug: "second",
			config: { members: [{ type: "skill", slug: "guide", source: { path: "other" } }] },
		};
		expect(() =>
			loadMarketplaceCatalog(root, parseMarketplaceManifest({ ...raw, abilities: [bundle, second] })),
		).toThrow("Conflicting bundle member source");
	});

	it.each([
		{ field: "slug", value: "different" },
		{ field: "type", value: "bundle" },
		{ field: "version", value: "2.0.0" },
		{ field: "name", value: undefined },
		{ field: "categoryI18n", value: { zh: 7 } },
		{ field: "config", value: { command: "unexpected" } },
	])("rejects invalid member metadata: $field", ({ field, value }) => {
		const { root, directory, raw, metadata } = fixture();
		writeFileSync(join(directory, "ability.json"), JSON.stringify({ ...metadata, [field]: value }));
		expect(() => loadMarketplaceCatalog(root, parseMarketplaceManifest(raw))).toThrow();
	});

	it("rejects missing descriptors and detail paths escaping the member package", () => {
		const { root, directory, raw, metadata } = fixture();
		writeFileSync(
			join(directory, "ability.json"),
			JSON.stringify({ ...metadata, detail: { format: "markdown", path: "../../outside.md" } }),
		);
		expect(() => loadMarketplaceCatalog(root, parseMarketplaceManifest(raw))).toThrow("escapes ability source");
		rmSync(join(directory, "ability.json"));
		expect(() => loadMarketplaceCatalog(root, parseMarketplaceManifest(raw))).toThrow();
	});

	it("derives MCP configuration and parameters from mcp.json, not the bundle", () => {
		const { root, directory, raw, metadata } = fixture();
		writeFileSync(join(directory, "ability.json"), JSON.stringify({ ...metadata, type: "mcp" }));
		writeFileSync(
			join(directory, "mcp.json"),
			JSON.stringify({
				schemaVersion: 1,
				slug: "guide",
				version: "1.0.0",
				server: { command: "uvx", args: ["example"] },
				parameters: [{ key: "TOKEN", label: "Token", secret: true, required: true }],
			}),
		);
		raw.abilities[0].config.members[0].type = "mcp";
		const catalog = loadMarketplaceCatalog(root, parseMarketplaceManifest(raw));
		expect(catalog.abilities[1].config).toMatchObject({
			mcp: { command: "uvx" },
			mcp_parameters: [{ key: "TOKEN", secret: true, required: true }],
		});
		expect(readFileSync(join(directory, "mcp.json"), "utf8")).not.toContain("autoApprove");
	});

	it("supports scene and plugin members through their existing package validators", () => {
		const { root, directory, raw, metadata } = fixture();
		raw.abilities[0].config.members[0].type = "scene";
		writeFileSync(join(directory, "ability.json"), JSON.stringify({ ...metadata, type: "scene" }));
		expect(loadMarketplaceCatalog(root, parseMarketplaceManifest(raw)).abilities[1].type).toBe("scene");
		raw.abilities[0].config.members[0].type = "plugin";
		writeFileSync(join(directory, "ability.json"), JSON.stringify({ ...metadata, type: "plugin" }));
		writeFileSync(
			join(directory, "plugin.json"),
			JSON.stringify({
				id: "guide",
				version: "1.0.0",
				name: "Guide",
				pluginApiVersion: "1.1.0",
				entry: "index.js",
				permissions: ["storage.read"],
			}),
		);
		writeFileSync(join(directory, "index.js"), "export default {};");
		expect(loadMarketplaceCatalog(root, parseMarketplaceManifest(raw)).abilities[1].config).toMatchObject({
			permissions: ["storage.read"],
			api_version: "1.1.0",
		});
		rmSync(join(directory, "index.js"));
		expect(() => loadMarketplaceCatalog(root, parseMarketplaceManifest(raw))).toThrow("missing or outside");
	});

	it("rejects oversized metadata before parsing it", () => {
		const { root, directory, raw, metadata } = fixture();
		writeFileSync(
			join(directory, "ability.json"),
			JSON.stringify({ ...metadata, description: "x".repeat(64 * 1024) }),
		);
		expect(() => loadMarketplaceCatalog(root, parseMarketplaceManifest(raw))).toThrow("too large");
	});

	it("rejects package directory links and links inside member packages", () => {
		const { root, directory, raw } = fixture();
		const outside = fixture();
		const link = join(root, "linked-package");
		symlinkSync(outside.directory, link, "junction");
		raw.abilities[0].config.members[0].source.path = "linked-package";
		expect(() => loadMarketplaceCatalog(root, parseMarketplaceManifest(raw))).toThrow("Unsafe ability source");
		raw.abilities[0].config.members[0].source.path = "abilities/guide";
		symlinkSync(outside.directory, join(directory, "linked-child"), "junction");
		expect(() => loadMarketplaceCatalog(root, parseMarketplaceManifest(raw))).toThrow("Symlinks are not allowed");
	});
});
