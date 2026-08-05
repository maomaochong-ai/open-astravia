import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parsePluginManifest } from "@vetta-org/plugin-sdk/manifest";
import type { HMRPayload, Plugin, PluginOption, ResolvedConfig } from "vite";
import { emitVettaPluginDevEvent } from "./dev-events.js";

export const VETTA_PLUGIN_DEV_ENTRY_ID = "virtual:vetta-plugin-dev-entry";

const RESOLVED_DEV_ENTRY_ID = `\0${VETTA_PLUGIN_DEV_ENTRY_ID}`;
const DEV_PREAMBLE_PATH = "/@vetta-plugin-dev-preamble";

export function isVettaPluginDevServer(): boolean {
	return process.env.VETTA_PLUGIN_DEV_SERVER === "1";
}

function readPluginId(config: ResolvedConfig): string {
	const raw: unknown = JSON.parse(readFileSync(resolve(config.root, "plugin.json"), "utf8"));
	return parsePluginManifest(raw).id;
}

function createDevEntryPlugin(entry: string): Plugin {
	let pluginId = "";
	let entryUrl = "";
	return {
		name: "vetta-plugin-dev-entry",
		apply: "serve",
		configResolved(config) {
			pluginId = readPluginId(config);
			entryUrl = `/${relative(config.root, resolve(config.root, entry)).replaceAll("\\", "/")}`;
		},
		resolveId(id) {
			return id === VETTA_PLUGIN_DEV_ENTRY_ID ? RESOLVED_DEV_ENTRY_ID : undefined;
		},
		load(id) {
			if (id !== RESOLVED_DEV_ENTRY_ID) return;
			return `
import * as pluginModule from ${JSON.stringify(entryUrl)};

const moduleStore = globalThis.__VETTA_PLUGIN_DEV_MODULES__ ??= new Map();
moduleStore.set(${JSON.stringify(pluginId)}, pluginModule);

export * from ${JSON.stringify(entryUrl)};
export default pluginModule.default;

if (import.meta.hot) {
  import.meta.hot.accept(${JSON.stringify(entryUrl)}, (nextModule) => {
    if (!nextModule) return;
    moduleStore.set(${JSON.stringify(pluginId)}, nextModule);
    import.meta.hot.send("vetta:plugin-lifecycle-reload", {
      pluginId: ${JSON.stringify(pluginId)},
      reason: "entry",
    });
  });
  import.meta.hot.on("vetta:plugin-full-reload", async () => {
    const nextModule = await import(${JSON.stringify(`${entryUrl}?vetta-reload=`)} + Date.now());
    moduleStore.set(${JSON.stringify(pluginId)}, nextModule);
    import.meta.hot.send("vetta:plugin-lifecycle-reload", {
      pluginId: ${JSON.stringify(pluginId)},
      reason: "full-reload",
    });
  });
}
`;
		},
	};
}

function createDevRuntimePlugin(): Plugin {
	let pluginId = "";
	return {
		name: "vetta-plugin-dev-runtime",
		apply: "serve",
		configResolved(config) {
			pluginId = readPluginId(config);
		},
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				if (request.url?.split("?", 1)[0] !== DEV_PREAMBLE_PATH) {
					next();
					return;
				}
				response.statusCode = 200;
				response.setHeader("Content-Type", "text/javascript");
				response.end(`
import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
`);
			});

			server.ws.on("vetta:plugin-lifecycle-reload", (data) => {
				const reason =
					typeof data === "object" && data !== null && "reason" in data && data.reason === "full-reload"
						? "full-reload"
						: "entry";
				emitVettaPluginDevEvent({ type: "update", pluginId, reason });
			});

			const send = server.ws.send.bind(server.ws);
			server.ws.send = ((payloadOrEvent: unknown, data?: unknown) => {
				if (typeof payloadOrEvent === "object" && payloadOrEvent !== null && "type" in payloadOrEvent) {
					if (payloadOrEvent.type === "full-reload") {
						send({ type: "custom", event: "vetta:plugin-full-reload", data: {} });
						return;
					}
					if (payloadOrEvent.type === "error" && "err" in payloadOrEvent) {
						const error = payloadOrEvent.err;
						const message =
							typeof error === "object" && error !== null && "message" in error
								? String(error.message)
								: String(error);
						emitVettaPluginDevEvent({ type: "error", pluginId, message });
					}
				}
				if (typeof payloadOrEvent === "string") {
					send(payloadOrEvent, data);
					return;
				}
				send(payloadOrEvent as HMRPayload);
			}) as typeof server.ws.send;
		},
	};
}

export function createVettaPluginDevPlugins(entry: string): PluginOption[] {
	return [react(), createDevEntryPlugin(entry), createDevRuntimePlugin()];
}
