import { type TSchema, Type } from "@sinclair/typebox";
import type { AgentToolUpdateCallback } from "@vetta/agent-core";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../../src/extensions/index.js";
import {
	adaptPublicCodingAgentSdkCustomTools,
	CODING_AGENT_SDK_CUSTOM_TOOL_ERROR_CODES,
	CodingAgentSdkCustomToolError,
} from "../../src/host/sdk-session/index.js";
import type { Theme } from "../../src/modes/interactive/theme/theme.js";
import type { CodingAgentSessionToolDefinition, CodingAgentToolExecutionContext } from "../../src/public-api/sdk.js";

describe("Coding Agent SDK custom tool adapter", () => {
	it("adapts the stable public tool contract without exposing product managers", async () => {
		const parameters = Type.Object({ value: Type.String() });
		const component = { render: () => ["rendered"] };
		const renderCall = vi.fn(() => component);
		const execute = vi.fn(
			async (
				_toolCallId: string,
				params: { value: string },
				_signal: AbortSignal | undefined,
				_onUpdate: AgentToolUpdateCallback<unknown> | undefined,
				context: CodingAgentToolExecutionContext,
			) => ({
				content: [{ type: "text" as const, text: `${context.cwd}:${params.value}` }],
				details: undefined,
			}),
		);
		const tool: CodingAgentSessionToolDefinition<typeof parameters> = {
			name: "public_echo",
			label: "Public Echo",
			description: "Echo through the stable SDK contract",
			parameters,
			execute,
			renderCall,
		};
		const adapted = adaptPublicCodingAgentSdkCustomTools([tool]);
		const definition = adapted?.[0]?.definition;
		if (!definition) throw new Error("Missing adapted public SDK custom tool");
		const context = { cwd: "C:/public-workspace" } as unknown as ExtensionContext;

		await expect(
			definition.execute("call-public", { value: "ok" }, undefined, undefined, context),
		).resolves.toMatchObject({ content: [{ type: "text", text: "C:/public-workspace:ok" }] });
		expect(execute).toHaveBeenCalledWith("call-public", { value: "ok" }, undefined, undefined, context);
		const currentTheme = {} as Theme;
		expect(definition.renderCall?.({ value: "ok" }, currentTheme)).toBe(component);
		expect(renderCall).toHaveBeenCalledWith({ value: "ok" }, currentTheme);
	});

	it("rejects a custom tool whose public schema is not a valid TypeBox schema", () => {
		const tool: CodingAgentSessionToolDefinition = {
			name: "invalid_schema",
			label: "Invalid schema",
			description: "Invalid schema fixture",
			parameters: {} as TSchema,
			async execute() {
				return { content: [], details: undefined };
			},
		};

		expect(() => adaptPublicCodingAgentSdkCustomTools([tool])).toThrowError(CodingAgentSdkCustomToolError);
		try {
			adaptPublicCodingAgentSdkCustomTools([tool]);
		} catch (error) {
			expect(error).toMatchObject({
				code: CODING_AGENT_SDK_CUSTOM_TOOL_ERROR_CODES.INVALID_SCHEMA,
				toolName: "invalid_schema",
			});
		}
	});

	it("validates custom tool input before invoking the public implementation", async () => {
		const parameters = Type.Object({ value: Type.String() });
		const execute = vi.fn(async () => ({ content: [], details: undefined }));
		const tool: CodingAgentSessionToolDefinition<typeof parameters> = {
			name: "validated_input",
			label: "Validated input",
			description: "Input validation fixture",
			parameters,
			execute,
		};
		const definition = adaptPublicCodingAgentSdkCustomTools([tool])?.[0]?.definition;
		if (!definition) throw new Error("Missing adapted public SDK custom tool");
		const context = { cwd: "C:/public-workspace" } as unknown as ExtensionContext;

		await expect(
			definition.execute("call-invalid", { value: 1 }, undefined, undefined, context),
		).rejects.toMatchObject({
			code: CODING_AGENT_SDK_CUSTOM_TOOL_ERROR_CODES.INVALID_INPUT,
			toolName: "validated_input",
		});
		expect(execute).not.toHaveBeenCalled();
	});
});
