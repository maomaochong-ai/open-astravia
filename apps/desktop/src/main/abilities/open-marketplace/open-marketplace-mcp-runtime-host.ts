import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { getAppLogger } from "../../logger.js";
import { ManagedHttpRuntimeService, type ManagedHttpRuntimeSpec } from "./open-marketplace-managed-http-runtime.js";
import { OpenMarketplaceMcpRuntimeInstaller } from "./open-marketplace-mcp-runtime.js";

const mcpRuntimeRoot = join(getVettaHomePath(), "abilities", "mcp");
export const openMarketplaceMcpRuntimeInstaller = new OpenMarketplaceMcpRuntimeInstaller({ rootDir: mcpRuntimeRoot });
const runtimeService = new ManagedHttpRuntimeService({
	rootDir: mcpRuntimeRoot,
	onDiagnostic: (message) => {
		try {
			getAppLogger("mcp").debug(`managed marketplace runtime ${message}`);
		} catch {
			// Lightweight test hosts may not configure Electron logging.
		}
	},
});
const setupStatus = new Map<string, boolean>();

export const ensureOpenMarketplaceManagedMcpRuntime = (runtimeId: string): Promise<string> =>
	runtimeService.ensure(runtimeId);
export const readOpenMarketplaceManagedMcpRuntimeSpec = (runtimeId: string): Promise<ManagedHttpRuntimeSpec> =>
	runtimeService.readSpec(runtimeId);
export const recordOpenMarketplaceMcpSetupStatus = (runtimeId: string, authenticated: boolean): void => {
	setupStatus.set(runtimeId, authenticated);
};
export const getRecordedOpenMarketplaceMcpSetupStatus = (runtimeId: string): boolean =>
	setupStatus.get(runtimeId) ?? false;
export const stopOpenMarketplaceManagedMcpRuntime = async (runtimeId: string): Promise<void> => {
	await runtimeService.stop(runtimeId);
	setupStatus.delete(runtimeId);
};
export const removeOpenMarketplaceManagedMcpRuntime = async (sourceId: string, slug: string): Promise<void> => {
	const runtimeId = openMarketplaceMcpRuntimeInstaller.runtimeId(sourceId, slug);
	await stopOpenMarketplaceManagedMcpRuntime(runtimeId);
	await openMarketplaceMcpRuntimeInstaller.remove(sourceId, slug);
};
export const stopAllOpenMarketplaceMcpRuntimes = (): Promise<void> => runtimeService.stopAll();
