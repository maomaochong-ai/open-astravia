import { describe, expect, it, vi } from "vitest";
import type { InstalledPlugin, PluginManifest } from "../../preload/api-types/plugins.js";
import { findAstraviaPluginPackagePath, PluginPackageOpenService } from "./plugin-package-open-service.js";

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
		expect(service.enqueue("C:/Downloads/demo.ASTRAVIAPKG")).toBe(true);
		await service.waitForIdle();
		expect(dependencies.inspect).not.toHaveBeenCalled();

		service.markReady();
		await service.waitForIdle();

		expect(dependencies.inspect).toHaveBeenCalledWith("C:/Downloads/demo.ASTRAVIAPKG");
		expect(dependencies.confirm).toHaveBeenCalledWith("C:/Downloads/demo.ASTRAVIAPKG", manifest);
		expect(dependencies.install).toHaveBeenCalledWith("C:/Downloads/demo.ASTRAVIAPKG", manifest);
		expect(dependencies.notifyInstalled).toHaveBeenCalledWith(installed);
		expect(dependencies.revealApp).toHaveBeenCalledOnce();
	});

	it("does not install when the user cancels the package confirmation", async () => {
		const { dependencies, service } = harness(false);
		service.markReady();
		service.enqueue("C:/Downloads/demo.astraviapkg");
		await service.waitForIdle();

		expect(dependencies.install).not.toHaveBeenCalled();
		expect(dependencies.notifyInstalled).not.toHaveBeenCalled();
	});

	it("reports validation or installation errors without breaking later packages", async () => {
		const { dependencies, service } = harness();
		dependencies.inspect.mockRejectedValueOnce(new Error("invalid package"));
		service.markReady();
		service.enqueue("C:/Downloads/broken.astraviapkg");
		service.enqueue("C:/Downloads/demo.astraviapkg");
		await service.waitForIdle();

		expect(dependencies.notifyError).toHaveBeenCalledWith(
			"C:/Downloads/broken.astraviapkg",
			expect.objectContaining({ message: "invalid package" }),
			undefined,
		);
		expect(dependencies.install).toHaveBeenCalledWith("C:/Downloads/demo.astraviapkg", manifest);
	});

	it("keeps the inspected identity when package installation fails", async () => {
		const { dependencies, service } = harness();
		dependencies.install.mockRejectedValueOnce(new Error("copy failed"));
		service.markReady();
		service.enqueue("C:/Downloads/demo.astraviapkg");
		await service.waitForIdle();

		expect(dependencies.notifyError).toHaveBeenCalledWith(
			"C:/Downloads/demo.astraviapkg",
			expect.objectContaining({ message: "copy failed" }),
			manifest,
		);
	});
});

describe("findAstraviaPluginPackagePath", () => {
	it("recognizes only the dedicated package extension", () => {
		expect(findAstraviaPluginPackagePath(["electron.exe", "app.js", "C:/Downloads/demo.astraviapkg"])).toBe(
			"C:/Downloads/demo.astraviapkg",
		);
		expect(findAstraviaPluginPackagePath(["electron.exe", "C:/Downloads/demo.zip"])).toBeUndefined();
	});
});
