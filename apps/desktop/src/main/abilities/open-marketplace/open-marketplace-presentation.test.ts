import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseMarketplaceManifest } from "./marketplace-schema";
import { loadOpenMarketplacePresentation } from "./open-marketplace-presentation";

const temporaryRoots: string[] = [];

async function createFixture(): Promise<{
	root: string;
	ability: ReturnType<typeof parseMarketplaceManifest>["abilities"][number];
}> {
	const root = await mkdtemp(join(tmpdir(), "vetta-open-presentation-test-"));
	temporaryRoots.push(root);
	await mkdir(join(root, "assets"), { recursive: true });
	const manifest = parseMarketplaceManifest({
		schemaVersion: 1,
		name: "test-market",
		marketplaceVersion: "2026.07.8",
		repository: "https://github.com/example/test-market",
		minAppVersion: "0.5.11",
		abilities: [
			{
				type: "mcp",
				slug: "demo-mcp",
				name: "Demo MCP",
				version: "1.0.0",
				source: { path: "abilities/mcp/demo-mcp" },
			},
		],
	});
	return { root, ability: manifest.abilities[0] };
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("loadOpenMarketplacePresentation", () => {
	it("loads rich blocks, localized markdown and local image assets", async () => {
		const { root, ability } = await createFixture();
		await writeFile(join(root, "assets", "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>', "utf-8");
		await writeFile(join(root, "README.zh-CN.md"), "# 中文详情", "utf-8");
		await writeFile(
			join(root, "detail.json"),
			JSON.stringify({
				schemaVersion: 1,
				blocks: [
					{
						type: "feature-grid",
						items: [{ title: "Fast", description: "Local first", icon: "assets/icon.svg" }],
					},
					{
						type: "steps",
						title: "Install",
						items: [{ title: "Choose ability", description: "Review its configuration" }],
					},
					{
						type: "showcase",
						showcase: {
							template: "chat-over-canvas",
							canvas: "code",
							user_prompt: "Review this change",
							assistant_reply: "I will inspect the diff first.",
						},
					},
					{ type: "image", src: "assets/icon.svg", alt: "Demo" },
					{ type: "callout", tone: "warning", title: "Permission", content: "Use least privilege." },
					{ type: "markdown", content: "## Usage\n\nAsk a concrete question." },
					{ type: "links", items: [{ label: "Docs", href: "https://example.com/docs" }] },
				],
			}),
			"utf-8",
		);
		await writeFile(
			join(root, "ability.json"),
			JSON.stringify({
				schemaVersion: 1,
				type: "mcp",
				slug: "demo-mcp",
				version: "1.0.0",
				icon: "assets/icon.svg",
				detail: {
					format: "blocks",
					path: "detail.json",
					meta: [{ key: "docs", value: "https://example.com/docs" }],
					i18n: { "zh-CN": { format: "markdown", path: "README.zh-CN.md" } },
				},
			}),
			"utf-8",
		);

		const presentation = loadOpenMarketplacePresentation(root, ability, "2026.07.8");

		expect(presentation?.icon).toMatch(/^vetta-file:\/\/local\/.+\?v=2026\.07\.8$/);
		expect(presentation?.detail.blocks).toHaveLength(7);
		expect(presentation?.detail.blocks?.[0]).toMatchObject({
			type: "feature-grid",
			items: [{ icon: expect.stringContaining("vetta-file://local/") }],
		});
		expect(presentation?.detail.blocks?.[2]).toMatchObject({
			type: "showcase",
			showcase: { template: "chat-over-canvas", canvas: "code" },
		});
		expect(presentation?.detail.blocks?.[4]).toEqual({
			type: "callout",
			tone: "warning",
			title: "Permission",
			content: "Use least privilege.",
		});
		expect(presentation?.detail.i18n?.["zh-CN"]?.content).toBe("# 中文详情");
		expect(presentation?.detail.meta).toEqual([{ key: "docs", value: "https://example.com/docs" }]);
	});

	it("falls back to markdown when a blocks document is invalid", async () => {
		const { root, ability } = await createFixture();
		await writeFile(join(root, "detail.json"), "{ invalid", "utf-8");
		await writeFile(join(root, "README.md"), "Fallback detail", "utf-8");
		await writeFile(
			join(root, "ability.json"),
			JSON.stringify({
				schemaVersion: 1,
				type: "mcp",
				slug: "demo-mcp",
				version: "1.0.0",
				detail: { format: "blocks", path: "detail.json", fallback: "README.md" },
			}),
			"utf-8",
		);

		expect(loadOpenMarketplacePresentation(root, ability, "2026.07.8")?.detail.content).toBe("Fallback detail");
	});

	it("rejects mismatched identity and escaping asset paths", async () => {
		const identityFixture = await createFixture();
		await writeFile(
			join(identityFixture.root, "ability.json"),
			JSON.stringify({ schemaVersion: 1, type: "mcp", slug: "other", version: "1.0.0" }),
			"utf-8",
		);
		expect(() => loadOpenMarketplacePresentation(identityFixture.root, identityFixture.ability, "2026.07.8")).toThrow(
			"identity does not match",
		);

		const pathFixture = await createFixture();
		await writeFile(
			join(pathFixture.root, "ability.json"),
			JSON.stringify({
				schemaVersion: 1,
				type: "mcp",
				slug: "demo-mcp",
				version: "1.0.0",
				icon: "../outside.svg",
			}),
			"utf-8",
		);
		expect(() => loadOpenMarketplacePresentation(pathFixture.root, pathFixture.ability, "2026.07.8")).toThrow(
			"escapes ability source",
		);
	});

	it("keeps packages without ability.json valid", async () => {
		const { root, ability } = await createFixture();
		expect(loadOpenMarketplacePresentation(root, ability, "2026.07.8")).toBeNull();
	});
});
