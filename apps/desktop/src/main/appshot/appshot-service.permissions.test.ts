// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const spawned = vi.hoisted(() => [] as FakeChild[]);

interface FakeChild {
	args: string[];
	finish: (payload: unknown) => void;
}

vi.mock("node:child_process", async () => {
	const { EventEmitter } = await import("node:events");
	class Child {
		readonly stdout = new EventEmitter();
		readonly stderr = new EventEmitter();
		private readonly events = new EventEmitter();
		constructor(readonly args: string[]) {
			spawned.push(this);
		}
		on(event: string, handler: (...args: unknown[]) => void): void {
			this.events.on(event, handler);
		}
		kill(): void {}
		finish(payload: unknown): void {
			this.stdout.emit("data", Buffer.from(JSON.stringify(payload), "utf8"));
			setImmediate(() => this.events.emit("close", 0));
		}
	}
	return {
		spawn: (_bin: string, args: string[]) => new Child(args),
		execFile: (_file: string, _args: unknown, callback?: unknown) => {
			if (typeof callback === "function") callback(null);
		},
	};
});

vi.mock("./helper-resolver.js", () => ({
	APPSHOT_HELPER_BUNDLE_ID: "com.astravia.appshot",
	clearHelperQuarantine: () => {},
	resolveAppshotHelperBinary: () => "/tmp/appshot-helper",
}));

vi.mock("../ipc/fs.js", () => ({ readDesktopConfig: async () => ({}) }));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
vi.mock("../window-manager.js", () => ({ getMainWindow: () => null, showMainWindow: () => {} }));
vi.mock("@astravia/action-rpc", () => ({ getAstraviaHomePath: () => "/tmp/astravia" }));

const permissionsPayload = { accessibility: false, screenRecording: false };

describe("requestHelperPermissions", () => {
	beforeEach(() => {
		spawned.length = 0;
		vi.resetModules();
		Object.defineProperty(process, "platform", { configurable: true, value: "darwin" });
	});

	it("runs a second service's request instead of swallowing it into the first one", async () => {
		const { requestHelperPermissions } = await import("./appshot-service.js");

		const first = requestHelperPermissions("accessibility");
		const second = requestHelperPermissions("screen-recording");

		// 同一时刻只允许一个系统授权框：第二个请求排队，不能被合流吞掉。
		// 合流的实现（旧行为）下第二个服务永远不会 spawn，最终只能看到 1 个子进程。
		await vi.waitFor(() => expect(spawned).toHaveLength(1));
		expect(spawned[0]?.args).toEqual(["--request-permissions", "accessibility"]);

		spawned[0]?.finish(permissionsPayload);
		await first;

		await vi.waitFor(() => expect(spawned).toHaveLength(2));
		expect(spawned[1]?.args).toEqual(["--request-permissions", "screen-recording"]);

		spawned[1]?.finish(permissionsPayload);
		await second;
	});
});
