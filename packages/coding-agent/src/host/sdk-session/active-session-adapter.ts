import type { ImageContent, TextContent } from "@vetta/ai";
import type {
	GreenfieldSdkActiveSession,
	GreenfieldSdkActiveSessionCapabilityPort,
	GreenfieldSdkNewSessionOptions,
	GreenfieldSdkSessionRuntimePort,
	GreenfieldSdkTreeNavigationOptions,
} from "./runtime-contracts.js";
import { GreenfieldSdkSessionAdapter } from "./session-adapter.js";

/**
 * 在固定 Session 门面之外叠加活动会话所有权。
 *
 * 对象本身保持稳定；身份切换只替换 Active Session Host 内部的 Runtime Session。
 */
export class GreenfieldSdkActiveSessionAdapter
	extends GreenfieldSdkSessionAdapter
	implements GreenfieldSdkActiveSession
{
	constructor(
		runtime: GreenfieldSdkSessionRuntimePort,
		private readonly active: GreenfieldSdkActiveSessionCapabilityPort,
		onClosed?: () => void,
	) {
		super(runtime, onClosed);
	}

	getSessionBranch(): ReturnType<GreenfieldSdkActiveSession["getSessionBranch"]> {
		return this.active.getSessionBranch();
	}

	sendCustomMessage<T = unknown>(
		message: {
			readonly customType: string;
			readonly content: string | readonly (TextContent | ImageContent)[];
			readonly display: boolean;
			readonly details?: T;
		},
		options?: Parameters<GreenfieldSdkActiveSession["sendCustomMessage"]>[1],
	): Promise<void> {
		return this.active.sendCustomMessage<T>(message, options);
	}

	sendUserMessage(
		content: Parameters<GreenfieldSdkActiveSession["sendUserMessage"]>[0],
		options?: Parameters<GreenfieldSdkActiveSession["sendUserMessage"]>[1],
	): Promise<void> {
		return this.active.sendUserMessage(content, options);
	}

	newSession(options?: GreenfieldSdkNewSessionOptions): Promise<boolean> {
		return this.active.newSession(options);
	}

	abortBranchSummary(): void {
		this.active.abortBranchSummary();
	}

	executeBash(
		command: string,
		onChunk?: (chunk: string) => void,
		options?: Parameters<GreenfieldSdkActiveSession["executeBash"]>[2],
	): ReturnType<GreenfieldSdkActiveSession["executeBash"]> {
		return this.active.executeBash(command, onChunk, options);
	}

	recordBashResult(
		command: string,
		result: Parameters<GreenfieldSdkActiveSession["recordBashResult"]>[1],
		options?: Parameters<GreenfieldSdkActiveSession["recordBashResult"]>[2],
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
		options?: GreenfieldSdkTreeNavigationOptions,
	): ReturnType<GreenfieldSdkActiveSession["navigateTree"]> {
		return this.active.navigateTree(targetId, options);
	}

	switchBranch(targetId: string): ReturnType<GreenfieldSdkActiveSession["switchBranch"]> {
		return this.active.switchBranch(targetId);
	}

	appendBranchSummary(
		parentId: string | null,
		summary: string,
		details?: unknown,
		fromHook?: boolean,
	): ReturnType<GreenfieldSdkActiveSession["appendBranchSummary"]> {
		return this.active.appendBranchSummary(parentId, summary, details, fromHook);
	}

	deleteMessage(entryId: string): ReturnType<GreenfieldSdkActiveSession["deleteMessage"]> {
		return this.active.deleteMessage(entryId);
	}

	replaceLastUserMessage(entryId: string): ReturnType<GreenfieldSdkActiveSession["replaceLastUserMessage"]> {
		return this.active.replaceLastUserMessage(entryId);
	}

	exportForkToNewFile(entryId: string): ReturnType<GreenfieldSdkActiveSession["exportForkToNewFile"]> {
		return this.active.exportForkToNewFile(entryId);
	}

	getUserMessagesForForking(): ReturnType<GreenfieldSdkActiveSession["getUserMessagesForForking"]> {
		return this.active.getUserMessagesForForking();
	}
}
