import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { embedExeIcon, needsIconPatch } from "./embed-exe-icon.mjs";
import { embedPackagedAppIcons } from "./windows-version-layout.mjs";

const require = createRequire(import.meta.url);

/** 读 ICO 头里声明的各档尺寸（0 记作 256）。 */
function readIcoEntrySizes(icoBytes) {
	const count = icoBytes.readUInt16LE(4);
	const sizes = [];
	for (let i = 0; i < count; i += 1) {
		const width = icoBytes.readUInt8(6 + i * 16);
		sizes.push(width === 0 ? 256 : width);
	}
	return sizes;
}

function readIconGroupSizes(exeBytes) {
	const { NtExecutable, NtExecutableResource, Resource } = require("resedit");
	const res = NtExecutableResource.from(NtExecutable.from(exeBytes));
	const [group] = Resource.IconGroupEntry.fromEntries(res.entries);
	// ICO/资源里的 0 宽高表示 256，读回来时归一化。
	return group?.icons.map((icon) => (icon.width === 0 ? 256 : icon.width)) ?? [];
}

test("embedExeIcon writes the icon group into an executable", async () => {
	const directory = await mkdtemp(join(tmpdir(), "astravia-exe-icon-"));
	const exePath = join(directory, "app.exe");
	const iconPath = join(directory, "app.ico");

	const { NtExecutable } = require("resedit");
	await writeFile(exePath, Buffer.from(NtExecutable.createEmpty().generate()));
	await writeFile(iconPath, await readFile(new URL("../build/icon.ico", import.meta.url)));

	assert.deepEqual(readIconGroupSizes(await readFile(exePath)), []);

	const iconCount = await embedExeIcon(exePath, iconPath);

	// 断言与 ico 自身的档位一致，不另写一份清单：ico 增删尺寸时这里自动跟随。
	assert.equal(iconCount, readIcoEntrySizes(await readFile(iconPath)).length);
	assert.deepEqual(readIconGroupSizes(await readFile(exePath)), readIcoEntrySizes(await readFile(iconPath)));
});

test("embedPackagedAppIcons covers both the launcher and the versioned Electron exe", async () => {
	const appOutDir = await mkdtemp(join(tmpdir(), "astravia-pack-icons-"));
	await mkdir(join(appOutDir, "versions", "1.2.3"), { recursive: true });
	const iconPath = join(appOutDir, "icon.ico");
	const targets = [];

	await embedPackagedAppIcons({
		appOutDir,
		version: "1.2.3",
		iconPath,
		embed: async (exePath, receivedIconPath) => {
			targets.push([exePath, receivedIconPath]);
		},
	});

	// 版本目录里的 Electron 本体先写：旧快捷方式与固定项都指向它。
	assert.deepEqual(targets, [
		[join(appOutDir, "versions", "1.2.3", "Astravia.exe"), iconPath],
		[join(appOutDir, "Astravia.exe"), iconPath],
	]);
});

test("needsIconPatch skips unchanged binaries and re-runs when the icon changes", async () => {
	const directory = await mkdtemp(join(tmpdir(), "astravia-dev-icon-"));
	const exePath = join(directory, "electron.exe");
	await writeFile(exePath, "binary");
	const exeMtimeMs = Math.round((await stat(exePath)).mtimeMs);

	assert.equal(needsIconPatch(undefined, { exeMtimeMs, iconSha: "a" }), true);
	assert.equal(needsIconPatch({ exePath, exeMtimeMs, iconSha: "a" }, { exeMtimeMs, iconSha: "a" }), false);
	assert.equal(needsIconPatch({ exePath, exeMtimeMs, iconSha: "a" }, { exeMtimeMs, iconSha: "b" }), true);
	assert.equal(needsIconPatch({ exePath, exeMtimeMs, iconSha: "a" }, { exeMtimeMs: exeMtimeMs + 1, iconSha: "a" }), true);
});
