import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodingAgentExtensionRunAdapter } from "../../src/adapters/runtime-core/extension-run-adapter.js";
import { AuthStorage } from "../../src/auth/index.js";
import { discoverAndLoadExtensions, ExtensionRunner } from "../../src/extensions/index.js";
import { createCodingAgentModelRuntime } from "../../src/models/index.js";
import { createExtensionSessionView } from "../fixtures/extension-session-view.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("CodingAgentExtensionRunAdapter", () => {
	it("keeps Prompt resolution lazy when no before_agent_start handler exists", async () => {
		const bridge = new CodingAgentExtensionRunAdapter();
		bridge.bind(await createRunner());
		let resolutionCount = 0;

		const result = await bridge.prepare({
			sessionId: "session-1",
			turnId: "turn-1",
			signal: new AbortController().signal,
			input: {
				message: {
					role: "user",
					content: "inspect",
					timestamp: 1,
				},
			},
			messages: [],
			async resolveSystemPrompt() {
				resolutionCount += 1;
				return "base prompt";
			},
		});

		expect(result).toBeUndefined();
		expect(resolutionCount).toBe(0);
	});

	it("chains handlers once and maps their messages to persistent Run context", async () => {
		const runner = await createRunner(`
			export default function(extension) {
				extension.on("before_agent_start", async (event) => ({
					message: {
						customType: "first-context",
						content: "first message",
						display: false,
						details: { order: 1 },
					},
					systemPrompt: event.systemPrompt + ":first",
				}));
				extension.on("before_agent_start", async (event) => ({
					message: {
						customType: "second-context",
						content: [{ type: "text", text: event.prompt }],
						display: true,
					},
					systemPrompt: event.systemPrompt + ":second",
				}));
			}
		`);
		const bridge = new CodingAgentExtensionRunAdapter();
		const unbind = bridge.bind(runner);
		let resolutionCount = 0;

		const result = await bridge.prepare({
			sessionId: "session-1",
			turnId: "turn-1",
			signal: new AbortController().signal,
			input: {
				message: {
					role: "user",
					content: [
						{ type: "text", text: "inspect image" },
						{ type: "image", data: "base64", mimeType: "image/png" },
					],
					timestamp: 1,
				},
			},
			messages: [],
			async resolveSystemPrompt() {
				resolutionCount += 1;
				return "base prompt";
			},
		});

		expect(resolutionCount).toBe(1);
		expect(result).toEqual({
			context: [
				{
					type: "first-context",
					content: "first message",
					modelVisible: true,
					display: false,
					metadata: { order: 1 },
				},
				{
					type: "second-context",
					content: [{ type: "text", text: "inspect image" }],
					modelVisible: true,
					display: true,
					metadata: undefined,
				},
			],
			instructionOverride: [
				{
					id: "coding-agent.extension.before-agent-start",
					content: "base prompt:first:second",
					priority: 0,
				},
			],
		});
		expect(bridge.readSystemPrompt()).toBe("base prompt:first:second");
		bridge.recordSystemPrompt("recompiled base prompt");
		expect(bridge.readSystemPrompt()).toBe("base prompt:first:second");
		unbind();
		await bridge.prepare({
			sessionId: "session-1",
			turnId: "turn-2",
			signal: new AbortController().signal,
			input: {
				message: {
					role: "user",
					content: "next run",
					timestamp: 2,
				},
			},
			messages: [],
			async resolveSystemPrompt() {
				throw new Error("Prompt resolution must remain lazy without a handler");
			},
		});
		expect(bridge.readSystemPrompt()).toBe("recompiled base prompt");
	});

	it("delegates transient context transformation to the bound runner without mutating the input", async () => {
		const runner = await createRunner(`
			export default function(extension) {
				extension.on("context", async (event) => ({
					messages: [
						...event.messages,
						{
							role: "custom",
							customType: "extension-context",
							content: "injected",
							display: false,
							timestamp: 2,
						},
					],
				}));
			}
		`);
		const bridge = new CodingAgentExtensionRunAdapter();
		bridge.bind(runner);
		const input = [{ role: "user" as const, content: "request", timestamp: 1 }];

		const result = await bridge.transformContext(input);

		expect(input).toEqual([{ role: "user", content: "request", timestamp: 1 }]);
		expect(result).toEqual([
			{ role: "user", content: "request", timestamp: 1 },
			{
				role: "custom",
				customType: "extension-context",
				content: "injected",
				display: false,
				timestamp: 2,
			},
		]);
	});

	it("replaces a bound runner only when the caller declares a reload transaction", async () => {
		const first = await createRunner();
		const second = await createRunner(`
			export default function(extension) {
				extension.on("before_agent_start", async (event) => ({
					systemPrompt: event.systemPrompt + ":reloaded",
				}));
			}
		`);
		const bridge = new CodingAgentExtensionRunAdapter();
		const unbindFirst = bridge.bind(first);
		expect(() => bridge.bind(second)).toThrow("already bound");
		const unbindSecond = bridge.bind(second, { replaceExisting: true });

		unbindFirst();
		const result = await bridge.prepare({
			sessionId: "session-1",
			turnId: "turn-1",
			signal: new AbortController().signal,
			input: { message: { role: "user", content: "inspect", timestamp: 1 } },
			messages: [],
			resolveSystemPrompt: async () => "base",
		});

		expect(result).toMatchObject({
			instructionOverride: [{ content: "base:reloaded" }],
		});
		unbindSecond();
	});
});

async function createRunner(extensionSource?: string): Promise<ExtensionRunner> {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "extension-run-adapter-"));
	temporaryDirectories.push(directory);
	const extensionsDirectory = path.join(directory, "extensions");
	fs.mkdirSync(extensionsDirectory);
	if (extensionSource) {
		fs.writeFileSync(path.join(extensionsDirectory, "before-agent-start.ts"), extensionSource);
	}
	const loaded = await discoverAndLoadExtensions([], directory, directory);
	const authStorage = AuthStorage.create(path.join(directory, "auth.json"));
	return new ExtensionRunner(
		loaded.extensions,
		loaded.runtime,
		directory,
		createExtensionSessionView(directory),
		createCodingAgentModelRuntime(authStorage),
	);
}
