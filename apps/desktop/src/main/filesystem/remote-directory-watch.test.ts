import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listDirectory = vi.fn();
// 这一组测的是没有 helper 时的轮询降级；helper 那条路见 remote-directory-watch.helper.test.ts。
vi.mock("../ssh/ssh-runtime.js", () => ({
	getSshConnection: () => ({ listDirectory, helper: async () => undefined }),
}));

const { allowRemoteProjectRoot } = await import("./remote-filesystem.js");
const { watchRemoteDirectory } = await import("./remote-directory-watch.js");

const file = (name: string, modifiedAtSeconds: number) => ({ name, kind: "file", sizeBytes: 1, modifiedAtSeconds });

describe("远端目录的变更监听", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		allowRemoteProjectRoot("ssh://build-01/srv/app");
	});
	afterEach(() => vi.useRealTimers());

	it("Agent 在远端新增或改动文件后几秒内通知文件树，内容没变时不打扰", async () => {
		const onChange = vi.fn();
		listDirectory.mockResolvedValue([file("a.ts", 1)]);
		const stop = watchRemoteDirectory("ssh://build-01/srv/app/src", onChange, { pollIntervalMs: 1000 });

		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(1000);
		expect(onChange).not.toHaveBeenCalled();

		listDirectory.mockResolvedValue([file("a.ts", 2), file("b.ts", 2)]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(onChange).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1000);
		expect(onChange).toHaveBeenCalledTimes(1);
		stop();
	});

	it("停止后不再访问远端", async () => {
		listDirectory.mockResolvedValue([]);
		const stop = watchRemoteDirectory("ssh://build-01/srv/app", vi.fn(), { pollIntervalMs: 1000 });
		await vi.advanceTimersByTimeAsync(0);
		stop();
		const calls = listDirectory.mock.calls.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(listDirectory).toHaveBeenCalledTimes(calls);
	});

	it("主机掉线时放慢重试，恢复后照常报告变化", async () => {
		const onChange = vi.fn();
		listDirectory.mockResolvedValueOnce([file("a.ts", 1)]).mockRejectedValueOnce(new Error("offline"));
		const stop = watchRemoteDirectory("ssh://build-01/srv/app", onChange, {
			pollIntervalMs: 1000,
			failureBackoffMs: 5000,
		});
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(1000); // 这一轮失败
		listDirectory.mockResolvedValue([file("a.ts", 9)]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(onChange).not.toHaveBeenCalled(); // 还在退避
		await vi.advanceTimersByTimeAsync(4000);
		expect(onChange).toHaveBeenCalledTimes(1);
		stop();
	});

	it("项目之外的远端目录不能监听", () => {
		expect(() => watchRemoteDirectory("ssh://build-01/etc", vi.fn())).toThrow(/outside any known project/);
	});
});
