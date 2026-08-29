// 授权码体系单元验证（bun extension/scripts/license.test.ts 直接运行）：
// 签名→验签往返、篡改拒绝、过期拒绝、格式损坏拒绝。
import assert from "node:assert/strict";
import { checkLicense, decodePayload, encodeLicense, encodePayload, parseLicense } from "../src/license.ts";

const keyPair = await crypto.subtle.generateKey(
	{ name: "ECDSA", namedCurve: "P-256" },
	true,
	["sign", "verify"],
);
const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

async function sign(payloadText: string): Promise<Uint8Array> {
	return new Uint8Array(
		await crypto.subtle.sign(
			{ name: "ECDSA", hash: "SHA-256" },
			keyPair.privateKey,
			new TextEncoder().encode(payloadText),
		),
	);
}

// 1. 往返：有效码验签通过
const payload = encodePayload("ASTR-2026-0001", "20291231");
const code = encodeLicense(payload, await sign(payload));
const parsed = parseLicense(code);
assert.equal(parsed.payloadText, payload);
assert.equal(parsed.signature.length, 64, "P1363 签名应为 64 字节");
assert.deepEqual(decodePayload(parsed.payloadText), { order: "ASTR-2026-0001", expire: "20291231" });
const ok = await checkLicense(code, publicJwk);
assert.deepEqual(ok, { ok: true, order: "ASTR-2026-0001", expire: "20291231" });
console.log("1. 往返验证通过");

// 2. 篡改一个字符 → invalid
const tampered = code.slice(0, -2) + (code.endsWith("A") ? "B" : "A");
assert.deepEqual(await checkLicense(tampered, publicJwk), { ok: false, reason: "invalid" });
console.log("2. 篡改拒绝通过");

// 3. 过期 → expired（先签过去日期）
const pastPayload = encodePayload("ASTR-2026-0002", "20200101");
const pastCode = encodeLicense(pastPayload, await sign(pastPayload));
assert.deepEqual(await checkLicense(pastCode, publicJwk), { ok: false, reason: "expired" });
console.log("3. 过期拒绝通过");

// 4. 格式损坏 → invalid
assert.deepEqual(await checkLicense("WEP-NOT-A-CODE", publicJwk), { ok: false, reason: "invalid" });
assert.deepEqual(await checkLicense("", publicJwk), { ok: false, reason: "invalid" });
console.log("4. 格式损坏拒绝通过");

// 5. 码含分组破折号仍可解析（模拟用户手动换行/粘贴）
const grouped = code.replaceAll("-", "").match(/.{1,4}/g)?.join("-") ?? code;
assert.equal(parseLicense(grouped).payloadText, payload);
console.log("5. 分组粘贴解析通过");

console.log("\n[license.test] 全部通过");
