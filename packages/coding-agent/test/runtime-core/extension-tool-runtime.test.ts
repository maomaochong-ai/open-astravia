import { Type } from "@sinclair/typebox";
import type { ModelCallFrameCompositionContext, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import type {
	Extension,
	ExtensionContext,
	ExtensionRunner,
	RegisteredTool,
	ToolDefinition,
} from "../../src/extensions/index.js";
import { CodingAgentExtensionToolRuntime } from "../../src/extensions/runtime/extension-tool-runtime.js";

const echoParameters = Type.Object({ value: Type.String() });

describe("CodingAgentExtensionToolRuntime", () => {
	it("keeps first-wins registration and hides a shadowed base tool when inactive", () => {
		const runtime = new CodingAgentExtensionToolRuntime([
			extensionWithTool("first", echoTool("first")),
			extensionWithTool("second", echoTool("second")),
		]);
		const baseTool = runtimeTool("extension_echo", "base");
		const context = compositionContext(new Map([[baseTool.name, baseTool]]));

		const inactive = runtime.compose(context, context.frame.tools, { mode: "explicit", toolNames: [] });
		expect(inactive.frame.tools.has("extension_echo")).toBe(false);
		expect(inactive.availableTools.get("extension_echo")?.description).toBe("first");

		const active = runtime.compose(context, context.frame.tools, {
			mode: "explicit",
			toolNames: ["extension_echo"],
		});
		expect(active.frame.tools.get("extension_echo")?.description).toBe("first");
	});

	it("places active Extension tools before non-shadowed host tools", () => {
		const runtime = new CodingAgentExtensionToolRuntime([extensionWithTool("extension", echoTool("extension"))]);
		const hostTool = runtimeTool("host_tool", "host");
		const context = compositionContext(new Map([[hostTool.name, hostTool]]));

		const active = runtime.compose(context, context.frame.tools, { mode: "scope" });

		expect([...active.frame.tools.keys()]).toEqual(["extension_echo", "host_tool"]);
	});

	it("dispatches execution through the runner bound to the request session", async () => {
		const observedContexts: ExtensionContext[] = [];
		const tool: ToolDefinition = {
			...echoTool("bound"),
			async execute(_toolCallId, params, _signal, _onUpdate, context) {
				observedContexts.push(context);
				return {
					content: [{ type: "text", text: `${context.cwd}:${readValue(params)}` }],
					details: undefined,
				};
			},
		};
		const runtime = new CodingAgentExtensionToolRuntime([extensionWithTool("bound", tool)]);
		const extensionContext = { cwd: "C:/workspace" } as unknown as ExtensionContext;
		const runner = { createContext: () => extensionContext } as unknown as ExtensionRunner;
		const unbind = runtime.bindRunner("session-1", runner);
		const advertised = runtime.readAvailableTools().get("extension_echo");
		if (!advertised) throw new Error("Missing Extension tool");

		const result = await advertised.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call-1",
			input: { value: "hello" },
			signal: new AbortController().signal,
		});

		expect(result.content).toEqual([{ type: "text", text: "C:/workspace:hello" }]);
		expect(observedContexts).toEqual([extensionContext]);
		unbind();
		await expect(
			advertised.execute({
				sessionId: "session-1",
				turnId: "turn-2",
				toolCallId: "call-2",
				input: { value: "again" },
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("runner is not bound");
	});

	it("replaces Extension tool definitions without losing Session runner bindings", async () => {
		const runtime = new CodingAgentExtensionToolRuntime([extensionWithTool("before", echoTool("before"))]);
		const runner = { createContext: () => ({ cwd: "C:/workspace" }) } as unknown as ExtensionRunner;
		runtime.bindRunner("session-1", runner);

		runtime.refresh([extensionWithTool("after", echoTool("after"))]);

		expect(runtime.readAvailableTools().get("extension_echo")?.description).toBe("after");
		const refreshed = runtime.readAvailableTools().get("extension_echo");
		if (!refreshed) throw new Error("Missing refreshed Extension tool");
		await expect(
			refreshed.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "call-1",
				input: { value: "updated" },
				signal: new AbortController().signal,
			}),
		).resolves.toMatchObject({ content: [{ type: "text", text: "updated" }] });
	});

	it("isolates Session overlays and lets Session tools override process Extension tools", () => {
		const runtime = new CodingAgentExtensionToolRuntime([extensionWithTool("extension", echoTool("extension"))]);
		runtime.replaceSessionTools("session-1", [registeredTool("<sdk-1>", echoTool("session-1"))]);
		runtime.replaceSessionTools("session-2", [registeredTool("<sdk-2>", echoTool("session-2"))]);

		expect(runtime.readAvailableTools("session-1").get("extension_echo")?.description).toBe("session-1");
		expect(runtime.readAvailableTools("session-2").get("extension_echo")?.description).toBe("session-2");
		expect(runtime.readAvailableTools("other-session").get("extension_echo")?.description).toBe("extension");

		runtime.clearSessionTools("session-1");
		expect(runtime.readAvailableTools("session-1").get("extension_echo")?.description).toBe("extension");
		expect(runtime.readAvailableTools("session-2").get("extension_echo")?.description).toBe("session-2");
	});

	it("keeps a captured Model Call Frame stable while replacements affect the next call", async () => {
		const runtime = new CodingAgentExtensionToolRuntime([]);
		const runner = { createContext: () => ({ cwd: "C:/workspace" }) } as unknown as ExtensionRunner;
		runtime.bindRunner("session-1", runner);
		runtime.replaceSessionTools("session-1", [registeredTool("<sdk>", echoTool("before"))]);
		const context = compositionContext(new Map());
		const captured = runtime
			.compose(context, context.frame.tools, { mode: "scope" })
			.frame.tools.get("extension_echo");
		if (!captured) throw new Error("Missing captured Session tool");

		runtime.replaceSessionTools("session-1", [registeredTool("<sdk>", echoTool("after"))]);
		const next = runtime.compose(context, context.frame.tools, { mode: "scope" }).frame.tools.get("extension_echo");
		if (!next) throw new Error("Missing replaced Session tool");

		expect(captured.description).toBe("before");
		expect(next.description).toBe("after");
		await expect(executeTool(captured, "captured")).resolves.toMatchObject({
			content: [{ type: "text", text: "captured" }],
		});
		await expect(executeTool(next, "next")).resolves.toMatchObject({
			content: [{ type: "text", text: "next" }],
		});
	});
});

function echoTool(description: string): ToolDefinition {
	return {
		name: "extension_echo",
		label: "Extension Echo",
		description,
		parameters: echoParameters,
		async execute(_toolCallId, params) {
			return { content: [{ type: "text", text: readValue(params) }], details: undefined };
		},
	};
}

function extensionWithTool(path: string, definition: ToolDefinition): Extension {
	const tool = registeredTool(path, definition);
	return {
		path,
		resolvedPath: path,
		handlers: new Map(),
		tools: new Map([[definition.name, tool]]),
		messageRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
}

function registeredTool(extensionPath: string, definition: ToolDefinition): RegisteredTool {
	return { definition, extensionPath };
}

function executeTool(tool: RuntimeToolDefinition, value: string) {
	return tool.execute({
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId: "call-1",
		input: { value },
		signal: new AbortController().signal,
	});
}

function runtimeTool(name: string, description: string): RuntimeToolDefinition {
	return {
		name,
		label: name,
		description,
		inputSchema: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: description }] };
		},
	};
}

function compositionContext(tools: ReadonlyMap<string, RuntimeToolDefinition>): ModelCallFrameCompositionContext {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		signal: new AbortController().signal,
		messages: [],
		modelBinding: {} as ModelCallFrameCompositionContext["modelBinding"],
		frame: { instructions: [], tools },
	};
}

function readValue(value: unknown): string {
	if (typeof value !== "object" || value === null) throw new Error("Expected Extension tool input");
	const text = Reflect.get(value, "value");
	if (typeof text !== "string") throw new Error("Expected Extension tool value");
	return text;
}
