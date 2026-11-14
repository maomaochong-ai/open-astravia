import { describe, expect, it, vi } from "vitest";

/**
 * 会话创建链路上桌面配置至少会被读两次（沙箱检查一次、配置解析一次），
 * 每次读取都要「读文件 + 迁移 + 读 SSH 主机 + 解析」并且串行排队。
 * 调用方已经读过时把结果传进来，就不再读第二遍。
 */
// 不用 importActual：那个模块会连带加载 electron，在 vitest 里会因 app 未初始化而炸。
vi.mock("../ipc/fs.js", () => ({
	allowProjectRoot: vi.fn(),
	readDesktopConfig: vi.fn(),
}));
vi.mock("./session-paths.js", () => ({
	ensureConversationSubCwd: async () => undefined,
	ensureSessionWorkingCwd: async () => undefined,
	readSessionCwdFromHeader: async () => undefined,
	resolveSessionDirForCwd: () => "/ws/.astravia/sessions",
}));
vi.mock("./session-agent-mode-store.js", () => ({
	LEGACY_SESSION_AGENT_MODE: "work",
	readSessionAgentMode: async () => undefined,
}));
vi.mock("@astravia/coding-agent/composition", () => ({
	createCodingAgentRuntimeSessionSelection: () => ({ selection: true }),
}));
vi.mock("@astravia/coding-agent/cli-guidance", () => ({ ASTRAVIA_CLI_GUIDANCE: "guidance" }));

const { readDesktopConfig } = await import("../ipc/fs.js");
const { resolveDesktopSessionConfig } = await import("./resolve-session-config");

const preloaded = { defaultAgentMode: "work", defaultExecutionMode: "sandbox" } as never;

describe("会话配置解析", () => {
	it("传入了已读配置时不再读第二遍", async () => {
		const reader = vi.mocked(readDesktopConfig);
		reader.mockClear();

		const resolved = await resolveDesktopSessionConfig({ cwd: "/ws" }, "conversation", "interactive", preloaded);

		expect(reader).not.toHaveBeenCalled();
		expect(resolved.agentMode).toBe("work");
	});

	it("没有传入时才自己读", async () => {
		const reader = vi.mocked(readDesktopConfig);
		reader.mockClear();
		reader.mockResolvedValue(preloaded);

		await resolveDesktopSessionConfig({ cwd: "/ws" }, "conversation", "interactive");

		expect(reader).toHaveBeenCalledTimes(1);
	});
});
