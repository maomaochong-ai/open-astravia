import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VETTA_HOME_ENV } from "@vetta/action-rpc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const temporaryRoots: string[] = [];
let previousHome: string | undefined;

/** desktop-config.json 的路径在模块加载时算好，所以每个用例重置模块并重设 VETTA_HOME。 */
async function loadStoreWithConfig(config: Record<string, unknown> | undefined): Promise<{
	readDesktopConfig: () => Promise<{ defaultAgentMode?: "work" | "coding" }>;
}> {
	const home = await mkdtemp(join(tmpdir(), "vetta-config-"));
	temporaryRoots.push(home);
	process.env[VETTA_HOME_ENV] = home;
	if (config) {
		await writeFile(join(home, "desktop-config.json"), JSON.stringify(config), "utf8");
	}
	vi.resetModules();
	return await import("./desktop-config-store.js");
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
