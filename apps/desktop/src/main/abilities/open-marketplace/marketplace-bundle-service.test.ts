import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, expect, it, vi } from "vitest";
import type { InstalledSkill } from "../../../preload/api-types/skills";
import { installOpenMarketplaceAbility } from "./open-marketplace-installer";
import { readOpenMarketplaceMcpPackage } from "./open-marketplace-mcp";
import { OpenMarketplaceService } from "./open-marketplace-service";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function archive(version: string, listed = false, broken = false): Buffer {
	const guide = { type: "skill", slug: "guide", name: "Guide", version, source: { path: "abilities/guide" } };
	const mcp = { type: "mcp", slug: "search", name: "Search", version, source: { path: "abilities/search" } };
	const zip = new AdmZip();
	const add = (path: string, data: unknown) =>
		zip.addFile(`market/${path}`, Buffer.from(typeof data === "string" ? data : JSON.stringify(data)));
	add(".vetta/marketplace.json", {
		schemaVersion: listed ? 1 : 2,
		name: "test",
		marketplaceVersion: version,
		minAppVersion: "0.5.49",
		repository: "https://github.com/example/market",
		abilities: [
			...(listed ? [guide, mcp] : []),
			{
				type: "bundle",
				slug: "research",
				name: "Research",
				version: "1.0.0",
				config: {
					members: [guide, mcp].map(({ type, slug, source }) => ({ type, slug, ...(listed ? {} : { source }) })),
				},
			},
		],
	});
	for (const ability of [guide, mcp]) {
		const { source, ...metadata } = ability;
		add(`${source.path}/ability.json`, {
			schemaVersion: 1,
			...metadata,
			detail: { content: "Details", i18n: { zh: { name: `${ability.name} 中文`, content: "中文详情" } } },
		});
	}
	add(
		"abilities/guide/SKILL.md",
		`---\nname: guide\ndescription: Guide\nversion: ${broken ? "wrong" : version}\n---\nGuide ${version}`,
	);
	add("abilities/search/mcp.json", {
		schemaVersion: 1,
		slug: "search",
		version,
		server: { command: "uvx", args: ["example"] },
		parameters: [{ key: "TOKEN", label: "Token", required: true, secret: true }],
	});
	// A valid package on disk is not installable unless a listing or a bundle references it.
	add("abilities/not-referenced/ability.json", {
		schemaVersion: 1,
		type: "skill",
		slug: "not-referenced",
		name: "Orphan",
		version,
	});
	add(
		"abilities/not-referenced/SKILL.md",
		`---\nname: not-referenced\ndescription: Orphan\nversion: ${version}\n---\nUnused`,
	);
	return zip.toBuffer();
}

it("keeps installed identities and disabled state when top-level entries become bundle-only, including cache reload and upgrades", async () => {
	const root = await mkdtemp(join(tmpdir(), "vetta-bundle-service-test-"));
	roots.push(root);
	let data = archive("1.0.0", true);
	let installed: Record<string, InstalledSkill> = {};
	const recordInstall = vi.fn();
	const service = new OpenMarketplaceService({
		rootDir: join(root, "cache"),
		appVersion: "0.5.49",
		sourceId: "test-source",
		repository: "https://github.com/example/market",
		fetchArchive: async () => new Response(new Uint8Array(data)),
		installAbility: async (snapshot, ability, origin) => {
			if (ability.type !== "skill") throw new Error("Unexpected install type");
			await installOpenMarketplaceAbility(snapshot, ability, origin, {
				getBaseDir: () => join(root, "installed"),
				tmpBaseDir: join(root, "staging"),
				readManifest: () => installed,
				writeManifest: (next) => {
					installed = next;
				},
				recordInstall,
				recordEvent: vi.fn(),
			});
		},
		prepareMcpAbility: async (snapshot, ability) =>
			readOpenMarketplaceMcpPackage(join(snapshot, ability.source.path), ability).server,
	});
	expect((await service.refresh()).abilities.every((ability) => ability.listed)).toBe(true);
	await service.install("skill", "guide");
	installed.guide.enabled = false;
	data = archive("2.0.0");
	const current = await service.refresh();
	expect(current.error).toBeUndefined();
	expect(current.abilities.filter((ability) => ability.listed).map((ability) => ability.slug)).toEqual(["research"]);
	expect(current.abilities.find((ability) => ability.slug === "guide")).toMatchObject({
		listed: false,
		version: "2.0.0",
		detail: { i18n: { zh: { name: "Guide 中文" } } },
	});
	expect(current.abilities.find((ability) => ability.type === "bundle")?.config.members).toMatchObject([
		{ type: "skill", slug: "guide", exists: true },
		{ type: "mcp", slug: "search", exists: true },
	]);
	await service.install("skill", "guide");
	expect(installed.guide).toMatchObject({ version: "2.0.0", enabled: false });
	expect(await readFile(join(root, "installed/guide/SKILL.md"), "utf8")).toContain("Guide 2.0.0");
	expect(recordInstall.mock.calls.map((call) => call[3].catalogId)).toEqual([
		"github:test-source:skill:guide",
		"github:test-source:skill:guide",
	]);
	expect(await service.prepareMcp("search")).toMatchObject({ command: "uvx", args: ["example"] });
	const restarted = new OpenMarketplaceService({
		rootDir: join(root, "cache"),
		appVersion: "0.5.49",
		sourceId: "test-source",
		repository: "https://github.com/example/market",
		fetchArchive: async () => {
			throw new Error("offline");
		},
	});
	expect((await restarted.listCached()).abilities).toEqual(current.abilities);
	expect(await restarted.refresh()).toMatchObject({ error: "sync-failed", abilities: current.abilities });
	data = archive("3.0.0", false, true);
	expect(await service.refresh()).toMatchObject({
		error: "sync-failed",
		marketplaceVersion: "2.0.0",
		abilities: current.abilities,
	});
	await expect(service.install("skill", "not-referenced")).rejects.toThrow("Open ability not found");
});
