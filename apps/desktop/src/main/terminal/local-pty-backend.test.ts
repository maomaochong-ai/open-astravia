import { describe, expect, it } from "vitest";
import { hangUpPty } from "./local-pty-backend.js";

function target(overrides: { kill?: () => void; destroy?: () => void } = {}) {
	const calls: string[] = [];
	return {
		calls,
		kill(signal?: string) {
			calls.push(`kill:${signal ?? ""}`);
			overrides.kill?.();
		},
		destroy() {
			calls.push("destroy");
			overrides.destroy?.();
		},
	};
}

describe("hangUpPty", () => {
	it("先给 shell 发 SIGHUP，再关主端", () => {
		// 顺序不能反：先发信号，shell 才有机会把 SIGHUP 转给自己的作业并干净退出；
		// 关主端是给「shell 转发不了」兜底的第二道。
		const pty = target();

		hangUpPty(pty);

		expect(pty.calls).toEqual(["kill:SIGHUP", "destroy"]);
	});

	it("信号发不出去时照样关主端", () => {
		// shell 先自己退了，pid 不存在 —— 但主端还开着，前台进程组还没收到 SIGHUP。
		// 这一步要是被异常带走，用户跑的 dev server 就留在后台了。
		const pty = target({
			kill: () => {
				throw new Error("ESRCH");
			},
		});

		hangUpPty(pty);

		expect(pty.calls).toContain("destroy");
	});

	it("关主端失败不往外抛：回收是尽力而为的", () => {
		const pty = target({
			destroy: () => {
				throw new Error("already closed");
			},
		});

		expect(() => hangUpPty(pty)).not.toThrow();
	});
});
