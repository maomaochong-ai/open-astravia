// @vitest-environment jsdom

import type { InstalledPlugin } from "@preload/api";
import type { ConversationEvent, PluginPermission } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	conversationListener: undefined as ((event: ConversationEvent) => void) | undefined,
	logError: vi.fn(),
}));

vi.mock("../../../router", () => ({ router: { navigate: vi.fn() } }));
vi.mock("./plugin-runtime-log", () => ({ logPluginRuntimeError: mocks.logError }));
vi.mock("./plugin-host-bridge", () => ({
	pluginHostBridge: {
		conversation: {
			sendPrompt: vi.fn(),
			createSession: vi.fn(),
			insertText: vi.fn(),
			abort: vi.fn(),
			on: (listener: (event: ConversationEvent) => void) => {
				mocks.conversationListener = listener;
				return { dispose: vi.fn() };
			},
		},
	},
	registerPluginMediaProviderHandler: vi.fn(),
	registerPluginOcrProviderHandler: vi.fn(),
}));

import { createCommandApi, createConversationApi, createFsApi } from "./plugin-host-apis";

const CAPABILITY_SESSION_ID = "capability-session-1";

function installedPlugin(permissions: PluginPermission[]): InstalledPlugin {
	return {
		id: "diagnostic-plugin",
		activeVersion: "1.2.3",
		permissions,
		grantedPermissions: permissions,
		declaredCommands: ["worker"],
		grantedCommandNames: ["worker"],
	} as unknown as InstalledPlugin;
}

describe("plugin host API diagnostics", () => {
	beforeEach(() => {
		mocks.logError.mockClear();
		mocks.conversationListener = undefined;
	});

	it("identifies the plugin and capability session when directory watching fails", async () => {
		const unsubscribe = vi.fn();
		Object.assign(window, {
			vetta: {
				fs: {
					onDirChanged: vi.fn(() => unsubscribe),
					watchDir: vi.fn(async () => {
						throw new Error("watch failed");
					}),
					unwatchDir: vi.fn(),
				},
				plugins: { internalCapabilities: { filesystem: {} } },
			},
		});

		createFsApi(installedPlugin(["fs.read"]), CAPABILITY_SESSION_ID).watchDirectory("C:/workspace", vi.fn());

		await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledOnce());
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(mocks.logError).toHaveBeenCalledWith(
			"directory watch failed",
			expect.objectContaining({
				pluginId: "diagnostic-plugin",
				pluginVersion: "1.2.3",
				capabilitySessionId: CAPABILITY_SESSION_ID,
				stage: "watch-directory",
			}),
			expect.any(Error),
		);
	});

	it("attributes a failing command exit callback without blocking the host event", async () => {
		let emitExit: ((event: { spawnId: string; exitCode: number | null; signal: string | null }) => void) | undefined;
		Object.assign(window, {
			vetta: {
				plugins: {
					onCommandSpawnExit: vi.fn((listener) => {
						emitExit = listener;
						return vi.fn();
					}),
					spawnCommand: vi.fn(async () => ({ spawnId: "spawn-1", pid: 42 })),
					stopCommandSpawn: vi.fn(),
					getCommandSpawnStatus: vi.fn(),
				},
			},
		});
		const handle = await createCommandApi(installedPlugin(["agent.command.spawn"]), CAPABILITY_SESSION_ID, []).spawn(
			"worker",
		);
		handle.onExit(() => {
			throw new Error("listener failed");
		});

		expect(() => emitExit?.({ spawnId: "spawn-1", exitCode: 1, signal: null })).not.toThrow();
		expect(mocks.logError).toHaveBeenCalledWith(
			"command exit listener failed",
			expect.objectContaining({
				pluginId: "diagnostic-plugin",
				pluginVersion: "1.2.3",
				capabilitySessionId: CAPABILITY_SESSION_ID,
				stage: "spawn-exit-listener",
				spawnId: "spawn-1",
			}),
			expect.any(Error),
		);
	});

	it("attributes a failing conversation listener to its plugin", () => {
		createConversationApi(installedPlugin(["agent.session.read"]), []).on(() => {
			throw new Error("listener failed");
		});
		const event = { type: "conversation-changed", conversation: null } as unknown as ConversationEvent;

		expect(() => mocks.conversationListener?.(event)).not.toThrow();
		expect(mocks.logError).toHaveBeenCalledWith(
			"conversation listener failed",
			expect.objectContaining({
				pluginId: "diagnostic-plugin",
				pluginVersion: "1.2.3",
				stage: "conversation-event",
				eventType: "conversation-changed",
			}),
			expect.any(Error),
		);
	});
});
