import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VETTA_HOME_ENV } from "@vetta/action-rpc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const temporaryRoots: string[] = [];
let previousHome: string | undefined;

/** desktop-config.json 的路径在模块加载时算好，所以每个用例重置模块并重设 VETTA_HOME。 */
async function loadStoreWithConfig(config: Record<string, unknown> | undefined): Promise<
	typeof import("./desktop-config-store.js") & {
		readDisk: () => Promise<Record<string, unknown>>;
		overwriteDisk: (config: Record<string, unknown>) => Promise<void>;
	}
> {
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
	const overwriteDisk = (next: Record<string, unknown>) =>
		writeFile(join(home, "desktop-config.json"), JSON.stringify(next), "utf8");
	return { ...store, readDisk, overwriteDisk };
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
	}, 20_000);

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

describe("desktop config schema migration", () => {
	it("migrates an unversioned config to v2 and writes the new preferences back", async () => {
		const store = await loadStoreWithConfig({ projects: [], fieldFromNewerVersion: { keep: true } });
		const config = await store.readDesktopConfig();
		expect(config.schemaVersion).toBe(2);
		expect(config.notificationPreferences).toEqual({
			soundEnabled: true,
			systemScope: "away-from-session",
			soundScope: "always",
			soundVolume: 60,
			events: {
				completed: { systemEnabled: true, soundId: "soft-chime" },
				failed: { systemEnabled: true, soundId: "soft-chime" },
				actionRequired: { systemEnabled: true, soundId: "soft-chime" },
			},
		});
		expect(await store.readDisk()).toMatchObject({
			schemaVersion: 2,
			fieldFromNewerVersion: { keep: true },
		});
	});

	it("normalizes invalid notification preferences", async () => {
		const store = await loadStoreWithConfig({
			schemaVersion: 2,
			notificationPreferences: {
				systemScope: "sometimes",
				soundScope: "always",
				soundVolume: 150,
				events: { completed: { systemEnabled: false, soundId: "from-disk" } },
			},
		});
		expect((await store.readDesktopConfig()).notificationPreferences).toEqual({
			soundEnabled: true,
			systemScope: "away-from-session",
			soundScope: "always",
			soundVolume: 100,
			events: {
				completed: { systemEnabled: false, soundId: "soft-chime" },
				failed: { systemEnabled: true, soundId: "soft-chime" },
				actionRequired: { systemEnabled: true, soundId: "soft-chime" },
			},
		});
	});

	it("preserves a future schema and unknown fields across read-modify-write", async () => {
		const store = await loadStoreWithConfig({
			schemaVersion: 7,
			future: { keep: true },
			notificationPreferences: {
				systemScope: "always",
				soundScope: "always",
				soundVolume: 50,
				futurePreference: "keep",
				events: {
					completed: { systemEnabled: true, soundId: null, futureEventPreference: "keep" },
					futureEvent: { future: true },
				},
			},
		});
		const config = await store.readDesktopConfig();
		expect(config.schemaVersion).toBe(7);
		await store.updateDesktopConfig((current) => ({ ...current, debugMode: true }));
		expect(await store.readDisk()).toMatchObject({
			schemaVersion: 7,
			future: { keep: true },
			debugMode: true,
			notificationPreferences: {
				futurePreference: "keep",
				events: {
					completed: { futureEventPreference: "keep" },
					futureEvent: { future: true },
				},
			},
		});
	});
});

describe("写回配置不丢本版本不认识的字段", () => {
	// 新旧版本共用同一份 ~/.vetta：旧版读配置时按白名单解析，不认识的字段（如 0.5.58 之于
	// sshHosts）不进内存，随后任何一次写回都会把它从磁盘上抹掉。
	it("读改写之后，磁盘上未知字段原样保留", async () => {
		const future = { hosts: [{ id: "h1", target: "user@example" }] };
		const store = await loadStoreWithConfig({ projects: [], fieldFromNewerVersion: future });
		await store.updateDesktopConfig((current) => ({ ...current, debugMode: true }));
		const disk = await store.readDisk();
		expect(disk.fieldFromNewerVersion).toEqual(future);
		expect(disk.debugMode).toBe(true);
	});

	it("已知字段显式置空仍能删除", async () => {
		const store = await loadStoreWithConfig({ projects: [], remoteControl: { cloudEnabled: true, devices: [] } });
		await store.updateDesktopConfig((current) => ({ ...current, remoteControl: undefined }));
		expect((await store.readDisk()).remoteControl).toBeUndefined();
	});

	it("并发更新不同字段时在最新配置上依次执行", async () => {
		const store = await loadStoreWithConfig({ projects: [], debugMode: false, language: "zh-CN" });
		let releaseFirst!: () => void;
		const firstCanFinish = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let firstStarted!: () => void;
		const firstDidStart = new Promise<void>((resolve) => {
			firstStarted = resolve;
		});

		const first = store.updateDesktopConfig(async (current) => {
			firstStarted();
			await firstCanFinish;
			return { ...current, debugMode: true };
		});
		await firstDidStart;
		const second = store.updateDesktopConfig((current) => ({ ...current, language: "en" }));
		releaseFirst();

		await Promise.all([first, second]);
		expect(await store.readDisk()).toMatchObject({ debugMode: true, language: "en" });
	});

	it("读取会等待排在它前面的配置更新并返回最新快照", async () => {
		const store = await loadStoreWithConfig({ projects: [], debugMode: false });
		let releaseUpdate!: () => void;
		const updateCanFinish = new Promise<void>((resolve) => {
			releaseUpdate = resolve;
		});
		let updateStarted!: () => void;
		const updateDidStart = new Promise<void>((resolve) => {
			updateStarted = resolve;
		});

		const update = store.updateDesktopConfig(async (current) => {
			updateStarted();
			await updateCanFinish;
			return { ...current, debugMode: true };
		});
		await updateDidStart;
		const read = store.readDesktopConfig();
		releaseUpdate();

		await expect(update).resolves.toMatchObject({ debugMode: true });
		await expect(read).resolves.toMatchObject({ debugMode: true });
	});

	it("一次更新失败不会阻断后续配置更新", async () => {
		const store = await loadStoreWithConfig({ projects: [], debugMode: false });

		const failed = store.updateDesktopConfig(() => {
			throw new Error("injected failure");
		});
		const recovered = store.updateDesktopConfig((current) => ({ ...current, debugMode: true }));

		await expect(failed).rejects.toThrow("injected failure");
		await expect(recovered).resolves.toMatchObject({ debugMode: true });
		expect(await store.readDisk()).toMatchObject({ debugMode: true });
	});
});

describe("SSH 主机单独存放，旧版本整份覆盖 desktop-config 也抹不掉", () => {
	// 0.5.58 与开发版共用 ~/.vetta：它按自己的白名单重写 desktop-config.json，
	// 不认识的 sshHosts 随之消失。主机列表放在旧版本不知道的文件里才躲得开。
	const host = { id: "h1", label: "构建机", target: "build-01", source: "manual" as const };

	it("旧版整份覆盖 desktop-config 后，主机仍在", async () => {
		const store = await loadStoreWithConfig({ projects: [] });
		await store.writeSshHosts([host]);
		await store.overwriteDisk({ projects: [], language: "zh-CN" });
		expect((await store.readDesktopConfig()).sshHosts).toEqual([host]);
		expect(store.readConfigSync().sshHosts).toEqual([host]);
	});

	it("老配置里的 sshHosts 在第一次写回时迁出，此后不再依赖 desktop-config", async () => {
		const store = await loadStoreWithConfig({ projects: [], sshHosts: [host] });
		const config = await store.readDesktopConfig();
		expect(config.sshHosts).toEqual([host]);
		await store.updateDesktopConfig((current) => ({ ...current, debugMode: true }));
		expect((await store.readDisk()).sshHosts).toBeUndefined();
		await store.overwriteDisk({ projects: [] });
		expect((await store.readDesktopConfig()).sshHosts).toEqual([host]);
	});

	it("其他设置更新不会盖掉刚改过的主机列表", async () => {
		const store = await loadStoreWithConfig({ projects: [] });
		await store.writeSshHosts([host]);
		const moved = { ...host, target: "build-02" };
		await store.writeSshHosts([moved]);
		await store.updateDesktopConfig((current) => ({ ...current, debugMode: true }));
		expect((await store.readDesktopConfig()).sshHosts).toEqual([moved]);
	});
});

describe("remote device and pairing persistence", () => {
	it("reads legacy IDs and keeps a stable device separate from current and pending pairings", async () => {
		const store = await loadStoreWithConfig({
			projects: [],
			remoteControl: {
				cloudEnabled: false,
				devices: [
					{ id: "legacy", name: "Phone", mobileSecretHash: "h", mobileIdentityKey: "key", createdAt: 1 },
					{
						id: "stable",
						pairingId: "current-pairing",
						pairedAt: 9,
						name: "Custom",
						renamed: true,
						desktopControl: false,
						mobileSecretHash: "h2",
						mobileIdentityKey: "key2",
						createdAt: 2,
					},
				],
				pendingPairings: [
					{ pairingId: "pending", mobileSecretHash: "h3", expiresAt: 123 },
					{ pairingId: "invalid-identity", mobileSecretHash: "h", expiresAt: 123, mobileIdentityKey: 42 },
					{ pairingId: "invalid-expiry", mobileSecretHash: "h", expiresAt: "tomorrow" },
				],
			},
		});
		const remote = (await store.readDesktopConfig()).remoteControl!;
		expect(remote.devices[0]).toMatchObject({ id: "legacy", pairingId: "legacy", pairedAt: 1 });
		expect(remote.devices[1]).toMatchObject({
			id: "stable",
			pairingId: "current-pairing",
			pairedAt: 9,
			renamed: true,
			desktopControl: false,
			createdAt: 2,
		});
		expect(remote.pendingPairings).toEqual([{ pairingId: "pending", mobileSecretHash: "h3", expiresAt: 123 }]);
		await store.updateDesktopConfig((config) => ({ ...config, remoteControl: remote }));
		expect((await store.readDesktopConfig()).remoteControl).toEqual(remote);
	});
});
