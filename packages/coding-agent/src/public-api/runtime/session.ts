import type { AgentMessage } from "@vetta/agent-core";
import type { ConversationDocument } from "@vetta/runtime-core/conversation";
import { projectCodingAgentGreenfieldMessages } from "../../adapters/runtime-core/greenfield-agent-message-context-projector.js";
import {
	CodingAgentGreenfieldBranchNavigationHost,
	type CodingAgentGreenfieldBranchNavigationHostOptions,
	type CodingAgentGreenfieldBranchNavigationOptions,
} from "../../adapters/runtime-core/greenfield-branch-navigation-host.js";
import {
	CodingAgentGreenfieldResourceReloadHost,
	type CodingAgentGreenfieldResourceReloadHostOptions,
} from "../../adapters/runtime-core/greenfield-resource-reload-host.js";
import type { GreenfieldSdkSessionCapabilityPort } from "../../host/sdk-session/runtime-contracts.js";
import {
	CodingAgentGreenfieldSessionCapabilityHost,
	type CodingAgentGreenfieldSessionCapabilityHostOptions,
} from "../../host/sdk-session/session-capability-host.js";
import type { CodingAgentBranchSummaryEntry } from "../../sessions/index.js";

export type CodingAgentRuntimeBranchNavigationOptions = CodingAgentGreenfieldBranchNavigationOptions;
export type CodingAgentRuntimeBranchNavigationHostOptions = CodingAgentGreenfieldBranchNavigationHostOptions;
export type CodingAgentRuntimeResourceReloadHostOptions = CodingAgentGreenfieldResourceReloadHostOptions;
export type CodingAgentSessionCapabilityHostOptions = CodingAgentGreenfieldSessionCapabilityHostOptions;
export type CodingAgentSessionCapabilityHost = GreenfieldSdkSessionCapabilityPort;

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
	return new CodingAgentGreenfieldBranchNavigationHost(options);
}

export function createCodingAgentRuntimeResourceReloadHost(
	options: CodingAgentRuntimeResourceReloadHostOptions,
): CodingAgentRuntimeResourceReloadHost {
	return new CodingAgentGreenfieldResourceReloadHost(options);
}

export function createCodingAgentSessionCapabilityHost(
	options: CodingAgentSessionCapabilityHostOptions,
): CodingAgentSessionCapabilityHost {
	return new CodingAgentGreenfieldSessionCapabilityHost(options);
}

export function projectCodingAgentRuntimeMessages(document: ConversationDocument): readonly AgentMessage[] {
	return projectCodingAgentGreenfieldMessages(document);
}
