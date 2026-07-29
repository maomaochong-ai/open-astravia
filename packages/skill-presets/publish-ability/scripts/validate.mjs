/**
 * 提交前的本地严格校验。
 *
 * 服务端也校验同一套规则（`internal/service/ability_submit.go`），这里再做一遍不是
 * 重复：agent 拿到「HTTP 400: detail.author 必填」时只知道失败了，而这里能在**一次
 * 执行里**把所有问题一次性列全，agent 一轮就能补齐重试，不必来回试探。
 *
 * 因此本模块的产出是**错误清单**而非首个错误。
 */

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

	for (const [locale, override] of Object.entries(detail.i18n ?? {})) {
		if (!locale.trim()) {
			errors.push("detail.i18n 的 locale 键不能为空");
			continue;
		}
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

	if (input.version !== undefined && String(input.version).trim() !== "" && !SAFE_SEGMENT.test(String(input.version).trim())) {
		errors.push(`version 含非法字符：${input.version}（仅允许字母数字 . _ -）`);
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
