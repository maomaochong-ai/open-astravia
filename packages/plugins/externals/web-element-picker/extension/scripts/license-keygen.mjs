// 生成授权码密钥对：ECDSA P-256。
// 私钥 → extension/.secrets/license-private.jwk.json（勿提交，妥善备份）；
// 公钥 → extension/src/license-public.jwk.json（随扩展发布，扩展内置用于验签）。
// 用法：bun extension/scripts/license-keygen.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const secretsDir = resolve(root, ".secrets");
const publicPath = resolve(root, "src", "license-public.jwk.json");

const keyPair = await crypto.subtle.generateKey(
	{ name: "ECDSA", namedCurve: "P-256" },
	true,
	["sign", "verify"],
);

const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

mkdirSync(secretsDir, { recursive: true });
writeFileSync(resolve(secretsDir, "license-private.jwk.json"), `${JSON.stringify(privateJwk, null, 2)}\n`);
writeFileSync(publicPath, `${JSON.stringify(publicJwk, null, 2)}\n`);

console.log(`[license-keygen] private key -> ${resolve(secretsDir, "license-private.jwk.json")}`);
console.log(`[license-keygen] public  key -> ${publicPath}`);
console.log("[license-keygen] 请务必备份私钥文件；私钥泄露=授权码可被伪造。公钥随扩展发布。");
