import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type AgentRpcExecutable,
	type AgentRpcFixture,
	type AgentRpcProcess,
	buildAgentRpcExecutable,
	type CreateAgentRpcFixtureOptions,
	createAgentRpcFixture,
	type RpcFrame,
	readSessionFile,
	readSessionId,
	type StartAgentRpcOptions,
	startAgentRpc,
} from "./support/agent-rpc-test-process.js";
import { legacyRuntimeContract } from "./support/legacy-runtime-contract.js";
import {
	LEGACY_EXECUTION_MARKERS,
	readLegacyExecutionContextObservations,
	writeLegacyExecutionContextExtension,
	writeLegacyExecutionSessionFixture,
} from "./support/legacy-session-execution-fixture.js";
import {
	type OpenAiResponsesTestServer,
	type ProviderRequest,
	type ProviderRequestRecord,
	startOpenAiResponsesTestServer,
	textResponseEvents,
	toolCallResponseEvents,
} from "./support/openai-responses-test-server.js";

const PROVIDER_CONTRACT_HOST_OPTIONS = {
	enableHostBridge: true,
	scenario: "im-claw",
} as const satisfies StartAgentRpcOptions;
const rolloverTriggeredFixtures = new Set<string>();
let executable: AgentRpcExecutable;

beforeAll(async () => {
	executable = await buildAgentRpcExecutable();
});

afterAll(async () => {
	await executable.dispose();
});

describe("Agent Runtime Provider contract", { timeout: 30_000 }, () => {
	it("preserves the exact Provider request body and ordered tool surface", async () => {
		const frame = await runRuntimeScenario(
			async ({ process, server, fixture }) => {
				const mark = process.mark();
				await process.request("prompt-provider-frame", "prompt", {
					message: "Capture the exact Provider request frame",
				});
				await process.waitFor((frame) => frame.type === "agent_end", mark);
				expect(server.requests).toHaveLength(1);
				const request = server.requests[0];
				if (!request) throw new Error("Expected one Provider request");
				return observableProviderRequest(request.body, fixture);
			},
			() => ({ kind: "events", events: textResponseEvents("Provider frame captured.") }),
		);
		expect(frame.model).toBe("test-model");
		expect(JSON.stringify(frame.input)).toContain("Capture the exact Provider request frame");
		expect(providerToolNames(frame)).toEqual(expect.arrayContaining(["read", "im_send_attachment"]));
	}, 30_000);

	it("preserves the IM-consumed streaming text contract", async () => {
		const observation = await runRuntimeScenario(
			async ({ process, server }) => {
				const mark = process.mark();
				await expect(process.request("prompt-text", "prompt", { message: "Say hello" })).resolves.toMatchObject({
					type: "response",
					command: "prompt",
					success: true,
				});
				await process.waitFor((frame) => frame.type === "agent_end", mark);
				expect(server.requests).toHaveLength(1);
				return observeFrames(process.framesSince(mark));
			},
			() => ({ kind: "events", events: textResponseEvents("Hello from fixture.") }),
		);

		expect(observation).toEqual({
			lifecycle: legacyRuntimeContract.rpc.streamingLifecycle,
			textDelta: "Hello from fixture.",
			finalText: "Hello from fixture.",
			tools: [],
			sessionPathChanges: [],
		});
	});

	it("preserves Tool Call, Tool Result and second model-call behavior", async () => {
		const observation = await runRuntimeScenario(
			async ({ process, server, fixture }) => {
				const sourcePath = join(fixture.workspace, "message.txt");
				await writeFile(sourcePath, "tool fixture content", "utf8");
				const mark = process.mark();
				await process.request("prompt-tool", "prompt", { message: "Read message.txt" });
				await process.waitFor((frame) => frame.type === "agent_end", mark);

				expect(
					server.requests,
					JSON.stringify({ frames: process.framesSince(mark), stderr: process.stderr, requests: server.requests }),
				).toHaveLength(2);
				expect(JSON.stringify(server.requests[1]?.body.input)).toContain("tool fixture content");
				return observeFrames(process.framesSince(mark));
			},
			(_request, index, fixture) =>
				index === 0
					? {
							kind: "events",
							events: toolCallResponseEvents("read", {
								path: join(fixture.workspace, "message.txt"),
							}),
						}
					: { kind: "events", events: textResponseEvents("The file was read.") },
		);

		expect(observation).toMatchObject({
			lifecycle: ["agent_start", "turn_start", "turn_end", "turn_start", "turn_end", "agent_end"],
			finalText: "The file was read.",
			tools: [{ name: "read", isError: false }],
		});
	});

	it("preserves Extension Tool schema, execution context, progress and Tool Loop result", async () => {
		const observation = await runRuntimeScenario(
			async ({ process, server, fixture }) => {
				const mark = process.mark();
				await process.request("prompt-extension-tool", "prompt", { message: "Run extension_echo with hello" });
				await process.waitFor((frame) => frame.type === "agent_end", mark);

				expect(server.requests).toHaveLength(2);
				const firstRequest = server.requests[0];
				const secondRequest = server.requests[1];
				if (!firstRequest || !secondRequest) throw new Error("Expected two Provider requests");
				const frames = process.framesSince(mark);
				return {
					firstProviderRequest: observableProviderRequest(firstRequest.body, fixture),
					secondProviderInput: normalizeProviderValue(secondRequest.body.input, fixture),
					frames: observeFrames(frames),
					progressEventCount: frames.filter(({ type }) => type === "tool_execution_update").length,
				};
			},
			(_request, index) =>
				index === 0
					? { kind: "events", events: toolCallResponseEvents("extension_echo", { value: "hello" }) }
					: { kind: "events", events: textResponseEvents("Extension Tool completed.") },
			async (fixture) => ({
				extraArgs: ["--extension", await writeToolContractExtension(fixture)],
			}),
		);

		expect(providerToolNames(observation.firstProviderRequest)).toContain("extension_echo");
		expect(JSON.stringify(observation.secondProviderInput)).toContain("extension-result:hello");
		expect(observation).toMatchObject({
			frames: {
				finalText: "Extension Tool completed.",
				tools: [{ name: "extension_echo", isError: false }],
			},
			progressEventCount: 1,
		});
	}, 30_000);

	it("preserves in-flight abort behavior and closes the Provider request", async () => {
		const observation = await runRuntimeScenario(
			async ({ process, server }) => {
				const mark = process.mark();
				await process.request("prompt-abort", "prompt", { message: "Stream until aborted" });
				await process.waitFor((frame) => frame.type === "message_update", mark);
				await expect(process.request("abort-active", "abort")).resolves.toMatchObject({
					type: "response",
					command: "abort",
					success: true,
				});
				await process.waitFor((frame) => frame.type === "agent_end", mark);
				await server.waitForHeldRequestClosed();
				return observeFrames(process.framesSince(mark));
			},
			() => ({
				kind: "hold",
				events: textResponseEvents("partial").slice(0, 3),
			}),
		);

		expect(observation.lifecycle.at(0)).toBe("agent_start");
		expect(observation.lifecycle.at(-1)).toBe("agent_end");
		expect(observation.textDelta).toBe("partial");
	});

	it("preserves the attachment Host Bridge round trip", async () => {
		const observation = await runRuntimeScenario(
			async ({ process, server, fixture }) => {
				const attachmentPath = join(fixture.workspace, "artifact.txt");
				await writeFile(attachmentPath, "attachment", "utf8");
				const mark = process.mark();
				await process.request("prompt-attachment", "prompt", { message: "Send artifact.txt" });
				const hostRequest = await process.waitFor((frame) => frame.type === "host_request", mark);
				if (typeof hostRequest.id !== "string") throw new Error("Expected host_request id");
				process.send({
					type: "host_response",
					id: hostRequest.id,
					success: true,
					data: { messageId: "fixture-message-id" },
				});
				await process.waitFor((frame) => frame.type === "agent_end", mark);

				expect(server.requests).toHaveLength(2);
				expect(JSON.stringify(server.requests[1]?.body.input)).toContain("fixture-message-id");
				return observeFrames(process.framesSince(mark));
			},
			(_request, index, fixture) =>
				index === 0
					? {
							kind: "events",
							events: toolCallResponseEvents("im_send_attachment", {
								description: "Send the test artifact",
								path: join(fixture.workspace, "artifact.txt"),
								kind: "file",
							}),
						}
					: { kind: "events", events: textResponseEvents("Attachment sent.") },
		);

		expect(observation).toMatchObject({
			finalText: "Attachment sent.",
			tools: [{ name: "im_send_attachment", isError: false }],
		});
	});

	it("enforces the replacement and storage-continuation resource matrix", async () => {
		const replacement = await runRuntimeScenario(
			async ({ process, server, fixture }) => {
				const sourcePath = readSessionFile(await process.request("replacement-source", "get_state"));
				const pid = await seedSessionResources(process, fixture, "replacement");
				const transitionMark = process.mark();

				await process.request("replacement-new", "new_session");
				const targetState = await process.request("replacement-target", "get_state");
				const targetPath = readSessionFile(targetState);
				const inspectMark = process.mark();
				await process.request("replacement-inspect", "prompt", { message: "inspect-replacement-todos" });
				await process.waitFor((frame) => frame.type === "agent_end", inspectMark, 10_000);

				const sourceLock = persistentSessionLockPath(sourcePath);
				const targetLock = persistentSessionLockPath(targetPath);
				const inspection = server.requests.at(-1)?.rawBody ?? "";
				const backgroundStopped = await waitForProcessExit(pid);
				const observation = {
					backgroundStopped,
					pathChanged: targetPath !== sourcePath,
					pathChangeCount: process
						.framesSince(transitionMark)
						.filter(({ type }) => type === "session_path_changed").length,
					sourceOwnershipReleased: !existsSync(sourceLock),
					targetOwnershipHeld: existsSync(targetLock),
					todoState: inspection.includes("call_inspect_todo") && inspection.includes("No todo items."),
				};

				await process.close();
				await waitForProcessExit(pid);
				return { ...observation, targetOwnershipReleased: !existsSync(targetLock) };
			},
			(request, _index, fixture) => sessionContinuityResponse(request, fixture, "replacement"),
		);

		const continuation = await runRuntimeScenario(
			async ({ process, server, fixture }) => {
				const sourcePath = readSessionFile(await process.request("continuation-source", "get_state"));
				const pid = await seedSessionResources(process, fixture, "continuation");
				const transitionMark = process.mark();

				await process.request("continuation-rollover", "prompt", { message: "trigger-continuation-rollover" });
				await process.waitFor((frame) => frame.type === "agent_end", transitionMark, 10_000);
				const pathChange = await process.waitFor(
					(frame) => frame.type === "session_path_changed" && typeof frame.to === "string",
					transitionMark,
					5_000,
				);
				const targetPath = pathChange.to;
				if (typeof targetPath !== "string") throw new Error("Expected rollover target path");
				const targetState = await process.request("continuation-target", "get_state");
				const sourceLock = persistentSessionLockPath(sourcePath);
				const targetLock = persistentSessionLockPath(targetPath);
				const transitionFrames = process.framesSince(transitionMark);
				const transitionOwnership = {
					sourceOwnershipReleased: !existsSync(sourceLock),
					targetOwnershipHeld: existsSync(targetLock),
				};
				const inspectMark = process.mark();
				await process.request("continuation-inspect", "prompt", { message: "inspect-continuation-todos" });
				await process.waitFor((frame) => frame.type === "agent_end", inspectMark, 10_000);

				const finalPath = readSessionFile(await process.request("continuation-final", "get_state"));
				const finalLock = persistentSessionLockPath(finalPath);
				const inspection = server.requests.at(-1)?.rawBody ?? "";
				const observation = {
					backgroundPreserved: isProcessAlive(pid),
					lifecycle: transitionFrames
						.filter(({ type }) => ["agent_start", "turn_start", "turn_end", "agent_end"].includes(type))
						.map(({ type }) => type),
					pathChanged: readSessionFile(targetState) === targetPath && targetPath !== sourcePath,
					pathChangeCount: transitionFrames.filter(({ type }) => type === "session_path_changed").length,
					sourceDocumentPreserved: existsSync(sourcePath),
					targetDocumentCreated: existsSync(targetPath),
					...transitionOwnership,
					todoState: inspection.includes("call_inspect_todo") && inspection.includes("continuity todo"),
				};

				await process.close();
				return {
					...observation,
					backgroundStoppedOnClose: await waitForProcessExit(pid),
					targetOwnershipReleased: !existsSync(finalLock),
				};
			},
			(request, _index, fixture) => sessionContinuityResponse(request, fixture, "continuation"),
			(fixture) => ({
				extraArgs: ["--memory-mode", "--memory-file", join(fixture.workspace, "MEMORY.md")],
			}),
		);

		expect(replacement).toEqual({
			backgroundStopped: true,
			pathChanged: true,
			pathChangeCount: 0,
			sourceOwnershipReleased: true,
			targetOwnershipHeld: true,
			targetOwnershipReleased: true,
			todoState: true,
		});
		expect(continuation).toEqual({
			backgroundPreserved: true,
			backgroundStoppedOnClose: true,
			lifecycle: ["agent_start", "turn_start", "turn_end", "agent_end"],
			pathChanged: true,
			pathChangeCount: 1,
			sourceDocumentPreserved: true,
			sourceOwnershipReleased: true,
			targetDocumentCreated: true,
			targetOwnershipHeld: true,
			targetOwnershipReleased: true,
			todoState: true,
		});
	}, 60_000);

	it("preserves Extension context identity, once-per-call execution and transient Tool Loop transforms", async () => {
		const observation = await runRuntimeScenario(
			async ({ process, server, fixture }) => {
				const sourcePath = join(fixture.workspace, "context-message.txt");
				await writeFile(sourcePath, "context tool fixture", "utf8");
				const mark = process.mark();
				await process.request("prompt-context-tool", "prompt", { message: "Read context-message.txt" });
				await process.waitFor((frame) => frame.type === "agent_end", mark);

				expect(server.requests).toHaveLength(2);
				const firstInput = JSON.stringify(server.requests[0]?.body.input);
				const secondInput = JSON.stringify(server.requests[1]?.body.input);
				const state = await process.request("state-after-context-tool", "get_state");
				const persistedSession = await readFile(readSessionFile(state), "utf8");
				return {
					inputs: server.requests.map(({ body }) => normalizeProviderValue(body.input, fixture)),
					firstHasCallOne: firstInput.includes("context-call:1"),
					firstHasCustomIdentity: firstInput.includes("custom:fixture-seed"),
					secondHasOnlyCallTwo: secondInput.includes("context-call:2") && !secondInput.includes("context-call:1"),
					transientTransformWasNotPersisted: !persistedSession.includes("context-fixture"),
				};
			},
			(_request, index, fixture) =>
				index === 0
					? {
							kind: "events",
							events: toolCallResponseEvents("read", {
								path: join(fixture.workspace, "context-message.txt"),
							}),
						}
					: { kind: "events", events: textResponseEvents("Context Tool Loop completed.") },
			async (fixture) => ({
				extraArgs: ["--extension", await writeContextContractExtension(fixture)],
			}),
		);

		expect(observation).toMatchObject({
			firstHasCallOne: true,
			firstHasCustomIdentity: true,
			secondHasOnlyCallTwo: true,
			transientTransformWasNotPersisted: true,
		});
	}, 30_000);

	it("preserves context-before-compaction order and restored context through a CLI process restart", async () => {
		const observation = await runRuntimeScenario(
			async ({ process, server, fixture }) => {
				let mark = process.mark();
				await process.request("prompt-before-compaction", "prompt", {
					message: "initial-before-compaction",
				});
				await process.waitFor((frame) => frame.type === "agent_end", mark);

				mark = process.mark();
				await process.request("prompt-trigger-compaction", "prompt", {
					message: `trigger-context-compaction ${"x".repeat(5_000)}`,
				});
				await process.waitFor((frame) => frame.type === "agent_end", mark);
				const sessionState = await process.request("state-before-context-restart", "get_state");
				const sessionPath = readSessionFile(sessionState);
				const sessionContent = await readFile(sessionPath, "utf8");
				const compactionFirstKeptKind = describePersistedCompactionFirstKept(sessionContent);
				await process.close();

				const resumed = startAgentRpc(executable, fixture, {
					...PROVIDER_CONTRACT_HOST_OPTIONS,
					extraArgs: [
						"--extension",
						join(fixture.root, "context-contract-extension.ts"),
						"--session",
						sessionPath,
					],
				});
				try {
					mark = resumed.mark();
					await resumed.request("prompt-after-context-restart", "prompt", {
						message: "after-context-restart",
					});
					await resumed.waitFor((frame) => frame.type === "agent_end", mark);
				} finally {
					await resumed.close();
				}

				const normalRequests = server.requests.filter((request) => !isContextSummarizationRequest(request));
				const compactedRequest = normalRequests.find(({ rawBody }) =>
					rawBody.includes("trigger-context-compaction"),
				);
				const resumedRequest = normalRequests.find(({ rawBody }) => rawBody.includes("after-context-restart"));
				const contextObservations = await readContextContractObservations(fixture);
				return {
					inputs: normalRequests.map(({ body }) => normalizeProviderValue(body.input, fixture)),
					contextIdentities: contextObservations.map(({ identities }) => identities),
					contextObserved: contextObservations.map(({ observed }) => observed),
					agentRequestKinds: normalRequests.map(describeContextBoundaryRequest),
					compactionRequestCount: server.requests.length - normalRequests.length,
					compactionFirstKeptKind,
					contextCallCounts: contextObservations.map(({ call }) => call),
					contextObservedPreCompactionHistory:
						contextObservations[1]?.observed.includes("initial-before-compaction") === true,
					providerReceivedCompactionSummary:
						compactedRequest?.rawBody.includes("fixture compacted history") === true,
					resumedContextRestoredSummaryIdentity:
						contextObservations[2]?.identities.includes("compactionSummary") === true &&
						resumedRequest !== undefined,
				};
			},
			(request) => {
				const input = JSON.stringify(request.body.input);
				if (isContextSummarizationRequest(request)) {
					return {
						kind: "events",
						events: textResponseEvents("<summary>fixture compacted history</summary>"),
					};
				}
				if (input.includes("trigger-context-compaction") || input.includes("after-context-restart")) {
					return { kind: "events", events: textResponseEvents("Context boundary response.") };
				}
				if (input.includes("initial-before-compaction")) {
					return {
						kind: "events",
						events: textResponseEvents("Initial response."),
					};
				}
				return { kind: "events", events: textResponseEvents("Context boundary response.") };
			},
			async (fixture) => {
				await writeFile(
					join(fixture.agentDir, "settings.json"),
					JSON.stringify({
						compaction: { enabled: true, reserveTokens: 100, minFreePercent: 20, keepRecentTokens: 1 },
					}),
					"utf8",
				);
				return { extraArgs: ["--extension", await writeContextContractExtension(fixture)] };
			},
			{ contextWindow: 1_000, maxTokens: 100 },
		);

		expect(observation).toMatchObject({
			agentRequestKinds: ["initial", "compacted", "resumed"],
			contextCallCounts: [1, 2, 1],
			contextObservedPreCompactionHistory: true,
			providerReceivedCompactionSummary: true,
			resumedContextRestoredSummaryIdentity: true,
		});
		expect(observation.compactionRequestCount).toBeGreaterThan(0);
	}, 40_000);

	it("continues a migrated official Legacy session through Provider calls and a process restart", async () => {
		const observation = await runRuntimeScenario(
			async ({ process, server, fixture }) => {
				const sourcePath = join(fixture.conversationDir, "legacy-execution-source.jsonl");
				const sourceContent = await readFile(sourcePath, "utf8");
				const initialState = await process.request("legacy-execution-state-before", "get_state");
				const sessionPath = readSessionFile(initialState);
				const sessionId = readSessionId(initialState);

				let mark = process.mark();
				await process.request("legacy-execution-first", "prompt", { message: "continue-migrated-legacy-first" });
				await process.waitFor((frame) => frame.type === "agent_end", mark);
				await process.close();

				const migratedTargetsBeforeRestart = await listMigratedTargets(fixture);
				const resumed = startAgentRpc(executable, fixture, {
					...PROVIDER_CONTRACT_HOST_OPTIONS,
					extraArgs: [
						"--extension",
						join(fixture.root, "legacy-execution-context-extension.ts"),
						"--session",
						sessionPath,
					],
				});
				let resumedState: RpcFrame;
				try {
					resumedState = await resumed.request("legacy-execution-state-resumed", "get_state");
					mark = resumed.mark();
					await resumed.request("legacy-execution-second", "prompt", {
						message: "continue-migrated-legacy-second",
					});
					await resumed.waitFor((frame) => frame.type === "agent_end", mark);
				} finally {
					await resumed.close();
				}

				const persistedContent = await readFile(sessionPath, "utf8");
				const contextObservations = await readLegacyExecutionContextObservations({
					observationPath: join(fixture.root, "legacy-execution-context-observations.jsonl"),
					path: join(fixture.root, "legacy-execution-context-extension.ts"),
				});
				const providerInputs = server.requests.map(({ body }) => normalizeProviderValue(body.input, fixture));
				const firstProviderInput = JSON.stringify(server.requests[0]?.body.input);
				const migratedTargetsAfterRestart = await listMigratedTargets(fixture);

				return {
					contextCallCounts: contextObservations.map(({ call }) => call),
					contextIdentities: contextObservations.map(({ identities }) => identities),
					contextObserved: contextObservations.map(({ observed }) => observed),
					firstProviderBoundary: {
						containsAbandonedBranch: firstProviderInput.includes(LEGACY_EXECUTION_MARKERS.abandonedBranch),
						containsBranchSummary: firstProviderInput.includes(LEGACY_EXECUTION_MARKERS.branchSummary),
						containsCompactionSummary: firstProviderInput.includes(LEGACY_EXECUTION_MARKERS.compactionSummary),
						containsHiddenBash: firstProviderInput.includes(LEGACY_EXECUTION_MARKERS.hiddenBash),
						containsHiddenCustom: firstProviderInput.includes(LEGACY_EXECUTION_MARKERS.hiddenCustom),
						containsPrunedHistory: firstProviderInput.includes(LEGACY_EXECUTION_MARKERS.pruned),
						containsTail: firstProviderInput.includes(LEGACY_EXECUTION_MARKERS.tail),
						containsVisibleBash: firstProviderInput.includes(LEGACY_EXECUTION_MARKERS.visibleBash),
						containsVisibleCustom: firstProviderInput.includes(LEGACY_EXECUTION_MARKERS.visibleCustom),
					},
					migration: {
						activeSessionUsesImportedTarget:
							sessionPath !== sourcePath && sessionPath.endsWith(".conversation.jsonl"),
						migratedTargetCountValid:
							migratedTargetsBeforeRestart.length === 1 && migratedTargetsAfterRestart.length === 1,
						sourceUnchanged: (await readFile(sourcePath, "utf8")) === sourceContent,
					},
					persistence: describeContinuedConversation(persistedContent),
					providerInputs,
					resumedIdentityStable:
						readSessionFile(resumedState) === sessionPath && readSessionId(resumedState) === sessionId,
				};
			},
			(request) => {
				if (request.rawBody.includes("continue-migrated-legacy-second")) {
					return { kind: "events", events: textResponseEvents("Migrated Legacy second response.") };
				}
				return { kind: "events", events: textResponseEvents("Migrated Legacy first response.") };
			},
			async (fixture) => {
				const session = await writeLegacyExecutionSessionFixture(fixture);
				const extension = await writeLegacyExecutionContextExtension(fixture);
				return { extraArgs: ["--extension", extension.path, "--session", session.sourcePath] };
			},
		);

		expect(observation).toMatchObject({
			contextCallCounts: [1, 1],
			firstProviderBoundary: {
				containsAbandonedBranch: false,
				containsBranchSummary: true,
				containsCompactionSummary: true,
				containsHiddenBash: false,
				containsHiddenCustom: false,
				containsPrunedHistory: false,
				containsTail: true,
				containsVisibleBash: true,
				containsVisibleCustom: true,
			},
			migration: {
				activeSessionUsesImportedTarget: true,
				migratedTargetCountValid: true,
				sourceUnchanged: true,
			},
			persistence: {
				activeTailRoles: ["user", "assistant", "user", "assistant"],
				allParentsResolved: true,
				activeTailLinked: true,
			},
			resumedIdentityStable: true,
		});
		expect(observation.contextIdentities[0]).toContain("compactionSummary");
		expect(observation.contextIdentities[0]).toContain("bashExecution");
		expect(observation.contextIdentities[0]).toContain("custom:legacy-visible-context");
		expect(observation.contextIdentities[0]).toContain("custom:prompt_resource_reference");
		expect(observation.contextIdentities[0]).toContain("branchSummary");
		expect(observation.contextObserved[0]).toContain(LEGACY_EXECUTION_MARKERS.hiddenBash);
		expect(observation.contextObserved[0]).toContain(LEGACY_EXECUTION_MARKERS.hiddenCustom);
		expect(observation.contextObserved[0]).not.toContain(LEGACY_EXECUTION_MARKERS.abandonedBranch);
	}, 40_000);

	it("preserves dynamic image blocking at the final Provider boundary without rewriting history", async () => {
		const observation = await runRuntimeScenario(
			async ({ process, server, fixture }) => {
				let mark = process.mark();
				await process.request("prompt-image-visible", "prompt", {
					message: "first-image-visible",
					images: [TEST_IMAGE],
				});
				await process.waitFor((frame) => frame.type === "agent_end", mark);

				await writeImageSettings(fixture, true);
				mark = process.mark();
				await process.request("prompt-image-blocked", "prompt", {
					message: "second-image-blocked",
					images: [TEST_IMAGE],
				});
				await process.waitFor((frame) => frame.type === "agent_end", mark);

				expect(server.requests).toHaveLength(2);
				const firstInput = JSON.stringify(server.requests[0]?.body.input);
				const secondInput = JSON.stringify(server.requests[1]?.body.input);
				const state = await process.request("state-after-image-block", "get_state");
				const persistedSession = await readFile(readSessionFile(state), "utf8");
				return {
					inputs: server.requests.map(({ body }) => normalizeProviderValue(body.input, fixture)),
					firstProviderReceivedImage: firstInput.includes("input_image"),
					secondProviderBlockedAllImages:
						secondInput.includes("Image reading is disabled.") && !secondInput.includes("input_image"),
					historyRetainedImages: persistedSession.includes('"type":"image"'),
				};
			},
			(_request, index) => ({
				kind: "events",
				events: textResponseEvents(index === 0 ? "Visible image response." : "Blocked image response."),
			}),
			async (fixture) => {
				await writeImageSettings(fixture, false);
				return {};
			},
			{ modelInput: ["text", "image"] },
		);

		expect(observation).toMatchObject({
			firstProviderReceivedImage: true,
			secondProviderBlockedAllImages: true,
			historyRetainedImages: true,
		});
	}, 30_000);
});

type ScenarioHandler = (
	request: Parameters<Parameters<typeof startOpenAiResponsesTestServer>[0]>[0],
	index: number,
	fixture: AgentRpcFixture,
) => ReturnType<Parameters<typeof startOpenAiResponsesTestServer>[0]>;

interface ScenarioContext {
	readonly fixture: AgentRpcFixture;
	readonly process: AgentRpcProcess;
	readonly server: OpenAiResponsesTestServer;
}

async function runRuntimeScenario<T>(
	run: (context: ScenarioContext) => Promise<T>,
	handler: ScenarioHandler,
	resolveStartOptions?: (fixture: AgentRpcFixture) => Promise<StartAgentRpcOptions> | StartAgentRpcOptions,
	fixtureOptions: CreateAgentRpcFixtureOptions = {},
): Promise<T> {
	let fixture: AgentRpcFixture | undefined;
	let process: AgentRpcProcess | undefined;
	let server: OpenAiResponsesTestServer | undefined;
	try {
		server = await startOpenAiResponsesTestServer((request, index) => {
			if (!fixture) throw new Error("Agent RPC fixture was not initialized");
			return handler(request, index, fixture);
		});
		fixture = await createAgentRpcFixture({ ...fixtureOptions, baseUrl: server.baseUrl });
		process = startAgentRpc(executable, fixture, {
			...(await resolveStartOptions?.(fixture)),
			...PROVIDER_CONTRACT_HOST_OPTIONS,
		});
		return await run({ fixture, process, server });
	} finally {
		await process?.close();
		await fixture?.dispose();
		await server?.dispose();
	}
}

interface RuntimeObservation {
	readonly lifecycle: string[];
	readonly textDelta: string;
	readonly finalText: string;
	readonly tools: Array<{ readonly name: string; readonly isError: boolean }>;
	readonly sessionPathChanges: string[];
}

function observeFrames(frames: readonly RpcFrame[]): RuntimeObservation {
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

function persistentSessionLockPath(sessionPath: string): string {
	return `${sessionPath}.owner.lock`;
}

async function seedSessionResources(
	process: AgentRpcProcess,
	fixture: AgentRpcFixture,
	semantic: "replacement" | "continuation",
): Promise<number> {
	const mark = process.mark();
	await process.request(`${semantic}-seed`, "prompt", { message: `seed-${semantic}-resources` });
	await process.waitFor((frame) => frame.type === "agent_end", mark, 10_000);
	return waitForPid(join(fixture.workspace, `${semantic}-background.pid`));
}

function sessionContinuityResponse(
	request: ProviderRequestRecord,
	fixture: AgentRpcFixture,
	semantic: "replacement" | "continuation",
): { readonly kind: "events"; readonly events: readonly unknown[] } {
	const requestText = JSON.stringify(request.body.input);
	if (requestText.includes("You maintain a concise long-term MEMORY")) {
		return { kind: "events", events: textResponseEvents("NONE") };
	}
	if (requestText.includes("You are a context summarization assistant")) {
		return {
			kind: "events",
			events: textResponseEvents("<summary>provider rollover summary</summary>"),
		};
	}
	if (request.rawBody.includes(`inspect-${semantic}-todos`)) {
		return request.rawBody.includes("call_inspect_todo")
			? { kind: "events", events: textResponseEvents("Todo state inspected.") }
			: {
					kind: "events",
					events: toolCallResponseEvents(
						"todo",
						{ action: "list", description: "Inspect session continuity todo state" },
						{ callId: "call_inspect_todo", itemId: "fc_inspect_todo" },
					),
				};
	}
	if (semantic === "continuation" && request.rawBody.includes("trigger-continuation-rollover")) {
		if (rolloverTriggeredFixtures.has(fixture.root)) {
			return { kind: "events", events: textResponseEvents("Continuation resumed after rollover.") };
		}
		rolloverTriggeredFixtures.add(fixture.root);
		return {
			kind: "events",
			events: textResponseEvents("Continuation rollover response.", { inputTokens: 5_999, outputTokens: 1 }),
		};
	}
	if (request.rawBody.includes(`seed-${semantic}-resources`)) {
		if (!request.rawBody.includes("call_seed_todo")) {
			return {
				kind: "events",
				events: toolCallResponseEvents(
					"todo",
					{ action: "create", description: "Seed session continuity todo state", items: ["continuity todo"] },
					{ callId: "call_seed_todo", itemId: "fc_seed_todo" },
				),
			};
		}
		if (!request.rawBody.includes("call_seed_todo_done")) {
			return {
				kind: "events",
				events: toolCallResponseEvents(
					"todo",
					{ action: "update", description: "Complete session continuity todo state", id: 1, status: "done" },
					{ callId: "call_seed_todo_done", itemId: "fc_seed_todo_done" },
				),
			};
		}
		if (!request.rawBody.includes("call_seed_shell")) {
			return {
				kind: "events",
				events: toolCallResponseEvents(
					process.platform === "win32" ? "shell" : "bash",
					{
						command: heldProcessCommand(`${semantic}-background.pid`),
						run_in_background: true,
					},
					{ callId: "call_seed_shell", itemId: "fc_seed_shell" },
				),
			};
		}
		return {
			kind: "events",
			events: textResponseEvents("Session resources seeded.", {
				inputTokens: semantic === "continuation" ? 999 : 10,
				outputTokens: 1,
			}),
		};
	}
	return { kind: "events", events: textResponseEvents(`Unexpected ${semantic} request for ${fixture.workspace}`) };
}

function heldProcessCommand(relativePidPath: string): string {
	if (process.platform === "win32") {
		return `$PID | Set-Content -LiteralPath '${relativePidPath}' -Encoding ascii; Start-Sleep -Seconds 60`;
	}
	return `printf '%s' "$$" > '${relativePidPath}'; sleep 60`;
}

async function waitForPid(path: string): Promise<number> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		try {
			const pid = Number.parseInt((await readFile(path, "utf8")).trim(), 10);
			if (Number.isSafeInteger(pid) && pid > 0) return pid;
		} catch {
			// The command has not written its PID yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out waiting for background PID file: ${path}`);
}

async function waitForProcessExit(pid: number): Promise<boolean> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		if (!isProcessAlive(pid)) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return !isProcessAlive(pid);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function observableProviderRequest(body: ProviderRequest, fixture: AgentRpcFixture): Readonly<Record<string, unknown>> {
	const observation: Record<string, unknown> = { ...body };
	delete observation.prompt_cache_key;
	return normalizeProviderValue(observation, fixture) as Readonly<Record<string, unknown>>;
}

function normalizeProviderValue(value: unknown, fixture: AgentRpcFixture): unknown {
	if (typeof value === "string") {
		const fixtureDirectoryName = basename(fixture.root);
		const fixtureDirectoryIndex = value.toLowerCase().indexOf(fixtureDirectoryName.toLowerCase());
		const normalizedPath =
			fixtureDirectoryIndex >= 0
				? `${value.slice(0, fixtureDirectoryIndex)}<fixture-root>${value.slice(fixtureDirectoryIndex + fixtureDirectoryName.length)}`
				: value.replaceAll(fixture.root, "<fixture-root>");
		return normalizedPath.replace(/^Current date and time: .*$/gm, "Current date and time: <turn-time>");
	}
	if (Array.isArray(value)) return value.map((entry) => normalizeProviderValue(entry, fixture));
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [key, normalizeProviderValue(entry, fixture)]),
	);
}

function providerToolNames(body: Readonly<Record<string, unknown>>): string[] {
	if (!Array.isArray(body.tools)) return [];
	return body.tools.flatMap((tool) => {
		if (typeof tool !== "object" || tool === null) return [];
		const name = Reflect.get(tool, "name");
		return typeof name === "string" ? [name] : [];
	});
}

const TEST_IMAGE = {
	type: "image",
	data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4ZQAAAAASUVORK5CYII=",
	mimeType: "image/png",
} as const;

async function writeContextContractExtension(fixture: AgentRpcFixture): Promise<string> {
	const path = join(fixture.root, "context-contract-extension.ts");
	const observationPath = join(fixture.root, "context-contract-observations.jsonl");
	await writeFile(
		path,
		`import { appendFileSync } from "node:fs";
		const observationPath = ${JSON.stringify(observationPath)};
		export default function(extension) {
			let contextCalls = 0;
			extension.on("before_agent_start", async (event) => ({
				message: {
					customType: "fixture-seed",
					content: "seed:" + event.prompt,
					display: false,
				},
			}));
			extension.on("context", async (event) => {
				contextCalls += 1;
				const identities = event.messages.map((message) => {
					if (message.role === "custom") return "custom:" + message.customType;
					return message.role;
				});
				const observed = event.messages.flatMap((message) => {
					if (typeof message.content === "string") return [message.content];
					if (!Array.isArray(message.content)) return [];
					return message.content
						.filter((item) => item.type === "text")
						.map((item) => item.text);
				}).join("|");
				appendFileSync(observationPath, JSON.stringify({
					call: contextCalls,
					identities,
					observed,
				}) + "\\n", "utf8");
				return {
					messages: [
						...event.messages,
						{
							role: "custom",
							customType: "context-fixture",
							content: "context-call:" + contextCalls + ";identities:" + identities.join(",") + ";observed:" + observed,
							display: false,
							timestamp: contextCalls,
						},
					],
				};
			});
		}`,
		"utf8",
	);
	return path;
}

async function writeToolContractExtension(fixture: AgentRpcFixture): Promise<string> {
	const path = join(fixture.root, "tool-contract-extension.ts");
	await writeFile(
		path,
		`export default function(extension) {
			extension.registerTool({
				name: "extension_echo",
				label: "Extension Echo",
				description: "Echo a value through the Extension runtime context.",
				parameters: {
					type: "object",
					properties: { value: { type: "string" } },
					required: ["value"],
					additionalProperties: false,
				},
				async execute(_toolCallId, params, _signal, onUpdate, context) {
					onUpdate?.({
						content: [{ type: "text", text: "extension-progress:" + params.value }],
						details: { phase: "progress" },
					});
					return {
						content: [{
							type: "text",
							text: [
								"extension-result:" + params.value,
								"cwd:" + context.cwd,
								"model:" + (context.model?.id ?? "none"),
								"idle:" + context.isIdle(),
							].join("|"),
						}],
						details: { source: "extension" },
					};
				},
			});
		}`,
		"utf8",
	);
	return path;
}

interface ContextContractObservation {
	readonly call: number;
	readonly identities: readonly string[];
	readonly observed: string;
}

async function readContextContractObservations(
	fixture: AgentRpcFixture,
): Promise<readonly ContextContractObservation[]> {
	const content = await readFile(join(fixture.root, "context-contract-observations.jsonl"), "utf8");
	return content
		.trim()
		.split("\n")
		.map((line) => readContextContractObservation(JSON.parse(line)));
}

function readContextContractObservation(value: unknown): ContextContractObservation {
	if (typeof value !== "object" || value === null) throw new Error("Invalid context observation");
	const call = Reflect.get(value, "call");
	const identities = Reflect.get(value, "identities");
	const observed = Reflect.get(value, "observed");
	if (
		typeof call !== "number" ||
		!Array.isArray(identities) ||
		!identities.every((identity) => typeof identity === "string") ||
		typeof observed !== "string"
	) {
		throw new Error("Invalid context observation payload");
	}
	return { call, identities, observed };
}

async function writeImageSettings(fixture: AgentRpcFixture, blockImages: boolean): Promise<void> {
	await writeFile(
		join(fixture.agentDir, "settings.json"),
		JSON.stringify({ images: { autoResize: false, maxRecentImages: 1, blockImages } }),
		"utf8",
	);
}

function describeContextBoundaryRequest(request: ProviderRequestRecord): string {
	const input = JSON.stringify(request.body.input);
	if (input.includes("after-context-restart")) return "resumed";
	if (input.includes("trigger-context-compaction")) return "compacted";
	if (input.includes("initial-before-compaction")) return "initial";
	return "other";
}

function isContextSummarizationRequest(request: ProviderRequestRecord): boolean {
	return !Array.isArray(request.body.tools) || request.body.tools.length === 0;
}

function describePersistedCompactionFirstKept(content: string): string {
	const records: unknown[] = content
		.trim()
		.split(/\r?\n/)
		.map((line) => JSON.parse(line));
	let firstKeptEntryId: string | undefined;
	for (const record of records) {
		if (!isRecord(record)) continue;
		if (record.type === "compaction" && typeof record.firstKeptEntryId === "string") {
			firstKeptEntryId = record.firstKeptEntryId;
		}
		if (!isRecord(record.event) || record.event.type !== "context.compacted") continue;
		const compaction = record.event.record;
		if (isRecord(compaction) && typeof compaction.firstKeptEntryId === "string") {
			firstKeptEntryId = compaction.firstKeptEntryId;
		}
	}
	if (!firstKeptEntryId) return "missing";
	for (const record of records) {
		if (!isRecord(record)) continue;
		if (record.id === firstKeptEntryId) return describePersistedEntry(record);
		if (!isRecord(record.documentEntry) || record.documentEntry.id !== firstKeptEntryId) continue;
		return isRecord(record.event) ? describePersistedEvent(record.event) : "unknown-event";
	}
	return "unknown-entry";
}

function describePersistedEntry(entry: Record<string, unknown>): string {
	if (entry.type === "message" && isRecord(entry.message) && typeof entry.message.role === "string") {
		return `message:${entry.message.role}`;
	}
	if (entry.type === "custom_message" && typeof entry.customType === "string") {
		return `context:${entry.customType}:${readPersistedText(entry.content)}`;
	}
	return typeof entry.type === "string" ? entry.type : "unknown-entry";
}

function describePersistedEvent(event: Record<string, unknown>): string {
	if (event.type === "message.appended" && isRecord(event.message) && typeof event.message.role === "string") {
		return `message:${event.message.role}`;
	}
	if (
		(event.type === "context.appended" || event.type === "context.recorded") &&
		isRecord(event.record) &&
		typeof event.record.type === "string"
	) {
		return `context:${event.record.type}:${readPersistedText(event.record.content)}`;
	}
	return typeof event.type === "string" ? event.type : "unknown-event";
}

function readPersistedText(value: unknown): string {
	if (typeof value === "string") return value.slice(0, 40);
	return "non-text";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function listMigratedTargets(fixture: AgentRpcFixture): Promise<readonly string[]> {
	return (await readdir(fixture.conversationDir)).filter((name) => name.endsWith(".conversation.jsonl")).sort();
}

interface PersistedEntryReference {
	readonly id: string;
	readonly parentId: string | null;
	readonly role?: string;
}

function describeContinuedConversation(content: string): Readonly<Record<string, unknown>> {
	const records = content
		.trim()
		.split(/\r?\n/u)
		.map((line) => JSON.parse(line) as unknown);
	const entries: PersistedEntryReference[] = [];
	for (const record of records) {
		if (!isRecord(record)) continue;
		if (record.recordType === "conversation.import.seed" && Array.isArray(record.entries)) {
			for (const entry of record.entries) {
				const reference = readPersistedEntryReference(entry);
				if (reference) entries.push(reference);
			}
			continue;
		}
		if (isRecord(record.documentEntry)) {
			const reference = readPersistedEntryReference(record.documentEntry, readStoredEventRole(record.event));
			if (reference) entries.push(reference);
			continue;
		}
		const reference = readPersistedEntryReference(record);
		if (reference) entries.push(reference);
	}
	const knownIds = new Set<string>();
	let allParentsResolved = true;
	for (const entry of entries) {
		if (entry.parentId !== null && !knownIds.has(entry.parentId)) allParentsResolved = false;
		knownIds.add(entry.id);
	}
	const messageEntries = entries.filter(
		(entry): entry is PersistedEntryReference & { readonly role: string } => entry.role !== undefined,
	);
	const activeTail = messageEntries.slice(-4);
	return {
		activeTailRoles: activeTail.map(({ role }) => role),
		allParentsResolved,
		activeTailLinked:
			activeTail.length === 4 &&
			activeTail.slice(1).every((entry, index) => entry.parentId === activeTail[index]?.id),
	};
}

function readPersistedEntryReference(value: unknown, role?: string): PersistedEntryReference | undefined {
	if (!isRecord(value) || typeof value.id !== "string") return undefined;
	const parentId = value.parentId;
	if (parentId !== null && typeof parentId !== "string") return undefined;
	const messageRole = role ?? readStoredMessageRole(value.message);
	return { id: value.id, parentId, ...(messageRole ? { role: messageRole } : {}) };
}

function readStoredEventRole(value: unknown): string | undefined {
	if (!isRecord(value) || value.type !== "message.appended") return undefined;
	return readStoredMessageRole(value.message);
}

function readStoredMessageRole(value: unknown): string | undefined {
	if (!isRecord(value) || typeof value.role !== "string") return undefined;
	return value.role;
}
