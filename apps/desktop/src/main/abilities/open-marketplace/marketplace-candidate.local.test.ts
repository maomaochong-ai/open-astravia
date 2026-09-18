import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import AdmZip from "adm-zip";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { getPluginsBaseDir, listPlugins } from "../../plugins/plugin-catalog";
import { parseMarketplaceManifest } from "./marketplace-schema";
import { OpenMarketplaceService } from "./open-marketplace-service";

const testPaths = vi.hoisted(() => {
	const root = `${process.env.TEMP ?? process.cwd()}/vetta-marketplace-candidate-${process.pid}-${Math.random().toString(36).slice(2)}`;
	const previousHome = process.env.VETTA_HOME;
	if (process.env.VETTA_MARKETPLACE_CANDIDATE_ROOT) process.env.VETTA_HOME = `${root}/home`;
	return { root, home: `${root}/home`, resources: `${root}/resources`, previousHome };
});

vi.mock("electron", () => ({
	app: { isPackaged: true, resourcesPath: testPaths.resources },
	webContents: { getAllWebContents: () => [] },
}));
vi.mock("../ability-ledger.js", () => ({ recordAbilityInstall: vi.fn(), removeAbilityLedgerEntry: vi.fn() }));
vi.mock("../../credentials/desktop-credential-vault.js", () => ({ getDesktopCredentialVault: () => ({}) }));
vi.mock("../../skills/skill-service.js", () => ({
	getSkillBaseDir: vi.fn(),
	readSkillsManifest: vi.fn(() => ({})),
	recordSkillResourceEvent: vi.fn(),
	writeSkillsManifest: vi.fn(),
}));
vi.mock("../../logger", () => ({
	getAppLogger: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

const candidateRoot = process.env.VETTA_MARKETPLACE_CANDIDATE_ROOT;
const isolatedRoot = testPaths.root;
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");

beforeAll(async () => {
	if (!candidateRoot) return;
	Object.defineProperty(process, "resourcesPath", { configurable: true, value: testPaths.resources });
	await mkdir(testPaths.home, { recursive: true });
	await mkdir(join(testPaths.resources, "system-plugins"), { recursive: true });
});

afterAll(async () => {
	vi.unstubAllGlobals();
	if (originalResourcesPath) Object.defineProperty(process, "resourcesPath", originalResourcesPath);
	else Reflect.deleteProperty(process, "resourcesPath");
	if (testPaths.previousHome === undefined) delete process.env.VETTA_HOME;
	else process.env.VETTA_HOME = testPaths.previousHome;
	const temporaryBase = resolve(process.env.TEMP ?? process.cwd());
	const relativeRoot = relative(temporaryBase, resolve(isolatedRoot));
	if (!relativeRoot || relativeRoot === ".." || relativeRoot.startsWith(`..${sep}`)) {
		throw new Error("Marketplace test root is outside the temporary directory");
	}
	await rm(isolatedRoot, { recursive: true, force: true });
});

const manifest = candidateRoot
	? parseMarketplaceManifest(
			JSON.parse(readFileSync(join(candidateRoot, ".vetta", "marketplace.json"), "utf8")) as unknown,
		)
	: undefined;
const entries = candidateRoot
	? execFileSync("git", ["ls-files", "-z"], { cwd: candidateRoot }).toString("utf8").split("\0").filter(Boolean)
	: [];
const sourceArchive = new AdmZip();
for (const path of entries) {
	sourceArchive.addFile(
		`vetta-official-marketplace-candidate/${path.replaceAll("\\", "/")}`,
		readFileSync(join(candidateRoot!, path)),
	);
}
const archiveBytes = sourceArchive.toBuffer();
const response = (bytes: Buffer): Response =>
	new Response(new Uint8Array(bytes), {
		status: 200,
		headers: { "content-length": String(bytes.byteLength) },
	});

it.skipIf(!candidateRoot)(
	"syncs the actual candidate and installs every plugin release through Desktop",
	async () => {
		if (!candidateRoot || !manifest) throw new Error("Marketplace candidate is missing");
		vi.stubGlobal("fetch", async (url: URL) => {
			const filename = url.pathname.split("/").at(-1);
			if (!filename) throw new Error(`Unexpected artifact URL: ${url}`);
			return response(readFileSync(join(candidateRoot, ".release-artifacts", filename)));
		});
		const service = new OpenMarketplaceService({
			appVersion: "0.5.59",
			rootDir: join(isolatedRoot, "marketplace"),
			repository: manifest.repository,
			sourceRef: "marketplace-v3",
			fetchArchive: async () => response(archiveBytes),
			fetchManifest: async () => new Response(JSON.stringify(manifest), { status: 200 }),
		});
		const snapshot = await service.refresh();
		expect(snapshot.error).toBeUndefined();
		expect(snapshot.marketplaceVersion).toBe(manifest.marketplaceVersion);
		const expectedSlugs = new Set<string>(
			manifest.abilities.flatMap((ability) =>
				ability.type === "bundle"
					? [ability.slug, ...ability.config.members.map((member) => member.slug)]
					: [ability.slug],
			),
		);
		expect(snapshot.abilities.map((ability) => ability.slug).sort()).toEqual([...expectedSlugs].sort());
		const plugins = snapshot.abilities.filter((ability) => ability.type === "plugin");
		expect(plugins.length).toBeGreaterThan(0);
		for (const plugin of plugins) await service.install("plugin", plugin.slug);
		const installed = listPlugins().filter((plugin) => plugins.some((ability) => ability.slug === plugin.id));
		expect(installed.map((plugin) => plugin.id).sort()).toEqual(plugins.map((plugin) => plugin.slug).sort());
		for (const plugin of installed) {
			expect(plugin.activeVersion).toBe(plugins.find((ability) => ability.slug === plugin.id)?.version);
			expect(plugin.enabled).toBe(false);
			expect(plugin.grantedPermissions).toEqual([]);
			expect(plugin.rootPath.startsWith(getPluginsBaseDir())).toBe(true);
		}
	},
	30_000,
);

it.skipIf(!candidateRoot)("reports an app upgrade requirement to an older Desktop", async () => {
	if (!manifest) throw new Error("Marketplace candidate is missing");
	const service = new OpenMarketplaceService({
		appVersion: "0.5.58",
		rootDir: join(isolatedRoot, "old-marketplace"),
		repository: manifest.repository,
		sourceRef: "marketplace-v3",
		fetchArchive: async () => response(archiveBytes),
		fetchManifest: async () => new Response(JSON.stringify(manifest), { status: 200 }),
	});
	const snapshot = await service.refresh();
	expect(snapshot.error).toBe("app-outdated");
	expect(snapshot.requiredAppVersion).toBe(manifest.minAppVersion);
	expect(snapshot.abilities).toHaveLength(0);
});
