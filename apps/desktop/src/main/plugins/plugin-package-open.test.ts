import { describe, expect, it, vi } from "vitest";
import type { InstalledPlugin, PluginManifest } from "../../preload/api-types/plugins.js";
import { findVettaPluginPackagePath, PluginPackageOpenService } from "./plugin-package-open-service.js";

const manifest: PluginManifest = {
	id: "demo",
	name: "Demo",
	version: "1.2.0",
	pluginApiVersion: "^2.0.0",
	entry: "dist/mf-manifest.json",
	moduleFederation: { remoteName: "demo", expose: "./plugin" },
	permissions: ["network.fetch"],
	commands: ["demo.run"],
};

const installed = {
	id: "demo",
	name: "Demo",
	activeVersion: "1.2.0",
} as InstalledPlugin;

function harness(confirm = true) {
	const dependencies = {
		inspect: vi.fn(async () => manifest),
		confirm: vi.fn(async () => confirm),
		install: vi.fn(async () => installed),
		notifyInstalled: vi.fn(async () => {}),
		notifyError: vi.fn(async () => {}),
		revealApp: vi.fn(),
	};
	return { dependencies, service: new PluginPackageOpenService(dependencies) };
}

describe("PluginPackageOpenService", () => {
	it("queues a startup package and installs it only after Desktop is ready", async () => {
		const { dependencies, service } = harness();
		expect(service.enqueue("C:/Downloads/demo.VETTAPKG")).toBe(true);
		await service.waitForIdle();
		expect(dependencies.inspect).not.toHaveBeenCalled();

		service.markReady();
		await service.waitForIdle();

		expect(dependencies.inspect).toHaveBeenCalledWith("C:/Downloads/demo.VETTAPKG");
		expect(dependencies.confirm).toHaveBeenCalledWith("C:/Downloads/demo.VETTAPKG", manifest);
		expect(dependencies.install).toHaveBeenCalledWith("C:/Downloads/demo.VETTAPKG", manifest);
		expect(dependencies.notifyInstalled).toHaveBeenCalledWith(installed);
		expect(dependencies.revealApp).toHaveBeenCalledOnce();
	});

	it("does not install when the user cancels the package confirmation", async () => {
		const { dependencies, service } = harness(false);
		service.markReady();
		service.enqueue("C:/Downloads/demo.vettapkg");
		await service.waitForIdle();

		expect(dependencies.install).not.toHaveBeenCalled();
		expect(dependencies.notifyInstalled).not.toHaveBeenCalled();
	});

	it("reports validation or installation errors without breaking later packages", async () => {
		const { dependencies, service } = harness();
		dependencies.inspect.mockRejectedValueOnce(new Error("invalid package"));
		service.markReady();
		service.enqueue("C:/Downloads/broken.vettapkg");
		service.enqueue("C:/Downloads/demo.vettapkg");
		await service.waitForIdle();

		expect(dependencies.notifyError).toHaveBeenCalledWith(
			"C:/Downloads/broken.vettapkg",
			expect.objectContaining({ message: "invalid package" }),
		);
		expect(dependencies.install).toHaveBeenCalledWith("C:/Downloads/demo.vettapkg", manifest);
	});
});

describe("findVettaPluginPackagePath", () => {
	it("recognizes only the dedicated package extension", () => {
		expect(findVettaPluginPackagePath(["electron.exe", "app.js", "C:/Downloads/demo.vettapkg"])).toBe(
			"C:/Downloads/demo.vettapkg",
		);
		expect(findVettaPluginPackagePath(["electron.exe", "C:/Downloads/demo.zip"])).toBeUndefined();
	});
});
