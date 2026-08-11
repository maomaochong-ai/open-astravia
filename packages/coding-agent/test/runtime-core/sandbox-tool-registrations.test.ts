import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { RuntimeSessionHostInteractionContext } from "@vetta/runtime-core";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import {
	clearSessionGrants,
	getSandboxShellGrant,
	type SandboxPermissionDecision,
	type SandboxPermissionPrompt,
	type SandboxShellGrant,
} from "@vetta/runtime-core/sandbox";
import {
	CODING_TOOL_SCOPES,
	type CodingToolRegistration,
	type ForegroundCommandOperations,
} from "@vetta/runtime-tools/coding";
import { afterEach, describe, expect, it } from "vitest";
import { createCodingAgentSandboxToolRegistrations } from "../../src/host/session-execution/sandbox-tool-registrations.js";

const SESSION_IDS = ["sandbox-read-session", "sandbox-deny-session", "sandbox-shell-session"] as const;

afterEach(() => {
	for (const sessionId of SESSION_IDS) clearSessionGrants(sessionId);
});

describe("Coding Agent sandbox tool registrations", () => {
	it.each([
		{ platform: "linux" as const, commandToolName: "bash" },
		{ platform: "darwin" as const, commandToolName: "bash" },
		{ platform: "win32" as const, commandToolName: "shell" },
	])("assembles native tool registrations for $platform", async ({ platform, commandToolName }) => {
		const cwd = await mkdtemp(join(tmpdir(), "vetta-sandbox-tools-"));
		try {
			const registrations = createRegistrations({ cwd, platform, decision: "deny" });

			expect(
				registrations.map((registration) => ({
					name: registration.tool.name,
					category: registration.category,
					scopeUse: registration.scopeUse,
				})),
			).toEqual([
				{ name: "read", category: "core", scopeUse: CODING_TOOL_SCOPES },
				{ name: "write", category: "core", scopeUse: CODING_TOOL_SCOPES },
				{ name: "edit", category: "core", scopeUse: CODING_TOOL_SCOPES },
				{ name: commandToolName, category: "core", scopeUse: CODING_TOOL_SCOPES },
			]);
			for (const registration of registrations) {
				expect(registration.tool.inputSchema).toMatchObject({ type: "object" });
				expect(registration.tool.description.length).toBeGreaterThan(0);
			}
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("routes outside-workspace read grants directly through the Runtime host and caches session grants", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "vetta-sandbox-workspace-"));
		const outsideRoot = await mkdtemp(join(tmpdir(), "vetta-sandbox-outside-"));
		const outsidePath = join(outsideRoot, "outside.txt");
		await writeFile(outsidePath, "outside content", "utf8");
		const prompts: SandboxPermissionPrompt[] = [];
		try {
			const registrations = createRegistrations({
				cwd,
				platform: "win32",
				decision: "allow_session",
				sessionId: "sandbox-read-session",
				prompts,
			});
			const readTool = requireTool(registrations, "read");

			const first = await readTool.execute(createRequest("sandbox-read-session", { path: outsidePath }));
			const second = await readTool.execute(createRequest("sandbox-read-session", { path: outsidePath }));

			expect(first.content).toEqual(second.content);
			expect(first.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("outside content") });
			expect(prompts).toHaveLength(1);
			expect(prompts[0]).toMatchObject({
				toolName: "read",
				capability: "file.read",
				target: outsidePath,
				sensitive: false,
			});
		} finally {
			await rm(cwd, { recursive: true, force: true });
			await rm(outsideRoot, { recursive: true, force: true });
		}
	});

	it("preserves the existing outside-workspace denial error", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "vetta-sandbox-deny-workspace-"));
		const outsideRoot = await mkdtemp(join(tmpdir(), "vetta-sandbox-deny-outside-"));
		try {
			const readTool = requireTool(
				createRegistrations({
					cwd,
					platform: "linux",
					decision: "deny",
					sessionId: "sandbox-deny-session",
				}),
				"read",
			);

			await expect(
				readTool.execute(createRequest("sandbox-deny-session", { path: join(outsideRoot, "missing.txt") })),
			).rejects.toThrow('is outside workspace root for tool "read"');
		} finally {
			await rm(cwd, { recursive: true, force: true });
			await rm(outsideRoot, { recursive: true, force: true });
		}
	});

	it("applies an outside-write grant while forwarding command timeout, signal and output", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "vetta-sandbox-shell-"));
		const outsidePath = join(dirname(tmpdir()), `vetta-sandbox-contract-${Date.now()}`, "result.txt").replaceAll(
			"\\",
			"/",
		);
		const prompts: SandboxPermissionPrompt[] = [];
		let activeGrant: SandboxShellGrant | undefined;
		let capturedTimeout: number | undefined;
		let capturedSignal: AbortSignal | undefined;
		const commandOperations: ForegroundCommandOperations = {
			async exec(_command, operationCwd, options) {
				activeGrant = getSandboxShellGrant(operationCwd);
				capturedTimeout = options.timeout;
				capturedSignal = options.signal;
				options.onData(Buffer.from("sandbox output"));
				return { exitCode: 0 };
			},
		};
		try {
			const shellTool = requireTool(
				createRegistrations({
					cwd,
					platform: "win32",
					decision: "allow_once",
					sessionId: "sandbox-shell-session",
					prompts,
					commandOperations,
				}),
				"shell",
			);
			const signal = new AbortController().signal;

			const result = await shellTool.execute(
				createRequest("sandbox-shell-session", { command: `echo ok > "${outsidePath}"`, timeout: 7 }, signal),
			);

			expect(result.content).toEqual([{ type: "text", text: "sandbox output" }]);
			expect(capturedTimeout).toBe(7);
			expect(capturedSignal).toBe(signal);
			expect(prompts).toHaveLength(1);
			const grantRoot = prompts[0]?.grantRoot;
			expect(grantRoot).toBeDefined();
			expect(activeGrant?.allowReadRoots).toContain(grantRoot);
			expect(activeGrant?.allowWriteRoots).toContain(grantRoot);
			expect(prompts[0]).toMatchObject({
				toolName: "shell",
				capability: "file.write",
				target: outsidePath,
				command: `echo ok > "${outsidePath}"`,
			});
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});

interface CreateRegistrationsOptions {
	readonly cwd: string;
	readonly platform: NodeJS.Platform;
	readonly decision: SandboxPermissionDecision;
	readonly sessionId?: string;
	readonly prompts?: SandboxPermissionPrompt[];
	readonly commandOperations?: ForegroundCommandOperations;
}

function createRegistrations(options: CreateRegistrationsOptions): readonly CodingToolRegistration[] {
	const defaultOperations: ForegroundCommandOperations = {
		async exec(_command, _cwd, execOptions) {
			execOptions.onData(Buffer.from("ok"));
			return { exitCode: 0 };
		},
	};
	const hostInteraction: RuntimeSessionHostInteractionContext = {
		confirm: async () => options.decision !== "deny",
		requestSandboxGrant: async (request) => {
			options.prompts?.push(request);
			return options.decision;
		},
	};
	return createCodingAgentSandboxToolRegistrations({
		cwd: options.cwd,
		platform: options.platform,
		hostInteraction,
		getSessionId: () => options.sessionId,
		commandOperations: options.commandOperations ?? defaultOperations,
	});
}

function requireTool(registrations: readonly CodingToolRegistration[], toolName: string): RuntimeToolDefinition {
	const registration = registrations.find(({ tool }) => tool.name === toolName);
	if (!registration) throw new Error(`Missing sandbox tool registration: ${toolName}`);
	return registration.tool;
}

function createRequest(
	sessionId: string,
	input: Readonly<Record<string, unknown>>,
	signal: AbortSignal = new AbortController().signal,
): Parameters<RuntimeToolDefinition["execute"]>[0] {
	return {
		sessionId,
		turnId: "turn-1",
		toolCallId: "tool-call-1",
		input,
		signal,
	};
}
