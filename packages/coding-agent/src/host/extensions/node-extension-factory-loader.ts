import * as bundledTypebox from "@sinclair/typebox";
import * as bundledAgentCore from "@vetta/agent-core";
import * as bundledAi from "@vetta/ai";
import { createNodeDynamicModuleLoader, nodeFileUrlToPath, resolveNodeModuleSpecifier } from "@vetta/runtime-node/host";
import * as piTypebox from "typebox";
import * as piCompile from "typebox/compile";
import * as piValue from "typebox/value";
import { isBunBinary } from "../../config.js";
import type { ExtensionFactory } from "../../extensions/api-contracts.js";
import type { ExtensionFactoryLoader } from "../../extensions/host-contracts.js";
import * as bundledCodingAgent from "../../index.js";

const NATIVE_VIRTUAL_MODULES: Readonly<Record<string, unknown>> = {
	"@sinclair/typebox": bundledTypebox,
	"@vetta/agent-core": bundledAgentCore,
	"@vetta/ai": bundledAi,
	"@vetta/coding-agent": bundledCodingAgent,
	"@vetta/coding-agent/extensions": bundledCodingAgent,
};

const piCodingAgentFacade = Object.freeze({
	defineTool: <T>(definition: T): T => definition,
});

const piAiFacade = Object.freeze({
	Type: piTypebox.Type,
	StringEnum: <T extends readonly string[]>(values: T) =>
		piTypebox.Type.Union(values.map((value) => piTypebox.Type.Literal(value))),
});

const PI_VIRTUAL_MODULES: Readonly<Record<string, unknown>> = {
	typebox: piTypebox,
	"typebox/compile": piCompile,
	"typebox/value": piValue,
	"@sinclair/typebox": piTypebox,
	"@sinclair/typebox/compile": piCompile,
	"@sinclair/typebox/value": piValue,
	"@earendil-works/pi-coding-agent": piCodingAgentFacade,
	"@earendil-works/pi-ai": piAiFacade,
	"@mariozechner/pi-coding-agent": piCodingAgentFacade,
	"@mariozechner/pi-ai": piAiFacade,
};

let aliases: Readonly<Record<string, string>> | undefined;

/** Node compatibility implementation for native and Pi Extension module profiles. */
export function createCodingAgentNodeExtensionFactoryLoader(): ExtensionFactoryLoader {
	return {
		async loadFactory(extensionPath, profile, options) {
			options?.signal?.throwIfAborted();
			const nativeAliases = profile === "native" ? optionalAliases() : undefined;
			const loader = createNodeDynamicModuleLoader(import.meta.url, {
				virtualModules: profile === "pi" ? PI_VIRTUAL_MODULES : NATIVE_VIRTUAL_MODULES,
				...(nativeAliases ? { aliases: nativeAliases } : {}),
			});
			const module = await loader.importDefault(extensionPath);
			options?.signal?.throwIfAborted();
			return typeof module === "function" ? (module as ExtensionFactory) : undefined;
		},
	};
}

function optionalAliases(): Readonly<Record<string, string>> | undefined {
	if (isBunBinary) return undefined;
	try {
		return resolveAliases();
	} catch {
		return undefined;
	}
}

function resolveAliases(): Readonly<Record<string, string>> {
	if (aliases) return aliases;
	const packageIndex = nodeFileUrlToPath(new URL("../../index.js", import.meta.url));
	const typeboxEntry = resolveNodeModuleSpecifier("@sinclair/typebox", import.meta.url);
	const typeboxRoot = typeboxEntry.replace(/[\\/]build[\\/]cjs[\\/]index\.js$/, "");
	aliases = {
		"@vetta/coding-agent": packageIndex,
		"@vetta/agent-core": resolveNodeModuleSpecifier("@vetta/agent-core", import.meta.url),
		"@vetta/ai": resolveNodeModuleSpecifier("@vetta/ai", import.meta.url),
		"@sinclair/typebox": typeboxRoot,
	};
	return aliases;
}
