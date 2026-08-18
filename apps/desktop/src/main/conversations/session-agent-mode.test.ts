import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/** 可变的 desktop-config 桩：模拟用户在新会话页改「默认工作模式」。 */
const desktopConfig: { defaultAgentMode: "work" | "coding"; defaultExecutionMode: string; experimental: object } = {
	defaultAgentMode: "work",
	defaultExecutionMode: "full-access",
	experimental: {},
};

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({
		debug: () => undefined,
		error: () => undefined,
		info: () => undefined,
		warn: () => undefined,
	}),
}));

vi.mock("../ipc/fs.js", () => ({
	allowProjectRoot: () => undefined,
	readDesktopConfig: async () => desktopConfig,
}));

vi.mock("../plugins/plugin-catalog.js", () => ({
	pluginAgentContributionService: {
		buildRuntimeConfig: () => undefined,
	},
}));

import { resolveDesktopSessionConfig } from "./resolve-session-config.js";
import {
	LEGACY_SESSION_AGENT_MODE,
	readSessionAgentMode,
	recordSessionAgentMode,
	resolveAgentModeStorePath,
} from "./session-agent-mode-store.js";

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-agent-mode-"));
	temporaryRoots.push(root);
	return root;
}

/** 造一个可被 resolveDesktopSessionConfig 当作「已存在会话」恢复的会话文件。 */
async function createSessionFile(root: string, name: string): Promise<string> {
	const sessionPath = join(root, name);
	await writeFile(sessionPath, `${JSON.stringify({ type: "session", cwd: root })}\n`, "utf8");
	return sessionPath;
}

afterEach(async () => {
	desktopConfig.defaultAgentMode = "work";
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("会话级工作模式固化", () => {
	it("改默认值只影响新会话，已有会话保持创建时的模式", async () => {
		const root = await createTemporaryRoot();

		const created = await resolveDesktopSessionConfig({ cwd: root }, "conversation", "interactive");
		expect(created.agentMode).toBe("work");
		const sessionPath = await createSessionFile(root, "existing.jsonl");
		await recordSessionAgentMode(sessionPath, created.agentMode);

		desktopConfig.defaultAgentMode = "coding";

		const resumed = await resolveDesktopSessionConfig({ cwd: root, sessionPath }, "conversation", "interactive");
		expect(resumed.agentMode).toBe("work");
		expect(resumed.config.agentMode).toBe("work");

		const fresh = await resolveDesktopSessionConfig({ cwd: root }, "conversation", "interactive");
		expect(fresh.agentMode).toBe("coding");
	});

	it("恢复会话读回创建时固化的模式，而不是当前默认值", async () => {
		const root = await createTemporaryRoot();
		desktopConfig.defaultAgentMode = "coding";
		const created = await resolveDesktopSessionConfig({ cwd: root }, "conversation", "interactive");
		const sessionPath = await createSessionFile(root, "coding-session.jsonl");
		await recordSessionAgentMode(sessionPath, created.agentMode);

		desktopConfig.defaultAgentMode = "work";
		const resumed = await resolveDesktopSessionConfig({ cwd: root, sessionPath }, "conversation", "interactive");
		expect(resumed.agentMode).toBe("coding");
	});

	it("没有记录的历史会话按常量回落，不跟随当前默认值", async () => {
		const root = await createTemporaryRoot();
		const sessionPath = await createSessionFile(root, "legacy.jsonl");
		desktopConfig.defaultAgentMode = "coding";

		const resumed = await resolveDesktopSessionConfig({ cwd: root, sessionPath }, "conversation", "interactive");
		expect(resumed.agentMode).toBe(LEGACY_SESSION_AGENT_MODE);
		expect(resumed.agentMode).toBe("work");
	});
});

describe("会话工作模式存储", () => {
	it("首次写入后不再被覆盖", async () => {
		const root = await createTemporaryRoot();
		const sessionPath = await createSessionFile(root, "pinned.jsonl");

		await recordSessionAgentMode(sessionPath, "coding");
		await recordSessionAgentMode(sessionPath, "work");

		expect(await readSessionAgentMode(sessionPath)).toBe("coding");
	});

	it("同目录多会话各自独立，索引与会话文件同级", async () => {
		const root = await createTemporaryRoot();
		const first = await createSessionFile(root, "a.jsonl");
		const second = await createSessionFile(root, "b.jsonl");

		await recordSessionAgentMode(first, "coding");
		await recordSessionAgentMode(second, "work");

		expect(await readSessionAgentMode(first)).toBe("coding");
		expect(await readSessionAgentMode(second)).toBe("work");
		const raw: unknown = JSON.parse(await readFile(resolveAgentModeStorePath(first), "utf8"));
		expect(raw).toEqual({ a: "coding", b: "work" });
	});

	it("索引损坏或非法值时按无记录处理", async () => {
		const root = await createTemporaryRoot();
		const sessionPath = await createSessionFile(root, "broken.jsonl");
		await writeFile(resolveAgentModeStorePath(sessionPath), "{ not json", "utf8");

		expect(await readSessionAgentMode(sessionPath)).toBeUndefined();

		await writeFile(resolveAgentModeStorePath(sessionPath), JSON.stringify({ broken: "plan" }), "utf8");
		expect(await readSessionAgentMode(sessionPath)).toBeUndefined();
	});
});
