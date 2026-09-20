import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSshHelperForTests, createLoopbackSshConnection } from "@vetta/ssh-transport/testing";
import { describe, expect, it, vi } from "vitest";

const helperBinary = buildSshHelperForTests();
const connection = createLoopbackSshConnection("build-01", { helper: { resolveBinary: () => helperBinary } });
vi.mock("../ssh/ssh-runtime.js", () => ({ getSshConnection: () => connection }));

const { allowRemoteProjectRoot } = await import("./remote-filesystem.js");
const { watchRemoteDirectory } = await import("./remote-directory-watch.js");

describe.skipIf(!helperBinary)("远端目录的变更监听：由 helper 推送", () => {
	it("远端新增文件后收到通知；helper 的通道断开后仍然会刷新", async () => {
		const remoteRoot = realpathSync(mkdtempSync(join(tmpdir(), "vetta-watch-remote-")));
		const uri = `ssh://build-01${remoteRoot}`;
		allowRemoteProjectRoot(uri);
		const onChange = vi.fn();
		// 轮询间隔设得很长：这里收到的通知只可能来自 helper。
		const stop = watchRemoteDirectory(uri, onChange, { pollIntervalMs: 600_000, failureBackoffMs: 200 });
		await vi.waitFor(async () => expect(await connection.helper()).toBeDefined(), { timeout: 15_000 });
		// 订阅是异步建立的，等它就位。
		await new Promise((resolve) => setTimeout(resolve, 300));

		writeFileSync(join(remoteRoot, "new.ts"), "x");
		await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 10_000 });

		// 网络抖了一下：通道断开时补一次刷新，随后重新订阅。
		onChange.mockClear();
		(await connection.helper())?.close();
		await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 10_000 });
		await new Promise((resolve) => setTimeout(resolve, 800));
		onChange.mockClear();
		writeFileSync(join(remoteRoot, "later.ts"), "x");
		await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 10_000 });
		stop();
	}, 60_000);
});
