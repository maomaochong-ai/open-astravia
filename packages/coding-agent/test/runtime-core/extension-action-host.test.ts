import type { Api, Model } from "@vetta/ai";
import type { RuntimeSession, RuntimeSessionContextDeliveryController } from "@vetta/runtime-core";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import { CodingAgentExtensionActionHost } from "../../src/host/extensions/action-host.js";

const model: Model<Api> = {
	id: "model",
	name: "Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};

describe("CodingAgentExtensionActionHost", () => {
	it("maps all command actions to Greenfield-owned ports and preserves delivery timing", async () => {
		const delivery = vi.fn<RuntimeSessionContextDeliveryController["deliver"]>(async () => {});
		const prompt = vi.fn(async () => ({ status: "completed" as const }));
		const appendEntry = vi.fn(async () => {});
		const setName = vi.fn(async () => {});
		const setLabel = vi.fn(async () => {});
		const selectModel = vi.fn(async () => {});
		const setThinkingLevel = vi.fn();
		const setActiveToolNames = vi.fn();
		const errors: string[] = [];
		const state = {
			model,
			thinkingLevel: "medium" as const,
			isStreaming: false,
			messageCount: 0,
			contextPercent: null,
			contextWindow: 8_000,
			activeToolNames: ["read"],
			parentSessionPath: undefined,
			parentEntryId: undefined,
		};
		const tool: RuntimeToolDefinition = {
			name: "read",
			label: "Read",
			description: "Read a file",
			inputSchema: { type: "object", properties: {} },
			execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
		};
		const session = {
			readState: () => state,
			prompt,
			createCoreAssembly: () => ({
				contextDeliveryController: { deliver: delivery },
				metadataController: {
					appendEntry,
					readName: () => "Persisted",
					setName,
					setLabel,
				},
				toolController: {
					readActiveToolNames: () => ["read"],
					readAvailableTools: () => new Map([[tool.name, tool]]),
					setActiveToolNames,
				},
				modelView: {
					resolveApiKey: async () => "key",
				},
				modelController: {
					selectModel,
					setThinkingLevel,
				},
			}),
		} as unknown as RuntimeSession;
		const host = new CodingAgentExtensionActionHost({
			session,
			resourceLoader: {
				getPrompts: () => ({
					prompts: [
						{
							name: "review",
							description: "Review",
							content: "",
							source: "project",
							filePath: "/prompts/review.md",
						},
					],
					diagnostics: [],
				}),
				getSkills: () => ({ skills: [], diagnostics: [] }),
			},
			onError: (error) => errors.push(error.error),
			now: () => 42,
		});

		host.actions.sendMessage({ customType: "note", content: "record", display: false });
		state.isStreaming = true;
		host.actions.sendMessage({ customType: "note", content: "steer", display: false });
		host.actions.sendMessage({ customType: "note", content: "follow", display: false }, { deliverAs: "followUp" });
		host.actions.sendMessage({ customType: "note", content: "next", display: false }, { deliverAs: "nextTurn" });
		state.isStreaming = false;
		host.actions.sendMessage({ customType: "note", content: "turn", display: false }, { triggerTurn: true });
		host.actions.sendUserMessage("hello");
		host.actions.appendEntry("audit", { ok: true });
		host.actions.setSessionName("Renamed");
		host.actions.setLabel("entry-1", "Important");
		host.actions.setActiveTools(["read"]);
		host.actions.setThinkingLevel("high");

		expect(host.actions.getSessionName()).toBe("Renamed");
		expect(host.actions.getActiveTools()).toEqual(["read"]);
		expect(host.actions.getAllTools()).toMatchObject([{ name: "read", description: "Read a file" }]);
		expect(host.actions.getCommands()).toMatchObject([{ name: "review", source: "prompt" }]);
		await expect(host.actions.setModel(model)).resolves.toBe(true);
		await host.dispose();

		expect(delivery.mock.calls.map(([, mode]) => mode)).toEqual([
			"record",
			"steer",
			"followUp",
			"nextTurn",
			"triggerTurn",
		]);
		expect(prompt).toHaveBeenCalledWith({
			text: "hello",
			images: undefined,
			streamingBehavior: undefined,
			metadata: { codingAgentExtensionInputSource: "extension" },
		});
		expect(appendEntry).toHaveBeenCalledWith("audit", { ok: true });
		expect(setName).toHaveBeenCalledWith("Renamed");
		expect(setLabel).toHaveBeenCalledWith("entry-1", "Important");
		expect(setActiveToolNames).toHaveBeenCalledWith(["read"]);
		expect(selectModel).toHaveBeenCalledWith("test/model", "always");
		expect(setThinkingLevel).toHaveBeenCalledWith("high");
		expect(errors).toEqual([]);
	});

	it("emits model_select only after the selected model changes", async () => {
		const nextModel: Model<Api> = { ...model, id: "next-model", name: "Next Model" };
		let selectedModel = model;
		const onModelSelect = vi.fn(async () => {});
		const session = {
			readState: () => ({
				model: selectedModel,
				thinkingLevel: "medium",
				isStreaming: false,
				activeToolNames: [],
			}),
			createCoreAssembly: () => ({
				contextDeliveryController: { deliver: vi.fn(async () => {}) },
				metadataController: {
					appendEntry: vi.fn(async () => {}),
					readName: () => undefined,
					setName: vi.fn(async () => {}),
					setLabel: vi.fn(async () => {}),
				},
				toolController: {
					readAvailableTools: () => new Map(),
					setActiveToolNames: vi.fn(),
				},
				modelView: { resolveApiKey: async () => "key" },
				modelController: {
					selectModel: async () => {
						selectedModel = nextModel;
					},
					setThinkingLevel: vi.fn(),
				},
			}),
		} as unknown as RuntimeSession;
		const host = new CodingAgentExtensionActionHost({
			session,
			resourceLoader: {
				getPrompts: () => ({ prompts: [], diagnostics: [] }),
				getSkills: () => ({ skills: [], diagnostics: [] }),
			},
			onModelSelect,
		});

		await expect(host.actions.setModel(nextModel)).resolves.toBe(true);
		expect(onModelSelect).toHaveBeenCalledWith({
			type: "model_select",
			model: nextModel,
			previousModel: model,
			source: "set",
		});
	});
});
