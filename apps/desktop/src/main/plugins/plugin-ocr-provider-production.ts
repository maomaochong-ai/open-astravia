import { randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { getDesktopOcrProviderRegistry } from "../capabilities/ocr-providers.js";
import { listPlugins } from "./plugin-catalog.js";
import { PluginOcrProviderHost } from "./plugin-ocr-provider-host.js";

export function createPluginOcrProviderHost(): PluginOcrProviderHost {
	return new PluginOcrProviderHost({
		listPlugins,
		createRequestId: randomUUID,
		fetch,
		openAsBlob,
		getRegistry: getDesktopOcrProviderRegistry,
	});
}
