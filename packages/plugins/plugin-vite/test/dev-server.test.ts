import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVettaPluginDevServer, type VettaPluginDevServer } from "../src/dev-server.js";
import type { VettaPluginDevEvent } from "../src/dev-events.js";

const temporaryDirectories: string[] = [];
const runningServers: VettaPluginDevServer[] = [];
const originalFederationTestOverride = process.env.MFE_VITE_NO_TEST_ENV_CHECK;

beforeEach(() => {
	process.env.MFE_VITE_NO_TEST_ENV_CHECK = "true";
});

afterEach(async () => {
	await Promise.all(runningServers.splice(0).map((server) => server.close()));
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
	if (originalFederationTestOverride === undefined) delete process.env.MFE_VITE_NO_TEST_ENV_CHECK;
	else process.env.MFE_VITE_NO_TEST_ENV_CHECK = originalFederationTestOverride;
});

async function createPluginProject(): Promise<string> {
	const rootDir = await mkdtemp(join(fileURLToPath(new URL(".", import.meta.url)), "tmp-dev-server-"));
	temporaryDirectories.push(rootDir);
	await mkdir(join(rootDir, "src"), { recursive: true });
	await mkdir(join(rootDir, "locales"), { recursive: true });
	await writeFile(
		join(rootDir, "plugin.json"),
		JSON.stringify({
			id: "dev-server-test",
			name: "Dev server test",
			version: "0.1.0",
			pluginApiVersion: "^1.0.0",
			runtime: "module-federation",
			entry: "dist/mf-manifest.json",
			moduleFederation: { remoteName: "dev_server_test", expose: "./plugin" },
			styles: ["dist/style.css"],
			permissions: [],
		}),
	);
	await writeFile(join(rootDir, "locales", "en.json"), JSON.stringify({ title: "Test" }));
	await writeFile(
		join(rootDir, "src", "index.tsx"),
		`import "./style.css";
export function Panel() { return <div className="panel">test</div>; }
export default { activate() {} };
`,
	);
	await writeFile(join(rootDir, "src", "style.css"), `.panel { color: red; }\n`);
	const pluginViteEntryPath = relative(rootDir, fileURLToPath(new URL("../src/index.ts", import.meta.url))).replaceAll(
		"\\",
		"/",
	);
	await writeFile(
		join(rootDir, "vite.config.ts"),
		`import { vettaPluginFederation } from ${JSON.stringify(pluginViteEntryPath)};
export default {
  plugins: [vettaPluginFederation({ name: "dev_server_test", entry: "./src/index.tsx" })],
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
};
`,
	);
	return rootDir;
}

describe("startVettaPluginDevServer", () => {
	it("serves the MF manifest, React preamble, HMR entry and scoped CSS", async () => {
		const rootDir = await createPluginProject();
		const events: VettaPluginDevEvent[] = [];
		const server = await startVettaPluginDevServer(rootDir, (event) => events.push(event));
		runningServers.push(server);

		expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(events[0]).toEqual({
			type: "ready",
			pluginId: "dev-server-test",
			entryUrl: `${server.origin}/mf-manifest.json`,
			origin: server.origin,
		});

		const [manifest, preamble, virtualEntry, pluginEntry, cssModule] = await Promise.all([
			fetch(server.entryUrl),
			fetch(`${server.origin}/@vetta-plugin-dev-preamble`),
			fetch(`${server.origin}/@id/__x00__virtual:vetta-plugin-dev-entry`),
			fetch(`${server.origin}/src/index.tsx`),
			fetch(`${server.origin}/src/style.css`),
		]);
		expect(manifest.status).toBe(200);
		expect(manifest.headers.get("content-type")).toContain("application/json");
		expect(await manifest.json()).toMatchObject({ id: "dev_server_test" });
		expect(await preamble.text()).toContain("__vite_plugin_react_preamble_installed__");
		expect(await virtualEntry.text()).toContain("__VETTA_PLUGIN_DEV_MODULES__");
		expect(await pluginEntry.text()).toContain("/@vite/client");
		const cssText = await cssModule.text();
		expect(cssText).toContain("@scope ([data-vetta-plugin-root=dev-server-test])");
		expect(cssText).toContain("__vite__updateStyle");
	});

	it("emits a targeted resource update when a locale changes", async () => {
		const rootDir = await createPluginProject();
		const events: VettaPluginDevEvent[] = [];
		const server = await startVettaPluginDevServer(rootDir, (event) => events.push(event));
		runningServers.push(server);

		await writeFile(join(rootDir, "locales", "en.json"), JSON.stringify({ title: "Updated" }));
		await vi.waitFor(
			() => {
				expect(events).toContainEqual({
					type: "update",
					pluginId: "dev-server-test",
					reason: "resource",
					path: "locales/en.json",
				});
			},
			{ timeout: 5_000, interval: 50 },
		);
	});
});
