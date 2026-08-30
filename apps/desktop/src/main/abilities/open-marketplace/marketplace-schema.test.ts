import { describe, expect, it } from "vitest";
import { parseMarketplaceManifest } from "./marketplace-schema";

function validManifest(): Record<string, unknown> {
	return {
		schemaVersion: 1,
		name: "vetta-open-abilities",
		marketplaceVersion: "2026.07.1",
		repository: "https://github.com/example/vetta-abilities",
		minAppVersion: "0.5.11",
		abilities: [
			{
				type: "skill",
				slug: "demo-skill",
				name: "Demo Skill",
				description: "Demo",
				version: "1.0.0",
				source: { path: "abilities/skills/demo-skill" },
			},
		],
	};
}

describe("parseMarketplaceManifest", () => {
	it.each(["../escape", "/absolute", "C:relative", "C:/absolute", "\\\\server\\share", "bad\0path", "."])(
		"rejects unsafe member paths: %s",
		(path) => {
			const bundle = {
				type: "bundle",
				slug: "research",
				name: "Research",
				version: "1.0.0",
				config: { members: [{ type: "skill", slug: "guide", source: { path } }] },
			};
			expect(() =>
				parseMarketplaceManifest({ ...validManifest(), schemaVersion: 2, abilities: [bundle] }),
			).toThrow();
		},
	);
	it("does not resolve bare references from another bundle's unlisted packages", () => {
		const bundle = {
			type: "bundle",
			slug: "research",
			name: "Research",
			version: "1.0.0",
			config: { members: [{ type: "skill", slug: "guide", source: { path: "abilities/guide" } }] },
		};
		const bare = { ...bundle, slug: "bare", config: { members: [{ type: "skill", slug: "guide" }] } };
		for (const abilities of [
			[bundle, bare],
			[bare, bundle],
		]) {
			expect(() => parseMarketplaceManifest({ ...validManifest(), schemaVersion: 2, abilities })).toThrow(
				"Bundle member not found",
			);
		}
	});
	it("accepts explicit package members only with the version 2 manifest contract", () => {
		const bundle = {
			type: "bundle",
			slug: "research",
			name: "Research",
			version: "1.0.0",
			config: { members: [{ type: "skill", slug: "guide", source: { path: "abilities\\guide" } }] },
		};
		const raw = { ...validManifest(), schemaVersion: 2, abilities: [bundle] };
		const parsed = parseMarketplaceManifest(raw);
		expect(parsed.abilities[0]).toMatchObject({ config: { members: [{ source: { path: "abilities/guide" } }] } });
		expect(() => parseMarketplaceManifest({ ...raw, schemaVersion: 1 })).toThrow("schemaVersion 2");
		bundle.config.members[0].source.path = "../outside";
		expect(() => parseMarketplaceManifest(raw)).toThrow("escapes marketplace root");
	});
	it("preserves optional category translations without changing category identity", () => {
		const manifest = validManifest();
		const abilities = manifest.abilities as Array<Record<string, unknown>>;
		abilities[0] = { ...abilities[0], category: "Documents", categoryI18n: { zh: "文档", "en-US": "Documents" } };
		expect(parseMarketplaceManifest(manifest).abilities[0]).toMatchObject({
			category: "Documents",
			categoryI18n: { zh: "文档", "en-US": "Documents" },
		});
		expect(parseMarketplaceManifest(validManifest()).abilities[0]?.categoryI18n).toBeUndefined();
	});

	it.each([null, [], "文档", { zh: 42 }, { zh: { name: "文档" } }].map((categoryI18n) => ({ categoryI18n })))(
		"rejects malformed category translations: $categoryI18n",
		({ categoryI18n }) => {
			const manifest = validManifest();
			const abilities = manifest.abilities as Array<Record<string, unknown>>;
			abilities[0] = { ...abilities[0], categoryI18n };
			expect(() => parseMarketplaceManifest(manifest)).toThrow();
		},
	);

	it("fills defaults for optional ability fields", () => {
		const manifest = parseMarketplaceManifest(validManifest());

		expect(manifest.abilities[0]).toMatchObject({
			configVersion: 1,
			license: "",
			author: "",
			tags: [],
			detail: {},
		});
		expect(manifest.minAppVersion).toBe("0.5.11");
	});

	it("requires a valid minAppVersion", () => {
		const missing = validManifest();
		delete missing.minAppVersion;
		expect(() => parseMarketplaceManifest(missing)).toThrow();
		expect(() => parseMarketplaceManifest({ ...validManifest(), minAppVersion: "0.5" })).toThrow();
	});

	it("rejects source paths that escape the repository root", () => {
		const manifest = validManifest();
		const abilities = manifest.abilities as Array<Record<string, unknown>>;
		abilities[0] = { ...abilities[0], source: { path: "../../outside" } };

		expect(() => parseMarketplaceManifest(manifest)).toThrow("escapes marketplace root");
	});

	it("rejects duplicate type and slug entries", () => {
		const manifest = validManifest();
		const abilities = manifest.abilities as Array<Record<string, unknown>>;
		abilities.push(structuredClone(abilities[0]));

		expect(() => parseMarketplaceManifest(manifest)).toThrow("Duplicate ability");
	});

	it("rejects the same slug across skill and scene because the local manifest shares a namespace", () => {
		const manifest = validManifest();
		const abilities = manifest.abilities as Array<Record<string, unknown>>;
		abilities.push({ ...structuredClone(abilities[0]), type: "scene" });

		expect(() => parseMarketplaceManifest(manifest)).toThrow("Duplicate ability slug");
	});

	it("accepts MCP, plugin and bundle entries", () => {
		const manifest = validManifest();
		const abilities = manifest.abilities as Array<Record<string, unknown>>;
		abilities.push({
			type: "mcp",
			slug: "context7",
			name: "Context7",
			version: "1.0.0",
			source: { path: "abilities/mcp/context7" },
		});
		abilities.push({
			type: "plugin",
			slug: "demo-plugin",
			name: "Demo Plugin",
			version: "1.0.0",
			source: { path: "abilities/plugins/demo-plugin" },
		});
		abilities.push({
			type: "bundle",
			slug: "starter-bundle",
			name: "Starter Bundle",
			version: "1.0.0",
			config: {
				members: [
					{ type: "mcp", slug: "context7" },
					{ type: "plugin", slug: "demo-plugin" },
				],
			},
		});

		expect(parseMarketplaceManifest(manifest).abilities.map((ability) => ability.type)).toEqual([
			"skill",
			"mcp",
			"plugin",
			"bundle",
		]);
	});

	it("rejects inline MCP configuration", () => {
		const manifest = validManifest();
		(manifest.abilities as Array<Record<string, unknown>>).push({
			type: "mcp",
			slug: "broken-mcp",
			name: "Broken MCP",
			version: "1.0.0",
			config: { mcp: { type: "http" } },
			source: { path: "abilities/mcp/broken-mcp" },
		});

		expect(() => parseMarketplaceManifest(manifest)).toThrow(
			"MCP configuration must be stored in source.path/mcp.json",
		);
	});

	it("rejects missing and nested bundle members", () => {
		const missing = validManifest();
		(missing.abilities as Array<Record<string, unknown>>).push({
			type: "bundle",
			slug: "starter-bundle",
			name: "Starter Bundle",
			version: "1.0.0",
			config: { members: [{ type: "plugin", slug: "missing" }] },
		});
		expect(() => parseMarketplaceManifest(missing)).toThrow("Bundle member not found");

		const nested = structuredClone(missing);
		const abilities = nested.abilities as Array<Record<string, unknown>>;
		abilities[1] = {
			...abilities[1],
			config: { members: [{ type: "bundle", slug: "starter-bundle" }] },
		};
		expect(() => parseMarketplaceManifest(nested)).toThrow();
	});

	it("accepts host showcase templates and canvas motifs", () => {
		const manifest = validManifest();
		const abilities = manifest.abilities as Array<Record<string, unknown>>;
		abilities[0] = {
			...abilities[0],
			detail: {
				blocks: [
					{
						type: "showcase",
						showcase: {
							template: "workbench",
							canvas: "browser",
							user_prompt: "Open the orders page",
							assistant_reply: "I will wait for you to sign in first.",
						},
					},
					{
						type: "showcase",
						showcase: {
							template: "prompt-result",
							canvas: "terminal",
							user_prompt: "Summarize git status",
							assistant_reply: "Working tree is clean.",
						},
					},
					{
						type: "showcase",
						showcase: {
							template: "spotlight",
							user_prompt: "Switch the default model",
							assistant_reply: "Confirm this setting change.",
						},
					},
				],
			},
		};

		const parsed = parseMarketplaceManifest(manifest);
		const blocks = parsed.abilities[0]?.detail.blocks;
		expect(blocks?.map((block) => block.type === "showcase" && block.showcase.template)).toEqual([
			"workbench",
			"prompt-result",
			"spotlight",
		]);
	});

	it("rejects unknown showcase templates and canvas motifs", () => {
		const unknownTemplate = validManifest();
		(unknownTemplate.abilities as Array<Record<string, unknown>>)[0] = {
			...(unknownTemplate.abilities as Array<Record<string, unknown>>)[0],
			detail: {
				blocks: [
					{
						type: "showcase",
						showcase: {
							template: "custom-css",
							user_prompt: "x",
							assistant_reply: "y",
						},
					},
				],
			},
		};
		expect(() => parseMarketplaceManifest(unknownTemplate)).toThrow();

		const unknownCanvas = validManifest();
		(unknownCanvas.abilities as Array<Record<string, unknown>>)[0] = {
			...(unknownCanvas.abilities as Array<Record<string, unknown>>)[0],
			detail: {
				blocks: [
					{
						type: "showcase",
						showcase: {
							template: "canvas-hero",
							canvas: "custom",
							user_prompt: "x",
							assistant_reply: "y",
						},
					},
				],
			},
		};
		expect(() => parseMarketplaceManifest(unknownCanvas)).toThrow();
	});
});
