// 授权码：一级离线验签（ECDSA P-256 + SHA-256，全程 WebCrypto，浏览器与 Node 一致）。
//
// 码格式（展示时允许插入 "-" 分组，解析时移除所有 "-" 再按 "." 分隔）：
//   WEP-<base32(payload)，每4字符一组以-分隔>.<base32(signature)，每4字符一组以-分隔>
// payload 文本：`1|<订单号>|<有效期YYYYMMDD>`（版本|订单号|到期日）。
// signature：对 payload 文本做 ECDSA P-256/SHA-256 签名（P1363，64 字节）。
//
// 安全边界：一级离线码为对称可逆向提取的弱防线，接受“一码多机 + 分享”风险
// （见 ../../docs/selector-plugin-integration.md §12.4 决策记录）。

const enc = new TextEncoder();

export const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(data: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = "";
	for (const byte of data) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	return out;
}

export function base32Decode(text: string): Uint8Array {
	const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
	let bits = 0;
	let value = 0;
	const out: number[] = [];
	for (const char of clean) {
		const idx = BASE32_ALPHABET.indexOf(char);
		if (idx < 0) continue;
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return new Uint8Array(out);
}

/** 每 4 字符一组，用 "-" 连接（纯展示）。 */
function group4(text: string): string {
	const parts: string[] = [];
	for (let i = 0; i < text.length; i += 4) parts.push(text.slice(i, i + 4));
	return parts.join("-");
}

export type LicensePayload = {
	order: string;
	/** YYYYMMDD */
	expire: string;
};

/** 构建 payload 文本：`1|<order>|<YYYYMMDD>` */
export function encodePayload(order: string, expire: string): string {
	return `1|${order}|${expire}`;
}

export function decodePayload(text: string): LicensePayload {
	const parts = text.split("|");
	if (parts.length !== 3 || parts[0] !== "1") throw new Error("bad license payload");
	const order = parts[1];
	const expire = parts[2];
	if (!/^\d{8}$/.test(expire)) throw new Error("bad license expiry");
	return { order, expire };
}

/** 生成展示用授权码。 */
export function encodeLicense(payloadText: string, signature: Uint8Array): string {
	return `WEP-${group4(base32Encode(enc.encode(payloadText)))}.${group4(base32Encode(signature))}`;
}

/** 解析授权码 → payload 文本 + 签名。格式非法时抛错。 */
export function parseLicense(code: string): { payloadText: string; signature: Uint8Array } {
	const clean = code.replaceAll("-", "").trim();
	const [head, sigB32] = clean.split(".");
	if (!head || !sigB32) throw new Error("bad license format");
	if (!head.startsWith("WEP")) throw new Error("bad license prefix");
	const payloadB32 = head.slice(3);
	const payloadText = new TextDecoder().decode(base32Decode(payloadB32));
	decodePayload(payloadText); // 校验结构
	return { payloadText, signature: base32Decode(sigB32) };
}

/** 验签（crypto.subtle，浏览器与 Node 通用）。 */
export async function verifySignature(
	payloadText: string,
	signature: Uint8Array,
	publicJwk: JsonWebKey,
): Promise<boolean> {
	const key = await crypto.subtle.importKey(
		"jwk",
		publicJwk,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["verify"],
	);
	return crypto.subtle.verify(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		signature as unknown as BufferSource,
		enc.encode(payloadText) as unknown as BufferSource,
	);
}

export type LicenseCheckResult =
	| { ok: true; order: string; expire: string }
	| { ok: false; reason: "invalid" | "expired" };

/** 完整校验：结构 + 签名 + 有效期。 */
export async function checkLicense(code: string, publicJwk: JsonWebKey): Promise<LicenseCheckResult> {
	let payloadText: string;
	let signature: Uint8Array;
	try {
		({ payloadText, signature } = parseLicense(code));
	} catch {
		return { ok: false, reason: "invalid" };
	}
	const payload = decodePayload(payloadText);
	if (!(await verifySignature(payloadText, signature, publicJwk))) {
		return { ok: false, reason: "invalid" };
	}
	const today = new Date();
	const expiry = new Date(
		Number(payload.expire.slice(0, 4)),
		Number(payload.expire.slice(4, 6)) - 1,
		Number(payload.expire.slice(6, 8)),
	);
	expiry.setHours(23, 59, 59, 999);
	if (today.getTime() > expiry.getTime()) return { ok: false, reason: "expired" };
	return { ok: true, order: payload.order, expire: payload.expire };
}
