// @vitest-environment jsdom

import type { DesktopApi } from "@preload/api";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const translations = vi.hoisted(() => ({
	t: (key: string) => key,
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: translations.t }),
}));

import { useOAuthLogin } from "./useOAuthLogin";

describe("useOAuthLogin", () => {
	let auth: DesktopApi["auth"];
	let emitCallback: () => void;
	let emitRejected: () => void;
	let unsubscribeCallback: ReturnType<typeof vi.fn>;
	let unsubscribeRejected: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		unsubscribeCallback = vi.fn();
		unsubscribeRejected = vi.fn();
		auth = {
			openExternal: vi.fn(async () => undefined),
			startOAuth: vi.fn(async () => undefined),
			reopenOAuth: vi.fn(async () => undefined),
			refreshToken: vi.fn(async () => ({ status: "transient" as const })),
			onOAuthCallback: vi.fn((handler) => {
				emitCallback = () => handler({ token: "token" });
				return unsubscribeCallback;
			}),
			onOAuthRejected: vi.fn((handler) => {
				emitRejected = handler;
				return unsubscribeRejected;
			}),
			onUnauthorized: vi.fn(() => () => undefined),
			onTokenRefreshed: vi.fn(() => () => undefined),
		};
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { auth } as unknown as DesktopApi,
		});
	});

	it("enters the waiting state while the system browser is opening", () => {
		const { result } = renderHook(() => useOAuthLogin());

		act(() => result.current.start());

		expect(result.current.phase).toBe("waiting");
		expect(result.current.error).toBe("");
		expect(auth.startOAuth).toHaveBeenCalledOnce();
	});

	it("returns to an actionable error state when opening the browser fails", async () => {
		vi.mocked(auth.startOAuth).mockRejectedValue(new Error("shell unavailable"));
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { result } = renderHook(() => useOAuthLogin());

		act(() => result.current.start());

		await waitFor(() => expect(result.current.phase).toBe("idle"));
		expect(result.current.error).toBe("login.openFailed");
		consoleError.mockRestore();
	});

	it("stops waiting when the host rejects an expired OAuth state", () => {
		const { result } = renderHook(() => useOAuthLogin());
		act(() => result.current.start());
		expect(result.current.phase).toBe("waiting");

		act(() => emitRejected());

		expect(result.current.phase).toBe("idle");
		expect(result.current.error).toBe("login.rejected");
	});

	it("clears transient state on success and removes both host listeners on unmount", () => {
		const { result, unmount } = renderHook(() => useOAuthLogin());
		act(() => emitRejected());
		expect(result.current.error).toBe("login.rejected");

		act(() => emitCallback());

		expect(result.current.phase).toBe("idle");
		expect(result.current.error).toBe("");
		unmount();
		expect(unsubscribeCallback).toHaveBeenCalledOnce();
		expect(unsubscribeRejected).toHaveBeenCalledOnce();
	});
});
