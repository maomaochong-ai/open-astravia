import { DOMAIN_DOWNLOAD_CAPABILITIES, type DownloadItem } from "@vetta/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginDownloadMethods = {
	listDownloads(this: PluginCapabilitySessionAccess, sessionId: string): Promise<DownloadItem[]> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_DOWNLOAD_CAPABILITIES.LIST, {});
	},

	cancelDownload(this: PluginCapabilitySessionAccess, sessionId: string, id: string): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_DOWNLOAD_CAPABILITIES.CANCEL, { id });
	},
};

export type PluginDownloadMethods = typeof pluginDownloadMethods;
