import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
	CodingAgentHost,
	CodingAgentPromptOptions,
	CodingAgentResourceContributions,
	CodingAgentSession,
	CodingAgentSessionCatalog,
	CodingAgentSessionCore,
	CodingAgentSessionEventListener,
	CodingAgentSessionToolDefinition,
	CodingAgentToolExecutionContext,
} from "../../src/public-api/sdk.js";
import * as publicSdk from "../../src/public-api/sdk.js";

const PUBLIC_SDK_DIRECTORY = new URL("../../src/public-api/sdk/", import.meta.url);
const PUBLIC_SDK_ENTRY = new URL("../../src/public-api/sdk.ts", import.meta.url);

describe("public Coding Agent SDK boundary", () => {
	it("exports only the stable runtime entrypoints", () => {
		expect(Object.keys(publicSdk).sort()).toEqual([
			"CODING_AGENT_SESSION_CREATE_ERROR_CODES",
			"CodingAgentSessionCreateError",
			"createCodingAgentHost",
			"createCodingAgentSession",
			"createCodingAgentSessionCatalog",
		]);
	});

	it("keeps migration and concrete manager names out of public SDK sources", () => {
		const publicFiles = [
			PUBLIC_SDK_ENTRY,
			...readdirSync(PUBLIC_SDK_DIRECTORY)
				.filter((name) => name.endsWith(".ts"))
				.map((name) => new URL(name, PUBLIC_SDK_DIRECTORY)),
		];
		expect(readdirSync(PUBLIC_SDK_DIRECTORY).sort()).toEqual([
			"index.ts",
			"sdk-create-contract.ts",
			"sdk-event-contract.ts",
			"sdk-host-contract.ts",
			"sdk-prompt-contract.ts",
			"sdk-resource-source-contract.ts",
			"sdk-session-catalog-contract.ts",
			"sdk-session-contract.ts",
			"sdk-tool-contract.ts",
		]);
		for (const file of publicFiles) {
			const source = readFileSync(file, "utf8");
			expect(source, file.pathname).not.toMatch(
				/\b(?:(?:Greenfield|Legacy)[A-Za-z0-9_]*|ModelRegistry|ResourceLoader|SessionManager|SettingsRuntime)\b/,
			);
		}
	});

	it("keeps stable contracts independent from Coding Agent internal source paths", () => {
		for (const name of readdirSync(PUBLIC_SDK_DIRECTORY).filter((entry) => entry.endsWith(".ts"))) {
			const file = new URL(name, PUBLIC_SDK_DIRECTORY);
			const source = readFileSync(file, "utf8");
			expect(source, file.pathname).not.toMatch(/from\s+["'](?:\.\.\/){2}/);
		}
	});
});

function verifyStablePublicTypes(
	session: CodingAgentSession,
	tool: CodingAgentSessionToolDefinition,
	options: CodingAgentPromptOptions,
	listener: CodingAgentSessionEventListener,
	resources: CodingAgentResourceContributions,
	catalog: CodingAgentSessionCatalog,
	host: CodingAgentHost,
): CodingAgentSessionCore {
	void [tool, options, listener, resources, catalog, host];
	return session;
}

void verifyStablePublicTypes;

function verifyToolContextIsNarrow(context: CodingAgentToolExecutionContext): void {
	void context.cwd;
	void context.getSystemPrompt();
	// @ts-expect-error Concrete session storage belongs to the compatibility Extension context.
	void context.sessionManager;
	// @ts-expect-error Concrete model discovery belongs to the product Composition Root.
	void context.modelRegistry;
}

void verifyToolContextIsNarrow;
