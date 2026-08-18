import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadEvent, DownloadItem } from "../../preload/api-types/downloads.js";
import { DesktopDownloadService } from "./download-service.js";

const paths = vi.hoisted(() => ({ downloads: "", userData: "" }));

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => (name === "downloads" ? paths.downloads : paths.userData),
	},
	shell: {
		openPath: () => Promise.resolve(""),
		showItemInFolder: () => undefined,
	},
}));

let testRoot = "";

beforeEach(async () => {
	testRoot = await mkdtemp(join(tmpdir(), "vetta-download-service-"));
	paths.downloads = join(testRoot, "downloads");
	paths.userData = join(testRoot, "user-data");
	await mkdir(join(paths.userData, "downloads"), { recursive: true });
});

afterEach(async () => {
	await rm(testRoot, { recursive: true, force: true });
});

describe("DesktopDownloadService", () => {
	it("restores active records as paused and persists cancellation", async () => {
		const persisted: DownloadItem = {
			id: "download",
			url: "https://example.com/file",
			filename: "file",
			path: join(paths.downloads, "file"),
			totalBytes: 10,
			receivedBytes: 5,
			status: "downloading",
			createdAt: 1,
		};
		const statePath = join(paths.userData, "downloads", "downloads.json");
		await writeFile(statePath, JSON.stringify([persisted]), "utf8");
		const service = new DesktopDownloadService();
		const events: DownloadEvent[] = [];
		service.attachEventSink((event) => events.push(event));

		expect(service.list()).toEqual([{ ...persisted, status: "paused", speedBytesPerSec: 0 }]);

		service.cancel("download");

		expect(service.list()[0]?.status).toBe("canceled");
		expect(events).toEqual([
			{
				type: "updated",
				item: { ...persisted, status: "canceled", speedBytesPerSec: 0 },
			},
		]);
		const stored = JSON.parse(await readFile(statePath, "utf8")) as DownloadItem[];
		expect(stored[0]?.status).toBe("canceled");
	});
});
