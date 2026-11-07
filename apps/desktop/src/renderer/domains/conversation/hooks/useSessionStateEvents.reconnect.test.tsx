// @vitest-environment jsdom

import { getDefaultStore } from "jotai";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@shared/i18n", () => ({ i18n: { t: (key: string) => key } }));

const { useSessionStateEvents } = await import("./useSessionStateEvents");
const { retryProgressAtom } = await import("@shared/store/chat-atoms");

function renderDispatcher() {
	const activeSessionRef = { current: null };
	const syncDurableHistory = vi.fn();
	renderHook(() => useSessionStateEvents({ activeSessionRef, syncDurableHistory }));
}

describe("useSessionStateEvents network recovery", () => {
	beforeEach(() => {
		getDefaultStore().set(retryProgressAtom, null);
	});

	it("clears the reconnect banner once the network comes back", () => {
		// 断网时 retry.end 可能根本没发出来，横幅会一直挂在对话区。
		getDefaultStore().set(retryProgressAtom, {
			attempt: 4,
			errorMessage: "network unreachable",
			maxAttempts: 5,
		});
		renderDispatcher();
		expect(getDefaultStore().get(retryProgressAtom)).not.toBeNull();

		window.dispatchEvent(new Event("online"));

		// 切到 VPN 再切回国内网络后，系统报 online，提示必须随之消失。
		expect(getDefaultStore().get(retryProgressAtom)).toBeNull();
	});
});
