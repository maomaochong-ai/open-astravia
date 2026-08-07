import type { ImageContent, TextContent } from "@vetta/ai";
import type { GreenfieldRuntimeSession } from "@vetta/runtime-core";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import { createGreenfieldReadonlySessionManager } from "../../adapters/runtime-core/greenfield-readonly-session-manager.js";
import type { CodingAgentActiveSessionHost } from "../../composition/session-host/active-session-transition-host.js";
import type {
	GreenfieldSdkActiveSessionCapabilityPort,
	GreenfieldSdkBashOperations,
	GreenfieldSdkBashResult,
	GreenfieldSdkNewSessionOptions,
	GreenfieldSdkTreeNavigationOptions,
	GreenfieldSdkTreeNavigationResult,
} from "./runtime-contracts.js";

export interface CodingAgentGreenfieldSdkBashPort {
	execute(
		session: GreenfieldRuntimeSession,
		command: string,
		onChunk?: (chunk: string) => void,
		options?: { readonly excludeFromContext?: boolean; readonly operations?: GreenfieldSdkBashOperations },
	): Promise<GreenfieldSdkBashResult>;
	record(
		session: GreenfieldRuntimeSession,
		command: string,
		result: GreenfieldSdkBashResult,
		options?: { readonly excludeFromContext?: boolean },
	): Promise<void>;
	abort(): void;
	readonly isRunning: boolean;
	hasPending(sessionId: string): boolean;
	quiesce(session: GreenfieldRuntimeSession): Promise<void>;
	dispose(): Promise<void>;
}

export interface CodingAgentGreenfieldSdkTreeNavigationPort {
	navigateTree(
		targetId: string,
		options?: GreenfieldSdkTreeNavigationOptions,
	): Promise<GreenfieldSdkTreeNavigationResult>;
	abortBranchSummary(): void;
}

export interface CodingAgentGreenfieldSdkActiveSessionCapabilityHostOptions {
	readonly sessionHost: Pick<
		CodingAgentActiveSessionHost,
		| "fork"
		| "newSession"
		| "readSession"
		| "runActiveSessionMutation"
		| "startActiveSessionOperation"
		| "switchSession"
	>;
	readonly createSessionSetupInitializer?: (
		setup: NonNullable<GreenfieldSdkNewSessionOptions["setup"]>,
	) => NonNullable<Parameters<CodingAgentActiveSessionHost["newSession"]>[0]>["seedInitializer"];
	readonly treeNavigation?: CodingAgentGreenfieldSdkTreeNavigationPort;
	readonly bash?: CodingAgentGreenfieldSdkBashPort;
}

/** SDK 活动会话命令到 Runtime 历史、上下文和身份事务端口的适配器。 */
export class CodingAgentGreenfieldSdkActiveSessionCapabilityHost implements GreenfieldSdkActiveSessionCapabilityPort {
	constructor(private readonly options: CodingAgentGreenfieldSdkActiveSessionCapabilityHostOptions) {}

	getSessionBranch() {
		return createGreenfieldReadonlySessionManager(this.readSession().createCoreAssembly()).getBranch();
	}

	sendCustomMessage<T = unknown>(
		message: {
			readonly customType: string;
			readonly content: string | readonly (TextContent | ImageContent)[];
			readonly display: boolean;
			readonly details?: T;
		},
		options?: { readonly triggerTurn?: boolean; readonly deliverAs?: "steer" | "followUp" | "nextTurn" },
	): Promise<void> {
		return this.options.sessionHost.startActiveSessionOperation(async (session) => {
			const mode = resolveCustomMessageDeliveryMode(session, options);
			const record: SessionContextRecord = {
				type: message.customType,
				content: normalizeContent(message.content),
				modelVisible: true,
				display: message.display,
				metadata: message.details,
				timestamp: Date.now(),
			};
			await session.createCoreAssembly().contextDeliveryController.deliver([record], mode);
		});
	}

	sendUserMessage(
		content: string | readonly (TextContent | ImageContent)[],
		options?: { readonly deliverAs?: "steer" | "followUp" },
	): Promise<void> {
		const normalized = normalizeUserContent(content);
		return this.options.sessionHost.startActiveSessionOperation(async (session) => {
			await session.prompt({
				text: normalized.text,
				images: normalized.images,
				streamingBehavior: options?.deliverAs,
			});
		});
	}

	async newSession(options?: GreenfieldSdkNewSessionOptions): Promise<boolean> {
		const seedInitializer = options?.setup ? this.options.createSessionSetupInitializer?.(options.setup) : undefined;
		if (options?.setup && !seedInitializer) {
			throw new Error("Greenfield SDK session setup compatibility is unavailable");
		}
		const result = await this.options.sessionHost.newSession({
			...(options?.parentSession ? { parentSession: options.parentSession } : {}),
			...(seedInitializer ? { seedInitializer } : {}),
		});
		return !result.cancelled;
	}

	abortBranchSummary(): void {
		this.options.treeNavigation?.abortBranchSummary();
	}

	executeBash(
		command: string,
		onChunk?: (chunk: string) => void,
		options?: { readonly excludeFromContext?: boolean; readonly operations?: GreenfieldSdkBashOperations },
	): Promise<GreenfieldSdkBashResult> {
		const bash = this.requireBash();
		return this.options.sessionHost.startActiveSessionOperation((session) =>
			bash.execute(session, command, onChunk, options),
		);
	}

	recordBashResult(
		command: string,
		result: GreenfieldSdkBashResult,
		options?: { readonly excludeFromContext?: boolean },
	): Promise<void> {
		const bash = this.requireBash();
		return this.options.sessionHost.runActiveSessionMutation((session) =>
			bash.record(session, command, result, options),
		);
	}

	abortBash(): void {
		this.options.bash?.abort();
	}

	get isBashRunning(): boolean {
		return this.options.bash?.isRunning ?? false;
	}

	get hasPendingBashMessages(): boolean {
		return this.options.bash?.hasPending(this.readSession().sessionId) ?? false;
	}

	async switchSession(sessionPath: string): Promise<boolean> {
		return !(await this.options.sessionHost.switchSession(sessionPath)).cancelled;
	}

	async fork(entryId: string): Promise<{ selectedText: string; cancelled: boolean }> {
		const result = await this.options.sessionHost.fork(entryId);
		return { selectedText: result.text, cancelled: result.cancelled };
	}

	navigateTree(
		targetId: string,
		options?: GreenfieldSdkTreeNavigationOptions,
	): Promise<GreenfieldSdkTreeNavigationResult> {
		if (!this.options.treeNavigation) {
			throw new Error("Greenfield SDK tree navigation capability is unavailable");
		}
		return this.options.treeNavigation.navigateTree(targetId, options);
	}

	switchBranch(targetId: string): Promise<{ leafId: string }> {
		return this.options.sessionHost.runActiveSessionMutation((session) =>
			session.createCoreAssembly().historyController.switchBranch(targetId),
		);
	}

	appendBranchSummary(
		parentId: string | null,
		summary: string,
		details?: unknown,
		fromHook?: boolean,
	): Promise<{ entryId: string }> {
		return this.options.sessionHost.runActiveSessionMutation((session) =>
			session.createCoreAssembly().historyController.appendBranchSummary(parentId, summary, details, fromHook),
		);
	}

	deleteMessage(entryId: string): Promise<{ leafId: string | null }> {
		return this.options.sessionHost.runActiveSessionMutation((session) =>
			session.createCoreAssembly().historyController.deleteMessage(entryId),
		);
	}

	replaceLastUserMessage(entryId: string): Promise<{ leafId: string | null }> {
		return this.options.sessionHost.runActiveSessionMutation((session) =>
			session.createCoreAssembly().historyController.replaceLastUserMessage(entryId),
		);
	}

	exportForkToNewFile(entryId: string): Promise<{ path: string; text: string }> {
		return this.options.sessionHost.runActiveSessionMutation((session) =>
			session.createCoreAssembly().historyController.forkSession(entryId),
		);
	}

	getUserMessagesForForking(): readonly { entryId: string; text: string }[] {
		return createGreenfieldReadonlySessionManager(this.readSession().createCoreAssembly())
			.getEntries()
			.flatMap((entry) => {
				if (entry.type !== "message" || entry.message.role !== "user") return [];
				const text = readContentText(entry.message.content);
				return text ? [{ entryId: entry.id, text }] : [];
			});
	}

	async quiesceIdentity(): Promise<void> {
		const bash = this.options.bash;
		if (bash) await bash.quiesce(this.readSession());
	}

	dispose(): Promise<void> {
		return this.options.bash?.dispose() ?? Promise.resolve();
	}

	private readSession(): GreenfieldRuntimeSession {
		return this.options.sessionHost.readSession();
	}

	private requireBash(): CodingAgentGreenfieldSdkBashPort {
		if (!this.options.bash) throw new Error("Greenfield SDK Bash capability is unavailable");
		return this.options.bash;
	}
}

function resolveCustomMessageDeliveryMode(
	session: GreenfieldRuntimeSession,
	options: { readonly triggerTurn?: boolean; readonly deliverAs?: "steer" | "followUp" | "nextTurn" } | undefined,
) {
	if (options?.deliverAs === "nextTurn") return "nextTurn" as const;
	if (session.readState().isStreaming) return options?.deliverAs === "followUp" ? "followUp" : "steer";
	return options?.triggerTurn ? "triggerTurn" : "record";
}

function normalizeContent(content: string | readonly (TextContent | ImageContent)[]): (TextContent | ImageContent)[] {
	return typeof content === "string" ? [{ type: "text", text: content }] : [...content];
}

function normalizeUserContent(content: string | readonly (TextContent | ImageContent)[]): {
	readonly text: string;
	readonly images: ImageContent[] | undefined;
} {
	if (typeof content === "string") return { text: content, images: undefined };
	const text = content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	const images = content.filter((part): part is ImageContent => part.type === "image");
	return { text, images: images.length > 0 ? images : undefined };
}

function readContentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			typeof part === "object" && part !== null && typeof Reflect.get(part, "text") === "string"
				? Reflect.get(part, "text")
				: "",
		)
		.join("");
}
