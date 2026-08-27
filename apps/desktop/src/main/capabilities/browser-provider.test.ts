import { CapabilityHub } from "@vetta/capability-runtime";
import {
	type BrowserRuntimeStatus,
	CAPABILITY_ERROR_CODES,
	FOUNDATION_BROWSER_CAPABILITIES,
} from "@vetta/capability-sdk";
import { describe, expect, it, vi } from "vitest";
import { BrowserAutomationError } from "../browser-automation/contracts.js";
import { type BrowserCapabilityService, registerDesktopBrowserProvider } from "./browser-provider.js";

function service(overrides: Partial<BrowserCapabilityService> = {}): BrowserCapabilityService {
	return {
		runtimeStatus: vi.fn(async () => ({ phase: "ready" as const, version: "0.34.0" })),
		installRuntime: vi.fn(async () => ({ phase: "ready" as const, version: "0.34.0" })),
		createSession: vi.fn(),
		getSession: vi.fn(),
		closeSession: vi.fn(),
		navigate: vi.fn(),
		snapshot: vi.fn(),
		readText: vi.fn(),
		screenshot: vi.fn(),
		act: vi.fn(),
		...overrides,
	};
}

describe("desktop browser capability provider", () => {
	it("registers the runtime query and forwards structured input", async () => {
		const hub = new CapabilityHub();
		const browser = service();
		const registration = registerDesktopBrowserProvider(hub.foundation, browser);
		try {
			await expect(
				hub.invoke(
					FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_STATUS,
					{ namespace: "publisher" },
					{ signal: new AbortController().signal, traceId: "browser-status" },
				),
			).resolves.toEqual({ phase: "ready", version: "0.34.0" });
			expect(browser.runtimeStatus).toHaveBeenCalledOnce();
		} finally {
			registration.dispose();
		}
	});

	it("maps host policy errors and honors pre-aborted invocations", async () => {
		const hub = new CapabilityHub();
		const browser = service({
			navigate: vi.fn(async () => {
				throw new BrowserAutomationError("policy_denied", "blocked");
			}),
		});
		const registration = registerDesktopBrowserProvider(hub.foundation, browser);
		try {
			await expect(
				hub.invoke(
					FOUNDATION_BROWSER_CAPABILITIES.NAVIGATE,
					{ namespace: "publisher", sessionId: "session", url: "https://blocked.example" },
					{ signal: new AbortController().signal, traceId: "browser-policy" },
				),
			).rejects.toMatchObject({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED });

			const controller = new AbortController();
			controller.abort();
			await expect(
				hub.invoke(
					FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_STATUS,
					{ namespace: "publisher" },
					{ signal: controller.signal, traceId: "browser-aborted" },
				),
			).rejects.toMatchObject({ code: CAPABILITY_ERROR_CODES.ABORTED });
		} finally {
			registration.dispose();
		}
	});

	it("forwards cancellation into an in-flight provider operation", async () => {
		const hub = new CapabilityHub();
		const browser = service({
			runtimeStatus: vi.fn(
				(signal?: AbortSignal) =>
					new Promise<BrowserRuntimeStatus>((_resolve, reject) => {
						signal?.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
					}),
			),
		});
		const registration = registerDesktopBrowserProvider(hub.foundation, browser);
		const controller = new AbortController();
		try {
			const invocation = hub.invoke(
				FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_STATUS,
				{ namespace: "publisher" },
				{ signal: controller.signal, traceId: "browser-in-flight-abort" },
			);
			controller.abort();
			await expect(invocation).rejects.toMatchObject({ code: CAPABILITY_ERROR_CODES.ABORTED });
		} finally {
			registration.dispose();
		}
	});
});
