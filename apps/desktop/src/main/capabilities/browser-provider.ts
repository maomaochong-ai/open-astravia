import { bindCapability, type CapabilityRegistry } from "@vetta/capability-runtime";
import {
	CAPABILITY_ERROR_CODES,
	CapabilityError,
	type Disposable,
	FOUNDATION_BROWSER_CAPABILITIES,
} from "@vetta/capability-sdk";
import type { BrowserAutomationService } from "../browser-automation/browser-automation-service.js";
import { BrowserAutomationError } from "../browser-automation/contracts.js";

const BROWSER_PROVIDER_OWNER = "vetta.foundation.browser";

export type BrowserCapabilityService = Pick<
	BrowserAutomationService,
	| "runtimeStatus"
	| "installRuntime"
	| "createSession"
	| "getSession"
	| "closeSession"
	| "navigate"
	| "snapshot"
	| "readText"
	| "screenshot"
	| "act"
>;

function assertNotAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new CapabilityError(CAPABILITY_ERROR_CODES.ABORTED, "Browser capability invocation was aborted");
	}
}

function mapBrowserError(error: unknown): never {
	if (!(error instanceof BrowserAutomationError)) throw error;
	const code =
		error.code === "session_not_found"
			? CAPABILITY_ERROR_CODES.NOT_FOUND
			: error.code === "policy_denied" || error.code === "session_forbidden"
				? CAPABILITY_ERROR_CODES.ACCESS_DENIED
				: error.code === "invalid_request" || error.code === "stale_snapshot"
					? CAPABILITY_ERROR_CODES.INVALID_INPUT
					: CAPABILITY_ERROR_CODES.PROVIDER_FAILED;
	throw new CapabilityError(code, error.message, { cause: error });
}

async function executeBrowser<Output>(operation: () => Promise<Output>, signal: AbortSignal): Promise<Output> {
	assertNotAborted(signal);
	try {
		const output = await operation();
		assertNotAborted(signal);
		return output;
	} catch (error) {
		if (signal.aborted) {
			throw new CapabilityError(CAPABILITY_ERROR_CODES.ABORTED, "Browser capability invocation was aborted", {
				cause: error,
			});
		}
		mapBrowserError(error);
	}
}

export function registerDesktopBrowserProvider(
	registry: CapabilityRegistry,
	service: BrowserCapabilityService,
): Disposable {
	return registry.registerOwner(BROWSER_PROVIDER_OWNER, [
		bindCapability(FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_STATUS, {
			execute: async (_input, context) =>
				executeBrowser(() => service.runtimeStatus(context.signal), context.signal),
		}),
		bindCapability(FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_INSTALL, {
			execute: async (input, context) =>
				executeBrowser(() => service.installRuntime(input, context.signal), context.signal),
		}),
		bindCapability(FOUNDATION_BROWSER_CAPABILITIES.SESSION_CREATE, {
			execute: async (input, context) =>
				executeBrowser(() => service.createSession(input, context.signal), context.signal),
		}),
		bindCapability(FOUNDATION_BROWSER_CAPABILITIES.SESSION_GET, {
			execute: async (input, context) =>
				executeBrowser(() => Promise.resolve(service.getSession(input)), context.signal),
		}),
		bindCapability(FOUNDATION_BROWSER_CAPABILITIES.SESSION_CLOSE, {
			execute: async (input, context) =>
				executeBrowser(() => service.closeSession(input, context.signal), context.signal),
		}),
		bindCapability(FOUNDATION_BROWSER_CAPABILITIES.NAVIGATE, {
			execute: async (input, context) =>
				executeBrowser(() => service.navigate(input, context.signal), context.signal),
		}),
		bindCapability(FOUNDATION_BROWSER_CAPABILITIES.SNAPSHOT, {
			execute: async (input, context) =>
				executeBrowser(() => service.snapshot(input, context.signal), context.signal),
		}),
		bindCapability(FOUNDATION_BROWSER_CAPABILITIES.READ_TEXT, {
			execute: async (input, context) =>
				executeBrowser(() => service.readText(input, context.signal), context.signal),
		}),
		bindCapability(FOUNDATION_BROWSER_CAPABILITIES.SCREENSHOT, {
			execute: async (input, context) =>
				executeBrowser(() => service.screenshot(input, context.signal), context.signal),
		}),
		bindCapability(FOUNDATION_BROWSER_CAPABILITIES.ACT, {
			execute: async (input, context) => executeBrowser(() => service.act(input, context.signal), context.signal),
		}),
	]);
}
