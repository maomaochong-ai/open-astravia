import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { ACTION_RPC_ENDPOINT_FILE_ENV, VETTA_HOME_ENV } from "@vetta/action-rpc";
import { parseWikiPage } from "@vetta/runtime-knowledge";
import { z } from "zod";
import {
	RUNTIME_CANARY_BATCH_PROMPT,
	RUNTIME_CANARY_FIRST_PROMPT,
	RUNTIME_CANARY_KNOWLEDGE_FAILURE_SOURCE_PATH,
	RUNTIME_CANARY_KNOWLEDGE_PENDING_SOURCE_PATH,
	RUNTIME_CANARY_KNOWLEDGE_SOURCE_PATH,
	RUNTIME_CANARY_MCP_PROMPT,
	RUNTIME_CANARY_QUESTION_PROMPT,
	RUNTIME_CANARY_RESTART_PROMPT,
	RUNTIME_CANARY_SCHEDULER_PROMPT,
	RUNTIME_CANARY_SECOND_PROMPT,
	RUNTIME_CANARY_SKILL_MARKER,
	runtimeCanaryExitReportSchema,
	runtimeCanaryHostStateSchema,
	type RuntimeCanaryKnowledgeContract,
	runtimeCanaryKnowledgeNotificationSchema,
	type RuntimeCanaryProcessingRecordFormat,
	runtimeCanaryRestartReportSchema,
	type RuntimeCanaryFixture,
	type RuntimeCanaryHostState,
} from "../src/main/app-debug/runtime-canary/contracts.js";
import {
	runRuntimeCanaryConversation,
	runRuntimeCanaryRestartedConversation,
	scheduleRuntimeCanaryQuit,
	startRuntimeCanaryConsumers,
	startRuntimeCanaryQuestion,
	type RuntimeCanaryDebugInvoker,
} from "../src/main/app-debug/runtime-canary/runner.js";

const desktopRoot = join(import.meta.dirname, "..");
const repoRoot = join(desktopRoot, "..", "..");
const knowledgeNotificationStorageKey = "runtime-canary-knowledge-notifications";
const actionCliSuccessSchema = z.object({ ok: z.literal(true), result: z.unknown() }).strict();
const knowledgeScanResultSchema = z
	.object({
		operation: z.literal("scan-now"),
		skipped: z.boolean(),
		reason: z.literal("no-model").optional(),
	})
	.loose();
const knowledgeManifestSchema = z
	.object({
		version: z.literal(1),
		pages: z.array(
			z
				.object({
					id: z.string(),
					path: z.string(),
					source_path: z.string(),
					source_hash: z.string(),
					orphaned_at: z.string().nullable(),
				})
				.strict(),
		),
	})
	.strict();
const knowledgeTagsSchema = z
	.object({
		version: z.literal(1),
		tags: z.record(z.string(), z.array(z.string())),
	})
	.strict();
const knowledgeFailureEntrySchema = z
	.object({
		source_hash: z.string(),
		source_path: z.string(),
		attempts: z.number().int().positive(),
		first_failed_at: z.string(),
		last_failed_at: z.string(),
		quarantined: z.boolean(),
	})
	.strict();
const knowledgeFailuresSchema = z
	.object({
		version: z.literal(1),
		entries: z.record(z.string(), knowledgeFailureEntrySchema),
	})
	.strict();
const cdpTargetSchema = z
	.object({
		type: z.string(),
		url: z.string(),
		webSocketDebuggerUrl: z.string().optional(),
	})
	.loose();
const cdpResponseSchema = z
	.object({
		id: z.number().optional(),
		error: z
			.object({
				message: z.string(),
			})
			.loose()
			.optional(),
		result: z
			.object({
				exceptionDetails: z.unknown().optional(),
				result: z
					.object({
						value: z.unknown().optional(),
					})
					.loose(),
			})
			.loose()
			.optional(),
	})
	.loose();
const knowledgeMonitorSchema = z
	.object({
		knowledgeBase: z
			.object({
				processingInputTokens: z.number(),
				processingOutputTokens: z.number(),
				processingRounds: z.number(),
				filesProcessed: z.number(),
				filesFailed: z.number(),
				manualScanCount: z.number(),
			})
			.loose(),
	})
	.loose();

try {
	const statePath = readArgument("--state-file");
	const state = runtimeCanaryHostStateSchema.parse(JSON.parse(await readFile(statePath, "utf8")));
	const endpointFilePath = join(state.runtimeCanary.vettaHome, "action-server.json");
	await waitFor(
		() => existsSync(state.runtimeCanary.installedCliPath),
		30_000,
		"Timed out waiting for Desktop to install the standalone Vetta CLI",
	);
	if (!isOutside(repoRoot, state.runtimeCanary.installedCliPath)) {
		throw new Error(`Runtime Canary CLI must be installed outside the repository: ${state.runtimeCanary.installedCliPath}`);
	}
	const invokeDebug: RuntimeCanaryDebugInvoker = async (debugId, input) =>
		await runVettaDebug(
			state.runtimeCanary.installedCliPath,
			state.runtimeCanary.workspace,
			endpointFilePath,
			state.runtimeCanary.vettaHome,
			debugId,
			input,
		);

	const conversation = await runRuntimeCanaryConversation(invokeDebug, {
		cwd: state.runtimeCanary.workspace,
		modelKey: state.runtimeCanary.modelKey,
	});
	await waitForKnowledgeActionProvider(state, endpointFilePath);
	const successfulKnowledgeAction = await startApprovedKnowledgeScan(state, endpointFilePath);
	const successfulKnowledgeResult = normalizeKnowledgeScan(
		parseSuccessfulKnowledgeScan(await successfulKnowledgeAction.result),
		"success",
	);
	await verifyKnowledgeSuccess(state.runtimeCanary);

	const pendingRawPath = join(
		state.runtimeCanary.knowledgeRoot,
		"raws",
		RUNTIME_CANARY_KNOWLEDGE_PENDING_SOURCE_PATH,
	);
	await writeFile(pendingRawPath, "Runtime Canary Knowledge Pending Source");
	const pendingKnowledgeAction = await startApprovedKnowledgeScan(state, endpointFilePath);
	await waitFor(
		async () =>
			existsSync(state.runtimeCanary.requestLogPath) &&
			(await readFile(state.runtimeCanary.requestLogPath, "utf8")).includes(
				RUNTIME_CANARY_KNOWLEDGE_PENDING_SOURCE_PATH,
			),
		30_000,
		"Timed out waiting for the pending Knowledge provider request",
	);
	const consumers = await startRuntimeCanaryConsumers(invokeDebug, {
		workspace: state.runtimeCanary.workspace,
		modelKey: state.runtimeCanary.modelKey,
		batchSourceDirectories: state.runtimeCanary.batchSourceDirectories,
	});
	const knowledgeSessionPaths = await listKnowledgeSessionPaths(state.runtimeCanary.knowledgeRoot);
	if (knowledgeSessionPaths.length < 2) {
		throw new Error(`Runtime Canary did not create both Knowledge processing sessions: ${knowledgeSessionPaths}`);
	}
	await writeFile(
		state.runtimeCanary.restartRequestPath,
		JSON.stringify({
			sessionPaths: [
				conversation.sessionPath,
				consumers.schedulerSessionPath,
				consumers.batchSessionPath,
				...knowledgeSessionPaths,
			],
		}),
	);
	const firstQuitDelayMs = await scheduleRuntimeCanaryQuit(invokeDebug);

	let restartedState: RuntimeCanaryHostState | undefined;
	await waitFor(
		async () => {
			if (!existsSync(state.runtimeCanary.restartReportPath) || !existsSync(endpointFilePath)) return false;
			try {
				const candidate = runtimeCanaryHostStateSchema.parse(JSON.parse(await readFile(statePath, "utf8")));
				if (
					candidate.desktopGeneration !== state.desktopGeneration + 1 ||
					candidate.desktopPid === state.desktopPid
				) {
					return false;
				}
				restartedState = candidate;
				return true;
			} catch {
				return false;
			}
		},
		90_000,
		"Timed out waiting for the second Desktop Runtime Canary process",
	);
	if (!restartedState) throw new Error("Desktop Runtime Canary did not publish its restarted host state");
	const activeRestartedState = restartedState;
	const restartReport = runtimeCanaryRestartReportSchema.parse(
		JSON.parse(await readFile(state.runtimeCanary.restartReportPath, "utf8")),
	);
	if (
		restartReport.desktopExitCode !== 0 ||
		restartReport.desktopPid !== state.desktopPid ||
		!restartReport.endpointRemoved ||
		!restartReport.sessionLocksReleased ||
		!restartReport.knowledgeRawsUnlocked
	) {
		throw new Error(`Desktop Runtime Canary restart cleanup failed: ${JSON.stringify(restartReport)}`);
	}
	const pendingKnowledgeResult = normalizeKnowledgeScan(
		parseSuccessfulKnowledgeScan(await pendingKnowledgeAction.result),
		"graceful abort",
	);
	await rm(pendingRawPath, { force: true });

	const restartedInvokeDebug: RuntimeCanaryDebugInvoker = async (debugId, input) =>
		await runVettaDebug(
			activeRestartedState.runtimeCanary.installedCliPath,
			activeRestartedState.runtimeCanary.workspace,
			endpointFilePath,
			activeRestartedState.runtimeCanary.vettaHome,
			debugId,
			input,
		);
	const restartedConversation = await runRuntimeCanaryRestartedConversation(restartedInvokeDebug, {
		sessionId: conversation.sessionId,
		sessionPath: conversation.sessionPath,
		cwd: activeRestartedState.runtimeCanary.workspace,
		modelKey: activeRestartedState.runtimeCanary.modelKey,
	});
	await installKnowledgeNotificationAudit(activeRestartedState.cdpPort, true);
	await waitForKnowledgeActionProvider(activeRestartedState, endpointFilePath);
	const failedRawPath = join(
		activeRestartedState.runtimeCanary.knowledgeRoot,
		"raws",
		RUNTIME_CANARY_KNOWLEDGE_FAILURE_SOURCE_PATH,
	);
	await writeFile(failedRawPath, "Runtime Canary Knowledge Failure Source");
	const failedKnowledgeAction = await startApprovedKnowledgeScan(activeRestartedState, endpointFilePath);
	const failedKnowledgeResult = normalizeKnowledgeScan(
		parseSuccessfulKnowledgeScan(await failedKnowledgeAction.result),
		"provider failure",
	);
	const knowledgeArtifacts = await verifyKnowledgeFailureRecorded(activeRestartedState.runtimeCanary);
	const knowledgeNotificationsAfterRestart = await readKnowledgeNotificationAudit(activeRestartedState.cdpPort);
	verifyKnowledgeNotificationSequence(knowledgeNotificationsAfterRestart);
	const finalKnowledgeSessionPaths = await listKnowledgeSessionPaths(activeRestartedState.runtimeCanary.knowledgeRoot);
	if (finalKnowledgeSessionPaths.length !== 3) {
		throw new Error(`Runtime Canary created unexpected Knowledge processing records: ${finalKnowledgeSessionPaths}`);
	}
	const processingRecordFormat = resolveProcessingRecordFormat(finalKnowledgeSessionPaths);
	const pendingQuestion = await startRuntimeCanaryQuestion(restartedInvokeDebug, {
		sessionPath: restartedConversation.sessionPath,
		modelKey: activeRestartedState.runtimeCanary.modelKey,
	});
	const finalQuitDelayMs = await scheduleRuntimeCanaryQuit(restartedInvokeDebug);

	await waitFor(
		() =>
			existsSync(state.runtimeCanary.exitReportPath) &&
			!existsSync(endpointFilePath) &&
			!isProcessAlive(state.hostPid) &&
			!isProcessAlive(state.runtimeCanary.providerPid),
		45_000,
		"Timed out waiting for the Desktop Runtime Canary to shut down",
	);

	const exitReport = runtimeCanaryExitReportSchema.parse(
		JSON.parse(await readFile(state.runtimeCanary.exitReportPath, "utf8")),
	);
	if (
		exitReport.desktopExitCode !== 0 ||
		exitReport.desktopExitCodes.length !== 2 ||
		exitReport.desktopProcessIds.length !== 2 ||
		exitReport.restartCount !== 1 ||
		exitReport.desktopProcessIds[0] !== state.desktopPid ||
		exitReport.desktopProcessIds[1] !== activeRestartedState.desktopPid ||
		!exitReport.endpointRemoved ||
		!exitReport.providerStopped
	) {
		throw new Error(`Desktop Runtime Canary cleanup failed: ${JSON.stringify(exitReport)}`);
	}
	for (const sessionPath of [
		conversation.sessionPath,
		consumers.schedulerSessionPath,
		consumers.batchSessionPath,
		...finalKnowledgeSessionPaths,
	]) {
		if (existsSync(`${sessionPath}.lock`) || existsSync(`${sessionPath}.owner.lock`)) {
			throw new Error(`Desktop Runtime Canary left a session ownership lock after shutdown: ${sessionPath}`);
		}
	}

	const providerRequests = await readFile(state.runtimeCanary.requestLogPath, "utf8");
	for (const prompt of [
		RUNTIME_CANARY_FIRST_PROMPT,
		RUNTIME_CANARY_SECOND_PROMPT,
		RUNTIME_CANARY_RESTART_PROMPT,
		RUNTIME_CANARY_MCP_PROMPT,
		RUNTIME_CANARY_QUESTION_PROMPT,
		RUNTIME_CANARY_SCHEDULER_PROMPT,
		RUNTIME_CANARY_BATCH_PROMPT,
		RUNTIME_CANARY_KNOWLEDGE_SOURCE_PATH,
		RUNTIME_CANARY_KNOWLEDGE_PENDING_SOURCE_PATH,
		RUNTIME_CANARY_KNOWLEDGE_FAILURE_SOURCE_PATH,
	]) {
		if (!providerRequests.includes(prompt)) {
			throw new Error(`Runtime Canary Provider did not observe prompt: ${prompt}`);
		}
	}
	if (!providerRequests.includes(RUNTIME_CANARY_SKILL_MARKER)) {
		throw new Error("Runtime Canary Provider did not observe the host Skill marker");
	}
	const batchRequestCount = providerRequests
		.split(/\r?\n/)
		.filter((line) => line.includes(RUNTIME_CANARY_BATCH_PROMPT)).length;
	if (batchRequestCount !== 1) {
		throw new Error(`Runtime Canary started ${batchRequestCount} Batch provider requests; expected exactly one`);
	}
	const schedulerRequestCount = providerRequests
		.split(/\r?\n/)
		.filter((line) => line.includes(RUNTIME_CANARY_SCHEDULER_PROMPT)).length;
	if (schedulerRequestCount !== 1) {
		throw new Error(
			`Runtime Canary started ${schedulerRequestCount} Scheduler provider requests; expected exactly one`,
		);
	}
	const conversationFile = await readFile(conversation.sessionPath, "utf8");
	if (
		!conversationFile.includes(RUNTIME_CANARY_RESTART_PROMPT) ||
		!conversationFile.includes(RUNTIME_CANARY_MCP_PROMPT)
	) {
		throw new Error("Restarted Runtime Canary prompts were not persisted to the conversation");
	}
	const monitor = knowledgeMonitorSchema.parse(
		JSON.parse(await readFile(join(state.runtimeCanary.vettaHome, "app-monitor", "summary.json"), "utf8")),
	);
	if (
		monitor.knowledgeBase.processingRounds !== 3 ||
		monitor.knowledgeBase.manualScanCount !== 3 ||
		monitor.knowledgeBase.filesProcessed !== 1 ||
		monitor.knowledgeBase.filesFailed !== 0 ||
		monitor.knowledgeBase.processingInputTokens <= 0 ||
		monitor.knowledgeBase.processingOutputTokens <= 0
	) {
		throw new Error(`Unexpected Runtime Canary Knowledge monitor snapshot: ${JSON.stringify(monitor.knowledgeBase)}`);
	}
	const knowledgeContract: RuntimeCanaryKnowledgeContract = {
		scans: {
			success: successfulKnowledgeResult,
			aborted: pendingKnowledgeResult,
			providerFailure: failedKnowledgeResult,
		},
		artifacts: knowledgeArtifacts.artifacts,
		failure: knowledgeArtifacts.failure,
		monitor: {
			processingInputTokens: monitor.knowledgeBase.processingInputTokens,
			processingOutputTokens: monitor.knowledgeBase.processingOutputTokens,
			processingRounds: monitor.knowledgeBase.processingRounds,
			filesProcessed: monitor.knowledgeBase.filesProcessed,
			filesFailed: monitor.knowledgeBase.filesFailed,
			manualScanCount: monitor.knowledgeBase.manualScanCount,
		},
		notifications: knowledgeNotificationsAfterRestart,
		processingRecordCount: finalKnowledgeSessionPaths.length,
		lifecycle: {
			desktopRestarted: true,
			sessionLocksReleased: true,
			rawsUnlocked: restartReport.knowledgeRawsUnlocked,
			endpointRemoved: true,
			providerStopped: true,
			desktopExitCode: exitReport.desktopExitCode,
		},
	};

	printJson({
		ok: true,
		result: {
			processingRecordFormat,
			knowledgeContract,
			...conversation,
			restartedMessageCount: restartedConversation.messageCount,
			...consumers,
			pendingQuestionOperationId: pendingQuestion.operationId,
			firstQuitDelayMs,
			finalQuitDelayMs,
			installedCliPath: state.runtimeCanary.installedCliPath,
			firstDesktopPid: state.desktopPid,
			secondDesktopPid: activeRestartedState.desktopPid,
			desktopRestarted: true,
			sessionPersisted: existsSync(conversation.sessionPath),
			sessionLocksReleased: true,
			knowledgeRawsUnlocked: restartReport.knowledgeRawsUnlocked,
			knowledgeFilesProcessed: monitor.knowledgeBase.filesProcessed,
			knowledgeFailureRecorded: true,
			knowledgeMonitorFilesFailed: monitor.knowledgeBase.filesFailed,
			endpointRemoved: true,
			providerStopped: true,
			desktopExitCode: exitReport.desktopExitCode,
		},
	});
} catch (error) {
	printJson({
		ok: false,
		error: {
			message: error instanceof Error ? error.message : String(error),
		},
	});
	process.exitCode = 1;
}

interface ProcessResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

async function waitForKnowledgeActionProvider(
	state: RuntimeCanaryHostState,
	endpointFilePath: string,
): Promise<void> {
	await waitFor(
		async () => {
			const result = await runVettaAction(
				state.runtimeCanary.installedCliPath,
				state.runtimeCanary.workspace,
				endpointFilePath,
				state.runtimeCanary.vettaHome,
				["search", "knowledge"],
			);
			return result.code === 0 && result.stdout.includes("knowledge.manage");
		},
		30_000,
		"Timed out waiting for the Knowledge Action provider",
	);
}

async function startApprovedKnowledgeScan(
	state: RuntimeCanaryHostState,
	endpointFilePath: string,
): Promise<{ readonly result: Promise<ProcessResult> }> {
	const result = runVettaAction(
		state.runtimeCanary.installedCliPath,
		state.runtimeCanary.workspace,
		endpointFilePath,
		state.runtimeCanary.vettaHome,
		["run", "knowledge.manage", JSON.stringify({ operation: "scan-now" })],
	);
	await approveNextKnowledgeAction(state.cdpPort);
	return { result };
}

async function approveNextKnowledgeAction(cdpPort: number): Promise<void> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const approved = await evaluateRenderer(
			cdpPort,
			`(() => {
				const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((candidate) => {
					const element = /** @type {HTMLElement} */ (candidate);
					return element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0;
				});
				const dialog = dialogs.at(-1);
				if (!dialog) return false;
				const buttons = dialog.querySelectorAll('button');
				const approveButton = buttons.item(buttons.length - 1);
				if (buttons.length < 2 || !approveButton) return false;
				approveButton.click();
				return true;
			})()`,
			z.boolean(),
		);
		if (approved) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Knowledge approval dialog did not become visible");
}

async function installKnowledgeNotificationAudit(cdpPort: number, reset: boolean): Promise<void> {
	await evaluateRenderer(
		cdpPort,
		`(() => {
			const key = ${JSON.stringify(knowledgeNotificationStorageKey)};
			if (${JSON.stringify(reset)}) localStorage.setItem(key, "[]");
			if (globalThis.__runtimeCanaryKnowledgeAudit) return true;
			const record = (event) => {
				const events = JSON.parse(localStorage.getItem(key) ?? "[]");
				events.push(event);
				localStorage.setItem(key, JSON.stringify(events));
			};
			const processingHandler = (value) => record({ type: "processing", value });
			const statusesHandler = () => record({ type: "statuses" });
			globalThis.__runtimeCanaryKnowledgeAudit = {
				record,
				processingHandler,
				statusesHandler,
				offProcessing: window.vetta.knowledge.onProcessingChanged(processingHandler),
				offStatuses: window.vetta.knowledge.onStatusesChanged(statusesHandler),
			};
			return true;
		})()`,
		z.literal(true),
	);
}

async function readKnowledgeNotificationAudit(
	cdpPort: number,
): Promise<Array<z.infer<typeof runtimeCanaryKnowledgeNotificationSchema>>> {
	const events = await evaluateRenderer(
		cdpPort,
		`localStorage.getItem(${JSON.stringify(knowledgeNotificationStorageKey)}) ?? "[]"`,
		z.string(),
	);
	return z.array(runtimeCanaryKnowledgeNotificationSchema).parse(JSON.parse(events));
}

async function evaluateRenderer<T>(cdpPort: number, expression: string, schema: z.ZodType<T>): Promise<T> {
	const targetResponse = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
	if (!targetResponse.ok) {
		throw new Error(`Unable to list Runtime Canary Renderer targets: HTTP ${targetResponse.status}`);
	}
	const targets = z.array(cdpTargetSchema).parse(await targetResponse.json());
	const target = targets.find(
		(candidate) =>
			candidate.type === "page" && candidate.webSocketDebuggerUrl !== undefined && isMainRendererUrl(candidate.url),
	);
	const targetWebSocketUrl = target?.webSocketDebuggerUrl;
	if (!targetWebSocketUrl) throw new Error("Vetta main Renderer CDP target was not found");

	return await new Promise<T>((resolve, reject) => {
		const requestId = 1;
		const socket = new WebSocket(targetWebSocketUrl);
		const timeout = setTimeout(() => {
			socket.close();
			reject(new Error("Timed out evaluating Runtime Canary Renderer expression"));
		}, 10_000);
		const finish = (operation: () => void): void => {
			clearTimeout(timeout);
			socket.close();
			operation();
		};
		socket.addEventListener("open", () => {
			socket.send(
				JSON.stringify({
					id: requestId,
					method: "Runtime.evaluate",
					params: {
						expression,
						awaitPromise: true,
						returnByValue: true,
					},
				}),
			);
		});
		socket.addEventListener("error", () => {
			finish(() => reject(new Error("Runtime Canary Renderer CDP connection failed")));
		});
		socket.addEventListener("message", (event) => {
			if (typeof event.data !== "string") return;
			const response = cdpResponseSchema.parse(JSON.parse(event.data));
			if (response.id !== requestId) return;
			if (response.error) {
				finish(() => reject(new Error(`Runtime Canary Renderer evaluation failed: ${response.error?.message}`)));
				return;
			}
			if (!response.result || response.result.exceptionDetails !== undefined) {
				finish(() =>
					reject(
						new Error(
							`Runtime Canary Renderer expression raised an exception: ${JSON.stringify(response.result?.exceptionDetails)}`,
						),
					),
				);
				return;
			}
			finish(() => {
				try {
					resolve(schema.parse(response.result?.result.value));
				} catch (error) {
					reject(error);
				}
			});
		});
	});
}

function isMainRendererUrl(url: string): boolean {
	return (
		url.startsWith("http://") &&
		!["/pet.html", "/quickpanel.html", "/onboarding.html"].some((entry) => url.includes(entry))
	);
}

function parseSuccessfulKnowledgeScan(result: ProcessResult): z.infer<typeof knowledgeScanResultSchema> {
	if (result.code !== 0) {
		throw new Error(
			`Vetta Knowledge Action failed with code ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
		);
	}
	const envelope = actionCliSuccessSchema.parse(JSON.parse(result.stdout));
	return knowledgeScanResultSchema.parse(envelope.result);
}

function normalizeKnowledgeScan(
	result: z.infer<typeof knowledgeScanResultSchema>,
	label: string,
): { readonly operation: "scan-now"; readonly skipped: false } {
	if (result.skipped) {
		throw new Error(`Runtime Canary Knowledge ${label} scan was unexpectedly skipped`);
	}
	return { operation: result.operation, skipped: false };
}

async function runVettaAction(
	installedCliPath: string,
	cwd: string,
	endpointFilePath: string,
	vettaHome: string,
	args: string[],
): Promise<ProcessResult> {
	return await runProcess(installedCliPath, ["action", ...args], cwd, {
		...process.env,
		[ACTION_RPC_ENDPOINT_FILE_ENV]: endpointFilePath,
		[VETTA_HOME_ENV]: vettaHome,
	});
}

async function verifyKnowledgeSuccess(fixture: RuntimeCanaryFixture): Promise<void> {
	await verifyKnowledgeArtifacts(fixture);
	const failures = await readJsonFile(join(fixture.knowledgeRoot, "failures.json"), knowledgeFailuresSchema);
	if (Object.keys(failures.entries).length !== 0) {
		throw new Error(`Runtime Canary Knowledge success recorded failures: ${JSON.stringify(failures)}`);
	}
}

async function verifyKnowledgeArtifacts(
	fixture: RuntimeCanaryFixture,
): Promise<RuntimeCanaryKnowledgeContract["artifacts"]> {
	const pagePath = join(fixture.knowledgeRoot, "wiki", "runtime-canary", "page.md");
	const [page, manifest, tags] = await Promise.all([
		readFile(pagePath, "utf8"),
		readJsonFile(join(fixture.knowledgeRoot, "manifest.json"), knowledgeManifestSchema),
		readJsonFile(join(fixture.knowledgeRoot, "tags.json"), knowledgeTagsSchema),
	]);
	const parsedPage = parseWikiPage(page);
	if (
		parsedPage.frontmatter.source_path !== RUNTIME_CANARY_KNOWLEDGE_SOURCE_PATH ||
		parsedPage.frontmatter.source_hash !== fixture.knowledgeSourceHash ||
		!parsedPage.body.includes("Processed by the selected Knowledge session.")
	) {
		throw new Error("Runtime Canary Knowledge wiki page does not match the deterministic Provider output");
	}
	if (
		manifest.pages.length !== 1 ||
		manifest.pages[0]?.source_path !== RUNTIME_CANARY_KNOWLEDGE_SOURCE_PATH ||
		manifest.pages[0]?.source_hash !== fixture.knowledgeSourceHash
	) {
		throw new Error(`Unexpected Runtime Canary Knowledge manifest: ${JSON.stringify(manifest)}`);
	}
	const sourcePathById = new Map(manifest.pages.map((entry) => [entry.id, entry.source_path]));
	const indexedSourcePaths = [
		...new Set(
			Object.values(tags.tags)
				.flat()
				.map((id) => sourcePathById.get(id) ?? `missing:${id}`),
		),
	].sort();
	if (!Object.hasOwn(tags.tags, "runtime-canary")) {
		throw new Error("Runtime Canary Knowledge tags index is missing the deterministic tag");
	}
	return {
		path: manifest.pages[0]?.path ?? "",
		source: parsedPage.frontmatter.source,
		sourcePath: parsedPage.frontmatter.source_path,
		sourceHash: parsedPage.frontmatter.source_hash,
		tags: [...parsedPage.frontmatter.tags].sort(),
		title: parsedPage.frontmatter.title,
		summary: parsedPage.frontmatter.summary,
		body: parsedPage.body,
		orphaned: parsedPage.frontmatter.orphaned_at !== null,
		manifestPageCount: manifest.pages.length,
		indexedSourcePaths,
	};
}

async function verifyKnowledgeFailureRecorded(fixture: RuntimeCanaryFixture): Promise<{
	readonly artifacts: RuntimeCanaryKnowledgeContract["artifacts"];
	readonly failure: RuntimeCanaryKnowledgeContract["failure"];
}> {
	const artifacts = await verifyKnowledgeArtifacts(fixture);
	const failures = await readJsonFile(join(fixture.knowledgeRoot, "failures.json"), knowledgeFailuresSchema);
	const failurePaths = Object.keys(failures.entries);
	const failure = failures.entries[RUNTIME_CANARY_KNOWLEDGE_FAILURE_SOURCE_PATH];
	if (
		failurePaths.length !== 1 ||
		!failure ||
		failure.source_path !== RUNTIME_CANARY_KNOWLEDGE_FAILURE_SOURCE_PATH ||
		failure.attempts !== 1 ||
		failure.quarantined
	) {
		throw new Error(`Unexpected Runtime Canary Knowledge failure record: ${JSON.stringify(failures)}`);
	}
	return {
		artifacts,
		failure: {
			sourcePath: failure.source_path,
			attempts: failure.attempts,
			quarantined: failure.quarantined,
		},
	};
}

function verifyKnowledgeNotificationSequence(
	events: readonly z.infer<typeof runtimeCanaryKnowledgeNotificationSchema>[],
): void {
	const states = processingStates(events);
	if (JSON.stringify(states) !== JSON.stringify([true, false])) {
		throw new Error(`Unexpected Runtime Canary Knowledge notification sequence: ${JSON.stringify(events)}`);
	}
	if (!events.some((event) => event.type === "statuses")) {
		throw new Error("Runtime Canary Knowledge notification audit did not observe status invalidation");
	}
}

function processingStates(
	events: readonly z.infer<typeof runtimeCanaryKnowledgeNotificationSchema>[],
): boolean[] {
	return events
		.filter((event): event is { readonly type: "processing"; readonly value: boolean } => event.type === "processing")
		.map((event) => event.value);
}

async function listKnowledgeSessionPaths(knowledgeRoot: string): Promise<string[]> {
	const sessionDirectory = join(knowledgeRoot, "processing_records", ".vetta", "sessions");
	if (!existsSync(sessionDirectory)) return [];
	const entries = await readdir(sessionDirectory, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
		.map((entry) => join(sessionDirectory, entry.name))
		.sort();
}

function resolveProcessingRecordFormat(paths: readonly string[]): RuntimeCanaryProcessingRecordFormat {
	if (paths.every((path) => path.endsWith(".conversation.jsonl"))) return "conversation-v2-jsonl";
	throw new Error(`Runtime Canary observed a non-production Knowledge processing record format: ${paths}`);
}

async function readJsonFile<T>(path: string, schema: z.ZodType<T>): Promise<T> {
	return schema.parse(JSON.parse(await readFile(path, "utf8")));
}

async function runVettaDebug(
	installedCliPath: string,
	cwd: string,
	endpointFilePath: string,
	vettaHome: string,
	debugId: string,
	input: unknown,
): Promise<unknown> {
	const result = await runProcess(installedCliPath, ["debug", "run", debugId, JSON.stringify(input)], cwd, {
		...process.env,
		[ACTION_RPC_ENDPOINT_FILE_ENV]: endpointFilePath,
		[VETTA_HOME_ENV]: vettaHome,
	});
	if (result.code !== 0) {
		throw new Error(
			`Vetta CLI failed with code ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
		);
	}
	const parsed = JSON.parse(result.stdout) as { ok?: unknown; result?: unknown };
	if (parsed.ok !== true) throw new Error(`Vetta CLI returned an unsuccessful response: ${result.stdout}`);
	return parsed.result;
}

async function runProcess(
	command: string,
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
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
			if (signal) {
				reject(new Error(`${command} exited with signal ${signal}\nstderr:\n${stderr}`));
				return;
			}
			resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
		});
	});
}

async function waitFor(
	predicate: () => boolean | Promise<boolean>,
	timeoutMs: number,
	message: string,
): Promise<void> {
	const startedAt = Date.now();
	while (!(await predicate())) {
		if (Date.now() - startedAt >= timeoutMs) throw new Error(message);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

function isOutside(parent: string, candidate: string): boolean {
	const pathFromParent = relative(parent, candidate);
	return pathFromParent.startsWith("..") || isAbsolute(pathFromParent);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readArgument(name: string): string {
	const index = process.argv.indexOf(name);
	const value = index === -1 ? undefined : process.argv[index + 1];
	if (!value) throw new Error(`Missing ${name}`);
	return value;
}

function printJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}
