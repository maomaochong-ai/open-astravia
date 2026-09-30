// @vitest-environment jsdom
/**
 * 「设置 → 远程连接」的配对入口：打开页面后自动准备二维码，并保留已有邀请。
 * 从真实连接层进入并渲染完整 View，只替换 Electron preload 这一外部边界。
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
			qrText: inviteUri,
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
	cancelInvite?: () => Promise<RemotePairingState>;
} = {}) {
	const initial = options.initial ?? BASE_STATE;
	const createInvite = vi.fn(options.createInvite ?? (async () => inviteState()));
	const steady = async () => initial;
	const setDesktopControl = vi.fn(steady);
	const setRelay = vi.fn(async (url: string | undefined) => ({ ...initial, relayBaseUrl: url ?? initial.relayBaseUrl }));
	const testRelay = vi.fn(async () => "noInviteCodes" as const);
	const listeners = new Set<(state: RemotePairingState) => void>();
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			remotePairing: {
				getState: vi.fn(async () => initial),
				createInvite,
				cancelInvite: vi.fn(options.cancelInvite ?? steady),
				setCloudEnabled: vi.fn(steady),
				approve: vi.fn(steady),
				revokeDevice: vi.fn(steady),
				renameDevice: vi.fn(steady),
				setDesktopControl,
				setRelay,
				testRelay,
				onStateChanged: (listener: (state: RemotePairingState) => void) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			},
		},
	});
	/** What the main process sends when the pairing state changes. */
	const push = (state: RemotePairingState) => {
		for (const listener of listeners) listener(state);
	};
	return { createInvite, push, setDesktopControl, setRelay, testRelay };
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
		expect(screen.getByText("remote.pairing.codePreparing")).toBeTruthy();
		expect(screen.getByText("remote.pairing.code")).toBeTruthy();
		expect(screen.getByText("remote.pairing.password")).toBeTruthy();
		expect(screen.queryByRole("img", { name: "remote.pairing.qrAlt" })).toBeNull();
		await waitFor(() => expect(createInvite).toHaveBeenCalledTimes(1));
		expect(screen.queryByRole("button", { name: "remote.pairing.create" })).toBeNull();

		act(() => pending.resolve(inviteState()));

		const qr = await screen.findByRole("img", { name: "remote.pairing.qrAlt" });
		expect(qr.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
	});

	it("连接码还在放上中继时先转圈，不显示随后会被换掉的二维码", async () => {
		const preparing = inviteState();
		installRemotePairing({
			initial: {
				...preparing,
				invite: { ...preparing.invite!, qrText: undefined, code: { code: "K7Q2-9MXD", password: "482913", status: "preparing" } },
			},
		});
		render(<RemotePairingSettings />);

		expect(await screen.findByText("remote.pairing.generating")).toBeTruthy();
		expect(screen.getByText("remote.pairing.codePreparing")).toBeTruthy();
		expect(screen.getByText("remote.pairing.code")).toBeTruthy();
		expect(screen.queryByRole("img", { name: "remote.pairing.qrAlt" })).toBeNull();
		expect(screen.getByRole("button", { name: "remote.pairing.cancel" }).hasAttribute("disabled")).toBe(true);
	});

	it("刷新时保持二维码和连接码的位置，并立刻收起即将作废的码", async () => {
		const ready = {
			...inviteState(),
			invite: {
				...inviteState().invite!,
				code: { code: "K7Q2-9MXD", password: "482913", status: "ready" as const },
			},
		};
		const pendingCancel = deferred<RemotePairingState>();
		const pendingCreate = deferred<RemotePairingState>();
		const { createInvite } = installRemotePairing({
			initial: ready,
			cancelInvite: () => pendingCancel.promise,
			createInvite: () => pendingCreate.promise,
		});
		const user = userEvent.setup();
		render(<RemotePairingSettings />);

		await screen.findByRole("img", { name: "remote.pairing.qrAlt" });
		expect(screen.getByText("K7Q2-9MXD")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "remote.pairing.cancel" }));

		expect(screen.queryByRole("img", { name: "remote.pairing.qrAlt" })).toBeNull();
		expect(screen.queryByText("K7Q2-9MXD")).toBeNull();
		expect(screen.queryByText("482913")).toBeNull();
		expect(screen.getByText("remote.pairing.generating")).toBeTruthy();
		expect(screen.getByText("remote.pairing.code")).toBeTruthy();
		expect(screen.getByText("remote.pairing.password")).toBeTruthy();
		expect(screen.getByRole("button", { name: "remote.pairing.cancel" }).hasAttribute("disabled")).toBe(true);

		act(() => pendingCancel.resolve({ ...BASE_STATE, lanEndpoints: ready.lanEndpoints }));
		await waitFor(() => expect(createInvite).toHaveBeenCalledTimes(1));
		expect(screen.queryByRole("img", { name: "remote.pairing.qrAlt" })).toBeNull();
		expect(screen.getByText("remote.pairing.generating")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "remote.pairing.create" })).toBeNull();

		const next = inviteState("vetta://pair/next");
		act(() =>
			pendingCreate.resolve({
				...next,
				invite: {
					...next.invite!,
					pairingId: "pairing-2",
					code: { code: "ABCD-EFGH", password: "111222", status: "ready" },
				},
			}),
		);
		await screen.findByRole("img", { name: "remote.pairing.qrAlt" });
		expect(screen.getByText("ABCD-EFGH")).toBeTruthy();
		expect(screen.getByText("111222")).toBeTruthy();
		expect(screen.queryByText("remote.pairing.generating")).toBeNull();
	});

	it("还没有配对手机时，用和手机行一样的空位说明如何配对", async () => {
		installRemotePairing({ initial: inviteState() });
		render(<RemotePairingSettings />);

		expect(await screen.findByText("remote.devices.empty")).toBeTruthy();
		expect(screen.getByText("remote.devices.emptyHint")).toBeTruthy();
		expect(screen.getByText("remote.devices.title")).toBeTruthy();
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

	it("电脑上的变化由主进程推送过来，手机上线离线无需轮询也会立刻显示", async () => {
		const device = {
			id: "d1",
			name: "Pixel",
			claimed: true,
			online: false,
			channels: [],
			desktopControl: false,
			createdAt: 1,
			lastSeenAt: 2,
		};
		const { push } = installRemotePairing({ initial: { ...inviteState(), devices: [device] } });
		render(<RemotePairingSettings />);
		expect(await screen.findByText(/remote\.devices\.lastSeen/)).toBeTruthy();

		act(() => push({ ...inviteState(), devices: [{ ...device, online: true, channels: ["lan"] }] }));
		expect(await screen.findByText("remote.devices.onlineVia:remote.devices.channel.lan")).toBeTruthy();
	});

	it("二维码过期或被用掉后立即换一个新的，不用再点生成", async () => {
		const { createInvite, push } = installRemotePairing({ initial: inviteState() });
		render(<RemotePairingSettings />);
		await screen.findByRole("img", { name: "remote.pairing.qrAlt" });
		expect(createInvite).not.toHaveBeenCalled();

		act(() => push({ ...BASE_STATE }));
		await waitFor(() => expect(createInvite).toHaveBeenCalledTimes(1));
		await screen.findByRole("img", { name: "remote.pairing.qrAlt" });
		expect(screen.queryByRole("button", { name: "remote.pairing.create" })).toBeNull();
	});

	it("连上的手机点电脑图标可以开关桌面操作，默认开启", async () => {
		const device = {
			id: "d1",
			name: "Pixel",
			claimed: true,
			online: true,
			channels: ["lan" as const],
			desktopControl: true,
			createdAt: 1,
		};
		const { setDesktopControl } = installRemotePairing({ initial: { ...inviteState(), devices: [device] } });
		const user = userEvent.setup();
		render(<RemotePairingSettings />);

		const desktop = await screen.findByRole("button", { name: "Pixel · remote.devices.desktop" });
		expect(desktop.getAttribute("aria-pressed")).toBe("true");
		await user.click(desktop);
		expect(setDesktopControl).toHaveBeenCalledWith("d1", false);
	});

	it("没连上或没开外网访问时不显示电脑图标", async () => {
		const offline = {
			id: "d1",
			name: "Pixel",
			claimed: true,
			online: false,
			channels: [],
			desktopControl: true,
			createdAt: 1,
			lastSeenAt: 2,
		};
		const { push } = installRemotePairing({ initial: { ...inviteState(), devices: [offline] } });
		render(<RemotePairingSettings />);
		expect(await screen.findByText("Pixel")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Pixel · remote.devices.desktop" })).toBeNull();

		act(() =>
			push({ ...inviteState(), cloudEnabled: false, devices: [{ ...offline, online: true, channels: ["lan"] }] }),
		);
		expect(await screen.findByText("remote.devices.onlineVia:remote.devices.channel.lan")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Pixel · remote.devices.desktop" })).toBeNull();
	});

	it("二维码旁给出连接码和密码，供不在电脑旁的手机输入", async () => {
		installRemotePairing({
			initial: {
				...inviteState(),
				invite: {
					...inviteState().invite!,
					code: { code: "K7Q2-9MXD", password: "482913", status: "ready" },
				},
			},
		});
		render(<RemotePairingSettings />);

		await screen.findByRole("img", { name: "remote.pairing.qrAlt" });
		expect(screen.getByText("remote.pairing.codeHint")).toBeTruthy();
		expect(screen.getByText("K7Q2-9MXD")).toBeTruthy();
		expect(screen.getByText("482913")).toBeTruthy();
	});

	it("中继收不下连接码时仍保留二维码，并说明原因", async () => {
		installRemotePairing({
			initial: {
				...inviteState(),
				invite: { ...inviteState().invite!, code: { code: "K7Q2-9MXD", password: "482913", status: "failed" } },
			},
		});
		render(<RemotePairingSettings />);

		await screen.findByRole("img", { name: "remote.pairing.qrAlt" });
		expect(screen.getByText("remote.pairing.codeFailed")).toBeTruthy();
		expect(screen.queryByText("482913")).toBeNull();
	});

	it("同一 Wi-Fi 下的手动地址默认收起，点开才显示", async () => {
		installRemotePairing({ initial: inviteState() });
		const user = userEvent.setup();
		render(<RemotePairingSettings />);

		const toggle = await screen.findByRole("button", { name: "remote.pairing.manualTitle" });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("192.168.1.8:43117")).toBeNull();

		await user.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("192.168.1.8:43117")).toBeTruthy();
	});

	it("中继服务器一行的「更改」可以更换、测试中继地址", async () => {
		const { setRelay, testRelay } = installRemotePairing({
			initial: { ...inviteState(), defaultRelayBaseUrl: "wss://relay.example.test" },
		});
		const user = userEvent.setup();
		render(<RemotePairingSettings />);

		expect(await screen.findByText("relay.example.test")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "remote.relay.change" }));
		const field = await screen.findByPlaceholderText("wss://relay.example.test");
		await user.type(field, "wss://relay.mine.test");
		await user.click(screen.getByRole("button", { name: "remote.relay.test" }));
		expect(testRelay).toHaveBeenCalledWith("wss://relay.mine.test");
		expect((await screen.findByRole("status")).textContent).toBe("remote.relay.result.noInviteCodes");

		await user.click(screen.getByRole("button", { name: "remote.relay.save" }));
		expect(setRelay).toHaveBeenCalledWith("wss://relay.mine.test");
		await waitFor(() => expect(screen.queryByPlaceholderText("wss://relay.example.test")).toBeNull());
	});
});
