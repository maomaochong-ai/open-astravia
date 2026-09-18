// @vitest-environment jsdom
import { pluginWorkspaceViewsAtom, type RegisteredWorkspaceView } from "@shared/store/atoms";
import { render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
	everReady: false,
	cycleReady: false,
	wait: vi.fn(() => new Promise<void>(() => {})),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../runtime/plugin-events", () => ({
	isPluginHostEverReady: () => host.everReady,
	isPluginHostCycleReady: () => host.cycleReady,
	waitForPluginHostReady: () => host.wait(),
}));

const { PluginWorkspaceViewSurface } = await import("./PluginWorkspaceViewRoute");

const PLUGIN_ID = "demo-plugin";
const VIEW_ID = "canvas";

function registeredView(component: RegisteredWorkspaceView["component"]): RegisteredWorkspaceView {
	return {
		pluginId: PLUGIN_ID,
		pluginName: "Demo",
		viewId: VIEW_ID,
		label: "Canvas",
		component,
		navOrder: 0,
		sidebar: true,
	};
}

function renderSurface(
	store: ReturnType<typeof createStore>,
	onMissing?: () => void,
): ReturnType<typeof render> {
	return render(
		<Provider store={store}>
			<PluginWorkspaceViewSurface pluginId={PLUGIN_ID} viewId={VIEW_ID} onMissing={onMissing} />
		</Provider>,
	);
}

describe("PluginWorkspaceViewSurface", () => {
	beforeEach(() => {
		host.everReady = false;
		host.cycleReady = false;
		host.wait.mockReset();
		host.wait.mockImplementation(() => new Promise<void>(() => {}));
	});

	it("注册表已有视图时首帧直接渲染组件，不闪 loading", () => {
		const store = createStore();
		store.set(pluginWorkspaceViewsAtom, [registeredView(() => <p>workspace-body</p>)]);

		renderSurface(store, vi.fn());

		expect(screen.getByText("workspace-body")).toBeTruthy();
		expect(screen.queryByText("workspaceView.loading")).toBeNull();
		expect(host.wait).not.toHaveBeenCalled();
	});

	it("注册表为空且宿主未就绪时停留在 loading，不触发 onMissing", () => {
		const store = createStore();
		store.set(pluginWorkspaceViewsAtom, []);
		const onMissing = vi.fn();

		renderSurface(store, onMissing);

		expect(screen.getByText("workspaceView.loading")).toBeTruthy();
		expect(screen.queryByText("workspaceView.missing")).toBeNull();
		expect(onMissing).not.toHaveBeenCalled();
		expect(host.wait).toHaveBeenCalled();
	});

	it("注册表为空且宿主已就绪时立即调用 onMissing，不再等加载周期", () => {
		host.everReady = true;
		host.cycleReady = true;
		const store = createStore();
		store.set(pluginWorkspaceViewsAtom, []);
		const onMissing = vi.fn();

		renderSurface(store, onMissing);

		expect(onMissing).toHaveBeenCalledTimes(1);
		expect(screen.getByText("workspaceView.missing")).toBeTruthy();
		expect(screen.queryByText("workspaceView.loading")).toBeNull();
		expect(host.wait).not.toHaveBeenCalled();
	});

	it("宿主曾经就绪但当前周期又在 loading 时继续等待，不提前 onMissing", () => {
		host.everReady = true;
		host.cycleReady = false;
		const store = createStore();
		store.set(pluginWorkspaceViewsAtom, []);
		const onMissing = vi.fn();

		renderSurface(store, onMissing);

		expect(screen.getByText("workspaceView.loading")).toBeTruthy();
		expect(onMissing).not.toHaveBeenCalled();
		expect(host.wait).toHaveBeenCalled();
	});

	it("保活隐藏时即使宿主已就绪也不 onMissing，避免把用户踢回首页", () => {
		host.everReady = true;
		host.cycleReady = true;
		const store = createStore();
		store.set(pluginWorkspaceViewsAtom, []);
		const onMissing = vi.fn();

		render(
			<Provider store={store}>
				<PluginWorkspaceViewSurface pluginId={PLUGIN_ID} viewId={VIEW_ID} onMissing={onMissing} active={false} />
			</Provider>,
		);

		expect(onMissing).not.toHaveBeenCalled();
		expect(screen.getByText("workspaceView.missing")).toBeTruthy();
	});
});
