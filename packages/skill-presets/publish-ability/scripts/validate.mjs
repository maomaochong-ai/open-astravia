/**
 * 提交前的本地严格校验。
 *
 * 服务端也校验同一套规则（`internal/service/ability_submit.go`），这里再做一遍不是
 * 重复：agent 拿到「HTTP 400: detail.author 必填」时只知道失败了，而这里能在**一次
 * 执行里**把所有问题一次性列全，agent 一轮就能补齐重试，不必来回试探。
 *
 * 因此本模块的产出是**错误清单**而非首个错误。
 */

import { nlsKeyOf } from "./package-inspect.mjs";

/** 能力形态。与服务端 model.AbilityType* 一一对应。 */
export const ABILITY_TYPES = ["skill", "scene", "mcp", "plugin", "bundle"];

/** 有产物的形态：必须随包提交，产物是安装的物理来源。 */
export const ARTIFACT_TYPES = ["skill", "scene", "plugin"];

/** 宿主已实现的头图模板白名单，与服务端 showcaseTemplates 保持一致。 */
const SHOWCASE_TEMPLATES = new Set(["chat-over-canvas", "chat-thread"]);
/** chat-over-canvas 的画布母题白名单。 */
const CANVAS_MOTIFS = new Set(["design", "code", "docs", "generic"]);
/**
 * 宿主真正能渲染的 Solar 图标。
 *
 * 与 `packages/theme-ui/src/skills/skill-icon.tsx` 的 SOLAR_SKILL_ICON_CLASS 一一对应：
 * 客户端用 Tailwind + @iconify/tailwind4，图标 class 必须在构建期被扫到，
 * 所以只有这份字面量名单里的图标有对应 CSS，**其余 solar:* 会静默回落成默认图标**。
 * 服务端只校验前缀，不认这份名单——所以拦在这里，否则就是「传成功了但图标不显示」。
 */
const SOLAR_ICONS = new Set([
	"solar:star-bold",
	"solar:magic-stick-3-bold",
	"solar:bolt-bold",
	"solar:fire-bold",
	"solar:heart-bold",
	"solar:cup-star-bold",
	"solar:code-bold",
	"solar:widget-2-bold",
	"solar:layers-bold",
	"solar:cpu-bolt-bold",
	"solar:database-bold",
	"solar:cloud-bold",
	"solar:server-bold",
	"solar:shield-bold",
	"solar:lock-keyhole-bold",
	"solar:key-bold",
	"solar:chat-round-bold",
	"solar:letter-bold",
	"solar:document-bold",
	"solar:folder-bold",
	"solar:gallery-bold",
	"solar:camera-bold",
	"solar:videocamera-record-bold",
	"solar:music-note-bold",
	"solar:chart-2-bold",
	"solar:graph-up-bold",
	"solar:map-point-bold",
	"solar:global-bold",
	"solar:rocket-2-bold",
	"solar:lightbulb-bolt-bold",
]);

/** meta 预置键白名单，与服务端 abilityMetaKeys 保持一致。 */
const META_KEYS = new Set(["homepage", "repository", "docs", "license"]);
/** slug / version 会拼进对象存储 key，白名单防路径注入。 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * `detail` 与 `detail.i18n[locale]` 的合法字段。
 *
 * 服务端是 `json.Unmarshal` 进结构体：**拼错的键既不报错也不入库**，提交返回成功而内容
 * 悄悄少了一块。写错键名是这条链路上最常见也最难自查的失误（`title` / `body` /
 * `markdown` / `long_description` 都出现过），故白名单之外一律拦下。
 */
const DETAIL_FIELDS = new Set([
	"name",
	"description",
	"author",
	"license",
	"icon",
	"tags",
	"content",
	"showcases",
	"meta",
	"i18n",
]);
/** 译文覆盖块的合法字段，是 DETAIL_FIELDS 的子集：author/license/icon 不按语言区分。 */
const LOCALE_FIELDS = new Set(["name", "description", "tags", "content", "showcases", "meta"]);

function validateUnknownFields(object, allowed, path, errors) {
	for (const key of Object.keys(object ?? {})) {
		if (allowed.has(key)) continue;
		errors.push(
			`${path}.${key} 不是合法字段，服务端会静默丢弃它。可用字段：${[...allowed].join(" / ")}`,
		);
	}
}

/**
 * 译文块的 locale 键：必须是基语言（`zh` / `en`），不能带地区后缀。
 *
 * 客户端的界面语言只有基语言两种，取值先精确匹配 `i18n[locale]`。写成 `en-US` 时：
 * 若包内 `locales/en.json` 也展开出一个 `en` 块，两个键并存且**不合并**，精确匹配命中
 * 包内那份（通常只有 name/description），作者写的 content/showcases/tags 整块沉底——
 * 表现为「英文详情页标题是英文、正文是中文」。没有包内块时才会回退到 `en-US`，
 * 所以这个错误是否致命取决于包的内容，不能靠运气。
 */
function validateLocaleKey(locale, errors) {
	const trimmed = locale.trim();
	if (!trimmed) {
		errors.push("detail.i18n 的 locale 键不能为空");
		return;
	}
	const region = /^([A-Za-z]{2,3})[-_]/.exec(trimmed);
	if (region) {
		errors.push(
			`detail.i18n.${trimmed} 的 locale 键不能带地区后缀，改成 "${region[1].toLowerCase()}"。` +
				`客户端界面语言只有基语言，带地区的键在包内也有同语言译文时会被整块忽略`,
		);
		return;
	}
	if (trimmed !== trimmed.toLowerCase()) {
		errors.push(`detail.i18n.${trimmed} 的 locale 键必须小写`);
	}
}

function isBlank(value) {
	return typeof value !== "string" || value.trim() === "";
}

/** 校验图标三态：空 / 白名单内的 solar 图标 / http(s):// */
function validateIcon(icon, errors) {
	if (icon === undefined || icon === null || String(icon).trim() === "") return;
	const trimmed = String(icon).trim();
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return;
	if (SOLAR_ICONS.has(trimmed)) return;
	if (trimmed.startsWith("solar:")) {
		errors.push(
			`detail.icon 不在宿主内置的 Solar 图标名单内：${trimmed}。` +
				`服务端会收下它，但客户端渲染不出来、会回落成默认图标。可选值：${[...SOLAR_ICONS].join(" / ")}`,
		);
		return;
	}
	errors.push(`detail.icon 非法：${trimmed}。只能是空、内置 Solar 图标名，或 http(s):// 外链`);
}

function validateShowcases(showcases, path, errors) {
	if (!showcases) return;
	if (!Array.isArray(showcases)) {
		errors.push(`${path} 必须是数组`);
		return;
	}
	showcases.forEach((sc, i) => {
		const at = `${path}[${i}]`;
		if (!SHOWCASE_TEMPLATES.has(sc?.template)) {
			errors.push(`${at}.template 非法：${sc?.template}。只能是 chat-over-canvas 或 chat-thread`);
		}
		if (isBlank(sc?.user_prompt)) errors.push(`${at}.user_prompt 必填`);
		if (isBlank(sc?.assistant_reply)) errors.push(`${at}.assistant_reply 必填`);
		if (sc?.canvas) {
			if (sc.template !== "chat-over-canvas") {
				errors.push(`${at}.canvas 仅 chat-over-canvas 模板可用`);
			} else if (!CANVAS_MOTIFS.has(sc.canvas)) {
				errors.push(`${at}.canvas 非法：${sc.canvas}。只能是 design/code/docs/generic`);
			}
		}
		if (sc?.brand_icon_url && !/^https?:\/\//.test(sc.brand_icon_url)) {
			errors.push(`${at}.brand_icon_url 必须以 http:// 或 https:// 开头`);
		}
	});
}

function validateMeta(meta, path, errors) {
	if (!meta) return;
	if (!Array.isArray(meta)) {
		errors.push(`${path} 必须是数组`);
		return;
	}
	meta.forEach((entry, i) => {
		const at = `${path}[${i}]`;
		const key = entry?.key?.trim();
		if (key) {
			if (!META_KEYS.has(key)) {
				errors.push(`${at}.key 非法：${key}。预置键只有 homepage/repository/docs/license；自定义条目请改用 label`);
			}
		} else if (isBlank(entry?.label)) {
			errors.push(`${at} 需要 key（预置项）或 label（自定义项）`);
		}
		if (isBlank(entry?.value)) errors.push(`${at}.value 必填`);
	});
}

/** 展示信息的必填与形状校验。所有形态共用。 */
function validateDetail(detail, errors) {
	if (!detail || typeof detail !== "object") {
		errors.push("detail 必填：它是能力全部展示信息的唯一来源");
		return;
	}
	if (isBlank(detail.name)) errors.push("detail.name 必填：市场卡片与详情页的标题");
	if (isBlank(detail.description)) errors.push("detail.description 必填：市场卡片的一句话简介");
	if (isBlank(detail.author)) errors.push("detail.author 必填：条目的作者署名");
	if (isBlank(detail.content)) {
		errors.push("detail.content 必填：详情页正文（markdown），用户装之前要靠它判断这是什么");
	}
	validateIcon(detail.icon, errors);
	validateShowcases(detail.showcases, "detail.showcases", errors);
	validateMeta(detail.meta, "detail.meta", errors);
	validateUnknownFields(detail, DETAIL_FIELDS, "detail", errors);

	for (const [locale, override] of Object.entries(detail.i18n ?? {})) {
		validateLocaleKey(locale, errors);
		if (!locale.trim()) continue;
		validateUnknownFields(override, LOCALE_FIELDS, `detail.i18n.${locale}`, errors);
		validateShowcases(override?.showcases, `detail.i18n.${locale}.showcases`, errors);
		validateMeta(override?.meta, `detail.i18n.${locale}.meta`, errors);
	}
}

function validateMembers(members, errors) {
	if (!Array.isArray(members) || members.length === 0) {
		errors.push("bundle 必须提供 members（至少一个成员）");
		return;
	}
	const seen = new Set();
	members.forEach((m, i) => {
		const at = `members[${i}]`;
		if (m?.type === "bundle") {
			errors.push(`${at}.type 非法：bundle 不能嵌套 bundle`);
		} else if (!ABILITY_TYPES.includes(m?.type)) {
			errors.push(`${at}.type 非法：${m?.type}`);
		}
		if (isBlank(m?.slug)) {
			errors.push(`${at}.slug 必填`);
			return;
		}
		const key = `${m.type}:${m.slug}`;
		if (seen.has(key)) errors.push(`${at} 成员重复：${key}`);
		seen.add(key);
		if (m.inline && Object.keys(m.inline).length > 0 && m.type !== "mcp") {
			errors.push(`${at}.inline 仅 mcp 成员允许——带产物的成员必须引用已上架条目`);
		}
	});
}

/**
 * 校验提交入参，返回全部问题。空数组表示通过。
 * `packageExists` 由调用方注入（默认不查文件系统），便于测试与关注点分离。
 */
export function validateUploadInput(input, options = {}) {
	const errors = [];

	if (!ABILITY_TYPES.includes(input?.type)) {
		// type 决定后续每一条规则，它错了继续校验只会产出误导性的报错
		return [`type 必填且只能是 ${ABILITY_TYPES.join(" / ")} 之一，收到：${JSON.stringify(input?.type)}`];
	}

	validateDetail(input.detail, errors);

	const version = String(input.version ?? "").trim();
	if (version !== "" && !SAFE_SEGMENT.test(version)) {
		errors.push(`version 含非法字符：${input.version}（仅允许字母数字 . _ -）`);
	}
	// 服务端对 plugin 恒取 manifest.Version，payload 里这个字段既不生效也不报错——
	// 留着它只会让人以为版本已经改过了
	if (version !== "" && input.type === "plugin") {
		errors.push("plugin 的版本以包内 plugin.json 的 version 为准，payload 的 version 不会生效，请删除该字段");
	}

	if (ARTIFACT_TYPES.includes(input.type)) {
		if (isBlank(input.package_path)) {
			errors.push(
				`${input.type} 必须提供 package_path：本地安装包路径（plugin 为 .zip，skill/scene 为 .zip 或 .tar.gz）`,
			);
		} else {
			const path = input.package_path;
			if (!/\.(zip|tar\.gz|tgz)$/i.test(path)) {
				errors.push(`package_path 后缀不支持：${path}。只接受 .zip / .tar.gz / .tgz`);
			}
			if (input.type === "plugin" && !/\.zip$/i.test(path)) {
				errors.push(`plugin 的安装包必须是 .zip（内含 plugin.json），收到：${path}`);
			}
			if (options.packageExists && !options.packageExists(path)) {
				errors.push(`package_path 指向的文件不存在：${path}`);
			}
		}
		// slug 来自包内 manifest（plugin.json 的 id / SKILL.md 的 name），传了也不作数
	} else {
		if (isBlank(input.slug)) {
			errors.push(`${input.type} 必须提供 slug（机器标识，与 type 联合唯一）`);
		} else if (!SAFE_SEGMENT.test(input.slug.trim())) {
			errors.push(`slug 含非法字符：${input.slug}（仅允许字母数字 . _ -）`);
		}
	}

	if (input.type === "mcp" && (!input.mcp_config || Object.keys(input.mcp_config).length === 0)) {
		errors.push("mcp 必须提供 mcp_config：原样写进 mcp.json 的配置块（transport / command / url 等）");
	}
	if (input.type === "bundle") {
		validateMembers(input.members, errors);
	}

	return errors;
}

// --- 与安装包的交叉校验 ---
//
// 静态校验管得了 payload 自身的形状，管不了「payload 与包内 manifest 是不是同一套口径」。
// 后者恰恰是提交后最难发现的一类问题：服务端把两份数据都收下、不报错，只是按固定优先级
// 决定谁生效，结果要装完切语言才看得见。故凡是能靠读包判定的，都在提交前判掉。

function baseLanguage(locale) {
	return String(locale).trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * 插件包的交叉校验。`pkg` 来自 package-inspect.mjs。
 *
 * 服务端会把包内 `locales/<locale>.json`（默认语言除外）展开成 `detail.i18n[<locale>]`，
 * 再与作者提交的 i18n **按 locale 键逐字段合并**。键对不上就不是合并而是并存。
 */
function crossCheckPlugin(input, pkg, errors, warnings) {
	const manifest = pkg.pluginManifest;
	if (!manifest) {
		errors.push("包内找不到 plugin.json（根目录或唯一的顶层子目录下），服务端会拒绝这个包");
		return;
	}
	if (!manifest.id || !SAFE_SEGMENT.test(String(manifest.id))) {
		errors.push(`plugin.json 的 id 非法：${JSON.stringify(manifest.id)}（仅允许字母数字 . _ -）`);
	}
	if (!manifest.version) {
		errors.push("plugin.json 缺少 version，服务端会拒绝这个包");
	}
	if (input.slug?.trim() && input.slug.trim() !== manifest.id) {
		warnings.push(`payload 的 slug（${input.slug.trim()}）会被忽略，实际用的是 plugin.json 的 id：${manifest.id}`);
	}

	const defaultLocale = String(manifest.defaultLocale ?? "").trim() || "zh";
	// 默认语言那份不会被展开成覆盖块——它已经是 detail 顶层的内容
	const packaged = Object.keys(pkg.locales).filter((locale) => locale !== defaultLocale);
	const authored = Object.keys(input.detail?.i18n ?? {});

	for (const locale of authored) {
		if (locale === defaultLocale) {
			errors.push(
				`detail.i18n.${locale} 是这个插件的默认语言（plugin.json 的 defaultLocale），` +
					"默认语言的文案写在 detail 顶层，不要再放进 i18n",
			);
			continue;
		}
		if (packaged.includes(locale)) continue;
		const collision = packaged.find((name) => baseLanguage(name) === baseLanguage(locale));
		if (collision) {
			errors.push(
				`detail.i18n.${locale} 与包内 locales/${collision}.json 是同一种语言但键不同，两者不会合并：` +
					`服务端会同时存下 "${collision}" 和 "${locale}" 两块，客户端只命中前者，你写的这块不会显示。` +
					`把键改成 "${collision}"`,
			);
		}
	}

	// 包内已有译名时再手写一份，等于把同一句话维护在两处；写岔了市场卡片与插件内的 UI 就对不上
	for (const [field, raw] of [
		["name", manifest.name],
		["description", manifest.description],
	]) {
		const key = nlsKeyOf(raw);
		if (!key) continue;
		for (const locale of authored) {
			const packagedText = pkg.locales[locale]?.[key];
			const authoredText = input.detail.i18n[locale]?.[field];
			if (!packagedText || !authoredText || packagedText === authoredText) continue;
			warnings.push(
				`detail.i18n.${locale}.${field} 与包内 locales/${locale}.json 的 ${key} 不一致，` +
					`提交后市场显示的是 payload 这份（"${authoredText}"），插件内 UI 仍显示包内那份（"${packagedText}"）`,
			);
		}
	}
}

/** skill / scene 的交叉校验：slug 与 tags 都来自 SKILL.md，payload 只能覆盖不能改名。 */
function crossCheckSkill(input, pkg, errors, warnings) {
	const fm = pkg.skillFrontmatter;
	if (!fm) {
		if (!pkg.root && !pkg.pluginManifest) {
			errors.push("包内找不到 SKILL.md（根目录或唯一的顶层子目录下），服务端会拒绝这个包");
		}
		return;
	}
	if (input.slug?.trim() && fm.name && input.slug.trim() !== fm.name) {
		warnings.push(`payload 的 slug（${input.slug.trim()}）会被忽略，实际用的是 SKILL.md 的 name：${fm.name}`);
	}
	if (fm.metadata?.tags?.length && !input.detail?.tags) {
		warnings.push(
			`detail.tags 未提供，将使用 SKILL.md frontmatter 的 tags：${fm.metadata.tags.join(", ")}`,
		);
	}
}

/**
 * 提交前拿安装包核对 payload。返回 `{errors, warnings}`。
 *
 * `pkg` 为 null（包读不动）时返回空结果：交叉校验是增补的一层，不该因为本模块读不懂
 * 某种压缩变体就挡住一次本该成功的提交——包的形状终究由服务端把关。
 */
export function crossCheckPackage(input, pkg) {
	const errors = [];
	const warnings = [];
	if (!pkg) return { errors, warnings };

	if (input.type === "plugin") {
		crossCheckPlugin(input, pkg, errors, warnings);
	} else {
		crossCheckSkill(input, pkg, errors, warnings);
	}

	// vetta.json 与 payload.detail 是同一份数据的两条投递路径，且是**整体二选一**：
	// 传了 detail，包内那份连一个字段都不会被读到
	if (pkg.vettaJson && input.detail) {
		warnings.push("包内的 vetta.json 被整体忽略：payload 提供了 detail，两者不做逐字段合并");
	}

	return { errors, warnings };
}
