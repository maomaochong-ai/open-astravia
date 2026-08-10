// 回归：重启宿主后按 sessionPath 重开会话，模型必须恢复成该会话上次实际用过的那个，
// 而不是宿主兜底的「可用列表第一个」（backend-pool.ts:resolveInitialModel）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import type { CodingAgentRuntimeModelSource } from "@vetta/coding-agent/host-services";
import { RuntimeHost } from "@vetta/runtime-core";
import { afterEach, describe, expect, it } from "vitest";
import {
	startOpenAiResponsesTestServer,
	textResponseEvents,
} from "../../../../cli-app/test/support/openai-responses-test-server.js";
import { DesktopRuntimeBackendPool } from "./backend-pool.js";

const MODEL_A: Model<Api> = {
	id: "model-a-first-in-list",
	name: "Model A",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
const MODEL_B: Model<Api> = { ...MODEL_A, id: "model-b-user-picked", name: "Model B" };

describe("Desktop session model restore", () => {
	const directories: string[] = [];
	const disposers: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const dispose of disposers.splice(0).reverse()) await dispose();
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("reopening a session after a host restart restores the model that session last used", async () => {
		const cwd = await temporaryDirectory("model-restore-workspace-");
		const sessionDir = await temporaryDirectory("model-restore-sessions-");
		const server = await startOpenAiResponsesTestServer(() => ({
			kind: "events",
			events: textResponseEvents("ok"),
		}));
		const modelA = { ...MODEL_A, baseUrl: server.baseUrl };
		const modelB = { ...MODEL_B, baseUrl: server.baseUrl };

		try {
			// 生产 compositionDefaults 里没有 initialModel（见 agent-runtime/composition.ts:75-85），
			// 所以这里也不给，走 backend-pool.ts:247 的 getAvailable()[0] 兜底。
			const first = createRuntime([modelA, modelB]);
			// Desktop 打开会话时不传 model（useSessionManager.ts:361）。
			const created = await first.runtime.createSession({
				cwd,
				sessionDir,
				scenario: "conversation",
				executionMode: "full-access",
				enableBackgroundTasks: false,
				includeAgentSkills: false,
			});
			const sessionPath = first.runtime.getSessionPath(created.sessionId);
			if (!sessionPath) throw new Error("session was not persisted");
			expect(first.runtime.getState(created.sessionId).model?.id).toBe(modelA.id);

			// 用户在输入栏切到 Model B，并用它跑了一轮（模型随该轮写进会话文件）。
			await first.runtime.updateSettings(created.sessionId, { modelKey: `${modelB.provider}/${modelB.id}` });
			expect(first.runtime.getState(created.sessionId).model?.id).toBe(modelB.id);
			await first.runtime.prompt(created.sessionId, { text: "hello" });
			expect(server.requests.at(-1)?.body.model).toBe(modelB.id);

			// 应用重启：进程内存里的 session handle 全部丢失。
			await first.dispose();

			const restarted = createRuntime([modelA, modelB]);
			const resumed = await restarted.runtime.createSession({
				cwd,
				sessionDir,
				sessionPath,
				scenario: "conversation",
				executionMode: "full-access",
				enableBackgroundTasks: false,
				includeAgentSkills: false,
			});
			// 期望：恢复成该会话上次用的 Model B。实际：列表第一个 Model A。
			expect(restarted.runtime.getState(resumed.sessionId).model?.id).toBe(modelB.id);
		} finally {
			await server.dispose();
		}
	}, 30_000);

	it("falls back to the host default when the session's last model is gone from the catalog", async () => {
		const cwd = await temporaryDirectory("model-restore-missing-workspace-");
		const sessionDir = await temporaryDirectory("model-restore-missing-sessions-");
		const server = await startOpenAiResponsesTestServer(() => ({
			kind: "events",
			events: textResponseEvents("ok"),
		}));
		const modelA = { ...MODEL_A, baseUrl: server.baseUrl };
		const modelB = { ...MODEL_B, baseUrl: server.baseUrl };

		try {
			const first = createRuntime([modelA, modelB]);
			const created = await first.runtime.createSession({
				cwd,
				sessionDir,
				scenario: "conversation",
				executionMode: "full-access",
				enableBackgroundTasks: false,
				includeAgentSkills: false,
			});
			const sessionPath = first.runtime.getSessionPath(created.sessionId);
			if (!sessionPath) throw new Error("session was not persisted");
			await first.runtime.updateSettings(created.sessionId, { modelKey: `${modelB.provider}/${modelB.id}` });
			await first.runtime.prompt(created.sessionId, { text: "hello" });
			await first.dispose();

			// 重启后 Model B 已从 catalog 移除（provider 下线 / 配置删除）。
			const restarted = createRuntime([modelA]);
			const resumed = await restarted.runtime.createSession({
				cwd,
				sessionDir,
				sessionPath,
				scenario: "conversation",
				executionMode: "full-access",
				enableBackgroundTasks: false,
				includeAgentSkills: false,
			});
			expect(restarted.runtime.getState(resumed.sessionId).model?.id).toBe(modelA.id);
		} finally {
			await server.dispose();
		}
	}, 30_000);

	function createRuntime(models: readonly Model<Api>[]): {
		runtime: RuntimeHost;
		dispose: () => Promise<void>;
	} {
		const pool = new DesktopRuntimeBackendPool({
			compositionDefaults: { modelRegistry: modelRegistry(models), initialThinkingLevel: "off" },
		});
		const runtime = new RuntimeHost({ sessionBackend: pool, getDefaultExecutionMode: () => "full-access" });
		const entry = {
			runtime,
			dispose: async () => {
				try {
					await runtime.disposeAllSessions();
				} finally {
					await pool.dispose();
				}
			},
		};
		disposers.push(entry.dispose);
		return entry;
	}

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}
});

function modelRegistry(models: readonly Model<Api>[]): CodingAgentRuntimeModelSource {
	return {
		refresh() {},
		getAvailable: () => [...models],
		find: (provider, modelId) => models.find((m) => m.provider === provider && m.id === modelId),
		getApiKey: async () => "test-key",
		setServerToken() {},
		loadRemoteModels: async () => undefined,
	};
}
