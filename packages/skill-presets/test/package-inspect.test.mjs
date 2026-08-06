import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { inspectPackage, nlsKeyOf } from "../publish-ability/scripts/package-inspect.mjs";

const workDir = mkdtempSync(join(tmpdir(), "publish-ability-"));

/** 手写一个 store（不压缩）的 zip：足以走完 EOCD → 中央目录 → 局部头这条解析链。 */
function writeZip(fileName, files) {
	const locals = [];
	const centrals = [];
	let offset = 0;

	for (const [name, content] of Object.entries(files)) {
		const nameBytes = Buffer.from(name, "utf8");
		const body = Buffer.from(content, "utf8");

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(0, 8); // method: store
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(body.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		locals.push(local, nameBytes, body);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(0, 10);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(body.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, nameBytes);

		offset += local.length + nameBytes.length + body.length;
	}

	const localPart = Buffer.concat(locals);
	const centralPart = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(Object.keys(files).length, 8);
	eocd.writeUInt16LE(Object.keys(files).length, 10);
	eocd.writeUInt32LE(centralPart.length, 12);
	eocd.writeUInt32LE(localPart.length, 16);

	const path = join(workDir, fileName);
	writeFileSync(path, Buffer.concat([localPart, centralPart, eocd]));
	return path;
}

/** 手写一个 tar.gz：512 字节定长头 + 内容补齐到 512 的倍数。 */
function writeTarGz(fileName, files) {
	const blocks = [];
	for (const [name, content] of Object.entries(files)) {
		const body = Buffer.from(content, "utf8");
		const header = Buffer.alloc(512);
		header.write(name, 0, 100, "utf8");
		header.write(body.length.toString(8).padStart(11, "0"), 124, 12, "utf8");
		header.write("0", 156, 1, "utf8");
		// checksum 字段本模块不校验，留空即可
		blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
	}
	blocks.push(Buffer.alloc(1024)); // 结束标记

	const path = join(workDir, fileName);
	writeFileSync(path, gzipSync(Buffer.concat(blocks)));
	return path;
}

describe("inspectPackage / zip", () => {
	it("读出根目录的 plugin.json 与 locales", () => {
		const path = writeZip("plugin-root.zip", {
			"plugin.json": JSON.stringify({ id: "demo", name: "%plugin.name%", defaultLocale: "zh" }),
			"locales/zh.json": JSON.stringify({ "plugin.name": "演示" }),
			"locales/en.json": JSON.stringify({ "plugin.name": "Demo" }),
			"dist/index.js": "console.log(1)",
		});

		const pkg = inspectPackage(path);

		expect(pkg.root).toBe("");
		expect(pkg.pluginManifest.id).toBe("demo");
		expect(Object.keys(pkg.locales).sort()).toEqual(["en", "zh"]);
		expect(pkg.locales.en["plugin.name"]).toBe("Demo");
	});

	it("manifest 在唯一顶层子目录下时同样能定位（与服务端规则一致）", () => {
		const path = writeZip("plugin-nested.zip", {
			"my-plugin/plugin.json": JSON.stringify({ id: "demo" }),
			"my-plugin/locales/en.json": JSON.stringify({ a: "b" }),
		});

		const pkg = inspectPackage(path);

		expect(pkg.root).toBe("my-plugin/");
		expect(pkg.pluginManifest.id).toBe("demo");
		expect(Object.keys(pkg.locales)).toEqual(["en"]);
	});

	it("读出包内 vetta.json", () => {
		const path = writeZip("with-vetta.zip", {
			"plugin.json": JSON.stringify({ id: "demo" }),
			"vetta.json": JSON.stringify({ name: "从包里来的" }),
		});

		expect(inspectPackage("/nope.zip")).toBeNull();
		expect(inspectPackage(path).vettaJson.name).toBe("从包里来的");
	});

	it("坏文件返回 null 而不抛错——交叉校验只是增补的一层", () => {
		const path = join(workDir, "broken.zip");
		writeFileSync(path, Buffer.from("not a zip at all"));

		expect(inspectPackage(path)).toBeNull();
	});
});

describe("inspectPackage / tar.gz 与 SKILL.md", () => {
	it("解析 frontmatter 的顶层字段与 metadata 一层", () => {
		const path = writeTarGz("skill.tar.gz", {
			"SKILL.md": [
				"---",
				"name: my-skill",
				"alias: 我的技能",
				"description: 一句话",
				"metadata:",
				"  version: 1.2.0",
				"  tags: [设计, 动画]",
				"  category: 开发",
				"---",
				"",
				"# 正文",
			].join("\n"),
		});

		const pkg = inspectPackage(path);

		expect(pkg.skillFrontmatter.name).toBe("my-skill");
		expect(pkg.skillFrontmatter.alias).toBe("我的技能");
		expect(pkg.skillFrontmatter.metadata.version).toBe("1.2.0");
		expect(pkg.skillFrontmatter.metadata.tags).toEqual(["设计", "动画"]);
	});

	it("块状列表形式的 tags 同样能读", () => {
		const path = writeTarGz("skill-list.tar.gz", {
			"SKILL.md": ["---", "name: s", "metadata:", "  tags:", "    - a", "    - b", "---", ""].join("\n"),
		});

		expect(inspectPackage(path).skillFrontmatter.metadata.tags).toEqual(["a", "b"]);
	});

	it("没有 frontmatter 时返回 null 而不是瞎猜", () => {
		const path = writeTarGz("no-fm.tar.gz", { "SKILL.md": "# 只有正文" });

		expect(inspectPackage(path).skillFrontmatter).toBeNull();
	});
});

describe("nlsKeyOf", () => {
	it("只认整串精确匹配的占位符", () => {
		expect(nlsKeyOf("%plugin.name%")).toBe("plugin.name");
		expect(nlsKeyOf("前缀 %plugin.name%")).toBeNull();
		expect(nlsKeyOf("Mobile UI Preview")).toBeNull();
		expect(nlsKeyOf(undefined)).toBeNull();
	});
});
