import { bindCapability, type CapabilityRegistry } from "@vetta/capability-runtime";
import {
	CAPABILITY_ERROR_CODES,
	CapabilityError,
	type Disposable,
	DOMAIN_MCP_CAPABILITIES,
} from "@vetta/capability-sdk";
import { getDesktopMcpSettingsService } from "../mcp/mcp-settings-service.js";

const DOMAIN_MCP_PROVIDER_OWNER = "vetta.domain.mcp";

function assertNotAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new CapabilityError(CAPABILITY_ERROR_CODES.ABORTED, "Capability invocation was aborted");
	}
}

export function registerDesktopMcpProviders(registry: CapabilityRegistry): Disposable {
	const mcp = getDesktopMcpSettingsService();
	return registry.registerOwner(DOMAIN_MCP_PROVIDER_OWNER, [
		bindCapability(DOMAIN_MCP_CAPABILITIES.LIST_SERVERS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return mcp.list();
			},
		}),
		bindCapability(DOMAIN_MCP_CAPABILITIES.GET_SERVER, {
			execute: async ({ name }, context) => {
				assertNotAborted(context.signal);
				return mcp.get(name);
			},
		}),
		bindCapability(DOMAIN_MCP_CAPABILITIES.UPSERT_SERVER, {
			execute: async ({ name, data }, context) => {
				assertNotAborted(context.signal);
				return mcp.upsert(name, data);
			},
		}),
		bindCapability(DOMAIN_MCP_CAPABILITIES.SET_SERVER_ENABLED, {
			execute: async ({ name, enabled }, context) => {
				assertNotAborted(context.signal);
				await mcp.setEnabled(name, enabled);
			},
		}),
		bindCapability(DOMAIN_MCP_CAPABILITIES.REMOVE_SERVER, {
			execute: async ({ name }, context) => {
				assertNotAborted(context.signal);
				await mcp.remove(name);
			},
		}),
	]);
}
