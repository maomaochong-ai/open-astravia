import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VETTA_HOME_ENV } from "@vetta/action-rpc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const temporaryRoots: string[] = [];
let previousHome: string | undefined;

/** desktop-config.json 的路径在模块加载时算好，所以每个用例重置模块并重设 VETTA_HOME。 */
async function loadStoreWithConfig(
	config: Record<string, unknown> | undefined,
): Promise<typeof import("./desktop-config-store.js") & { readDisk: () => Promise<Record<string, unknown>> }> {
	const home = await mkdtemp(join(tmpdir(), "vetta-config-"));
	temporaryRoots.push(home);
	process.env[VETTA_HOME_ENV] = home;
	if (config) {
		await writeFile(join(home, "desktop-config.json"), JSON.stringify(config), "utf8");
	}
	vi.resetModules();
	const store = await import("./desktop-config-store.js");
	const readDisk = async () =>
		JSON.parse(await readFile(join(home, "desktop-config.json"), "utf8")) as Record<string, unknown>;
	return { ...store, readDisk };
}

beforeEach(() => {
	previousHome = process.env[VETTA_HOME_ENV];
});

afterEach(async () => {
	if (previousHome === undefined) delete process.env[VETTA_HOME_ENV];
	else process.env[VETTA_HOME_ENV] = previousHome;
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("defaultAgentMode 兼容旧字段名", () => {
	it("只有旧 agentMode 字段的配置仍能读出", async () => {
		const store = await loadStoreWithConfig({ agentMode: "coding" });
		expect((await store.readDesktopConfig()).defaultAgentMode).toBe("coding");
	});

	it("新字段优先于旧字段", async () => {
		const store = await loadStoreWithConfig({ agentMode: "coding", defaultAgentMode: "work" });
		expect((await store.readDesktopConfig()).defaultAgentMode).toBe("work");
	});

	it("两个字段都没有时回落 work", async () => {
		const store = await loadStoreWithConfig({});
		expect((await store.readDesktopConfig()).defaultAgentMode).toBe("work");
	});

	it("配置文件不存在时回落 work", async () => {
		const store = await loadStoreWithConfig(undefined);
		expect((await store.readDesktopConfig()).defaultAgentMode).toBe("work");
	});
});

describe("写回配置不丢本版本不认识的字段", () => {
	// 新旧版本共用同一份 ~/.vetta：旧版读配置时按白名单解析，不认识的字段（如 0.5.58 之于
	// sshHosts）不进内存，随后任何一次写回都会把它从磁盘上抹掉。
	it("读改写之后，磁盘上未知字段原样保留", async () => {
		const future = { hosts: [{ id: "h1", target: "user@example" }] };
		const store = await loadStoreWithConfig({ projects: [], fieldFromNewerVersion: future });
		const config = await store.readDesktopConfig();
		await store.writeDesktopConfig({ ...config, debugMode: true });
		const disk = await store.readDisk();
		expect(disk.fieldFromNewerVersion).toEqual(future);
		expect(disk.debugMode).toBe(true);
	});

	it("已知字段显式置空仍能删除", async () => {
		const store = await loadStoreWithConfig({ projects: [], remoteControl: { pairingId: "p1" } });
		const config = await store.readDesktopConfig();
		await store.writeDesktopConfig({ ...config, remoteControl: undefined });
		expect((await store.readDisk()).remoteControl).toBeUndefined();
	});
});
