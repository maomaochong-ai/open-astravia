import type { ExtensionSessionView } from "../../src/extensions/index.js";

export function createExtensionSessionView(cwd: string): ExtensionSessionView {
	return {
		getCwd: () => cwd,
		getSessionDir: () => cwd,
		getSessionId: () => "test-session",
		getSessionFile: () => undefined,
		getLeafId: () => null,
		getLeafEntry: () => undefined,
		getEntry: () => undefined,
		getLabel: () => undefined,
		getBranch: () => [],
		getHeader: () => null,
		getEntries: () => [],
		getTree: () => [],
		getSessionName: () => undefined,
	};
}
