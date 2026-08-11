import type { ExtensionCommandContextActions } from "../../extensions/index.js";
import type { CodingAgentExtensionCommandActionPorts } from "./contracts.js";

type ExtensionNewSessionOptions = NonNullable<Parameters<ExtensionCommandContextActions["newSession"]>[0]>;

export function createCodingAgentExtensionCommandActions(
	ports: CodingAgentExtensionCommandActionPorts,
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
	ports: Pick<CodingAgentExtensionCommandActionPorts, "createSessionSetupInitializer">,
) {
	if (!options) return undefined;
	return {
		...(options.parentSession !== undefined ? { parentSession: options.parentSession } : {}),
		...(options.setup ? { seedInitializer: ports.createSessionSetupInitializer(options.setup) } : {}),
	};
}
