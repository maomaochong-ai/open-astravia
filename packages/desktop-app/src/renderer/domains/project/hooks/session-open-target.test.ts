import type { SessionInfo } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { resolveSessionOpenTarget } from "./session-open-target.js";

function session(path: string, access?: SessionInfo["access"]): SessionInfo {
	return {
		id: path,
		path,
		cwd: "/cwd",
		firstMessage: "hi",
		modifiedAt: 0,
		...(access ? { access } : {}),
	};
}

/** im-gateway 持有的 Claw 会话：可读历史，不可交互恢复。 */
const CLAW_ACCESS: SessionInfo["access"] = {
	readHistory: true,
	interactiveResume: false,
	rename: true,
	delete: true,
};

const DESKTOP_ACCESS: SessionInfo["access"] = {
	readHistory: true,
	interactiveResume: true,
	rename: true,
	delete: true,
};

describe("resolveSessionOpenTarget", () => {
	it("Claw 会话进只读 viewer", () => {
		const sessions = [session("/im/a.jsonl", CLAW_ACCESS)];
		expect(resolveSessionOpenTarget(sessions, "/im/a.jsonl")).toBe("viewer");
	});

	it("桌面会话走交互式恢复", () => {
		const sessions = [session("/desk/a.jsonl", DESKTOP_ACCESS)];
		expect(resolveSessionOpenTarget(sessions, "/desk/a.jsonl")).toBe("interactive");
	});

	it("access 全 false 时不可用", () => {
		const sessions = [
			session("/x/a.jsonl", { readHistory: false, interactiveResume: false, rename: false, delete: false }),
		];
		expect(resolveSessionOpenTarget(sessions, "/x/a.jsonl")).toBe("unavailable");
	});

	it("会话不在给定列表里时回落交互式（旧行为）", () => {
		// 回归点：Claw 会话原本被拿默认「对话」项目的 cwd 去查，必然查空，
		// 于是落到这条回落分支 → 主进程抛 SESSION_READ_ONLY → 点击毫无反应。
		// 修复方式是调用方传对 cwd，此处仅锁定回落语义本身。
		const sessions = [session("/other/b.jsonl", CLAW_ACCESS)];
		expect(resolveSessionOpenTarget(sessions, "/im/a.jsonl")).toBe("interactive");
		expect(resolveSessionOpenTarget(undefined, "/im/a.jsonl")).toBe("interactive");
	});

	it("access 尚未解析（乐观创建的本地条目）走交互式", () => {
		expect(resolveSessionOpenTarget([session("/desk/new.jsonl")], "/desk/new.jsonl")).toBe("interactive");
	});
});
