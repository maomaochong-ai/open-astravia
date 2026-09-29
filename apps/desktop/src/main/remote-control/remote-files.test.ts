import { posix } from "node:path";
import { REMOTE_FILE_CHUNK_BYTES, REMOTE_MAX_FILE_BYTES } from "@vetta/remote-control";
import { describe, expect, it } from "vitest";
import type { FsEntry } from "../../preload/fs-types.js";
import type { PreviewFileSource } from "../filesystem/preview-file-source.js";
import { type RemoteFileSystem, RemoteFiles } from "./remote-files.js";

const HOME = "/Users/me";
const CWD = "/Users/me/.vetta/conversation/s1";

interface FakeFile {
	bytes: Buffer;
	modifiedAt: number;
}

/** In-memory desktop: files by absolute path, folders implied, symlinks by realpath. */
function harness() {
	const files = new Map<string, FakeFile>();
	const links = new Map<string, string>();
	const reads: string[] = [];
	let scale: (bytes: Buffer) => Buffer | undefined = () => undefined;
	const isFolder = (path: string) => [...files.keys()].some((file) => file.startsWith(`${path}/`));
	const fs: RemoteFileSystem = {
		readDirectory: async (dir) => {
			if (!isFolder(dir)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
			const names = new Set<string>();
			for (const file of files.keys()) {
				if (file.startsWith(`${dir}/`)) names.add(file.slice(dir.length + 1).split("/")[0] ?? "");
			}
			return [...names].sort().map(
				(name): FsEntry => ({
					name,
					path: `${dir}/${name}`,
					isDirectory: !files.has(`${dir}/${name}`),
					size: files.get(`${dir}/${name}`)?.bytes.byteLength ?? 0,
					modifiedAt: files.get(`${dir}/${name}`)?.modifiedAt ?? 0,
				}),
			);
		},
		openSource: (path): PreviewFileSource => {
			// The desktop's preview scope: anywhere under home.
			if (!path.startsWith(`${HOME}/`)) throw new Error("Path is outside any previewable directory");
			return {
				path,
				stat: async () => {
					const file = files.get(path);
					if (file) return { size: file.bytes.byteLength, isFile: true, modifiedAt: file.modifiedAt };
					return isFolder(path) ? { size: 0, isFile: false, modifiedAt: 5 } : null;
				},
				read: async () => {
					reads.push(path);
					return files.get(path)?.bytes ?? Buffer.alloc(0);
				},
				readHead: async (count) => (files.get(path)?.bytes ?? Buffer.alloc(0)).subarray(0, count),
			};
		},
		realpath: async (path) => links.get(path) ?? path,
		scaleImage: (bytes) => scale(bytes),
	};
	const service = new RemoteFiles({ fs, home: HOME, path: posix });
	return {
		files,
		links,
		reads,
		service,
		setScale: (next: typeof scale) => {
			scale = next;
		},
	};
}

describe("RemoteFiles", () => {
	it("lists the session directory with canonical paths, hiding dotfiles and secrets", async () => {
		const { files, service } = harness();
		files.set(`${CWD}/report.html`, { bytes: Buffer.from("<p>hi</p>"), modifiedAt: 7 });
		files.set(`${CWD}/out/a.md`, { bytes: Buffer.from("# a"), modifiedAt: 8 });
		files.set(`${CWD}/.env`, { bytes: Buffer.from("KEY=1"), modifiedAt: 9 });
		files.set(`${CWD}/.ssh/id_rsa`, { bytes: Buffer.from("key"), modifiedAt: 9 });

		expect(await service.list(CWD, {})).toEqual({
			path: "",
			entries: [
				{ name: "out", path: "out", isDirectory: true, size: 0, modifiedAt: 0 },
				{ name: "report.html", path: "report.html", isDirectory: false, size: 9, modifiedAt: 7 },
			],
		});
		expect((await service.list(CWD, { path: "out" })).entries.map((entry) => entry.path)).toEqual(["out/a.md"]);
	});

	it("refuses to list outside the session directory, including through a symlinked folder", async () => {
		const { files, links, service } = harness();
		files.set(`${HOME}/Desktop/x.pdf`, { bytes: Buffer.from("%PDF"), modifiedAt: 1 });
		files.set(`${CWD}/escape/x`, { bytes: Buffer.from("x"), modifiedAt: 1 });
		links.set(`${CWD}/escape`, `${HOME}/Desktop`);
		await expect(service.list(CWD, { path: "~/Desktop" })).rejects.toMatchObject({ code: "forbidden" });
		await expect(service.list(CWD, { path: ".." })).rejects.toMatchObject({ code: "forbidden" });
		await expect(service.list(CWD, { path: "escape" })).rejects.toMatchObject({ code: "forbidden" });
		await expect(service.list(CWD, { path: "missing" })).rejects.toMatchObject({ code: "not_found" });
	});

	it("describes a linked file outside the session directory but inside the preview scope", async () => {
		const { files, service } = harness();
		files.set(`${HOME}/Desktop/report.pdf`, { bytes: Buffer.from("%PDF-1.7"), modifiedAt: 42 });
		expect(await service.stat(CWD, { path: "file:///Users/me/Desktop/report.pdf" })).toEqual({
			file: {
				name: "report.pdf",
				path: "~/Desktop/report.pdf",
				isDirectory: false,
				size: 8,
				modifiedAt: 42,
				mimeType: "application/pdf",
				displayPath: "~/Desktop/report.pdf",
			},
		});
	});

	it("maps what the phone may not see to forbidden and what is missing to not_found", async () => {
		const { files, links, service } = harness();
		files.set(`${HOME}/.ssh/id_rsa`, { bytes: Buffer.from("key"), modifiedAt: 1 });
		files.set(`${CWD}/innocent.txt`, { bytes: Buffer.from("key"), modifiedAt: 1 });
		links.set(`${CWD}/innocent.txt`, `${HOME}/.ssh/id_rsa`);
		await expect(service.stat(CWD, { path: "~/.ssh/id_rsa" })).rejects.toMatchObject({ code: "forbidden" });
		await expect(service.stat(CWD, { path: "innocent.txt" })).rejects.toMatchObject({ code: "forbidden" });
		await expect(service.stat(CWD, { path: "/etc/hosts" })).rejects.toMatchObject({ code: "forbidden" });
		await expect(service.stat(CWD, { path: "nope.md" })).rejects.toMatchObject({ code: "not_found" });
		await expect(service.stat(CWD, { path: " " })).rejects.toMatchObject({ code: "invalid_frame" });
	});

	it("reads in chunks, preparing the content once for the whole read", async () => {
		const { files, reads, service } = harness();
		const bytes = Buffer.alloc(REMOTE_FILE_CHUNK_BYTES + 10, 7);
		files.set(`${CWD}/big.bin`, { bytes, modifiedAt: 3 });
		const first = await service.read(CWD, { path: "big.bin", offset: 0 });
		expect(first).toMatchObject({ offset: 0, totalSize: bytes.byteLength, modifiedAt: 3 });
		expect(Buffer.from(first.data, "base64").byteLength).toBe(REMOTE_FILE_CHUNK_BYTES);
		const second = await service.read(CWD, { path: "big.bin", offset: REMOTE_FILE_CHUNK_BYTES, modifiedAt: 3 });
		expect(Buffer.from(second.data, "base64").byteLength).toBe(10);
		expect(reads).toEqual([`${CWD}/big.bin`]);
	});

	it("answers file_changed when the file is rewritten between chunks", async () => {
		const { files, service } = harness();
		files.set(`${CWD}/a.md`, { bytes: Buffer.from("one"), modifiedAt: 3 });
		await service.read(CWD, { path: "a.md", offset: 0 });
		files.set(`${CWD}/a.md`, { bytes: Buffer.from("two!"), modifiedAt: 4 });
		await expect(service.read(CWD, { path: "a.md", offset: 2, modifiedAt: 3 })).rejects.toMatchObject({
			code: "file_changed",
		});
	});

	it("refuses files over the limit but serves large photos scaled down", async () => {
		const { files, service, setScale } = harness();
		files.set(`${CWD}/huge.pdf`, { bytes: Buffer.alloc(REMOTE_MAX_FILE_BYTES + 1), modifiedAt: 1 });
		await expect(service.read(CWD, { path: "huge.pdf", offset: 0 })).rejects.toMatchObject({ code: "too_large" });

		files.set(`${CWD}/photo.png`, { bytes: Buffer.alloc(REMOTE_MAX_FILE_BYTES + 1), modifiedAt: 1 });
		setScale(() => Buffer.from("jpeg"));
		expect(await service.read(CWD, { path: "photo.png", offset: 0 })).toMatchObject({
			data: Buffer.from("jpeg").toString("base64"),
			totalSize: 4,
			mimeType: "image/jpeg",
		});
	});

	it("sends an image as it is when it cannot be scaled", async () => {
		const { files, service } = harness();
		files.set(`${CWD}/a.webp`, { bytes: Buffer.from("webp"), modifiedAt: 1 });
		expect(await service.read(CWD, { path: "a.webp", offset: 0 })).toMatchObject({ mimeType: "image/webp" });
	});

	it("rejects malformed reads", async () => {
		const { files, service } = harness();
		files.set(`${CWD}/a.md`, { bytes: Buffer.from("abc"), modifiedAt: 1 });
		await expect(service.read(CWD, { path: "a.md" })).rejects.toMatchObject({ code: "invalid_frame" });
		await expect(service.read(CWD, { path: "a.md", offset: 9 })).rejects.toMatchObject({ code: "invalid_frame" });
		files.set(`${CWD}/dir/x`, { bytes: Buffer.from("x"), modifiedAt: 1 });
		await expect(service.read(CWD, { path: "dir", offset: 0 })).rejects.toMatchObject({ code: "invalid_frame" });
	});
});
