import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServiceProviderManifest } from "@vetta-org/plugin-sdk";
import AdmZip from "adm-zip";
import { c as createTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { PluginServiceRuntimeInstaller } from "./plugin-service-runtime-installer.js";

const temporaryDirectories: string[] = [];

function sha256(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function zip(entries: Record<string, string>): Buffer {
	const archive = new AdmZip();
	for (const [path, content] of Object.entries(entries)) archive.addFile(path, Buffer.from(content));
	return archive.toBuffer();
}

function service(
	artifacts: PluginServiceProviderManifest["runtime"]["platforms"][string]["artifacts"],
	version = "1.0.0",
): PluginServiceProviderManifest {
	return {
		id: "bridge",
		runtime: {
			version,
			platforms: {
				"win32-x64": { executable: "core/bridge.exe", artifacts },
			},
		},
		process: {},
		health: { path: "/health" },
	};
}

async function createRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-plugin-service-installer-"));
	temporaryDirectories.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PluginServiceRuntimeInstaller", () => {
	it("installs multiple fixed-digest zip artifacts into one versioned runtime", async () => {
		const core = zip({ "bridge.exe": "core-v1" });
		const extension = zip({ "extension.dll": "extension-v1" });
		const installer = new PluginServiceRuntimeInstaller(await createRoot(), "win32-x64");

		const manifest = service([
			{ sha256: sha256(core), archive: "zip", destination: "core" },
			{ sha256: sha256(extension), archive: "zip", destination: "extensions" },
		]);
		const payloads = [
			{ destination: "core", data: core.toString("base64") },
			{ destination: "extensions", data: extension.toString("base64") },
		];
		const paths = await installer.install("managed-bridge", manifest, payloads);

		expect(await readFile(paths.executable, "utf8")).toBe("core-v1");
		expect(await readFile(join(paths.runtimeDirectory, "extensions", "extension.dll"), "utf8")).toBe("extension-v1");
		await expect(installer.resolve("managed-bridge", manifest)).resolves.toEqual(paths);
	});

	it("extracts tar.gz artifacts without trusting archive paths", async () => {
		const root = await createRoot();
		const source = join(root, "tar-source");
		await mkdir(source, { recursive: true });
		await writeFile(join(source, "bridge.exe"), "tar-core");
		const archivePath = join(root, "core.tar.gz");
		await createTar({ cwd: source, file: archivePath, gzip: true }, ["bridge.exe"]);
		const archive = await readFile(archivePath);
		const installer = new PluginServiceRuntimeInstaller(root, "win32-x64");

		const paths = await installer.install(
			"managed-bridge",
			service([{ sha256: sha256(archive), archive: "tar.gz", destination: "core" }]),
			[{ destination: "core", data: archive.toString("base64") }],
		);

		expect(await readFile(paths.executable, "utf8")).toBe("tar-core");
	});

	it("preserves an installed runtime when a replacement fails checksum verification", async () => {
		const root = await createRoot();
		const original = zip({ "bridge.exe": "trusted" });
		const tampered = zip({ "bridge.exe": "tampered" });
		const installer = new PluginServiceRuntimeInstaller(root, "win32-x64");
		const first = service([{ sha256: sha256(original), archive: "zip", destination: "core" }]);
		const paths = await installer.install("managed-bridge", first, [
			{ destination: "core", data: original.toString("base64") },
		]);

		await expect(
			installer.install(
				"managed-bridge",
				service([{ sha256: "f".repeat(64), archive: "zip", destination: "core" }]),
				[{ destination: "core", data: tampered.toString("base64") }],
			),
		).rejects.toThrow("SHA-256 mismatch");
		expect(await readFile(paths.executable, "utf8")).toBe("trusted");
	});

	it("rejects services that do not declare the current platform", async () => {
		const installer = new PluginServiceRuntimeInstaller(await createRoot(), "linux-arm64");
		await expect(installer.install("managed-bridge", service([]), [])).rejects.toThrow(
			"does not support platform linux-arm64",
		);
	});

	it("rejects duplicate tar entries before extracting a runtime", async () => {
		const root = await createRoot();
		await writeFile(join(root, "bridge.exe"), "payload");
		const path = join(root, "duplicate.tar.gz");
		await createTar({ cwd: root, file: path, gzip: true }, ["bridge.exe", "bridge.exe"]);
		const archive = await readFile(path);
		const installer = new PluginServiceRuntimeInstaller(root, "win32-x64");
		await expect(
			installer.install(
				"managed-bridge",
				service([
					{
						sha256: sha256(archive),
						archive: "tar.gz",
						destination: "core",
					},
				]),
				[{ destination: "core", data: archive.toString("base64") }],
			),
		).rejects.toThrow("Duplicate service runtime archive entry");
	});
});
