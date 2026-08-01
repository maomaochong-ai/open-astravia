/**
 * 读安装包里的 manifest，供提交前的交叉校验使用。
 *
 * 为什么要读包：payload 里的 i18n、tags、name 与包内 `plugin.json` / `locales/*.json` /
 * `SKILL.md` 是同一批信息的两个来源，服务端按一套固定优先级合并它们（见
 * `ability_upload.go` 的 mergeUploadDetail / mergeLocaleOverrides）。作者写的键与包内
 * 对不上时，服务端不会报错——它只是把两份数据并排存下，客户端按 locale 取值时命中包
 * 内那份，作者写的整块沉底。**这类问题在提交后不可见**，唯一能拦住它的位置就是这里。
 *
 * 零外部依赖：skill 目录没有 node_modules 落脚点（见 publish.mjs 的说明），故 zip 与
 * tar.gz 都手写解析。只读 manifest 这几个小文本文件，不解压整包。
 *
 * 任何解析失败都返回 null / 空值而不抛错——交叉校验是**增补**的一层，包的形状本身由
 * 服务端把关；这里读不懂就少查几项，绝不能因此挡住一次本该成功的提交。
 */

import { readFileSync } from "node:fs";
import { inflateRawSync, gunzipSync } from "node:zlib";

/** 单个 manifest 文本的读取上限：这些都是小文件，超了必是包结构异常，不值得解压。 */
const MAX_MANIFEST_BYTES = 1 << 20;

// ─── zip ───

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * 扫描中央目录，返回 `名字 → 取内容的函数`。
 *
 * 用中央目录而非顺序读局部头：局部头的 size 字段在带 data descriptor 的流式 zip 里
 * 恒为 0，只有中央目录里的那份始终可信。
 */
function readZipEntries(buffer) {
	// EOCD 在文件末尾，注释最长 64KiB，故最多回扫 64KiB + 22 字节
	const scanFrom = Math.max(0, buffer.length - 0xffff - 22);
	let eocd = -1;
	for (let i = buffer.length - 22; i >= scanFrom; i--) {
		if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) return null;

	const count = buffer.readUInt16LE(eocd + 10);
	let offset = buffer.readUInt32LE(eocd + 16);
	// zip64：条目数或偏移量溢出成哨兵值，本模块不支持，直接放弃交叉校验
	if (count === 0xffff || offset === 0xffffffff) return null;

	const entries = new Map();
	for (let i = 0; i < count; i++) {
		if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) return null;
		const method = buffer.readUInt16LE(offset + 10);
		const compressedSize = buffer.readUInt32LE(offset + 20);
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const localOffset = buffer.readUInt32LE(offset + 42);
		const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
		offset += 46 + nameLength + extraLength + commentLength;

		entries.set(normalizeEntryName(name), () => readZipEntry(buffer, localOffset, method, compressedSize));
	}
	return entries;
}

function readZipEntry(buffer, localOffset, method, compressedSize) {
	if (compressedSize > MAX_MANIFEST_BYTES * 4) return null;
	if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) return null;
	// 局部头的 name/extra 长度可以与中央目录的不同，必须按局部头这份算数据起点
	const nameLength = buffer.readUInt16LE(localOffset + 26);
	const extraLength = buffer.readUInt16LE(localOffset + 28);
	const start = localOffset + 30 + nameLength + extraLength;
	const raw = buffer.subarray(start, start + compressedSize);
	try {
		if (method === 0) return raw.toString("utf8");
		if (method === 8) return inflateRawSync(raw).toString("utf8");
	} catch {
		return null;
	}
	return null;
}

// ─── tar.gz ───

/** tar 走定长 512 字节块头，逐块跳过即可，只留下我们要读的文本文件。 */
function readTarEntries(buffer) {
	let data;
	try {
		data = gunzipSync(buffer);
	} catch {
		return null;
	}

	const entries = new Map();
	let offset = 0;
	while (offset + 512 <= data.length) {
		const name = data.toString("utf8", offset, offset + 100).replace(/\0.*$/, "");
		if (!name) break; // 连续两个空块 = 归档结束
		const sizeField = data.toString("utf8", offset + 124, offset + 136).replace(/\0.*$/, "").trim();
		const size = Number.parseInt(sizeField, 8);
		if (!Number.isFinite(size) || size < 0) return null;
		const typeFlag = data.toString("utf8", offset + 156, offset + 157);
		const start = offset + 512;

		// typeFlag "0" / "\0" 是普通文件；目录与长名扩展块等一律跳过
		if ((typeFlag === "0" || typeFlag === "\0" || typeFlag === "") && size <= MAX_MANIFEST_BYTES) {
			const end = start + size;
			entries.set(normalizeEntryName(name), () => data.toString("utf8", start, end));
		}
		offset = start + Math.ceil(size / 512) * 512;
	}
	return entries;
}

function normalizeEntryName(name) {
	return name.replace(/^\.\//, "").replace(/\\/g, "/");
}

// ─── manifest 定位 ───

/**
 * 找 manifest 所在目录：先看根，再看**唯一的顶层子目录**。
 * 与服务端 findPluginManifestFile / findSkillMd 的规则一致——两边不一致就会出现
 * 「本地校验说没问题，服务端说找不到 plugin.json」这种最难查的分歧。
 */
function locateManifest(entries, fileName) {
	if (entries.has(fileName)) return { path: fileName, dir: "" };
	for (const name of entries.keys()) {
		const segments = name.split("/");
		if (segments.length === 2 && segments[1] === fileName) {
			return { path: name, dir: `${segments[0]}/` };
		}
	}
	return null;
}

function readJson(entries, path) {
	const read = entries.get(path);
	if (!read) return null;
	const text = read();
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * SKILL.md 的 YAML frontmatter 解析：只认顶层 `key: value` 与 `metadata:` 下的一层。
 *
 * 刻意不引 YAML 解析器（零依赖约束），也刻意**只在能确定读懂时才返回值**：
 * 交叉校验依赖它给出的事实，读半懂产出的是假错误，比不校验更糟。
 */
function parseSkillFrontmatter(text) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text ?? "");
	if (!match) return null;

	const out = { metadata: {} };
	let inMetadata = false;
	let pendingListKey = null;

	for (const line of match[1].split(/\r?\n/)) {
		if (!line.trim() || line.trim().startsWith("#")) continue;

		const listItem = /^\s+-\s+(.*)$/.exec(line);
		if (listItem && pendingListKey) {
			(inMetadata ? out.metadata : out)[pendingListKey].push(stripQuotes(listItem[1]));
			continue;
		}
		pendingListKey = null;

		const indented = /^\s+/.test(line);
		const pair = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
		if (!pair) continue;
		const [, key, rawValue] = pair;

		if (!indented) {
			inMetadata = key === "metadata";
			if (inMetadata) continue;
		} else if (!inMetadata) {
			continue; // 不认识的嵌套结构，跳过而不猜
		}

		const target = inMetadata ? out.metadata : out;
		const value = rawValue.trim();
		if (value === "") {
			target[key] = [];
			pendingListKey = key;
			continue;
		}
		const inlineList = /^\[(.*)\]$/.exec(value);
		if (inlineList) {
			target[key] = inlineList[1]
				.split(",")
				.map((item) => stripQuotes(item.trim()))
				.filter(Boolean);
			continue;
		}
		target[key] = stripQuotes(value);
	}
	return out;
}

function stripQuotes(value) {
	return value.replace(/^["'](.*)["']$/, "$1").trim();
}

/**
 * 读出交叉校验要用的那几份 manifest。
 *
 * 返回 `null` 表示包读不动（格式不认识 / 结构异常），调用方应当跳过交叉校验而非报错。
 */
export function inspectPackage(filePath) {
	let buffer;
	try {
		buffer = readFileSync(filePath);
	} catch {
		return null;
	}

	const isZip = buffer.length > 4 && buffer.readUInt32LE(0) === LOCAL_SIGNATURE;
	const entries = isZip ? readZipEntries(buffer) : readTarEntries(buffer);
	if (!entries || entries.size === 0) return null;

	const pluginAt = locateManifest(entries, "plugin.json");
	const skillAt = locateManifest(entries, "SKILL.md");
	const dir = pluginAt?.dir ?? skillAt?.dir ?? "";

	const locales = {};
	const localePrefix = `${dir}locales/`;
	for (const name of entries.keys()) {
		if (!name.startsWith(localePrefix) || !name.endsWith(".json")) continue;
		const locale = name.slice(localePrefix.length, -".json".length);
		if (!locale || locale.includes("/")) continue;
		locales[locale] = readJson(entries, name) ?? {};
	}

	const skillText = skillAt ? entries.get(skillAt.path)?.() : null;

	return {
		root: dir,
		pluginManifest: pluginAt ? readJson(entries, pluginAt.path) : null,
		skillFrontmatter: skillText ? parseSkillFrontmatter(skillText) : null,
		vettaJson: readJson(entries, `${dir}vetta.json`),
		locales,
	};
}

/** `%key%` 占位符（ADR-0033）。与服务端 resolveNlsText 的判定一致。 */
export function nlsKeyOf(value) {
	const match = /^%([^%]+)%$/.exec(String(value ?? "").trim());
	return match ? match[1] : null;
}
