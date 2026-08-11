import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/auth/index.js";
import {
	bindExtensionRuntimeActions,
	createExtensionRuntime,
	type ExtensionActions,
	type ExtensionContextActions,
	type ExtensionExecutionHost,
	ExtensionRunner,
} from "../src/extensions/index.js";
import { createCodingAgentModelRuntime } from "../src/models/index.js";
import { createExtensionSessionView } from "./fixtures/extension-session-view.js";

describe("ExtensionExecutionHost", () => {
	it("原位绑定完整命令式动作并保留 Loader 共享状态", () => {
		const runtime = createExtensionRuntime();
		runtime.flagValues.set("feature", true);
		runtime.pendingProviderRegistrations.push({
			name: "provider",
			config: { baseUrl: "https://example.invalid" },
		});
		const actions = createActions();

		bindExtensionRuntimeActions(runtime, actions);

		expect(runtime.sendMessage).toBe(actions.sendMessage);
		expect(runtime.sendUserMessage).toBe(actions.sendUserMessage);
		expect(runtime.appendEntry).toBe(actions.appendEntry);
		expect(runtime.setSessionName).toBe(actions.setSessionName);
		expect(runtime.getSessionName).toBe(actions.getSessionName);
		expect(runtime.setLabel).toBe(actions.setLabel);
		expect(runtime.getActiveTools).toBe(actions.getActiveTools);
		expect(runtime.getAllTools).toBe(actions.getAllTools);
		expect(runtime.setActiveTools).toBe(actions.setActiveTools);
		expect(runtime.getCommands).toBe(actions.getCommands);
		expect(runtime.setModel).toBe(actions.setModel);
		expect(runtime.getThinkingLevel).toBe(actions.getThinkingLevel);
		expect(runtime.setThinkingLevel).toBe(actions.setThinkingLevel);
		expect(runtime.flagValues.get("feature")).toBe(true);
		expect(runtime.pendingProviderRegistrations).toHaveLength(1);
	});

	it("Runner 通过 Host 合同绑定 Runtime 与动态 Context 动作", () => {
		const runtime = createExtensionRuntime();
		const actions = createActions();
		const contextActions = createContextActions();
		const host: ExtensionExecutionHost = { actions, contextActions };
		const runner = new ExtensionRunner(
			[],
			runtime,
			process.cwd(),
			createExtensionSessionView(process.cwd()),
			createCodingAgentModelRuntime(AuthStorage.inMemory(), {
				modelsJsonPath: join(tmpdir(), "missing-extension-host-models.json"),
			}),
		);

		runner.bindExecutionHost(host);
		const context = runner.createContext();

		expect(runtime.getSessionName()).toBe("session");
		expect(context.isIdle()).toBe(false);
		expect(context.hasPendingMessages()).toBe(true);
		expect(context.getContextUsage()).toEqual({
			tokens: 25,
			contextWindow: 100,
			percent: 25,
		});
		expect(context.getSystemPrompt()).toBe("system");

		context.abort();
		context.shutdown();
		context.compact();
		expect(contextActions.abort).toHaveBeenCalledOnce();
		expect(contextActions.shutdown).toHaveBeenCalledOnce();
		expect(contextActions.compact).toHaveBeenCalledOnce();
	});
});

function createActions(): ExtensionActions {
	return {
		sendMessage: vi.fn(),
		sendUserMessage: vi.fn(),
		appendEntry: vi.fn(),
		setSessionName: vi.fn(),
		getSessionName: () => "session",
		setLabel: vi.fn(),
		getActiveTools: () => ["read"],
		getAllTools: () => [],
		setActiveTools: vi.fn(),
		getCommands: () => [],
		setModel: async () => true,
		getThinkingLevel: () => "medium",
		setThinkingLevel: vi.fn(),
	};
}

function createContextActions(): ExtensionContextActions {
	return {
		getModel: () => undefined,
		isIdle: () => false,
		abort: vi.fn(),
		hasPendingMessages: () => true,
		shutdown: vi.fn(),
		getContextUsage: () => ({
			tokens: 25,
			contextWindow: 100,
			percent: 25,
		}),
		compact: vi.fn(),
		getSystemPrompt: () => "system",
	};
}
