import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createLocalUpdateServer, parseRange } from "./serve-local-updates.mjs";

const temporaryRoots = [];
const servers = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("parses the range forms electron-updater uses", () => {
	assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
	assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999 });
	assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
	assert.deepEqual(parseRange("bytes=0-9999", 1000), { start: 0, end: 999 });
	assert.equal(parseRange(undefined, 1000), undefined);
	assert.deepEqual(parseRange("bytes=1000-1100", 1000), { invalid: true });
	assert.deepEqual(parseRange("bytes=50-10", 1000), { invalid: true });
});

async function startServer(body) {
	const root = await mkdtemp(join(tmpdir(), "vetta-local-updates-"));
	temporaryRoots.push(root);
	await writeFile(join(root, "Vetta-1.2.3-arm64-mac.zip"), body);
	const server = createLocalUpdateServer(root);
	servers.push(server);
	await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
	return `http://127.0.0.1:${server.address().port}`;
}

// 差分下载的成败全押在 206 上：返回 200 全量的静态服务器会让差分退化或失败。
test("serves byte ranges as 206 with the correct slice", async () => {
	const body = "0123456789abcdef";
	const base = await startServer(body);

	const partial = await fetch(`${base}/Vetta-1.2.3-arm64-mac.zip`, { headers: { Range: "bytes=4-8" } });
	assert.equal(partial.status, 206);
	assert.equal(partial.headers.get("content-range"), `bytes 4-8/${body.length}`);
	assert.equal(await partial.text(), "456789".slice(0, 5));

	const whole = await fetch(`${base}/Vetta-1.2.3-arm64-mac.zip`);
	assert.equal(whole.status, 200);
	assert.equal(whole.headers.get("accept-ranges"), "bytes");
	assert.equal(await whole.text(), body);
});

test("rejects unsatisfiable ranges and directory traversal", async () => {
	const base = await startServer("0123456789");

	const unsatisfiable = await fetch(`${base}/Vetta-1.2.3-arm64-mac.zip`, { headers: { Range: "bytes=99-200" } });
	assert.equal(unsatisfiable.status, 416);

	const traversal = await fetch(`${base}/../../etc/hosts`);
	assert.ok(traversal.status === 403 || traversal.status === 404);
});
