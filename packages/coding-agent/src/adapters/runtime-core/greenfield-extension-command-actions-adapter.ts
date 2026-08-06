import type {
	CodingAgentNewSessionOptions,
	CodingAgentSessionSeedInitializer,
} from "../../composition/session-host/active-session-transition-contracts.js";
import type { ExtensionCommandContextActions } from "../../extensions/index.js";
import type { CodingAgentGreenfieldBranchNavigationOptions } from "./greenfield-branch-navigation-host.js";

type ExtensionNewSessionOptions = NonNullable<Parameters<ExtensionCommandContextActions["newSession"]>[0]>;
type ExtensionSessionSetup = NonNullable<ExtensionNewSessionOptions["setup"]>;

export interface CodingAgentGreenfieldExtensionCommandActionPorts {
	waitForIdle(): Promise<void>;
	newSession(options?: CodingAgentNewSessionOptions): Promise<{ cancelled: boolean }>;
	createSessionSetupInitializer(setup: ExtensionSessionSetup): CodingAgentSessionSeedInitializer;
	fork(entryId: string): Promise<{ readonly cancelled: boolean }>;
	navigateTree(
		targetId: string,
		options?: CodingAgentGreenfieldBranchNavigationOptions,
	): Promise<{ cancelled: boolean }>;
	switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
	reload(): Promise<void>;
}

/** 将既有 Extension command context 合同适配为中性的 Greenfield 宿主端口。 */
export function createCodingAgentGreenfieldExtensionCommandActions(
	ports: CodingAgentGreenfieldExtensionCommandActionPorts,
): ExtensionCommandContextActions {
	return {
		waitForIdle: () => ports.waitForIdle(),
		newSession: (options) => ports.newSession(adaptNewSessionOptions(options, ports)),
		fork: async (entryId) => {
			const result = await ports.fork(entryId);
			return { cancelled: result.cancelled };
		},
		navigateTree: (targetId, options) => ports.navigateTree(targetId, options),
		switchSession: (sessionPath) => ports.switchSession(sessionPath),
		reload: () => ports.reload(),
	};
}

function adaptNewSessionOptions(
	options: ExtensionNewSessionOptions | undefined,
	ports: Pick<CodingAgentGreenfieldExtensionCommandActionPorts, "createSessionSetupInitializer">,
): CodingAgentNewSessionOptions | undefined {
	if (!options) return undefined;
	return {
		...(options.parentSession !== undefined ? { parentSession: options.parentSession } : {}),
		...(options.setup ? { seedInitializer: ports.createSessionSetupInitializer(options.setup) } : {}),
	};
}
