// @vitest-environment jsdom
/**
 * 「设置 → 远程连接」的配对入口：打开页面后自动准备二维码，并保留已有邀请。
 * 从真实连接层进入并渲染完整 View，只替换 Electron preload 与二维码编码两个外部边界。
 */
import type { RemotePairingState } from "@preload/api-types/remote-pairing";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) =>
			options ? `${key}:${Object.values(options).join(",")}` : key,
		i18n: { exists: () => true },
	}),
}));

vi.mock("qrcode", () => ({
	default: { toDataURL: async (text: string) => `data:image/png;base64,${btoa(text)}` },
}));

const { RemotePairingSettings } = await import("./RemotePairingSettings.js");

const BASE_STATE: RemotePairingState = {
	devices: [],
	approvals: [],
	lanEndpoints: [],
	cloudEnabled: true,
	relayBaseUrl: "wss://relay.example.test",
	vaultAvailable: true,
};

function inviteState(inviteUri = "vetta://pair/automatic"): RemotePairingState {
	return {
		...BASE_STATE,
		invite: {
			pairingId: "pairing-1",
			inviteUri,
			expiresAt: Date.now() + 10 * 60_000,
		},
		lanEndpoints: ["192.168.1.8:43117"],
	};
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	return {
		promise: new Promise<T>((done) => {
			resolve = done;
		}),
		resolve,
	};
}

function installRemotePairing(options: {
	initial?: RemotePairingState;
	createInvite?: () => Promise<RemotePairingState>;
} = {}) {
	const initial = options.initial ?? BASE_STATE;
	const createInvite = vi.fn(options.createInvite ?? (async () => inviteState()));
	const steady = async () => initial;
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			remotePairing: {
				getState: vi.fn(async () => initial),
				createInvite,
				cancelInvite: vi.fn(steady),
				setCloudEnabled: vi.fn(steady),
				approve: vi.fn(steady),
				revokeDevice: vi.fn(steady),
				renameDevice: vi.fn(steady),
			},
		},
	});
	return { createInvite };
}

afterEach(() => {
	cleanup();
	Reflect.deleteProperty(window, "vetta");
});

describe("远程连接设置", () => {
	it("打开页面就自动准备二维码，等待期间先显示明确反馈", async () => {
		const pending = deferred<RemotePairingState>();
		const { createInvite } = installRemotePairing({ createInvite: () => pending.promise });

		render(<RemotePairingSettings />);

		expect(screen.getByText("remote.pairing.generating")).toBeTruthy();
		await waitFor(() => expect(createInvite).toHaveBeenCalledTimes(1));
		expect(screen.queryByRole("button", { name: "remote.pairing.create" })).toBeNull();

		act(() => pending.resolve(inviteState()));

		const qr = await screen.findByRole("img", { name: "remote.pairing.qrAlt" });
		expect(qr.getAttribute("src")).toContain("data:image/png;base64,");
	});

	it("已有未过期二维码时直接沿用，不会因重新打开页面而作废", async () => {
		const { createInvite } = installRemotePairing({ initial: inviteState("vetta://pair/existing") });

		render(<RemotePairingSettings />);

		await screen.findByRole("img", { name: "remote.pairing.qrAlt" });
		expect(createInvite).not.toHaveBeenCalled();
	});

	it("自动生成失败后给出面向用户的提示，并允许手动重试", async () => {
		const createInvite = vi
			.fn<() => Promise<RemotePairingState>>()
			.mockRejectedValueOnce(new Error("secret internal failure"))
			.mockResolvedValueOnce(inviteState("vetta://pair/retry"));
		installRemotePairing({ createInvite });
		const user = userEvent.setup();

		render(<RemotePairingSettings />);

		expect((await screen.findByRole("alert")).textContent).toBe("remote.pairing.createFailed");
		expect(screen.queryByText("secret internal failure")).toBeNull();
		await user.click(screen.getByRole("button", { name: "remote.pairing.create" }));

		await screen.findByRole("img", { name: "remote.pairing.qrAlt" });
		expect(createInvite).toHaveBeenCalledTimes(2);
	});
});
