import type { AgentMessage } from "@vetta/agent-core";
import type { ConversationDocument } from "@vetta/runtime-core/conversation";
import {
	CodingAgentResourceReloadHost,
	type CodingAgentResourceReloadHostOptions,
} from "../../host/resources/resource-reload-host.js";
import type { CodingAgentSdkSessionCapabilityPort } from "../../host/sdk-session/runtime-contracts.js";
import {
	CodingAgentSdkSessionCapabilityHost,
	type CodingAgentSdkSessionCapabilityHostOptions,
} from "../../host/sdk-session/session-capability-host.js";
import {
	CodingAgentBranchNavigationHost,
	type CodingAgentBranchNavigationHostOptions,
	type CodingAgentBranchNavigationOptions,
} from "../../host/session-history/branch-navigation-host.js";
import type { CodingAgentBranchSummaryEntry } from "../../sessions/index.js";
import { projectCodingAgentMessages } from "../../sessions/projection/conversation-context-projector.js";

export type CodingAgentRuntimeBranchNavigationOptions = CodingAgentBranchNavigationOptions;
export type CodingAgentRuntimeBranchNavigationHostOptions = CodingAgentBranchNavigationHostOptions;
export type CodingAgentRuntimeResourceReloadHostOptions = CodingAgentResourceReloadHostOptions;
export type CodingAgentSessionCapabilityHostOptions = CodingAgentSdkSessionCapabilityHostOptions;
export type CodingAgentSessionCapabilityHost = CodingAgentSdkSessionCapabilityPort;

export interface CodingAgentRuntimeBranchNavigationHost {
	navigateTree(
		targetId: string,
		options?: CodingAgentRuntimeBranchNavigationOptions,
	): Promise<{
		readonly editorText?: string;
		readonly cancelled: boolean;
		readonly aborted?: boolean;
		readonly summaryEntry?: CodingAgentBranchSummaryEntry;
	}>;
	abortBranchSummary(): void;
}

export interface CodingAgentRuntimeResourceReloadHost {
	reload(): Promise<void>;
}

export function createCodingAgentRuntimeBranchNavigationHost(
	options: CodingAgentRuntimeBranchNavigationHostOptions,
): CodingAgentRuntimeBranchNavigationHost {
	return new CodingAgentBranchNavigationHost(options);
}

export function createCodingAgentRuntimeResourceReloadHost(
	options: CodingAgentRuntimeResourceReloadHostOptions,
): CodingAgentRuntimeResourceReloadHost {
	return new CodingAgentResourceReloadHost(options);
}

export function createCodingAgentSessionCapabilityHost(
	options: CodingAgentSessionCapabilityHostOptions,
): CodingAgentSessionCapabilityHost {
	return new CodingAgentSdkSessionCapabilityHost(options);
}

export function projectCodingAgentRuntimeMessages(document: ConversationDocument): readonly AgentMessage[] {
	return projectCodingAgentMessages(document);
}
