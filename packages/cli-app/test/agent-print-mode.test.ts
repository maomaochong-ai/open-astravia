import { spawn } from "node:child_process";
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AgentRpcFixture, createAgentRpcFixture } from "./support/agent-rpc-test-process.js";
import { legacyRuntimeContract } from "./support/legacy-runtime-contract.js";
import {
	startOpenAiResponsesTestServer,
	textResponseEvents,
	toolCallResponseEvents,
} from "./support/openai-responses-test-server.js";

interface AgentCliResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const compileScriptPath = fileURLToPath(new URL("../scripts/compile-standalone.mjs", import.meta.url));
const compileTargetByPlatform = {
	"darwin-arm64": "bun-darwin-arm64",
	"darwin-x64": "bun-darwin-x64",
	"linux-arm64": "bun-linux-arm64",
	"linux-x64": "bun-linux-x64",
	"win32-x64": "bun-windows-x64",
} as const;
let executable: AgentCliExecutable;

interface AgentCliExecutable {
	readonly path: string;
	dispose(): Promise<void>;
}

beforeAll(async () => {
	executable = await buildAgentCliExecutable();
}, 120_000);

afterAll(async () => {
	await executable?.dispose();
});

describe("Agent non-RPC CLI compatibility", () => {
	it("defaults explicit text Print to the production Runtime", async () => {
		const marker = "explicit text print response";
		const server = await startOpenAiResponsesTestServer(() => ({
			kind: "events",
			events: textResponseEvents(marker),
		}));
		const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		try {
			const result = await runAgentCli(fixture, ["--print", "reply in text"]);

			expect(result.code).toBe(0);
			expect(result.stdout).toContain(marker);
			expect(result.stderr).not.toContain("requested=");
			expect(server.requests).toHaveLength(1);
		} finally {
			await fixture.dispose();
			await server.dispose();
		}
	}, 30_000);

	it("keeps JSON print as a JSONL event stream", async () => {
		const marker = "JSON print response";
		const server = await startOpenAiResponsesTestServer(() => ({
			kind: "events",
			events: textResponseEvents(marker),
		}));
		const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		try {
			const result = await runAgentCli(fixture, ["--mode", "json", "reply in JSON"]);
			const frames = result.stdout.split(/\r?\n/).flatMap((line) => parseJsonLine(line));

			expect(result.code).toBe(0);
			expect(frames.length).toBeGreaterThan(1);
			expect(result.stdout).toContain(marker);
			expect(result.stderr).not.toContain("requested=");
		} finally {
			await fixture.dispose();
			await server.dispose();
		}
	}, 30_000);

	it("keeps production JSON Print core events compatible with the frozen historical contract", async () => {
		const marker = "JSON compatibility response";
		const server = await startOpenAiResponsesTestServer(() => ({
			kind: "events",
			events: textResponseEvents(marker),
		}));
		const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		try {
			const production = await runAgentCli(fixture, ["--mode", "json", "compare JSON events"]);

			expect(production.code).toBe(0);
			expect(readCoreEventTypes(production.stdout)).toEqual(legacyRuntimeContract.print.coreEventTypes);
			expect(production.stdout).toContain(marker);
			expect(production.stderr).not.toContain("requested=");
			expect(readSessionHeader(production.stdout)).toMatchObject({ type: "session", version: 3 });
		} finally {
			await fixture.dispose();
			await server.dispose();
		}
	}, 30_000);

	it("keeps piped stdin print-compatible without an explicit mode", async () => {
		const marker = "piped stdin response";
		const server = await startOpenAiResponsesTestServer(() => ({
			kind: "events",
			events: textResponseEvents(marker),
		}));
		const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		try {
			const result = await runAgentCli(fixture, ["agent"], "reply from stdin\n");

			expect(result.code).toBe(0);
			expect(result.stdout).toContain(marker);
			expect(result.stderr).not.toContain("requested=");
			expect(server.requests).toHaveLength(1);
		} finally {
			await fixture.dispose();
			await server.dispose();
		}
	}, 30_000);

	it("keeps piped stdin compatible on the production Print path", async () => {
		const marker = "Runtime piped stdin response";
		const server = await startOpenAiResponsesTestServer(() => ({
			kind: "events",
			events: textResponseEvents(marker),
		}));
		const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		try {
			const result = await runAgentCli(fixture, ["agent"], "reply from Runtime stdin\n");

			expect(result.code).toBe(0);
			expect(result.stdout).toContain(marker);
			expect(result.stderr).not.toContain("requested=");
			expect(server.requests).toHaveLength(1);
		} finally {
			await fixture.dispose();
			await server.dispose();
		}
	}, 30_000);

	it("keeps text and image @file inputs compatible with the frozen historical contract", async () => {
		const observation = await runPrintContract(async () => {
			const marker = "production attachment response";
			const server = await startOpenAiResponsesTestServer(() => ({
				kind: "events",
				events: textResponseEvents(marker),
			}));
			const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl, modelInput: ["text", "image"] });
			const textPath = join(fixture.workspace, "attachment.txt");
			const imagePath = join(fixture.workspace, "attachment.png");
			await Promise.all([
				writeFile(textPath, "attachment text fixture", "utf8"),
				writeFile(imagePath, Buffer.from(TEST_PNG_BASE64, "base64")),
			]);
			try {
				const result = await runAgentCli(fixture, [
					"--mode",
					"json",
					`@${textPath}`,
					`@${imagePath}`,
					"inspect attachments",
				]);
				expect(result.stderr).not.toContain("Photon WASM failed");
				return {
					code: result.code,
					userInput: normalizeFixtureValue(readLastUserInput(server.requests[0]?.body.input), fixture),
					toolNames: readProviderToolNames(server.requests[0]?.body.tools),
				};
			} finally {
				await fixture.dispose();
				await server.dispose();
			}
		});
		expect(JSON.stringify(observation.userInput)).toContain("attachment text fixture");
		expect(JSON.stringify(observation.userInput)).toContain("input_image");
	}, 60_000);

	it("keeps complete tool execution payloads compatible with the frozen historical contract", async () => {
		const observation = await runPrintContract(async () => {
			let fixture: AgentRpcFixture | undefined;
			const server = await startOpenAiResponsesTestServer((_request, index) =>
				index === 0
					? {
							kind: "events",
							events: toolCallResponseEvents("read", {
								path: join(fixture!.workspace, "tool-input.txt"),
							}),
						}
					: { kind: "events", events: textResponseEvents("tool loop completed") },
			);
			fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
			await writeFile(join(fixture.workspace, "tool-input.txt"), "tool payload fixture", "utf8");
			try {
				const result = await runAgentCli(fixture, ["--mode", "json", "read the fixture file"]);
				return {
					code: result.code,
					frames: readToolFrames(result.stdout, fixture),
					secondInputHasResult: server.requests[1]?.rawBody.includes("tool payload fixture") === true,
				};
			} finally {
				await fixture.dispose();
				await server.dispose();
			}
		});
		expect(observation.frames.map((frame) => frame.type)).toEqual(legacyRuntimeContract.print.toolFrameTypes);
		expect(observation.secondInputHasResult).toBe(true);
	}, 60_000);

	it("reports production Print tool errors without falling back to another Runtime", async () => {
		let fixture: AgentRpcFixture | undefined;
		const server = await startOpenAiResponsesTestServer((_request, index) =>
			index === 0
				? {
						kind: "events",
						events: toolCallResponseEvents("read", { path: join(fixture!.workspace, "missing.txt") }),
					}
				: { kind: "events", events: textResponseEvents("tool error observed") },
		);
		fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		try {
			const result = await runAgentCli(fixture, ["--mode", "json", "read the missing fixture"]);
			const toolEnd = readFrames(result.stdout).find((frame) => frame.type === "tool_execution_end");

			expect(result.code).toBe(0);
			expect(server.requests).toHaveLength(2);
			expect(toolEnd).toMatchObject({ toolName: "read", isError: true });
			expect(result.stderr).not.toContain("requested=");
		} finally {
			await fixture.dispose();
			await server.dispose();
		}
	}, 60_000);

	it("keeps Provider HTTP retry events compatible with the frozen historical contract", async () => {
		const observation = await runPrintContract(async () => {
			const server = await startOpenAiResponsesTestServer((_request, index) =>
				index < 3
					? { kind: "http-error", status: 503, body: "temporary provider outage" }
					: { kind: "events", events: textResponseEvents("retry recovered") },
			);
			const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
			await writeFile(
				join(fixture.agentDir, "settings.json"),
				JSON.stringify({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 } }),
				"utf8",
			);
			try {
				const result = await runAgentCli(fixture, ["--mode", "json", "retry the provider request"]);
				return {
					code: result.code,
					requestCount: server.requests.length,
					retryFrames: readFrames(result.stdout)
						.filter((frame) => frame.type === "auto_retry_start" || frame.type === "auto_retry_end")
						.map(normalizeRetryFrame),
				};
			} finally {
				await fixture.dispose();
				await server.dispose();
			}
		});
		expect(observation).toMatchObject({
			code: 0,
			requestCount: legacyRuntimeContract.print.retry.requestCount,
			retryFrames: legacyRuntimeContract.print.retry.frames,
		});
	}, 60_000);

	it("keeps Provider disconnect retry events compatible with the frozen historical contract", async () => {
		const observation = await runPrintContract(async () => {
			const server = await startOpenAiResponsesTestServer((_request, index) =>
				index < 3 ? { kind: "disconnect" } : { kind: "events", events: textResponseEvents("disconnect recovered") },
			);
			const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
			await writeFile(
				join(fixture.agentDir, "settings.json"),
				JSON.stringify({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 } }),
				"utf8",
			);
			try {
				const result = await runAgentCli(fixture, ["--mode", "json", "retry after disconnect"]);
				return {
					code: result.code,
					requestCount: server.requests.length,
					retryFrames: readFrames(result.stdout)
						.filter((frame) => frame.type === "auto_retry_start" || frame.type === "auto_retry_end")
						.map(normalizeRetryFrame),
				};
			} finally {
				await fixture.dispose();
				await server.dispose();
			}
		});
		expect(observation).toMatchObject({
			code: 0,
			requestCount: legacyRuntimeContract.print.retry.requestCount,
			retryFrames: legacyRuntimeContract.print.retry.frames,
		});
	}, 60_000);

	it("keeps non-retryable Provider errors compatible with the frozen historical contract", async () => {
		const observation = await runPrintContract(async () => {
			const server = await startOpenAiResponsesTestServer(() => ({
				kind: "http-error",
				status: 401,
				body: "invalid provider credential",
			}));
			const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
			await writeFile(
				join(fixture.agentDir, "settings.json"),
				JSON.stringify({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 } }),
				"utf8",
			);
			try {
				const result = await runAgentCli(fixture, ["--mode", "json", "do not retry authentication failures"]);
				return {
					code: result.code,
					requestCount: server.requests.length,
					retryFrameCount: readFrames(result.stdout).filter(
						(frame) => frame.type === "auto_retry_start" || frame.type === "auto_retry_end",
					).length,
					fallback: result.stderr.includes("fallback="),
				};
			} finally {
				await fixture.dispose();
				await server.dispose();
			}
		});
		expect(observation).toEqual(legacyRuntimeContract.print.nonRetryableProviderFailure);
	}, 60_000);

	it("keeps text Print Provider failure exit status compatible with the frozen historical contract", async () => {
		const observation = await runPrintContract(async () => {
			const server = await startOpenAiResponsesTestServer(() => ({
				kind: "http-error",
				status: 401,
				body: "invalid provider credential",
			}));
			const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
			try {
				const result = await runAgentCli(fixture, ["--print", "report authentication failure"]);
				return { code: result.code, requestCount: server.requests.length };
			} finally {
				await fixture.dispose();
				await server.dispose();
			}
		});
		expect(observation).toEqual(legacyRuntimeContract.print.textProviderFailure);
	}, 60_000);

	it("keeps Extension input errors isolated and observable", async () => {
		const observation = await runPrintContract(async () => {
			const server = await startOpenAiResponsesTestServer(() => ({
				kind: "events",
				events: textResponseEvents("extension error was isolated"),
			}));
			const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
			const extensionPath = join(fixture.root, "print-error-extension.ts");
			await writeFile(
				extensionPath,
				`export default function(extension) {
					extension.on("input", async () => { throw new Error("print extension fixture failure"); });
				}`,
				"utf8",
			);
			try {
				const result = await runAgentCli(fixture, [
					"--print",
					"--extension",
					extensionPath,
					"trigger the extension",
				]);
				return {
					code: result.code,
					providerRequests: server.requests.length,
					observedError: result.stderr.includes("print extension fixture failure"),
					observedOutput: result.stdout.includes("extension error was isolated"),
				};
			} finally {
				await fixture.dispose();
				await server.dispose();
			}
		});
		expect(observation).toEqual({
			code: 0,
			providerRequests: 1,
			observedError: true,
			observedOutput: true,
		});
	}, 60_000);

	it("fails before the Provider request for an unsupported Extension event on production Print", async () => {
		const server = await startOpenAiResponsesTestServer(() => ({
			kind: "events",
			events: textResponseEvents("extension fallback completed"),
		}));
		const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		const extensionPath = join(fixture.root, "unsupported-print-extension.ts");
		await writeFile(
			extensionPath,
			`export default function(extension) {
				extension.on("future_event", async () => {});
			}`,
			"utf8",
		);
		try {
			const result = await runAgentCli(fixture, [
				"--mode",
				"json",
				"--extension",
				extensionPath,
				"reject incompatible extension",
			]);

			expect(result.code).toBe(2);
			expect(result.stdout).not.toContain("extension fallback completed");
			expect(server.requests).toHaveLength(0);
			expect(result.stderr).toContain("errorCode=extension_incompatible");
			expect(result.stderr).toContain("unsupportedEvents=future_event");
			expect(result.stderr).toContain("unmetCapabilities=event-handler");
		} finally {
			await fixture.dispose();
			await server.dispose();
		}
	}, 60_000);

	it("keeps --continue context and session identity stable across Print processes", async () => {
		const observation = await runPrintContract(async () => {
			const server = await startOpenAiResponsesTestServer((_request, index) => ({
				kind: "events",
				events: textResponseEvents(index === 0 ? "first persisted response" : "continued response"),
			}));
			const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
			try {
				const first = await runAgentCli(fixture, ["--mode", "json", "first persisted prompt"]);
				const continued = await runAgentCli(fixture, ["--continue", "--mode", "json", "continued prompt"]);
				return {
					codes: [first.code, continued.code],
					sameSession: readSessionId(first.stdout) === readSessionId(continued.stdout),
					continuedContext:
						server.requests[1]?.rawBody.includes("first persisted prompt") === true &&
						server.requests[1]?.rawBody.includes("first persisted response") === true,
				};
			} finally {
				await fixture.dispose();
				await server.dispose();
			}
		});
		expect(observation).toEqual({ codes: [0, 0], sameSession: true, continuedContext: true });
	}, 60_000);

	it("fails before the Provider request for an unrepresentable historical session", async () => {
		const server = await startOpenAiResponsesTestServer(() => ({
			kind: "events",
			events: textResponseEvents("legacy session fallback completed"),
		}));
		const fixture = await createAgentRpcFixture({ baseUrl: server.baseUrl });
		const sessionPath = join(fixture.root, "unrepresentable-legacy.jsonl");
		const source = `${JSON.stringify({
			type: "session",
			version: 3,
			id: "unrepresentable-print-session",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: fixture.workspace,
		})}\n${JSON.stringify({
			type: "future_entry",
			id: "future-1",
			parentId: null,
			timestamp: "2026-01-01T00:00:01.000Z",
		})}\n`;
		await writeFile(sessionPath, source, "utf8");
		try {
			const result = await runAgentCli(fixture, ["--session", sessionPath, "--mode", "json", "continue safely"]);

			expect(result.code).toBe(2);
			expect(result.stdout).not.toContain("legacy session fallback completed");
			expect(server.requests).toHaveLength(0);
			expect(result.stderr).toContain("errorCode=session_version_unsupported");
			expect(result.stderr).toContain("issue=unsupported-record:1");
			const persisted = await readFile(sessionPath, "utf8");
			expect(persisted).toBe(source);
			const defaultSessionEntries = await readdir(join(fixture.agentDir, "sessions"), { recursive: true });
			expect(defaultSessionEntries.some((entry) => entry.endsWith(".conversation.jsonl"))).toBe(false);
		} finally {
			await fixture.dispose();
			await server.dispose();
		}
	}, 60_000);

	it("runs control commands without entering the Session Runtime", async () => {
		const fixture = await createAgentRpcFixture();
		const sessionPath = join(fixture.workspace, "control-export.jsonl");
		const exportPath = join(fixture.workspace, "control-export.html");
		try {
			await writeFile(
				sessionPath,
				`${JSON.stringify({
					type: "session",
					version: 3,
					id: "control-export-session",
					timestamp: "2026-01-01T00:00:00.000Z",
					cwd: fixture.workspace,
				})}\n${JSON.stringify({
					type: "message",
					id: "control-export-message",
					parentId: null,
					timestamp: "2026-01-01T00:00:01.000Z",
					message: { role: "user", content: "control export", timestamp: 1 },
				})}\n`,
				"utf8",
			);

			const help = await runAgentCli(fixture, ["agent", "--help"]);
			const version = await runAgentCli(fixture, ["agent", "--version"]);
			const models = await runAgentCli(fixture, ["agent", "--list-models", "test-model"]);
			const exported = await runAgentCli(fixture, ["agent", "--export", sessionPath, exportPath]);

			expect(help).toMatchObject({ code: 0, stderr: "" });
			expect(help.stdout).toContain("Usage:");
			expect(version).toMatchObject({ code: 0, stderr: "" });
			expect(version.stdout.trim().split(/\r?\n/).at(-1)).toMatch(/^\d+\.\d+\.\d+/);
			expect(models.code).toBe(0);
			expect(models.stdout).toContain("test-model");
			expect(models.stderr).not.toContain("[agent-runtime]");
			expect(exported.code).toBe(0);
			expect(exported.stdout).toContain(`Exported to: ${exportPath}`);
			expect(exported.stderr).not.toContain("[agent-runtime]");
			expect(await readFile(exportPath, "utf8")).toContain("<title>Session Export</title>");
		} finally {
			await fixture.dispose();
		}
	}, 60_000);
});

async function runAgentCli(
	fixture: AgentRpcFixture,
	extraArgs: readonly string[],
	stdin = "",
): Promise<AgentCliResult> {
	return new Promise<AgentCliResult>((resolve, reject) => {
		const agentArgs = extraArgs[0] === "agent" ? extraArgs.slice(1) : extraArgs;
		const child = spawn(
			executable.path,
			[
				"--provider",
				"test",
				"--model",
				"test-model",
				"--offline",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-themes",
				...agentArgs,
			],
			{
				cwd: fixture.workspace,
				env: {
					...process.env,
					VETTA_CODING_AGENT_DIR: fixture.agentDir,
					VETTA_HOME: join(fixture.root, "home"),
					VETTA_PACKAGE_DIR: undefined,
				},
				stdio: "pipe",
				windowsHide: true,
			},
		);
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => child.kill(), 20_000);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			clearTimeout(timeout);
			if (signal) reject(new Error(`Agent CLI exited with signal ${signal}\n${stderr}`));
			else resolve({ code: code ?? 1, stdout, stderr });
		});
		child.stdin.end(stdin);
	});
}

function parseJsonLine(line: string): readonly unknown[] {
	try {
		return [JSON.parse(line) as unknown];
	} catch {
		return [];
	}
}

const CORE_EVENT_TYPES = new Set([
	"agent_start",
	"turn_start",
	"message_start",
	"message_update",
	"message_end",
	"turn_end",
	"agent_end",
]);

function readCoreEventTypes(stdout: string): readonly string[] {
	return stdout
		.split(/\r?\n/)
		.flatMap((line) => parseJsonLine(line))
		.flatMap((frame) => {
			const type = readFrameType(frame);
			return type && CORE_EVENT_TYPES.has(type) ? [type] : [];
		});
}

function readSessionHeader(stdout: string): unknown {
	return stdout
		.split(/\r?\n/)
		.flatMap((line) => parseJsonLine(line))
		.find((frame) => readFrameType(frame) === "session");
}

async function runPrintContract<T>(run: () => Promise<T>): Promise<T> {
	return run();
}

interface JsonFrame {
	readonly type: string;
	readonly [key: string]: unknown;
}

interface ToolFrameObservation {
	readonly type: string;
	readonly toolCallId: unknown;
	readonly toolName: unknown;
	readonly args?: unknown;
	readonly partialResult?: unknown;
	readonly result?: unknown;
	readonly isError?: unknown;
	readonly phases?: unknown;
}

function readFrames(stdout: string): readonly JsonFrame[] {
	return stdout
		.split(/\r?\n/)
		.flatMap((line) => parseJsonLine(line))
		.filter(isJsonFrame);
}

function isJsonFrame(value: unknown): value is JsonFrame {
	return typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string";
}

function readToolFrames(stdout: string, fixture: AgentRpcFixture): readonly ToolFrameObservation[] {
	const observations: ToolFrameObservation[] = [];
	for (const frame of readFrames(stdout)) {
		if (frame.type === "tool_execution_start") {
			observations.push({
				type: frame.type,
				toolCallId: frame.toolCallId,
				toolName: frame.toolName,
				args: normalizeFixtureValue(frame.args, fixture),
			});
			continue;
		}
		if (frame.type === "tool_execution_update") {
			observations.push({
				type: frame.type,
				toolCallId: frame.toolCallId,
				toolName: frame.toolName,
				args: normalizeFixtureValue(frame.args, fixture),
				partialResult: normalizeFixtureValue(frame.partialResult, fixture),
			});
			continue;
		}
		if (frame.type === "tool_execution_end") {
			observations.push({
				type: frame.type,
				toolCallId: frame.toolCallId,
				toolName: frame.toolName,
				result: normalizeFixtureValue(frame.result, fixture),
				isError: frame.isError,
				phases: frame.phases,
			});
		}
	}
	return observations;
}

function normalizeRetryFrame(frame: JsonFrame): Readonly<Record<string, unknown>> {
	return {
		type: frame.type,
		attempt: frame.attempt,
		...(frame.type === "auto_retry_start"
			? { maxAttempts: frame.maxAttempts, delayMs: frame.delayMs }
			: { success: frame.success, finalError: frame.finalError }),
	};
}

function normalizeFixtureValue(value: unknown, fixture: AgentRpcFixture): unknown {
	if (typeof value === "string") {
		let normalized = value;
		let index = normalized.toLowerCase().indexOf(fixture.root.toLowerCase());
		while (index >= 0) {
			normalized = `${normalized.slice(0, index)}<fixture-root>${normalized.slice(index + fixture.root.length)}`;
			index = normalized.toLowerCase().indexOf(fixture.root.toLowerCase());
		}
		return normalized;
	}
	if (Array.isArray(value)) return value.map((entry) => normalizeFixtureValue(entry, fixture));
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeFixtureValue(entry, fixture)]));
}

function readLastUserInput(input: readonly unknown[] | undefined): unknown {
	if (!input) return undefined;
	for (let index = input.length - 1; index >= 0; index -= 1) {
		const entry = input[index];
		if (typeof entry === "object" && entry !== null && Reflect.get(entry, "role") === "user") return entry;
	}
	return undefined;
}

function readProviderToolNames(tools: readonly unknown[] | undefined): readonly string[] {
	return (tools ?? []).flatMap((tool) => {
		if (typeof tool !== "object" || tool === null) return [];
		const name = Reflect.get(tool, "name");
		return typeof name === "string" ? [name] : [];
	});
}

function readSessionId(stdout: string): string {
	const header = readSessionHeader(stdout);
	if (typeof header !== "object" || header === null || typeof Reflect.get(header, "id") !== "string") {
		throw new Error("Expected Print JSON header to contain a Session id");
	}
	return Reflect.get(header, "id");
}

function readFrameType(frame: unknown): string | undefined {
	if (typeof frame !== "object" || frame === null) return undefined;
	const type = Reflect.get(frame, "type");
	return typeof type === "string" ? type : undefined;
}

async function buildAgentCliExecutable(): Promise<AgentCliExecutable> {
	const directory = await mkdtemp(join(tmpdir(), "vetta-agent-cli-executable-"));
	const path = join(directory, process.platform === "win32" ? "vetta-agent.exe" : "vetta-agent");
	const platformTag = `${process.platform}-${process.arch}` as keyof typeof compileTargetByPlatform;
	const compileTarget = compileTargetByPlatform[platformTag];
	if (!compileTarget) throw new Error(`Unsupported Print artifact test platform: ${platformTag}`);
	try {
		await runCommand(
			"bun",
			[compileScriptPath, "--entry", "agent", "--target", compileTarget, "--outfile", path],
			repositoryRoot,
		);
		if (process.platform !== "win32") await chmod(path, 0o755);
		return {
			path,
			dispose: () => rm(directory, { force: true, recursive: true }),
		};
	} catch (error) {
		await rm(directory, { force: true, recursive: true });
		throw error;
	}
}

async function runCommand(command: string, args: readonly string[], cwd: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`Command failed with code ${code}, signal ${signal}\n${stderr}`));
		});
	});
}

const TEST_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
