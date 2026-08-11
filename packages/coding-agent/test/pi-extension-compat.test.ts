import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { ExtensionContext, ExtensionRunner } from "../src/extensions/index.js";
import {
	adaptPiToolDefinition,
	loadPiExtensions,
	PiExtensionCompatibilityError,
} from "../src/extensions/pi-compat/index.js";
import { CodingAgentExtensionToolRuntime } from "../src/extensions/runtime/extension-tool-runtime.js";
import { loadExtensions } from "../src/extensions/runtime/loading/load-extensions.js";

describe("Pi extension compatibility boundary", () => {
	it("loads a host-neutral Pi extension through the TypeBox 1 and tool ACL facades", async () => {
		const fixture = fileURLToPath(new URL("./fixtures/pi-extension-compat/hello.ts", import.meta.url));
		const result = await loadPiExtensions([fixture], process.cwd());

		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);
		const registered = result.extensions[0]?.tools.get("pi_hello");
		if (!registered) throw new Error("Missing compatible Pi tool");
		expect(registered.definition).toMatchObject({
			name: "pi_hello",
			prompt: {
				summary: "Greet a known person by name.",
				guidelines: ["Trim surrounding whitespace from names."],
			},
		});
		expect(registered.definition.renderCall).toBeUndefined();
		expect(result.compatibilityReports[0]?.features).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ feature: "tool:pi_hello", status: "adapted" }),
				expect.objectContaining({ feature: "tool:pi_hello:context", status: "host-dependent" }),
				expect.objectContaining({ feature: "tool:pi_hello:prepareArguments", status: "adapted" }),
				expect.objectContaining({ feature: "tool:pi_hello:prompt", status: "adapted" }),
				expect.objectContaining({ feature: "tool:pi_hello:renderer", status: "excluded" }),
				expect.objectContaining({ feature: "event:agent_end", status: "host-dependent" }),
				expect.objectContaining({ feature: "shortcut:ctrl+x", status: "excluded" }),
			]),
		);

		const runtime = new CodingAgentExtensionToolRuntime(result.extensions);
		const tool = runtime.readAvailableTools().get("pi_hello");
		if (!tool?.validateInput) throw new Error("Missing compatible Pi validator");
		const input = tool.validateInput({ name: "  Ada  " });
		expect(input).toEqual({ name: "Ada" });

		const context = { cwd: "C:/workspace" } as unknown as ExtensionContext;
		runtime.bindRunner("session-1", { createContext: () => context } as unknown as ExtensionRunner);
		await expect(
			tool.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "call-1",
				input,
				signal: new AbortController().signal,
			}),
		).resolves.toMatchObject({ content: [{ type: "text", text: "Hello, Ada!" }] });
	});

	it("does not expose Pi package facades through the native Extension loader", async () => {
		const fixture = fileURLToPath(new URL("./fixtures/pi-extension-compat/hello.ts", import.meta.url));
		const result = await loadExtensions([fixture], process.cwd());

		expect(result.extensions).toEqual([]);
		expect(result.errors[0]?.error).toContain("@earendil-works/pi-ai");
	});

	it("binds legacy Pi and TypeBox specifiers to the same isolated TypeBox 1 profile", async () => {
		const fixture = fileURLToPath(new URL("./fixtures/pi-extension-compat/legacy-typebox.ts", import.meta.url));
		const result = await loadPiExtensions([fixture], process.cwd());
		const runtime = new CodingAgentExtensionToolRuntime(result.extensions);
		const tool = runtime.readAvailableTools().get("legacy_schema");

		expect(result.errors).toEqual([]);
		expect(tool?.validateInput?.({ count: "2" })).toEqual({ count: 2 });
		expect(() => tool?.validateInput?.({ count: 0 })).toThrow("must be >= 1");
	});

	it("rejects Pi parallel tools instead of silently changing execution semantics", () => {
		expect(() =>
			adaptPiToolDefinition({
				name: "parallel",
				label: "Parallel",
				description: "unsupported",
				parameters: Type.Object({}),
				executionMode: "parallel",
				async execute() {
					return { content: [], details: undefined };
				},
			}),
		).toThrow(PiExtensionCompatibilityError);
	});

	it("rejects Pi lifecycle events that Vetta cannot yet emit as settled facts", async () => {
		const fixture = fileURLToPath(new URL("./fixtures/pi-extension-compat/unsupported-event.ts", import.meta.url));
		const result = await loadPiExtensions([fixture], process.cwd());

		expect(result.extensions).toEqual([]);
		expect(result.errors[0]?.error).toContain("agent_settled");
		expect(result.errors[0]?.error).toContain("no equivalent settled Vetta fact");
	});

	it("rejects API members that are not explicitly included in the compatibility profile", async () => {
		const fixture = fileURLToPath(new URL("./fixtures/pi-extension-compat/unsupported-api.ts", import.meta.url));
		const result = await loadPiExtensions([fixture], process.cwd());

		expect(result.extensions).toEqual([]);
		expect(result.errors[0]?.error).toContain("registerCommand");
		expect(result.errors[0]?.error).toContain("not supported by this profile");
	});
});
