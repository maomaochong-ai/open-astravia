import { bindCapability, type CapabilityRegistry } from "@astravia/capability-runtime";
import type {
	BrowserActInput,
	BrowserActionResult,
	BrowserNavigateInput,
	BrowserPageState,
	BrowserReadTextInput,
	BrowserRuntimeInstallInput,
	BrowserRuntimeStatus,
	BrowserScreenshot,
	BrowserScreenshotInput,
	BrowserSession,
	BrowserSessionCreateInput,
	BrowserSessionInput,
	BrowserSnapshot,
	BrowserSnapshotInput,
	BrowserTextContent,
} from "@astravia/capability-sdk";
import {
	CAPABILITY_ERROR_CODES,
	CapabilityError,
	type Disposable,
	FOUNDATION_BROWSER_CAPABILITIES,
} from "@astravia/capability-sdk";
import { BrowserAutomationError } from "../browser-automation/contracts.js";

const BROWSER_PROVIDER_OWNER = "astravia.foundation.browser";

export interface BrowserCapabilityService {
	runtimeStatus(signal?: AbortSignal): Promise<BrowserRuntimeStatus>;
	installRuntime(input: BrowserRuntimeInstallInput, signal?: AbortSignal): Promise<BrowserRuntimeStatus>;
	createSession(input: BrowserSessionCreateInput, signal?: AbortSignal): Promise<BrowserSession>;
	getSession(input: BrowserSessionInput): BrowserSession;
	closeSession(input: BrowserSessionInput, signal?: AbortSignal): Promise<void>;
	navigate(input: BrowserNavigateInput, signal?: AbortSignal): Promise<BrowserPageState>;
	snapshot(input: BrowserSnapshotInput, signal?: AbortSignal): Promise<BrowserSnapshot>;
	readText(input: BrowserReadTextInput, signal?: AbortSignal): Promise<BrowserTextContent>;
	screenshot(input: BrowserScreenshotInput, signal?: AbortSignal): Promise<BrowserScreenshot>;
	act(input: BrowserActInput, signal?: AbortSignal): Promise<BrowserActionResult>;
}

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
