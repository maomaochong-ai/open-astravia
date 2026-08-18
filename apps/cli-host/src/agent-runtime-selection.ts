import { resolveCodingAgentSessionDir } from "@vetta/coding-agent/bootstrap";
import { getAgentDir } from "@vetta/coding-agent/config";
import type { CodingAgentHtmlExportRuntime } from "@vetta/coding-agent/export-html";
import type { CodingAgentAuthRuntime } from "@vetta/coding-agent/host-services";
import { RPC_FAILURE_CODES, stringifyRpcStartupFailure } from "@vetta/coding-agent/rpc";
import { ConversationOwnershipConflictError } from "@vetta/runtime-storage/conversation";
import { classifyAgentCliIntent } from "./agent-cli-intent.js";
import { createCliCodingAgentBootstrap } from "./coding-agent-bootstrap.js";
import { runCodingAgentCliControl } from "./coding-agent-cli-control.js";
import { createCliResourcePackageRuntime, createCliSettingsRuntime } from "./coding-agent-resource-runtime.js";
import { ExtensionCompatibilityError } from "./extension-compatibility-error.js";
import { CliFileInputError } from "./file-processor.js";
import { createCliRuntimeSessionCatalog } from "./rpc/cli-session-format-compatibility.js";
import {
	prepareImRuntimeHost,
	preparePrintRuntimeHost,
	prepareRpcRuntimeHost,
	runImRuntimeHost,
	runPrintRuntimeHost,
	runRpcRuntimeHost,
} from "./rpc/runtime-host/runtime-host.js";
import { SessionCompatibilityError } from "./session-compatibility-error.js";

export interface RunAgentRuntimeCliOptions {
	readonly htmlExporter?: CodingAgentHtmlExportRuntime;
	/**
	 * 宿主在 bootstrap 完成、模型解析开始之前注入运行时 API Key。
	 *
	 * Desktop 把自定义 provider 的明文 key 存在 safeStorage 保险库里，
	 * `models.json` 只留 `credentialRef`，所以子进程单靠读 models.json /
	 * auth.json 拿不到凭据：ModelRuntime 会回落到本地 provider 的
	 * "no auth" 占位串，远端 provider（deepseek 等）随即 401。
	 */
	readonly injectRuntimeCredentials?: (authStorage: CodingAgentAuthRuntime) => void | Promise<void>;
}

export async function runAgentRuntimeCli(
	args: readonly string[],
	options: RunAgentRuntimeCliOptions = {},
): Promise<void> {
	assertSupportedSessionSelection(args);
	const intent = classifyAgentCliIntent(args);
	if (intent === "control") {
		if (
			!(await runCodingAgentCliControl([...args], {
				htmlExporter: options.htmlExporter,
				createBootstrap: async (controlArgs) => {
					const controlBootstrap = await createCliCodingAgentBootstrap({ args: controlArgs });
					await options.injectRuntimeCredentials?.(controlBootstrap.authStorage);
					return controlBootstrap;
				},
				createPackageCommandRuntime: () => {
					const cwd = process.cwd();
					const agentDir = getAgentDir();
					const settings = createCliSettingsRuntime(cwd, agentDir);
					return {
						settings,
						packages: createCliResourcePackageRuntime({ cwd, agentDir, settings }),
					};
				},
			}))
		) {
			throw new Error("CLI control intent was not handled by the Coding Agent control host");
		}
		return;
	}
	const bootstrap = await createCliCodingAgentBootstrap({ args: [...args] });
	// 必须早于 prepare*RuntimeHost：模型解析与可用性过滤都会读凭据。
	await options.injectRuntimeCredentials?.(bootstrap.authStorage);
	const conversationDir = resolveCodingAgentSessionDir(bootstrap.cwd, bootstrap.parsed.sessionDir);
	const sessionCatalog = createCliRuntimeSessionCatalog({
		cwd: bootstrap.cwd,
		sessionDir: conversationDir,
		agentDir: bootstrap.agentDir,
	});
	const imHost = bootstrap.parsed.enableHostBridge === true || bootstrap.parsed.scenario === "im-claw";

	try {
		if (intent === "print" && imHost) {
			throw new Error("IM host capabilities only support RPC mode");
		}
		const prepared = await (intent === "print"
			? preparePrintRuntimeHost({
					bootstrap,
					conversationDir,
					sessionCatalog,
					htmlExporter: options.htmlExporter,
				})
			: imHost
				? prepareImRuntimeHost({
						bootstrap,
						conversationDir,
						sessionCatalog,
						htmlExporter: options.htmlExporter,
					})
				: prepareRpcRuntimeHost({
						bootstrap,
						conversationDir,
						sessionCatalog,
						htmlExporter: options.htmlExporter,
					}));
		if (prepared.kind === "extension-incompatible") {
			throw new ExtensionCompatibilityError(prepared.extensionCompatibility);
		}
		if (prepared.kind === "session-incompatible") {
			throw new SessionCompatibilityError(prepared.sessionCompatibility);
		}
		if (prepared.kind === "print") await runPrintRuntimeHost(prepared);
		else if (imHost) await runImRuntimeHost(prepared);
		else await runRpcRuntimeHost(prepared);
	} catch (error) {
		if (error instanceof CliFileInputError) {
			process.stderr.write(`${error.message}\n`);
			process.exitCode = 1;
			return;
		}
		if (error instanceof ExtensionCompatibilityError) {
			if (intent === "rpc") process.stdout.write(stringifyRpcStartupFailure(error.toRpcStartupFailure()));
			else writeExtensionCompatibilityFailure(error);
			process.exitCode = 2;
			return;
		}
		if (error instanceof SessionCompatibilityError) {
			if (intent === "rpc") process.stdout.write(stringifyRpcStartupFailure(error.toRpcStartupFailure()));
			else writeSessionCompatibilityFailure(error);
			process.exitCode = 2;
			return;
		}
		if (!(error instanceof ConversationOwnershipConflictError)) throw error;
		process.stdout.write(
			stringifyRpcStartupFailure({
				type: "response",
				command: "startup",
				success: false,
				errorCode: RPC_FAILURE_CODES.SESSION_LOCKED,
				phase: "startup",
				recoverability: "user_action",
				error: error.message,
				...(error.holder
					? {
							lockHolder: {
								pid: error.holder.pid,
								hostname: error.holder.hostname,
								openedAt: error.holder.acquiredAt,
							},
						}
					: {}),
			}),
		);
		process.exitCode = 2;
	}
}

function writeSessionCompatibilityFailure(error: SessionCompatibilityError): void {
	const version = error.sourceVersion === undefined ? "" : ` sourceVersion=${error.sourceVersion}`;
	const issue = error.issueCode === undefined ? "" : ` issue=${error.issueCode}:${error.issueCount ?? 1}`;
	process.stderr.write(
		`[agent-runtime] startup failed errorCode=${error.errorCode} session=${error.sessionPath}${version}${issue}: ${error.message}\n`,
	);
}

function writeExtensionCompatibilityFailure(error: ExtensionCompatibilityError): void {
	const unsupportedEvents = formatList("unsupportedEvents", error.unsupportedEvents);
	const unmetCapabilities = formatList("unmetCapabilities", error.unmetRuntimeCapabilities);
	process.stderr.write(
		`[agent-runtime] startup failed errorCode=${error.errorCode}${unsupportedEvents}${unmetCapabilities}: ${error.message}\n`,
	);
}

function assertSupportedSessionSelection(args: readonly string[]): void {
	if (args.includes("--resume") || args.includes("-r")) {
		throw new Error("--resume is no longer supported; use --continue or --session");
	}
}

function formatList(label: string, values: readonly string[] | undefined): string {
	return values && values.length > 0 ? ` ${label}=${values.join(",")}` : "";
}
