import { describe, expect, it, vi } from "vitest";
import {
	PLUGIN_TOOL_RENDERER_LOADING_MESSAGE,
	PluginToolRendererHostLifecycle,
} from "./plugin-tool-renderer-host-lifecycle.js";

describe("PluginToolRendererHostLifecycle", () => {
	it("invalidates in-flight delivery and rejects new tools while the renderer document reloads", () => {
		const lifecycle = new PluginToolRendererHostLifecycle();
		const failInFlight = vi.fn();

		expect(lifecycle.acquire(failInFlight)).toMatchObject({
			ok: false,
			error: { message: PLUGIN_TOOL_RENDERER_LOADING_MESSAGE },
		});

		lifecycle.markReady();
		const lease = lifecycle.acquire(failInFlight);
		expect(lease.ok).toBe(true);

		lifecycle.markLoading();
		expect(failInFlight).toHaveBeenCalledOnce();
		expect(failInFlight).toHaveBeenCalledWith(
			expect.objectContaining({ message: PLUGIN_TOOL_RENDERER_LOADING_MESSAGE }),
		);
		expect(lifecycle.acquire(vi.fn())).toMatchObject({
			ok: false,
			error: { message: PLUGIN_TOOL_RENDERER_LOADING_MESSAGE },
		});

		lifecycle.markReady();
		expect(lifecycle.acquire(vi.fn())).toMatchObject({ ok: true });
	});

	it("cannot become ready again after disposal", () => {
		const lifecycle = new PluginToolRendererHostLifecycle();
		lifecycle.markReady();
		lifecycle.dispose();
		lifecycle.markReady();

		expect(lifecycle.acquire(vi.fn())).toMatchObject({
			ok: false,
			error: { message: "Plugin host renderer was disposed" },
		});
	});
});
