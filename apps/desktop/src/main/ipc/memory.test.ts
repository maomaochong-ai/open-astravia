import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryFilesSnapshot } from "../../preload/api-types/memory.js";

const bridge = vi.hoisted(() => ({
	handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
			bridge.handlers.set(channel, handler);
		},
		removeHandler: (channel: string) => {
			bridge.handlers.delete(channel);
		},
	},
}));

const { MEMORY_CHANNELS, registerMemoryIpc } = await import("./memory.js");

const roots: string[] = [];
let agentDir = "";
let projectDir = "";
let previousAgentDir: string | undefined;
let teardown: (() => void) | undefined;

function invoke<T>(channel: string, params: unknown): T {
	const handler = bridge.handlers.get(channel);
	if (!handler) throw new Error(`missing handler for ${channel}`);
	return handler({}, params) as T;
}

beforeEach(() => {
	bridge.handlers.clear();
	const root = mkdtempSync(join(tmpdir(), "astravia-memory-ipc-"));
	roots.push(root);
	agentDir = join(root, "agent");
	projectDir = join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(projectDir, { recursive: true });
	previousAgentDir = process.env.ASTRAVIA_CODING_AGENT_DIR;
	process.env.ASTRAVIA_CODING_AGENT_DIR = agentDir;
	teardown = registerMemoryIpc();
});

afterEach(() => {
	teardown?.();
	if (previousAgentDir === undefined) delete process.env.ASTRAVIA_CODING_AGENT_DIR;
	else process.env.ASTRAVIA_CODING_AGENT_DIR = previousAgentDir;
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("记忆 IPC 桥接", () => {
	it("注册两个通道，并在拆除时全部注销", () => {
		expect(bridge.handlers.has(MEMORY_CHANNELS.READ)).toBe(true);
		expect(bridge.handlers.has(MEMORY_CHANNELS.WRITE)).toBe(true);

		teardown?.();
		teardown = undefined;

		expect(bridge.handlers.size).toBe(0);
	});

	it("读取时同时返回用户级与会话 cwd 下的项目级文件", () => {
		const snapshot = invoke<MemoryFilesSnapshot>(MEMORY_CHANNELS.READ, { cwd: projectDir });

		expect(snapshot.user.path).toBe(join(agentDir, "MEMORY.md"));
		expect(snapshot.project?.path).toBe(join(projectDir, "MEMORY.md"));
		expect(snapshot.user.exists).toBe(false);
		expect(snapshot.project?.exists).toBe(false);
	});

	it("写入用户级记忆不需要会话 cwd", () => {
		invoke(MEMORY_CHANNELS.WRITE, { scope: "user", content: "只在用户级" });

		expect(readFileSync(join(agentDir, "MEMORY.md"), "utf8")).toBe("只在用户级");
	});

	it("写入项目级记忆落到会话 cwd，并可再读回", () => {
		invoke(MEMORY_CHANNELS.WRITE, { scope: "project", cwd: projectDir, content: "只在本项目" });

		expect(readFileSync(join(projectDir, "MEMORY.md"), "utf8")).toBe("只在本项目");
		const snapshot = invoke<MemoryFilesSnapshot>(MEMORY_CHANNELS.READ, { cwd: projectDir });
		expect(snapshot.project).toEqual({
			path: join(projectDir, "MEMORY.md"),
			content: "只在本项目",
			exists: true,
		});
		expect(snapshot.user.exists).toBe(false);
	});

	it("没有会话 cwd 时仍能读用户级记忆，项目级为 null", () => {
		const snapshot = invoke<MemoryFilesSnapshot>(MEMORY_CHANNELS.READ, { cwd: "" });

		expect(snapshot.user.path).toBe(join(agentDir, "MEMORY.md"));
		expect(snapshot.project).toBeNull();
	});

	it("拒绝非法 cwd、非法作用域与非字符串内容", () => {
		expect(() => invoke(MEMORY_CHANNELS.READ, { cwd: 42 })).toThrow(/cwd/);
		expect(() => invoke(MEMORY_CHANNELS.WRITE, { scope: "project", cwd: "  ", content: "x" })).toThrow(/cwd/);
		expect(() => invoke(MEMORY_CHANNELS.WRITE, { scope: "global", cwd: projectDir, content: "x" })).toThrow(/scope/);
		expect(() => invoke(MEMORY_CHANNELS.WRITE, { scope: "user", content: 42 })).toThrow(/content/);
	});
});
