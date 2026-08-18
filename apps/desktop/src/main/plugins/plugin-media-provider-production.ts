import { randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { getDesktopMediaRuntime } from "../capabilities/media-providers.js";
import { listPlugins } from "./plugin-catalog.js";
import { PluginMediaProviderHost } from "./plugin-media-provider-host.js";

export function createPluginMediaProviderHost(): PluginMediaProviderHost {
	return new PluginMediaProviderHost({
		listPlugins,
		getMediaRuntime: getDesktopMediaRuntime,
		createRequestId: randomUUID,
		fetch,
		openAsBlob,
	});
}
