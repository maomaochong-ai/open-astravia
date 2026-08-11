import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
	type AgentRpcFixture,
	AgentRpcProcess,
	createAgentRpcFixture,
	type RpcFrame,
	readSessionFile,
	readSessionId,
} from "./support/agent-rpc-test-process.js";
import {
	LEGACY_EXECUTION_MARKERS,
	readLegacyExecutionContextObservations,
	writeLegacyExecutionContextExtension,
	writeLegacyExecutionSessionFixture,
} from "./support/legacy-session-execution-fixture.js";
import {
	type OpenAiResponsesTestServer,
	type ProviderRequest,
	startOpenAiResponsesTestServer,
	textResponseEvents,
	toolCallResponseEvents,
} from "./support/openai-responses-test-server.js";

const READ_PROMPT = "INSTALLED_ARTIFACT_READ_PROMPT";
const MCP_PROMPT = "INSTALLED_ARTIFACT_MCP_PROMPT";
const SKILL_MARKER = "INSTALLED_ARTIFACT_SKILL_MARKER";
const MCP_DESCRIPTION = "Installed artifact MCP restart canary";
const MCP_RESULT = "INSTALLED_MCP_RESULT:restart";
const FILE_CONTENT = "installed artifact file content";
const MCP_TOOL_NAME = "mcp_installed_canary_echo";
const DYNAMIC_SKILL_V1 = "INSTALLED_ARTIFACT_DYNAMIC_SKILL_V1";
const DYNAMIC_SKILL_V2 = "INSTALLED_ARTIFACT_DYNAMIC_SKILL_V2";
const RPC_BASH_MARKER = "INSTALLED_ARTIFACT_GREENFIELD_RPC_BASH";
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const compileScriptPath = fileURLToPath(new URL("../scripts/compile-standalone.mjs", import.meta.url));
const compileTargetByPlatform = {
	"darwin-arm64": "bun-darwin-arm64",
	"darwin-x64": "bun-darwin-x64",
	"linux-arm64": "bun-linux-arm64",
	"linux-x64": "bun-linux-x64",
	"win32-x64": "bun-windows-x64",
} as const;

const MetafileSchema = z
	.object({
		outputs: z.record(
			z.string(),
			z
				.object({
					imports: z
						.array(
							z
								.object({
									external: z.boolean().optional(),
									kind: z.string(),
									path: z.string(),
								})
								.loose(),
						)
						.default([]),
				})
				.loose(),
		),
	})
	.loose();

const NativeConversationSeedSchema = z
	.object({
		recordType: z.literal("conversation.seed"),
		entries: z.array(z.object({ id: z.string(), type: z.string() }).loose()),
	})
	.loose();

interface InstalledCliArtifact {
	readonly binaryPath: string;
	readonly buildMetafilePath: string;
	readonly installDir: string;
	readonly root: string;
	dispose(): Promise<void>;
}

let artifact: InstalledCliArtifact;
let activeProcess: AgentRpcProcess | undefined;
let fixture: AgentRpcFixture | undefined;
let providerServer: OpenAiResponsesTestServer | undefined;

beforeAll(async () => {
	artifact = await buildInstalledCliArtifact();
}, 120_000);

afterAll(async () => {
	await artifact.dispose();
});

afterEach(async () => {
	await activeProcess?.close();
	activeProcess = undefined;
	await fixture?.dispose();
	fixture = undefined;
	await providerServer?.dispose();
	providerServer = undefined;
});

describe("installed standalone CLI artifact", () => {
	it("preserves the exact im-claw Provider frame through the production entry", async () => {
		await expectStandaloneArtifact(artifact);

		providerServer = await startOpenAiResponsesTestServer(() => ({
			kind: "events",
			events: textResponseEvents("Installed im-claw Provider frame captured."),
		}));
		fixture = await createAgentRpcFixture({ baseUrl: providerServer.baseUrl });
		activeProcess = startInstalledCli(artifact.binaryPath, fixture, createIsolatedArtifactEnv(fixture), {
			hostProfile: "im-claw",
			noSkills: true,
		});
		const mark = activeProcess.mark();
		await activeProcess.request("installed-frame", "prompt", {
			message: "Capture the installed im-claw Provider frame",
		});
		await activeProcess.waitFor((frame) => frame.type === "agent_end", mark, 30_000);
		expect(providerServer.requests).toHaveLength(1);
		const request = providerServer.requests[0];
		if (!request) throw new Error("Expected installed im-claw Provider request");
		const observation: InstalledFrameObservation = {
			provider: observableProviderRequest(request.body, fixture),
			runtime: observeRuntimeFrames(activeProcess.framesSince(mark)),
		};
		expect(providerToolNames(observation.provider)).toEqual(expect.arrayContaining(["read", "im_send_attachment"]));
		expect(observation.runtime).toMatchObject({
			lifecycle: ["agent_start", "turn_start", "turn_end", "agent_end"],
			finalText: "Installed im-claw Provider frame captured.",
		});
	}, 120_000);

	it("defaults ordinary RPC to the full production profile across installed executable restarts", async () => {
		await expectStandaloneArtifact(artifact);

		providerServer = await startOpenAiResponsesTestServer(() => ({
			kind: "events",
			events: textResponseEvents("Installed ordinary RPC compaction summary."),
		}));
		fixture = await createAgentRpcFixture({ baseUrl: providerServer.baseUrl });
		const isolatedEnv = createIsolatedArtifactEnv(fixture);
		const exportPath = join(fixture.root, "installed-greenfield-rpc.html");
		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, { noSkills: true });

		const initialState = await activeProcess.request("installed-default-state", "get_state");
		const sessionFile = readSessionFile(initialState);
		const sessionId = readSessionId(initialState);
		const ownershipLock = `${sessionFile}.owner.lock`;
		expect(existsSync(ownershipLock)).toBe(true);
		await expect(activeProcess.request("installed-models", "get_available_models")).resolves.toMatchObject({
			data: { models: [expect.objectContaining({ provider: "test", id: "test-model" })] },
		});
		await expect(
			activeProcess.request("installed-model", "set_model", { provider: "test", modelId: "test-model" }),
		).resolves.toMatchObject({ success: true });
		await expect(
			activeProcess.request("installed-thinking", "set_thinking_level", { level: "high" }),
		).resolves.toMatchObject({ success: true });
		await expect(
			activeProcess.request("installed-steering", "set_steering_mode", { mode: "one-at-a-time" }),
		).resolves.toMatchObject({ success: true });
		await expect(
			activeProcess.request("installed-follow-up", "set_follow_up_mode", { mode: "all" }),
		).resolves.toMatchObject({ success: true });
		await expect(
			activeProcess.request("installed-retry", "set_auto_retry", { enabled: false }),
		).resolves.toMatchObject({ success: true });
		await expect(
			activeProcess.request("installed-auto-compact", "set_auto_compaction", { enabled: false }),
		).resolves.toMatchObject({ success: true });
		await expect(
			activeProcess.request("installed-name", "set_session_name", { name: "installed-neutral-rpc" }),
		).resolves.toMatchObject({ success: true });
		await expect(
			activeProcess.request("installed-bash", "bash", { command: installedOutputCommand(RPC_BASH_MARKER) }),
		).resolves.toMatchObject({
			success: true,
			data: { output: expect.stringContaining(RPC_BASH_MARKER), exitCode: 0, cancelled: false },
		});
		await expect(activeProcess.request("installed-messages", "get_messages")).resolves.toMatchObject({
			data: {
				messages: [
					expect.objectContaining({
						role: "bashExecution",
						command: expect.stringContaining(RPC_BASH_MARKER),
					}),
				],
			},
		});
		await expect(activeProcess.request("installed-stats", "get_session_stats")).resolves.toMatchObject({
			data: { sessionId, totalMessages: expect.any(Number) },
		});
		await expect(
			activeProcess.request("installed-export", "export_html", { outputPath: exportPath }),
		).resolves.toMatchObject({ success: true, data: { path: exportPath } });
		await expect(stat(exportPath)).resolves.toMatchObject({ size: expect.any(Number) });
		expect(activeProcess.stderr).not.toContain("requested=");

		await expect(activeProcess.close()).resolves.toBe(0);
		activeProcess = undefined;
		await expect(stat(ownershipLock)).rejects.toMatchObject({ code: "ENOENT" });

		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, {
			noSkills: true,
			extraArgs: ["--session", sessionFile],
		});
		await expect(activeProcess.request("installed-resumed-state", "get_state")).resolves.toMatchObject({
			data: {
				sessionId,
				sessionFile,
				sessionName: "installed-neutral-rpc",
			},
		});
		await expect(activeProcess.request("installed-resumed-messages", "get_messages")).resolves.toMatchObject({
			data: {
				messages: [
					expect.objectContaining({
						role: "bashExecution",
						command: expect.stringContaining(RPC_BASH_MARKER),
					}),
				],
			},
		});
		await expect(activeProcess.request("installed-compact", "compact")).resolves.toMatchObject({ success: true });
		await expect(activeProcess.request("installed-memory-disabled", "flush_memory")).resolves.toMatchObject({
			success: true,
			data: { written: 0 },
		});
		await expect(activeProcess.close()).resolves.toBe(0);
		activeProcess = undefined;
		await expect(stat(ownershipLock)).rejects.toMatchObject({ code: "ENOENT" });
	}, 120_000);

	it("loads host capabilities and resumes one conversation across two executable processes", async () => {
		await expectStandaloneArtifact(artifact);

		let workspaceFilePath = "";
		providerServer = await startOpenAiResponsesTestServer((request) => {
			if (request.rawBody.includes(MCP_PROMPT)) {
				return request.rawBody.includes(MCP_RESULT)
					? { kind: "events", events: textResponseEvents("MCP completed after restart.") }
					: {
							kind: "events",
							events: toolCallResponseEvents(MCP_TOOL_NAME, { value: "restart" }, { callId: "call_mcp" }),
						};
			}
			if (request.rawBody.includes(READ_PROMPT)) {
				return request.rawBody.includes(FILE_CONTENT)
					? { kind: "events", events: textResponseEvents("Read completed before restart.") }
					: {
							kind: "events",
							events: toolCallResponseEvents("read", { path: workspaceFilePath }, { callId: "call_read" }),
						};
			}
			throw new Error(`Unexpected installed-artifact Provider request: ${request.rawBody}`);
		});

		fixture = await createAgentRpcFixture({ baseUrl: providerServer.baseUrl });
		workspaceFilePath = join(fixture.workspace, "installed-artifact.txt");
		await writeFile(workspaceFilePath, FILE_CONTENT, "utf8");
		const skillPath = await writeInstalledSkill(fixture);
		await writeInstalledMcpServer(fixture);
		const isolatedEnv = createIsolatedArtifactEnv(fixture);
		expect(isOutside(repositoryRoot, artifact.binaryPath)).toBe(true);
		expect(isOutside(repositoryRoot, fixture.workspace)).toBe(true);
		expect(
			Object.values(isolatedEnv).some(
				(value) => typeof value === "string" && value.toLowerCase().includes(repositoryRoot.toLowerCase()),
			),
		).toBe(false);

		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, { skillPath });
		const initialState = await activeProcess.request("installed-state-a", "get_state");
		const sessionFile = readSessionFile(initialState);
		const sessionId = readSessionId(initialState);
		const ownershipLock = `${sessionFile}.owner.lock`;
		expect(existsSync(ownershipLock)).toBe(true);

		const firstTurnMark = activeProcess.mark();
		await activeProcess.request("installed-read", "prompt", {
			message: `${READ_PROMPT}: read installed-artifact.txt`,
		});
		await activeProcess.waitFor((frame) => frame.type === "agent_end", firstTurnMark, 30_000);
		expect(providerServer.requests).toHaveLength(2);
		expect(providerServer.requests[0]?.rawBody).toContain(SKILL_MARKER);
		expect(readToolDescription(providerServer.requests[0]?.body.tools, "read")).not.toBe("");
		expect(JSON.stringify(providerServer.requests[1]?.body.input)).toContain(FILE_CONTENT);
		expect(
			activeProcess
				.framesSince(firstTurnMark)
				.some(
					(frame) => frame.type === "tool_execution_end" && frame.toolName === "read" && frame.isError !== true,
				),
		).toBe(true);

		await expect(activeProcess.close()).resolves.toBe(0);
		activeProcess = undefined;
		await expect(stat(ownershipLock)).rejects.toMatchObject({ code: "ENOENT" });

		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, {
			skillPath,
			extraArgs: ["--session", sessionFile],
		});
		const resumedState = await activeProcess.request("installed-state-b", "get_state");
		expect(readSessionFile(resumedState)).toBe(sessionFile);
		expect(readSessionId(resumedState)).toBe(sessionId);
		expect(existsSync(ownershipLock)).toBe(true);

		const secondTurnMark = activeProcess.mark();
		await activeProcess.request("installed-mcp", "prompt", {
			message: `${MCP_PROMPT}: call the installed canary with restart`,
		});
		await activeProcess.waitFor((frame) => frame.type === "agent_end", secondTurnMark, 30_000);
		expect(providerServer.requests).toHaveLength(4);
		expect(readToolDescription(providerServer.requests[2]?.body.tools, MCP_TOOL_NAME)).toBe(MCP_DESCRIPTION);
		expect(providerServer.requests[2]?.rawBody).toContain(SKILL_MARKER);
		expect(JSON.stringify(providerServer.requests[3]?.body.input)).toContain(MCP_RESULT);
		expect(
			activeProcess
				.framesSince(secondTurnMark)
				.some(
					(frame) =>
						frame.type === "tool_execution_end" && frame.toolName === MCP_TOOL_NAME && frame.isError !== true,
				),
		).toBe(true);

		await expect(activeProcess.close()).resolves.toBe(0);
		activeProcess = undefined;
		await expect(stat(ownershipLock)).rejects.toMatchObject({ code: "ENOENT" });
		const conversation = await readFile(sessionFile, "utf8");
		expect(conversation).toContain(READ_PROMPT);
		expect(conversation).toContain("Read completed before restart.");
		expect(conversation).toContain(MCP_PROMPT);
		expect(conversation).toContain("MCP completed after restart.");
	}, 120_000);

	it("keeps one terminal outcome and recovers after Provider failure in the installed executable", async () => {
		await expectStandaloneArtifact(artifact);

		providerServer = await startOpenAiResponsesTestServer((_request, index) => {
			if (index === 0) return { kind: "http-error", status: 400, body: "installed Provider failure" };
			return {
				kind: "events",
				events: textResponseEvents(index === 1 ? "Installed process recovered." : "Installed restart recovered."),
			};
		});
		fixture = await createAgentRpcFixture({ baseUrl: providerServer.baseUrl });
		const isolatedEnv = createIsolatedArtifactEnv(fixture);
		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, { noSkills: true });

		const failureMark = activeProcess.mark();
		await activeProcess.request("installed-provider-failure", "prompt", { message: "Trigger installed failure" });
		await activeProcess.waitFor((frame) => frame.type === "agent_end", failureMark, 30_000);
		const failedState = await activeProcess.request("installed-state-after-failure", "get_state");
		expect(failedState.data?.isStreaming).toBe(false);
		expect(
			activeProcess.framesSince(failureMark).filter((frame) => {
				if (frame.type === "agent_end") return true;
				return frame.type === "response" && frame.command === "prompt" && frame.success === false;
			}),
		).toHaveLength(1);

		await promptInstalledTurn(activeProcess, "installed-same-process-recovery", "Recover installed process");
		const sessionFile = readSessionFile(await activeProcess.request("installed-state-before-restart", "get_state"));
		await expect(activeProcess.close()).resolves.toBe(0);
		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, {
			noSkills: true,
			extraArgs: ["--session", sessionFile],
		});
		await promptInstalledTurn(activeProcess, "installed-restart-recovery", "Recover installed restart");
		expect(providerServer.requests).toHaveLength(3);
	}, 120_000);

	it("interrupts an active turn and transfers session ownership in the installed executable", async () => {
		await expectStandaloneArtifact(artifact);

		providerServer = await startOpenAiResponsesTestServer((_request, index) => {
			if (index === 0) {
				return {
					kind: "hold",
					events: textResponseEvents("Installed partial turn before session transition.").slice(0, 3),
				};
			}
			return {
				kind: "events",
				events: textResponseEvents(
					index === 1
						? "Installed process recovered after transition."
						: "Installed restart recovered after transition.",
				),
			};
		});
		fixture = await createAgentRpcFixture({ baseUrl: providerServer.baseUrl });
		const isolatedEnv = createIsolatedArtifactEnv(fixture);
		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, { noSkills: true });
		const sourcePath = readSessionFile(await activeProcess.request("installed-transition-source", "get_state"));
		const sourceOwnershipLock = `${sourcePath}.owner.lock`;
		expect(existsSync(sourceOwnershipLock)).toBe(true);

		const heldTurnMark = activeProcess.mark();
		await activeProcess.request("installed-transition-held-prompt", "prompt", {
			message: "Hold installed turn before new session",
		});
		await activeProcess.waitFor((frame) => frame.type === "message_update", heldTurnMark, 30_000);
		await activeProcess.request("installed-transition-new-session", "new_session");
		await providerServer.waitForHeldRequestClosed(5_000);

		const transitionedState = await activeProcess.request("installed-transition-target", "get_state");
		const targetPath = readSessionFile(transitionedState);
		const targetOwnershipLock = `${targetPath}.owner.lock`;
		expect(targetPath).not.toBe(sourcePath);
		expect(transitionedState.data?.isStreaming).toBe(false);
		expect(existsSync(sourceOwnershipLock)).toBe(false);
		expect(existsSync(targetOwnershipLock)).toBe(true);
		expect(activeProcess.framesSince(heldTurnMark).filter((frame) => frame.type === "agent_end")).toEqual([]);

		await promptInstalledTurn(
			activeProcess,
			"installed-transition-same-process-recovery",
			"Recover installed process after transition",
		);
		await expect(activeProcess.close()).resolves.toBe(0);
		activeProcess = undefined;
		await expect(stat(targetOwnershipLock)).rejects.toMatchObject({ code: "ENOENT" });

		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, {
			noSkills: true,
			extraArgs: ["--session", targetPath],
		});
		const resumedState = await activeProcess.request("installed-transition-resumed-state", "get_state");
		expect(readSessionFile(resumedState)).toBe(targetPath);
		expect(existsSync(targetOwnershipLock)).toBe(true);
		await promptInstalledTurn(
			activeProcess,
			"installed-transition-restart-recovery",
			"Recover installed restart after transition",
		);
		expect(providerServer.requests).toHaveLength(3);
	}, 120_000);

	it("drains an accepted session transition before installed transport cleanup", async () => {
		await expectStandaloneArtifact(artifact);

		providerServer = await startOpenAiResponsesTestServer(() => ({
			kind: "hold",
			events: textResponseEvents("Installed partial turn before transport cleanup.").slice(0, 3),
		}));
		fixture = await createAgentRpcFixture({ baseUrl: providerServer.baseUrl });
		activeProcess = startInstalledCli(artifact.binaryPath, fixture, createIsolatedArtifactEnv(fixture), {
			noSkills: true,
		});
		await activeProcess.request("installed-cleanup-source-state", "get_state");

		const heldTurnMark = activeProcess.mark();
		await activeProcess.request("installed-cleanup-held-prompt", "prompt", {
			message: "Hold installed turn before transport cleanup",
		});
		await activeProcess.waitFor((frame) => frame.type === "message_update", heldTurnMark, 30_000);
		const transitionMark = activeProcess.mark();
		activeProcess.send({ id: "installed-cleanup-new-session", type: "new_session" });
		await expect(activeProcess.close()).resolves.toBe(0);
		await providerServer.waitForHeldRequestClosed(5_000);

		expect(
			activeProcess
				.framesSince(transitionMark)
				.filter(
					(frame) =>
						frame.type === "response" &&
						frame.id === "installed-cleanup-new-session" &&
						frame.command === "new_session" &&
						frame.success === true,
				),
		).toHaveLength(1);
		expect(providerServer.requests).toHaveLength(1);
		expect(
			(await readdir(fixture.conversationDir)).filter(
				(name) => name.endsWith(".lock") || name.endsWith(".owner.lock"),
			),
		).toEqual([]);
		activeProcess = undefined;
	}, 120_000);

	it("cancels an accepted memory flush before installed transport cleanup", async () => {
		await expectStandaloneArtifact(artifact);

		providerServer = await startOpenAiResponsesTestServer((_request, index) =>
			index === 0 ? { kind: "events", events: textResponseEvents("Installed memory flush seed") } : { kind: "hold" },
		);
		fixture = await createAgentRpcFixture({ baseUrl: providerServer.baseUrl });
		const memoryFile = join(fixture.workspace, "MEMORY.md");
		await writeFile(memoryFile, "# Memory\n", "utf8");
		activeProcess = startInstalledCli(artifact.binaryPath, fixture, createIsolatedArtifactEnv(fixture), {
			noSkills: true,
			extraArgs: ["--memory-mode", "--memory-file", memoryFile],
		});
		await promptInstalledTurn(activeProcess, "installed-memory-close-seed", "Seed installed memory flush context");

		const flushMark = activeProcess.mark();
		activeProcess.send({ id: "installed-memory-close-flush", type: "flush_memory" });
		await providerServer.waitForHeldRequestStarted(5_000);
		await expect(activeProcess.close()).resolves.toBe(0);
		await providerServer.waitForHeldRequestClosed(5_000);

		expect(providerServer.requests).toHaveLength(2);
		expect(
			activeProcess
				.framesSince(flushMark)
				.filter(
					(frame) =>
						frame.type === "response" &&
						frame.id === "installed-memory-close-flush" &&
						frame.command === "flush_memory" &&
						frame.success === true,
				),
		).toHaveLength(1);
		expect(
			(await readdir(fixture.conversationDir)).filter(
				(name) => name.endsWith(".lock") || name.endsWith(".owner.lock"),
			),
		).toEqual([]);
		activeProcess = undefined;
	}, 120_000);

	it("quiets installed background work before publishing a new Session identity", async () => {
		await expectStandaloneArtifact(artifact);

		providerServer = await startOpenAiResponsesTestServer((_request, index) =>
			index === 0
				? {
						kind: "events",
						events: toolCallResponseEvents(process.platform === "win32" ? "shell" : "bash", {
							command: installedHeldProcessCommand("installed-background.pid"),
							run_in_background: true,
						}),
					}
				: {
						kind: "events",
						events: textResponseEvents(
							index === 1 ? "Installed background task started." : "Installed recovered.",
						),
					},
		);
		fixture = await createAgentRpcFixture({ baseUrl: providerServer.baseUrl });
		activeProcess = startInstalledCli(artifact.binaryPath, fixture, createIsolatedArtifactEnv(fixture), {
			noSkills: true,
		});
		const sourceState = await activeProcess.request("installed-background-source", "get_state");
		const sourcePath = readSessionFile(sourceState);

		await promptInstalledTurn(activeProcess, "installed-background-close", "Start the installed background task");
		const pid = await waitForInstalledPid(join(fixture.workspace, "installed-background.pid"));
		expect(isProcessAlive(pid)).toBe(true);

		await activeProcess.request("installed-background-new-session", "new_session");
		const targetPath = readSessionFile(await activeProcess.request("installed-background-target", "get_state"));
		expect(targetPath).not.toBe(sourcePath);
		expect(isProcessAlive(pid)).toBe(false);
		expect(existsSync(`${sourcePath}.owner.lock`)).toBe(false);
		expect(existsSync(`${targetPath}.owner.lock`)).toBe(true);
		await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 200));
		expect(providerServer.requests).toHaveLength(2);

		await promptInstalledTurn(
			activeProcess,
			"installed-background-recovery",
			"Continue in the installed new session",
		);
		expect(providerServer.requests).toHaveLength(3);
		await expect(activeProcess.close()).resolves.toBe(0);
		expect(
			(await readdir(fixture.conversationDir)).filter(
				(name) => name.endsWith(".lock") || name.endsWith(".owner.lock"),
			),
		).toEqual([]);
		activeProcess = undefined;
	}, 120_000);

	it("settles an installed prompt waiting on host_response before transport exit", async () => {
		await expectStandaloneArtifact(artifact);

		let attachmentPath = "";
		providerServer = await startOpenAiResponsesTestServer(() => ({
			kind: "events",
			events: toolCallResponseEvents("im_send_attachment", {
				description: "Send installed artifact before close",
				path: attachmentPath,
				kind: "file",
			}),
		}));
		fixture = await createAgentRpcFixture({ baseUrl: providerServer.baseUrl });
		attachmentPath = join(fixture.workspace, "installed-bridge-close.txt");
		await writeFile(attachmentPath, "installed bridge close", "utf8");
		activeProcess = startInstalledCli(artifact.binaryPath, fixture, createIsolatedArtifactEnv(fixture), {
			hostProfile: "im-claw",
			noSkills: true,
		});
		await activeProcess.request("installed-host-close-state", "get_state");

		const mark = activeProcess.mark();
		await activeProcess.request("installed-host-close-prompt", "prompt", {
			message: "Send installed-bridge-close.txt",
		});
		await activeProcess.waitFor((frame) => frame.type === "host_request", mark, 30_000);
		await expect(activeProcess.close()).resolves.toBe(0);
		const frames = activeProcess.framesSince(mark);

		expect(providerServer.requests).toHaveLength(1);
		expect(frames.filter((frame) => frame.type === "host_request")).toHaveLength(1);
		expect(
			frames.filter(
				(frame) =>
					frame.type === "response" && frame.id === "installed-host-close-prompt" && frame.command === "prompt",
			),
		).toEqual([expect.objectContaining({ success: true })]);
		expect(
			frames.filter(
				(frame) =>
					frame.type === "agent_end" ||
					(frame.type === "response" && frame.command === "prompt" && frame.success === false),
			),
		).toEqual([]);
		expect(
			(await readdir(fixture.conversationDir)).filter(
				(name) => name.endsWith(".lock") || name.endsWith(".owner.lock"),
			),
		).toEqual([]);
		activeProcess = undefined;
	}, 120_000);

	it("applies runtime Skill and MCP changes without rebuilding the installed session", async () => {
		await expectStandaloneArtifact(artifact);

		providerServer = await startOpenAiResponsesTestServer((_request, index) => ({
			kind: "events",
			events: textResponseEvents(`Installed dynamic capability turn ${index}.`),
		}));
		fixture = await createAgentRpcFixture({ baseUrl: providerServer.baseUrl });
		const isolatedEnv = createIsolatedArtifactEnv(fixture);
		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv);
		const initialState = await activeProcess.request("installed-dynamic-state-before", "get_state");
		const sessionFile = readSessionFile(initialState);
		const sessionId = readSessionId(initialState);
		const ownershipLock = `${sessionFile}.owner.lock`;

		await promptInstalledTurn(activeProcess, "installed-dynamic-empty", "Observe empty dynamic capabilities");
		const initialRequest = providerServer.requests.at(-1);
		expect(initialRequest?.rawBody).not.toContain(DYNAMIC_SKILL_V1);
		expect(readToolDescription(initialRequest?.body.tools, MCP_TOOL_NAME)).toBe("");

		const skillDirectory = join(fixture.workspace, ".vetta", "skills", "installed-dynamic");
		const skillPath = join(skillDirectory, "SKILL.md");
		await mkdir(skillDirectory, { recursive: true });
		await writeFile(skillPath, dynamicSkillDocument(DYNAMIC_SKILL_V1), "utf8");
		await promptInstalledTurn(activeProcess, "installed-dynamic-skill-v1", "Observe dynamic Skill v1");
		const versionOneRequest = providerServer.requests.at(-1);
		expect(versionOneRequest?.rawBody).toContain(DYNAMIC_SKILL_V1);
		expect(versionOneRequest?.rawBody).not.toContain(DYNAMIC_SKILL_V2);

		await writeFile(skillPath, dynamicSkillDocument(DYNAMIC_SKILL_V2), "utf8");
		await promptInstalledTurn(activeProcess, "installed-dynamic-skill-v2", "Observe dynamic Skill v2");
		const versionTwoRequest = providerServer.requests.at(-1);
		expect(versionTwoRequest?.rawBody).not.toContain(DYNAMIC_SKILL_V1);
		expect(versionTwoRequest?.rawBody).toContain(DYNAMIC_SKILL_V2);

		await writeInstalledMcpServer(fixture);
		await promptInstalledTurn(activeProcess, "installed-dynamic-mcp-added", "Observe added MCP capability");
		const mcpAddedRequest = providerServer.requests.at(-1);
		expect(readToolDescription(mcpAddedRequest?.body.tools, MCP_TOOL_NAME)).toBe(MCP_DESCRIPTION);

		await Promise.all([
			rm(skillDirectory, { force: true, recursive: true }),
			writeFile(join(fixture.agentDir, "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf8"),
		]);
		await promptInstalledTurn(activeProcess, "installed-dynamic-removed", "Observe removed dynamic capabilities");
		const removedRequest = providerServer.requests.at(-1);
		expect(removedRequest?.rawBody).not.toContain(DYNAMIC_SKILL_V1);
		expect(removedRequest?.rawBody).not.toContain(DYNAMIC_SKILL_V2);
		expect(readToolDescription(removedRequest?.body.tools, MCP_TOOL_NAME)).toBe("");

		const finalState = await activeProcess.request("installed-dynamic-state-after", "get_state");
		expect(readSessionId(finalState)).toBe(sessionId);
		expect(readSessionFile(finalState)).toBe(sessionFile);
		await expect(activeProcess.close()).resolves.toBe(0);
		activeProcess = undefined;
		await expect(stat(ownershipLock)).rejects.toMatchObject({ code: "ENOENT" });
	}, 120_000);

	it("migrates and continues an official Legacy session through installed executable restarts", async () => {
		await expectStandaloneArtifact(artifact);

		providerServer = await startOpenAiResponsesTestServer((request) => ({
			kind: "events",
			events: textResponseEvents(
				request.rawBody.includes("installed-migrated-second")
					? "Installed migrated second response."
					: "Installed migrated first response.",
			),
		}));
		fixture = await createAgentRpcFixture({ baseUrl: providerServer.baseUrl });
		const legacySession = await writeLegacyExecutionSessionFixture(fixture);
		const extension = await writeLegacyExecutionContextExtension(fixture);
		const isolatedEnv = createIsolatedArtifactEnv(fixture);
		activeProcess = startInstalledCli(artifact.binaryPath, fixture, createIsolatedArtifactEnv(fixture), {
			extraArgs: ["--extension", extension.path, "--session", legacySession.sourcePath],
		});

		const state = await activeProcess.request("installed-migration-state", "get_state");
		expect(state).toMatchObject({
			data: {
				sessionId: expect.stringMatching(/^legacy-import-/),
				sessionFile: expect.stringMatching(/\.conversation\.jsonl$/),
			},
		});
		const migratedSessionPath = readSessionFile(state);
		const migratedSessionId = readSessionId(state);
		expect(migratedSessionPath).not.toBe(legacySession.sourcePath);

		await promptInstalledTurn(activeProcess, "installed-migrated-first", "installed-migrated-first");
		expect(providerServer.requests).toHaveLength(1);
		const firstProviderInput = providerServer.requests[0]?.rawBody ?? "";
		expect(firstProviderInput).toContain(LEGACY_EXECUTION_MARKERS.compactionSummary);
		expect(firstProviderInput).toContain(LEGACY_EXECUTION_MARKERS.visibleBash);
		expect(firstProviderInput).toContain(LEGACY_EXECUTION_MARKERS.visibleCustom);
		expect(firstProviderInput).toContain(LEGACY_EXECUTION_MARKERS.branchSummary);
		expect(firstProviderInput).toContain(LEGACY_EXECUTION_MARKERS.tail);
		expect(firstProviderInput).not.toContain(LEGACY_EXECUTION_MARKERS.abandonedBranch);
		expect(firstProviderInput).not.toContain(LEGACY_EXECUTION_MARKERS.pruned);
		expect(firstProviderInput).not.toContain(LEGACY_EXECUTION_MARKERS.hiddenBash);
		expect(firstProviderInput).not.toContain(LEGACY_EXECUTION_MARKERS.hiddenCustom);
		await expect(activeProcess.close()).resolves.toBe(0);
		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, {
			extraArgs: ["--extension", extension.path, "--session", migratedSessionPath],
		});
		const resumedState = await activeProcess.request("installed-migration-resumed-state", "get_state");
		expect(readSessionFile(resumedState)).toBe(migratedSessionPath);
		expect(readSessionId(resumedState)).toBe(migratedSessionId);
		await promptInstalledTurn(activeProcess, "installed-migrated-second", "installed-migrated-second");
		expect(providerServer.requests).toHaveLength(2);
		expect(providerServer.requests[1]?.rawBody).toContain("Installed migrated first response.");

		expect(await readFile(legacySession.sourcePath, "utf8")).toBe(legacySession.content);
		expect(
			(await readdir(fixture.conversationDir)).filter((name) => name.endsWith(".conversation.jsonl")),
		).toHaveLength(1);
		const migratedContent = await readFile(migratedSessionPath, "utf8");
		expect(migratedContent).toContain("vetta.legacy_agent_message");
		expect(migratedContent).toContain('"role":"bashExecution"');
		expect(migratedContent).toContain("installed-migrated-first");
		expect(migratedContent).toContain("installed-migrated-second");
		const contextObservations = await readLegacyExecutionContextObservations(extension);
		expect(contextObservations.map(({ call }) => call)).toEqual([1, 1]);
		expect(contextObservations[0]?.identities).toEqual(
			expect.arrayContaining([
				"compactionSummary",
				"bashExecution",
				"custom:legacy-visible-context",
				"custom:prompt_resource_reference",
				"branchSummary",
			]),
		);
		expect(contextObservations[0]?.observed).toContain(LEGACY_EXECUTION_MARKERS.hiddenBash);
		expect(contextObservations[0]?.observed).toContain(LEGACY_EXECUTION_MARKERS.hiddenCustom);
		expect(activeProcess.stderr).not.toContain("sessionMigration=");
		await expect(activeProcess.close()).resolves.toBe(0);
		activeProcess = undefined;
	}, 120_000);

	it("fails closed for an unrepresentable Legacy session in the installed executable", async () => {
		await expectStandaloneArtifact(artifact);

		fixture = await createAgentRpcFixture();
		const legacySession = join(fixture.conversationDir, "installed-legacy-unknown.jsonl");
		const legacyContent = `${JSON.stringify({
			type: "session",
			version: 3,
			id: "installed-legacy-unknown",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: fixture.workspace,
		})}\n${JSON.stringify({
			type: "future_entry",
			id: "future-1",
			parentId: null,
			timestamp: "2026-01-01T00:00:01.000Z",
			secret: "must-not-leak",
		})}\n`;
		await writeFile(legacySession, legacyContent, "utf8");
		activeProcess = startInstalledCli(artifact.binaryPath, fixture, createIsolatedArtifactEnv(fixture), {
			extraArgs: ["--session", legacySession],
		});

		const failure = await activeProcess.waitFor((frame) => frame.type === "response" && frame.command === "startup");
		expect(failure).toMatchObject({
			type: "response",
			command: "startup",
			success: false,
			errorCode: "session_version_unsupported",
			sessionPath: await realpath(legacySession),
			sourceVersion: 3,
			issueCode: "unsupported-record",
			issueCount: 1,
		});
		expect(await readFile(legacySession, "utf8")).toBe(legacyContent);
		expect((await readdir(fixture.conversationDir)).some((name) => name.endsWith(".conversation.jsonl"))).toBe(false);
		await expect(activeProcess.waitForExit()).resolves.toBe(2);
		expect(activeProcess.frames).toEqual([failure]);
		expect(activeProcess.stderr).not.toContain("must-not-leak");
		activeProcess = undefined;
	}, 120_000);

	it("enforces the Extension Profile and explicit incompatibility failure in the installed executable", async () => {
		await expectStandaloneArtifact(artifact);

		fixture = await createAgentRpcFixture();
		const isolatedEnv = createIsolatedArtifactEnv(fixture);
		const commandAuditPath = join(fixture.root, "installed-command-audit.txt");
		const nativeSeedAuditPath = join(fixture.root, "installed-native-seed-audit.jsonl");
		const combinedExtension = await writeInstalledExtension(
			fixture,
			"combined-extension.ts",
			`import { appendFileSync } from "node:fs";
			import { createEventBus as createRootEventBus } from "@vetta/coding-agent";
			import { createEventBus as createExtensionEventBus } from "@vetta/coding-agent/extensions";
			export default function(pi) {
				createRootEventBus().clear();
				createExtensionEventBus().clear();
				pi.on("session_start", async () => {});
				pi.registerCommand("extension-audit", {
					handler: async () => appendFileSync(${JSON.stringify(commandAuditPath)}, "executed", "utf8"),
				});
				pi.registerCommand("native-session-seed", {
					handler: async (_args, ctx) => {
						const result = await ctx.newSession({
							setup(session) {
								appendFileSync(${JSON.stringify(nativeSeedAuditPath)}, JSON.stringify({
									phase: "setup",
									path: session.getSessionFile(),
								}) + "\\n", "utf8");
								session.appendSessionInfo("installed native seed");
								session.appendMessage({
									role: "user",
									content: "installed native setup context",
									timestamp: Date.now(),
								});
							},
						});
						appendFileSync(${JSON.stringify(nativeSeedAuditPath)}, JSON.stringify({
							phase: "result",
							cancelled: result.cancelled,
						}) + "\\n", "utf8");
					},
				});
				pi.registerTool({
					name: "extension_echo",
					label: "Extension Echo",
					description: "Echo a value.",
					parameters: {
						type: "object",
						properties: { value: { type: "string" } },
						required: ["value"],
					},
					async execute(_id, params) {
						return { content: [{ type: "text", text: params.value }], details: {} };
					},
				});
			}`,
		);
		const uiOnlyExtension = await writeInstalledExtension(
			fixture,
			"ui-only-extension.ts",
			`export default function(pi) {
				pi.registerShortcut("ctrl+shift+r", { handler: async () => {} });
				pi.registerMessageRenderer("audit-card", () => null);
				pi.on("user_bash", async () => ({ result: undefined }));
			}`,
		);
		const forwardExtension = await writeInstalledExtension(
			fixture,
			"forward-extension.ts",
			`export default function(pi) {
				pi.on("future_event", async () => {});
			}`,
		);

		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, {
			extraArgs: ["--extension", combinedExtension],
		});
		await expect(activeProcess.request("installed-combined-state", "get_state")).resolves.toMatchObject({
			success: true,
		});
		await activeProcess.request("installed-extension-command", "prompt", { message: "/extension-audit" });
		expect(await readFile(commandAuditPath, "utf8")).toBe("executed");
		const sourceSessionPath = readSessionFile(
			await activeProcess.request("installed-native-seed-source", "get_state"),
		);
		await expect(
			activeProcess.request("installed-native-seed-command", "prompt", { message: "/native-session-seed" }),
		).resolves.toMatchObject({ success: true });
		await waitForInstalledFileText(nativeSeedAuditPath, '"phase":"result","cancelled":false');
		const nativeSeedAudit = (await readFile(nativeSeedAuditPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as unknown);
		expect(nativeSeedAudit).toEqual([
			expect.objectContaining({ phase: "setup", path: expect.stringMatching(/\.conversation\.jsonl$/) }),
			{ phase: "result", cancelled: false },
		]);
		const seededState = await activeProcess.request("installed-native-seed-target", "get_state");
		const seededSessionPath = readSessionFile(seededState);
		expect(seededSessionPath).not.toBe(sourceSessionPath);
		const seededContent = await readFile(seededSessionPath, "utf8");
		const nativeSeed = readNativeConversationSeed(seededContent);
		expect(seededContent).not.toContain('"recordType":"conversation.import.seed"');
		expect(nativeSeed.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "session_info" }),
				expect.objectContaining({ type: "message" }),
			]),
		);
		const seededMessage = nativeSeed.entries.find((entry) => entry.type === "message");
		if (!seededMessage) throw new Error("Expected installed native seed message");
		await expect(activeProcess.close()).resolves.toBe(0);
		activeProcess = undefined;

		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, {
			extraArgs: ["--extension", combinedExtension, "--session", seededSessionPath],
		});
		const resumedSeedState = await activeProcess.request("installed-native-seed-resumed", "get_state");
		expect(readSessionFile(resumedSeedState)).toBe(seededSessionPath);
		await expect(activeProcess.request("installed-native-seed-messages", "get_messages")).resolves.toMatchObject({
			data: {
				messages: [expect.objectContaining({ role: "user", content: "installed native setup context" })],
			},
		});
		await activeProcess.request("installed-native-seed-fork", "fork", { entryId: seededMessage.id });
		const forkedSessionPath = readSessionFile(
			await activeProcess.request("installed-native-seed-fork-state", "get_state"),
		);
		expect(forkedSessionPath).not.toBe(seededSessionPath);
		expect(await readFile(forkedSessionPath, "utf8")).not.toContain('"recordType":"conversation.import.seed"');
		expect(
			(await readdir(fixture.conversationDir)).filter(
				(name) => name.endsWith(".jsonl") && !name.endsWith(".conversation.jsonl"),
			),
		).toEqual([]);
		await expect(activeProcess.close()).resolves.toBe(0);
		activeProcess = undefined;

		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, {
			extraArgs: ["--extension", combinedExtension, "--session", forkedSessionPath],
		});
		const resumedForkState = await activeProcess.request("installed-native-fork-resumed", "get_state");
		expect(readSessionFile(resumedForkState)).toBe(forkedSessionPath);
		await expect(activeProcess.close()).resolves.toBe(0);
		activeProcess = undefined;

		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, {
			extraArgs: ["--extension", uiOnlyExtension],
		});
		await expect(activeProcess.request("installed-ui-state", "get_state")).resolves.toMatchObject({ success: true });
		await expect(activeProcess.close()).resolves.toBe(0);
		activeProcess = undefined;

		activeProcess = startInstalledCli(artifact.binaryPath, fixture, isolatedEnv, {
			extraArgs: ["--extension", forwardExtension],
		});
		const forwardFailure = await activeProcess.waitFor(
			(frame) => frame.type === "response" && frame.command === "startup",
		);
		expect(forwardFailure).toMatchObject({
			type: "response",
			command: "startup",
			success: false,
			errorCode: "extension_incompatible",
			unsupportedEvents: ["future_event"],
			unmetRuntimeCapabilities: ["event-handler"],
		});
		await expect(activeProcess.waitForExit()).resolves.toBe(2);
		expect(activeProcess.frames).toEqual([forwardFailure]);
		activeProcess = undefined;
	}, 120_000);
});

async function buildInstalledCliArtifact(): Promise<InstalledCliArtifact> {
	const root = await mkdtemp(join(tmpdir(), "vetta-installed-cli-artifact-"));
	const buildDir = join(root, "build");
	const installDir = join(root, "install");
	const binaryName = process.platform === "win32" ? "vetta.exe" : "vetta";
	const buildBinaryPath = join(buildDir, binaryName);
	const binaryPath = join(installDir, binaryName);
	const buildMetafilePath = join(buildDir, "metafile.json");
	const platformTag = `${process.platform}-${process.arch}` as keyof typeof compileTargetByPlatform;
	const compileTarget = compileTargetByPlatform[platformTag];
	if (!compileTarget) throw new Error(`Unsupported installed-artifact test platform: ${platformTag}`);
	try {
		await Promise.all([mkdir(buildDir, { recursive: true }), mkdir(installDir, { recursive: true })]);
		await runCommand("bun", [
			compileScriptPath,
			"--target",
			compileTarget,
			"--outfile",
			buildBinaryPath,
			"--metafile",
			buildMetafilePath,
		]);
		await copyFile(buildBinaryPath, binaryPath);
		if (process.platform !== "win32") await chmod(binaryPath, 0o755);
		return {
			binaryPath,
			buildMetafilePath,
			installDir,
			root,
			dispose: () => rm(root, { force: true, recursive: true }),
		};
	} catch (error) {
		await rm(root, { force: true, recursive: true });
		throw error;
	}
}

async function expectStandaloneArtifact(installed: InstalledCliArtifact): Promise<void> {
	expect(await readdir(installed.installDir)).toEqual([process.platform === "win32" ? "vetta.exe" : "vetta"]);
	expect((await stat(installed.binaryPath)).size).toBeGreaterThan(0);
	const metafile = MetafileSchema.parse(JSON.parse(await readFile(installed.buildMetafilePath, "utf8")));
	const externalImports = Object.values(metafile.outputs)
		.flatMap(({ imports }) => imports)
		.filter(({ external }) => external === true);
	expect(externalImports).toEqual([]);
}

function readNativeConversationSeed(content: string): z.infer<typeof NativeConversationSeedSchema> {
	for (const line of content.split(/\r?\n/u)) {
		if (!line.trim()) continue;
		const parsed = NativeConversationSeedSchema.safeParse(JSON.parse(line));
		if (parsed.success) return parsed.data;
	}
	throw new Error("Installed session does not contain a native conversation.seed record");
}

async function writeInstalledSkill(currentFixture: AgentRpcFixture): Promise<string> {
	const skillDir = join(currentFixture.root, "host-skill");
	const skillPath = join(skillDir, "SKILL.md");
	await mkdir(skillDir, { recursive: true });
	await writeFile(
		skillPath,
		[
			"---",
			"name: installed-artifact-skill",
			`description: ${SKILL_MARKER}`,
			"---",
			"",
			"# Installed artifact skill",
			"",
			`Use this host-provided instruction marker: ${SKILL_MARKER}.`,
			"",
		].join("\n"),
		"utf8",
	);
	return skillPath;
}

async function writeInstalledExtension(currentFixture: AgentRpcFixture, name: string, source: string): Promise<string> {
	const extensionPath = join(currentFixture.root, name);
	await writeFile(extensionPath, source, "utf8");
	return extensionPath;
}

async function writeInstalledMcpServer(currentFixture: AgentRpcFixture): Promise<void> {
	const serverPath = join(currentFixture.root, "installed-mcp-server.mjs");
	await writeFile(
		serverPath,
		[
			'import { createInterface } from "node:readline";',
			"",
			"const lines = createInterface({ input: process.stdin });",
			"for await (const line of lines) {",
			"\tconst request = JSON.parse(line);",
			'\tif (!Object.hasOwn(request, "id")) continue;',
			"\tlet result;",
			'\tif (request.method === "initialize") {',
			"\t\tresult = {",
			'\t\t\tprotocolVersion: request.params?.protocolVersion ?? "2024-11-05",',
			"\t\t\tcapabilities: { tools: {} },",
			'\t\t\tserverInfo: { name: "installed-canary", version: "1.0.0" },',
			"\t\t};",
			'\t} else if (request.method === "tools/list") {',
			"\t\tresult = {",
			"\t\t\ttools: [{",
			'\t\t\t\tname: "echo",',
			`\t\t\t\tdescription: ${JSON.stringify(MCP_DESCRIPTION)},`,
			"\t\t\t\tinputSchema: {",
			'\t\t\t\t\ttype: "object",',
			'\t\t\t\t\tproperties: { value: { type: "string" } },',
			'\t\t\t\t\trequired: ["value"],',
			"\t\t\t\t\tadditionalProperties: false,",
			"\t\t\t\t},",
			"\t\t\t}],",
			"\t\t};",
			'\t} else if (request.method === "tools/call") {',
			'\t\tconst value = typeof request.params?.arguments?.value === "string" ? request.params.arguments.value : "";',
			`\t\tresult = { content: [{ type: "text", text: ${JSON.stringify(`${MCP_RESULT.slice(0, -7)}`)} + value }] };`,
			"\t} else {",
			"\t\tresult = {};",
			"\t}",
			'\tprocess.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");',
			"}",
			"",
		].join("\n"),
		"utf8",
	);
	await writeFile(
		join(currentFixture.agentDir, "mcp.json"),
		JSON.stringify({
			mcpServers: {
				installed_canary: {
					args: [serverPath],
					command: process.execPath,
					startupTimeout: 10_000,
				},
			},
		}),
		"utf8",
	);
}

function createIsolatedArtifactEnv(currentFixture: AgentRpcFixture): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const key of [
		"APPDATA",
		"ComSpec",
		"LANG",
		"LC_ALL",
		"LOCALAPPDATA",
		"NO_PROXY",
		"PATHEXT",
		"SystemRoot",
		"TEMP",
		"TMP",
		"TMPDIR",
		"WINDIR",
	]) {
		const value = process.env[key];
		if (value !== undefined) env[key] = value;
	}
	env.PATH = (process.env.PATH ?? "")
		.split(delimiter)
		.filter((entry) => entry.length > 0 && isOutside(repositoryRoot, resolve(entry)))
		.join(delimiter);
	env.CI = "1";
	env.HOME = currentFixture.root;
	env.NO_COLOR = "1";
	env.USERPROFILE = currentFixture.root;
	env.VETTA_CODING_AGENT_DIR = currentFixture.agentDir;
	env.VETTA_HOME = join(currentFixture.root, "home");
	return env;
}

interface StartInstalledCliOptions {
	readonly hostProfile?: "im-claw";
	readonly skillPath?: string;
	readonly noSkills?: boolean;
	readonly extraArgs?: readonly string[];
}

function startInstalledCli(
	binaryPath: string,
	currentFixture: AgentRpcFixture,
	env: NodeJS.ProcessEnv,
	options: StartInstalledCliOptions = {},
): AgentRpcProcess {
	const child: ChildProcessWithoutNullStreams = spawn(
		binaryPath,
		[
			"agent",
			"--mode",
			"rpc",
			...(options.hostProfile === "im-claw" ? ["--enable-host-bridge", "--scenario", "im-claw"] : []),
			"--session-dir",
			currentFixture.conversationDir,
			"--provider",
			"test",
			"--model",
			"test-model",
			"--offline",
			"--no-extensions",
			...(options.noSkills ? ["--no-skills"] : []),
			...(options.skillPath ? ["--skill", options.skillPath] : []),
			"--no-prompt-templates",
			"--no-themes",
			...(options.extraArgs ?? []),
		],
		{
			cwd: currentFixture.workspace,
			env,
			stdio: "pipe",
			windowsHide: true,
		},
	);
	return new AgentRpcProcess(child);
}

function installedOutputCommand(value: string): string {
	if (process.platform === "win32") return `Write-Output -NoEnumerate '${value.replaceAll("'", "''")}'`;
	return `printf '%s' '${value.replaceAll("'", `'\\''`)}'`;
}

interface InstalledFrameObservation {
	readonly provider: Readonly<Record<string, unknown>>;
	readonly runtime: InstalledRuntimeObservation;
}

function observableProviderRequest(
	body: ProviderRequest,
	currentFixture: AgentRpcFixture,
): Readonly<Record<string, unknown>> {
	const observation: Record<string, unknown> = { ...body };
	delete observation.prompt_cache_key;
	return normalizeProviderValue(observation, currentFixture) as Readonly<Record<string, unknown>>;
}

function normalizeProviderValue(value: unknown, currentFixture: AgentRpcFixture): unknown {
	if (typeof value === "string") {
		return value
			.replaceAll(currentFixture.root, "<fixture-root>")
			.replace(/^Current date and time: .*$/gm, "Current date and time: <turn-time>");
	}
	if (Array.isArray(value)) return value.map((entry) => normalizeProviderValue(entry, currentFixture));
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [key, normalizeProviderValue(entry, currentFixture)]),
	);
}

interface InstalledRuntimeObservation {
	readonly lifecycle: readonly string[];
	readonly textDelta: string;
	readonly finalText: string;
	readonly tools: ReadonlyArray<{ readonly name: string; readonly isError: boolean }>;
	readonly sessionPathChanges: readonly string[];
}

function observeRuntimeFrames(frames: readonly RpcFrame[]): InstalledRuntimeObservation {
	const lifecycleTypes = new Set(["agent_start", "turn_start", "turn_end", "agent_end"]);
	const lifecycle: string[] = [];
	const tools: Array<{ name: string; isError: boolean }> = [];
	const sessionPathChanges: string[] = [];
	let textDelta = "";
	let finalText = "";

	for (const frame of frames) {
		if (lifecycleTypes.has(frame.type)) lifecycle.push(frame.type);
		if (frame.type === "message_update") {
			const assistantEvent = frame.assistantMessageEvent;
			if (
				typeof assistantEvent === "object" &&
				assistantEvent !== null &&
				Reflect.get(assistantEvent, "type") === "text_delta"
			) {
				const delta = Reflect.get(assistantEvent, "delta");
				if (typeof delta === "string") textDelta += delta;
			}
		}
		if (frame.type === "message_end") {
			const text = readAssistantText(frame.message);
			if (text) finalText = text;
		}
		if (frame.type === "tool_execution_end") {
			tools.push({
				name: typeof frame.toolName === "string" ? frame.toolName : "",
				isError: frame.isError === true,
			});
		}
		if (frame.type === "session_path_changed" && typeof frame.to === "string") {
			sessionPathChanges.push(frame.to);
		}
	}
	return { lifecycle, textDelta, finalText, tools, sessionPathChanges };
}

function readAssistantText(value: unknown): string {
	if (typeof value !== "object" || value === null || Reflect.get(value, "role") !== "assistant") return "";
	const content = Reflect.get(value, "content");
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(item): item is { readonly type: "text"; readonly text: string } =>
				typeof item === "object" &&
				item !== null &&
				Reflect.get(item, "type") === "text" &&
				typeof Reflect.get(item, "text") === "string",
		)
		.map(({ text }) => text)
		.join("\n");
}

function providerToolNames(body: Readonly<Record<string, unknown>>): string[] {
	if (!Array.isArray(body.tools)) return [];
	return body.tools.flatMap((tool) => {
		if (typeof tool !== "object" || tool === null) return [];
		const name = Reflect.get(tool, "name");
		return typeof name === "string" ? [name] : [];
	});
}

async function promptInstalledTurn(process: AgentRpcProcess, id: string, message: string): Promise<void> {
	const mark = process.mark();
	await process.request(id, "prompt", { message });
	await process.waitFor((frame) => frame.type === "agent_end", mark, 30_000);
}

function dynamicSkillDocument(description: string): string {
	return `---
name: installed-dynamic
description: ${description}
---

Use this Skill only for the installed artifact dynamic capability gate.
`;
}

function readToolDescription(tools: readonly unknown[] | undefined, name: string): string {
	for (const tool of tools ?? []) {
		if (typeof tool !== "object" || tool === null || Reflect.get(tool, "name") !== name) continue;
		const description = Reflect.get(tool, "description");
		return typeof description === "string" ? description : "";
	}
	return "";
}

function installedHeldProcessCommand(relativePidPath: string): string {
	if (process.platform === "win32") {
		return `$PID | Set-Content -LiteralPath '${relativePidPath}' -Encoding ascii; Start-Sleep -Seconds 60`;
	}
	return `printf '%s' "$$" > '${relativePidPath}'; sleep 60`;
}

async function waitForInstalledPid(path: string): Promise<number> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		try {
			const pid = Number.parseInt((await readFile(path, "utf8")).trim(), 10);
			if (Number.isSafeInteger(pid) && pid > 0) return pid;
		} catch {
			// The background command has not written its PID yet.
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
	}
	throw new Error(`Timed out waiting for installed background PID file: ${path}`);
}

async function waitForInstalledFileText(path: string, expected: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		try {
			if ((await readFile(path, "utf8")).includes(expected)) return;
		} catch {
			// The extension command has not completed yet.
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
	}
	throw new Error(`Timed out waiting for installed audit file ${path}`);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function isOutside(parent: string, candidate: string): boolean {
	const pathFromParent = relative(parent, candidate);
	return pathFromParent.startsWith("..") || isAbsolute(pathFromParent);
}

async function runCommand(command: string, args: readonly string[]): Promise<void> {
	await new Promise<void>((resolvePromise, rejectPromise) => {
		const child = spawn(command, args, {
			cwd: repositoryRoot,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let output = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			output += chunk;
		});
		child.once("error", rejectPromise);
		child.once("exit", (code, signal) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			rejectPromise(new Error(`Command failed (code=${code ?? "null"}, signal=${signal ?? "null"})\n${output}`));
		});
	});
}
