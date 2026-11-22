/**
 * Windows Authenticode 签名配置。
 *
 * 为什么需要它：Windows 的 Smart App Control / SmartScreen 会拦下「无法验证发布者」的
 * exe 与安装包——用户看到的正是「智能应用控制已阻止可能不安全的应用」。签名不是加固
 * 选项，而是分发前提；而且必须**在图标与版本资源写完之后**签名，任何后续的 PE 写入都会
 * 让签名失效。
 *
 * 与 macOS 一致的约定（见 docs/deploy/apple-code-signing.md）：
 * - 凭据齐全 → 签名全部 exe 与安装包；
 * - 一个都不设 → 维持未签名产物（本地开发 / 未配置的 fork）；
 * - 只设一半 → 直接报错，不让「看起来签过其实没签」的产物发出去；
 * - `ASTRAVIA_REQUIRE_WINDOWS_SIGNATURE=1` 时，缺凭据就失败（发布流水线用）。
 */

/** 只属于 Windows 的变量。CSC_LINK / CSC_KEY_PASSWORD 与 macOS 共用格式（base64 PFX）。 */
export const WINDOWS_SIGNING_ENV_KEYS = [
	"WIN_CSC_LINK",
	"WIN_CSC_KEY_PASSWORD",
	"CSC_LINK",
	"CSC_KEY_PASSWORD",
	"ASTRAVIA_WINDOWS_SIGN_CERT",
	"ASTRAVIA_WINDOWS_SIGN_PASSWORD",
	"ASTRAVIA_WINDOWS_SIGN_SHA1",
];

export const DEFAULT_WINDOWS_TIMESTAMP_URL = "http://timestamp.digicert.com";

function hasValue(env, key) {
	return typeof env[key] === "string" && env[key].trim().length > 0;
}

function firstValue(env, keys) {
	for (const key of keys) {
		if (hasValue(env, key)) return { key, value: env[key].trim() };
	}
	return undefined;
}

export function hasWindowsSigningEnvironment(env = process.env) {
	return WINDOWS_SIGNING_ENV_KEYS.some((key) => hasValue(env, key));
}

/**
 * 解析签名配置。
 *
 * 两种凭据形态：
 * - PFX 文件：`WIN_CSC_LINK` / `CSC_LINK`（路径或 base64）+ 密码；
 * - 证书存储：`ASTRAVIA_WINDOWS_SIGN_SHA1`（指纹），用 `signtool /sha1` 选证书。
 */
export function resolveWindowsSigningConfig(env = process.env) {
	const required = env.ASTRAVIA_REQUIRE_WINDOWS_SIGNATURE?.trim();
	if (required !== undefined && required !== "" && required !== "0" && required !== "1") {
		throw new Error('ASTRAVIA_REQUIRE_WINDOWS_SIGNATURE must be "0" or "1"');
	}
	const requireSignature = required === "1";

	const certificateFile = firstValue(env, ["WIN_CSC_LINK", "CSC_LINK"]);
	const certificatePassword = firstValue(env, ["WIN_CSC_KEY_PASSWORD", "CSC_KEY_PASSWORD"]);
	const storeCert = firstValue(env, ["ASTRAVIA_WINDOWS_SIGN_SHA1"]);
	const namedCertificate = firstValue(env, ["ASTRAVIA_WINDOWS_SIGN_CERT"]);
	const timestampUrl = env.ASTRAVIA_WINDOWS_TIMESTAMP_URL?.trim() || DEFAULT_WINDOWS_TIMESTAMP_URL;

	// 只给密码不给证书是最常见的误配（CI secret 只导了一半）：先拦住，别落到「禁用」分支。
	if (certificatePassword && !certificateFile) {
		throw new Error(
			"Windows 签名凭据不完整；缺少 WIN_CSC_LINK。见 docs/deploy/windows-code-signing.md，" +
				"或清空全部 Windows 签名变量以产出未签名安装包。",
		);
	}

	if (!certificateFile && !storeCert && !namedCertificate) {
		if (requireSignature) {
			throw new Error(
				"ASTRAVIA_REQUIRE_WINDOWS_SIGNATURE=1 但没有 Windows 签名凭据；" +
					"设置 WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD，或 ASTRAVIA_WINDOWS_SIGN_SHA1，" +
					"见 docs/deploy/windows-code-signing.md",
			);
		}
		return { enabled: false, timestampUrl };
	}

	const missing = [];
	// PFX 必须同时有标识与密码；只有路径没有密码属于「半配置」，签出来的产物不可信。
	if (certificateFile && !certificatePassword) missing.push("WIN_CSC_KEY_PASSWORD");
	if (certificatePassword && !certificateFile) missing.push("WIN_CSC_LINK");
	if (missing.length > 0) {
		throw new Error(
			`Windows 签名凭据不完整；缺少 ${missing.join("; ")}。` +
				"见 docs/deploy/windows-code-signing.md，或清空全部 Windows 签名变量以产出未签名安装包。",
		);
	}

	return {
		enabled: true,
		certificateFile: certificateFile?.value,
		certificatePassword: certificatePassword?.value,
		certificateSha1: storeCert?.value,
		certificateName: namedCertificate?.value,
		timestampUrl,
	};
}
