// 售卖授权码：读取私钥 JWK，对 payload 签名，输出买断码。
// 用法：
//   bun extension/scripts/license-sign.mjs --order ASTR-2026-0001 --expire 20291231
//   --expire 为 YYYYMMDD（含当天，23:59:59 前有效）。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeLicense, encodePayload } from "../src/license.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
	const idx = process.argv.indexOf(`--${name}`);
	return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
}

const order = arg("order");
const expire = arg("expire");
if (!order || !expire) {
	console.error("用法: bun extension/scripts/license-sign.mjs --order <订单号> --expire <YYYYMMDD>");
	process.exit(1);
}
if (!/^\d{8}$/.test(expire)) {
	console.error("--expire 必须是 YYYYMMDD");
	process.exit(1);
}

const privateJwk = JSON.parse(
	readFileSync(resolve(root, ".secrets", "license-private.jwk.json"), "utf8"),
);

const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
	"sign",
]);

const payloadText = encodePayload(order, expire);
const signature = new Uint8Array(
	await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(payloadText)),
);

console.log(`[license-sign] order=${order} expire=${expire}`);
console.log(`[license-sign] 授权码：\n${encodeLicense(payloadText, signature)}`);
