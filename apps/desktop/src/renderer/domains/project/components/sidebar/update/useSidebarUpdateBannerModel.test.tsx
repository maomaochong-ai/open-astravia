// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, opts?: Record<string, unknown>) =>
			opts ? `${key}:${Object.values(opts).join(",")}` : key,
		i18n: { exists: () => true },
	}),
}));

const { updaterStateAtom } = await import("@shared/store/atoms");
const { useSidebarUpdateBannerModel } = await import("./useSidebarUpdateBannerModel.js");
const { createStore, Provider } = await import("jotai");

type UpdaterState = Parameters<typeof updaterStateAtom.write>[0] extends never ? never : unknown;

interface UpdaterStub {
	downloadCalls: number;
	installCalls: number;
	dismissCalls: number;
}

function installUpdaterStub(): UpdaterStub {
	const stub: UpdaterStub = { downloadCalls: 0, installCalls: 0, dismissCalls: 0 };
	Object.defineProperty(window, "astravia", {
		configurable: true,
		value: {
			updater: {
				download: async () => {
					stub.downloadCalls += 1;
				},
				install: async () => {
					stub.installCalls += 1;
				},
				dismiss: async () => {
					stub.dismissCalls += 1;
				},
			},
		},
	});
	return stub;
}

function renderBanner(state: Record<string, unknown>) {
	const store = createStore();
	store.set(updaterStateAtom as never, { currentVersion: "0.5.73", ...state } as never);
	return renderHook(() => useSidebarUpdateBannerModel(), {
		wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
	});
}

describe("useSidebarUpdateBannerModel", () => {
	it("prompts as soon as an update is available, not only once it is downloaded", () => {
		installUpdaterStub();
		const { result } = renderBanner({ phase: "available", latestVersion: "0.5.77" });

		expect(result.current?.label).toBe("update.bannerAvailable:0.5.77");
		expect(result.current?.actionLabel).toBe("update.bannerDownload");
		expect(result.current?.actionDisabled).toBe(false);
	});

	it("downloads the update when the operator clicks the action", () => {
		const stub = installUpdaterStub();
		const { result } = renderBanner({ phase: "available", latestVersion: "0.5.77" });

		act(() => result.current?.onAction());

		expect(stub.downloadCalls).toBe(1);
		expect(stub.installCalls).toBe(0);
	});

	it("shows download progress and keeps the action inert while downloading", () => {
		const stub = installUpdaterStub();
		const { result } = renderBanner({ phase: "downloading", latestVersion: "0.5.77", progress: 0.42 });

		expect(result.current?.label).toBe("update.bannerAvailable:0.5.77");
		expect(result.current?.actionLabel).toBe("update.bannerDownloading:42");
		expect(result.current?.actionDisabled).toBe(true);

		act(() => result.current?.onAction());
		expect(stub.downloadCalls).toBe(0);
	});

	it("keeps offering the restart once the download is ready", () => {
		const stub = installUpdaterStub();
		const { result } = renderBanner({ phase: "ready", latestVersion: "0.5.77", progress: 1 });

		expect(result.current?.label).toBe("update.bannerReady:0.5.77");
		expect(result.current?.actionLabel).toBe("update.bannerRestart");

		act(() => result.current?.onAction());
		expect(stub.installCalls).toBe(1);
	});

	it("stays hidden while there is nothing to act on", () => {
		installUpdaterStub();

		expect(renderBanner({ phase: "idle" }).result.current).toBeNull();
		expect(renderBanner({ phase: "checking" }).result.current).toBeNull();
		expect(renderBanner({ phase: "idle", error: "updater.errors.checkFailed" }).result.current).toBeNull();
	});

	it("stays dismissed for the same version and returns for the next one", () => {
		const stub = installUpdaterStub();
		const { result, rerender } = renderBanner({ phase: "available", latestVersion: "0.5.77" });

		act(() => result.current?.onDismiss());
		expect(stub.dismissCalls).toBe(1);
		rerender();
		expect(result.current).toBeNull();
	});

	it("reappears when a newer version replaces the dismissed one", async () => {
		installUpdaterStub();
		const store = createStore();
		store.set(updaterStateAtom as never, { currentVersion: "0.5.73", phase: "available", latestVersion: "0.5.77" } as never);
		const { result } = renderHook(() => useSidebarUpdateBannerModel(), {
			wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
		});

		act(() => result.current?.onDismiss());
		act(() => {
			store.set(updaterStateAtom as never, {
				currentVersion: "0.5.73",
				phase: "available",
				latestVersion: "0.5.79",
			} as never);
		});

		expect(result.current?.label).toBe("update.bannerAvailable:0.5.79");
	});
});
