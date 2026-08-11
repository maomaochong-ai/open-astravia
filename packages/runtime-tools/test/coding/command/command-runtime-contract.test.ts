import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type CommandSpawnHook,
	type CommandToolExecutor,
	CommandToolInputSchema,
	createBashToolRegistration,
	createForegroundCommandToolExecutor,
	createShellToolRegistration,
	type ForegroundCommandOperations,
	getBashToolScopes,
	getShellToolScopes,
} from "../../../src/coding/index.js";
import { createTestForegroundCommandHost } from "../../support/local-command-host.js";

type CommandName = "bash" | "shell";

interface CommandFixtureOptions {
	readonly operations?: ForegroundCommandOperations;
	readonly commandPrefix?: string;
	readonly spawnHook?: CommandSpawnHook;
	readonly blockUntilSec?: number;
}

function createOperations(output: string, exitCode = 0): ForegroundCommandOperations {
	return {
		async exec(_command, _cwd, options) {
			options.onData(Buffer.from(output));
			return { exitCode };
		},
	};
}

function createRuntimeRegistration(name: CommandName, cwd: string, toolOptions: CommandFixtureOptions) {
	const host = createTestForegroundCommandHost(cwd);
	const executor = createForegroundCommandToolExecutor({
		...host,
		operations: toolOptions.operations ?? host.operations,
		commandPrefix: toolOptions.commandPrefix,
		spawnHook: toolOptions.spawnHook ? (context) => toolOptions.spawnHook?.({ ...context }) ?? context : undefined,
		blockUntilSec: toolOptions.blockUntilSec,
	});
	return name === "bash"
		? createBashToolRegistration(cwd, { executor })
		: createShellToolRegistration(cwd, { executor });
}

describe.each(["bash", "shell"] as const)("runtime %s command adapter", (toolName) => {
	it("keeps the public definition, scope, output, details, and updates", async () => {
		const cwd = "C:/workspace";
		const calls: Array<{ readonly command: string; readonly cwd: string; readonly marker?: string }> = [];
		const toolOptions: CommandFixtureOptions = {
			operations: {
				async exec(command, operationCwd, options) {
					calls.push({ command, cwd: operationCwd, marker: options.env?.COMMAND_CONTRACT_MARKER });
					options.onData(Buffer.from("command output\n"));
					return { exitCode: 0 };
				},
			},
			commandPrefix: "echo prefix",
			spawnHook: (context) => ({
				...context,
				command: `${context.command}\necho hook`,
				cwd: "C:/spawn-cwd",
				env: { ...context.env, COMMAND_CONTRACT_MARKER: "present" },
			}),
		};
		const runtime = createRuntimeRegistration(toolName, cwd, toolOptions);

		expect(runtime.tool).toMatchObject({
			name: toolName,
			label: toolName,
			inputSchema: CommandToolInputSchema,
		});
		expect(runtime.tool.description).toContain("Foreground vs background");
		expect(runtime.scopeUse).toEqual(toolName === "bash" ? getBashToolScopes() : getShellToolScopes());
		expect(runtime.category).toBe("core");

		const input = { command: "echo command", timeout: 7 };
		const runtimeUpdates: unknown[] = [];
		const runtimeResult = await runtime.tool.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "runtime-call",
			input,
			signal: new AbortController().signal,
			onUpdate: (update) => runtimeUpdates.push(update),
		});

		expect(runtimeResult).toEqual({ content: [{ type: "text", text: "command output\n" }], details: undefined });
		expect(runtimeUpdates).toEqual([{ content: [{ type: "text", text: "command output\n" }], details: {} }]);
		expect(calls).toEqual([
			{ command: "echo prefix\necho command\necho hook", cwd: "C:/spawn-cwd", marker: "present" },
		]);
	});

	it("preserves protected skill directory warnings", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "runtime-command-protected-"));
		const protectedDirectory = join(cwd, ".vetta", "skills");
		const protectedFile = join(protectedDirectory, "changed.txt");
		mkdirSync(protectedDirectory, { recursive: true });
		const toolOptions: CommandFixtureOptions = {
			operations: {
				async exec(_command, _cwd, options) {
					writeFileSync(protectedFile, "changed");
					options.onData(Buffer.from("done"));
					return { exitCode: 0 };
				},
			},
		};

		try {
			const runtime = createRuntimeRegistration(toolName, cwd, toolOptions);
			const runtimeResult = await runtime.tool.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "runtime-protected",
				input: { command: "write-protected" },
				signal: new AbortController().signal,
			});
			expect(runtimeResult.content[0]).toMatchObject({
				text: expect.stringContaining("WARNING: The following files inside skill/scene directories"),
			});
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("preserves non-zero exit and unavailable background errors", async () => {
		const cwd = "C:/workspace";
		const failingOptions: CommandFixtureOptions = { operations: createOperations("failure output", 2) };
		const runtime = createRuntimeRegistration(toolName, cwd, failingOptions);
		const signal = new AbortController().signal;

		await expect(
			runtime.tool.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "runtime-failure",
				input: { command: "fail" },
				signal,
			}),
		).rejects.toThrow("failure output\n\nCommand exited with code 2");
		await expect(
			runtime.tool.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "runtime-background",
				input: { command: "serve", run_in_background: true },
				signal,
			}),
		).rejects.toThrow("Background execution is not available in this session");
	});

	it("preserves timeout, abort, path correction, and line truncation behavior", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "runtime-command-contract-"));
		try {
			writeFileSync(join(cwd, "报告-最终.txt"), "content");
			const capturedCommands: string[] = [];
			const pathOptions: CommandFixtureOptions = {
				operations: {
					async exec(command, _cwd, options) {
						capturedCommands.push(command);
						options.onData(Buffer.from("corrected"));
						return { exitCode: 0 };
					},
				},
			};
			const runtimePath = createRuntimeRegistration(toolName, cwd, pathOptions);
			const input = { command: 'read "报告 - 最终.txt"' };
			const runtimeResult = await runtimePath.tool.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "runtime-path",
				input,
				signal: new AbortController().signal,
			});
			expect(runtimeResult.content[0]).toMatchObject({ text: expect.stringContaining("Auto-corrected path") });
			expect(runtimeResult.details).toMatchObject({ pathCorrections: [{ original: "报告 - 最终.txt" }] });
			expect(capturedCommands).toEqual(['read "报告-最终.txt"']);

			const largeOutput = Array.from({ length: 2_002 }, (_, index) => `line-${index}`).join("\n");
			const truncationOptions: CommandFixtureOptions = { operations: createOperations(largeOutput) };
			const runtimeTruncation = createRuntimeRegistration(toolName, cwd, truncationOptions);
			const runtimeTruncated = await runtimeTruncation.tool.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "runtime-truncation",
				input: { command: "many-lines" },
				signal: new AbortController().signal,
			});
			expect(runtimeTruncated.details).toMatchObject({
				truncation: { truncated: true, truncatedBy: "lines", totalLines: 2_002, outputLines: 2_000 },
			});
			expect(runtimeTruncated.content[0]).toMatchObject({ text: expect.stringContaining("Showing lines 3-2002") });

			for (const errorMessage of ["timeout:3", "aborted"]) {
				const errorOptions: CommandFixtureOptions = {
					operations: {
						async exec() {
							throw new Error(errorMessage);
						},
					},
				};
				const runtimeError = createRuntimeRegistration(toolName, cwd, errorOptions);
				const runtimePromise = runtimeError.tool.execute({
					sessionId: "session-1",
					turnId: "turn-1",
					toolCallId: "runtime-error",
					input: { command: "fail", timeout: 3 },
					signal: new AbortController().signal,
				});
				await expect(runtimePromise).rejects.toThrow(
					errorMessage === "timeout:3" ? "Command timed out after 3 seconds" : "Command aborted",
				);
			}
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("runtime command registration", () => {
	it("keeps bash and shell platform scopes mutually exclusive", () => {
		expect(getBashToolScopes("win32")).toEqual([]);
		expect(getShellToolScopes("win32")).not.toEqual([]);
		expect(getBashToolScopes("linux")).not.toEqual([]);
		expect(getShellToolScopes("linux")).toEqual([]);
	});

	it("forwards Runtime execution context through the command Port", async () => {
		const calls: Parameters<CommandToolExecutor["execute"]>[0][] = [];
		const executor: CommandToolExecutor = {
			async execute(request) {
				calls.push(request);
				return { content: [{ type: "text", text: "forwarded" }] };
			},
		};
		const registration = createBashToolRegistration("C:/workspace", { executor, platform: "linux" });
		const signal = new AbortController().signal;
		const result = await registration.tool.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "tool-call-1",
			input: { command: "echo forwarded" },
			signal,
		});

		expect(result).toEqual({ content: [{ type: "text", text: "forwarded" }] });
		expect(calls).toEqual([
			expect.objectContaining({
				toolName: "bash",
				cwd: "C:/workspace",
				toolCallId: "tool-call-1",
				input: { command: "echo forwarded" },
				signal,
			}),
		]);
	});

	it("executes a real local foreground command through the independent Runtime executor", async () => {
		const toolName: CommandName = process.platform === "win32" ? "shell" : "bash";
		const registration = createRuntimeRegistration(toolName, process.cwd(), {});
		const executable = `"${process.execPath}"`;
		const command = `${executable} -e "process.stdout.write('runtime-command-ok')"`;
		const result = await registration.tool.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "tool-call-real-command",
			input: { command, timeout: 10 },
			signal: new AbortController().signal,
		});

		expect(result.content).toEqual([{ type: "text", text: "runtime-command-ok" }]);
	});
});
