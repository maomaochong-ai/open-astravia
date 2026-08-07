import type { ImageContent, TextContent } from "@vetta/ai";
import type {
	CodingAgentNewSessionOptions,
	CodingAgentSession,
	CodingAgentTreeNavigationOptions,
} from "../../public-api/sdk/sdk-session-contract.js";
import type {
	CodingAgentSdkActiveSessionCapabilityPort,
	CodingAgentSdkSessionRuntimePort,
} from "./runtime-contracts.js";
import { CodingAgentSdkSessionAdapter } from "./session-adapter.js";

/**
 * 在固定 Session 门面之外叠加活动会话所有权。
 *
 * 对象本身保持稳定；身份切换只替换 Active Session Host 内部的 Runtime Session。
 */
export class CodingAgentSdkActiveSessionAdapter extends CodingAgentSdkSessionAdapter implements CodingAgentSession {
	constructor(
		runtime: CodingAgentSdkSessionRuntimePort,
		private readonly active: CodingAgentSdkActiveSessionCapabilityPort,
		onClosed?: () => void,
	) {
		super(runtime, onClosed);
	}

	getSessionBranch(): ReturnType<CodingAgentSession["getSessionBranch"]> {
		return this.active.getSessionBranch();
	}

	sendCustomMessage<T = unknown>(
		message: {
			readonly customType: string;
			readonly content: string | readonly (TextContent | ImageContent)[];
			readonly display: boolean;
			readonly details?: T;
		},
		options?: Parameters<CodingAgentSession["sendCustomMessage"]>[1],
	): Promise<void> {
		return this.active.sendCustomMessage<T>(message, options);
	}

	sendUserMessage(
		content: Parameters<CodingAgentSession["sendUserMessage"]>[0],
		options?: Parameters<CodingAgentSession["sendUserMessage"]>[1],
	): Promise<void> {
		return this.active.sendUserMessage(content, options);
	}

	newSession(options?: CodingAgentNewSessionOptions): Promise<boolean> {
		return this.active.newSession(options);
	}

	abortBranchSummary(): void {
		this.active.abortBranchSummary();
	}

	executeBash(
		command: string,
		onChunk?: (chunk: string) => void,
		options?: Parameters<CodingAgentSession["executeBash"]>[2],
	): ReturnType<CodingAgentSession["executeBash"]> {
		return this.active.executeBash(command, onChunk, options);
	}

	recordBashResult(
		command: string,
		result: Parameters<CodingAgentSession["recordBashResult"]>[1],
		options?: Parameters<CodingAgentSession["recordBashResult"]>[2],
	): Promise<void> {
		return this.active.recordBashResult(command, result, options);
	}

	abortBash(): void {
		this.active.abortBash();
	}

	get isBashRunning(): boolean {
		return this.active.isBashRunning;
	}

	get hasPendingBashMessages(): boolean {
		return this.active.hasPendingBashMessages;
	}

	switchSession(sessionPath: string): Promise<boolean> {
		return this.active.switchSession(sessionPath);
	}

	async fork(entryId: string): Promise<{ selectedText: string; cancelled: boolean }> {
		return this.active.fork(entryId);
	}

	navigateTree(
		targetId: string,
		options?: CodingAgentTreeNavigationOptions,
	): ReturnType<CodingAgentSession["navigateTree"]> {
		return this.active.navigateTree(targetId, options);
	}

	switchBranch(targetId: string): ReturnType<CodingAgentSession["switchBranch"]> {
		return this.active.switchBranch(targetId);
	}

	appendBranchSummary(
		parentId: string | null,
		summary: string,
		details?: unknown,
		fromHook?: boolean,
	): ReturnType<CodingAgentSession["appendBranchSummary"]> {
		return this.active.appendBranchSummary(parentId, summary, details, fromHook);
	}

	deleteMessage(entryId: string): ReturnType<CodingAgentSession["deleteMessage"]> {
		return this.active.deleteMessage(entryId);
	}

	replaceLastUserMessage(entryId: string): ReturnType<CodingAgentSession["replaceLastUserMessage"]> {
		return this.active.replaceLastUserMessage(entryId);
	}

	exportForkToNewFile(entryId: string): ReturnType<CodingAgentSession["exportForkToNewFile"]> {
		return this.active.exportForkToNewFile(entryId);
	}

	getUserMessagesForForking(): ReturnType<CodingAgentSession["getUserMessagesForForking"]> {
		return this.active.getUserMessagesForForking();
	}
}
