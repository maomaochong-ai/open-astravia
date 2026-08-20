import { createServer } from "node:http";
import { createHash } from "node:crypto";

function incrementPatch(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) throw new Error(`Invalid E2E fixture version: ${version}`);
	return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function yamlForVersion(version, artifact) {
	// Keep one checksum-bearing file so electron-updater can resolve the
	// platform file list. The equal-version mode still prevents a download.
	const checksum = Buffer.alloc(64).toString("base64");
	return [
		`version: ${version}`,
		"files:",
		`  - url: ${artifact?.name ?? `Vetta-${version}-e2e.test`}`,
		`    size: ${artifact?.body.length ?? 0}`,
		`    sha512: ${artifact?.sha512 ?? checksum}`,
		"releaseDate: 2026-01-01T00:00:00.000Z",
		"",
	].join("\n");
}

/**
 * Start a local, deterministic generic update feed for packaged E2E tests.
 * `downloadable` exercises electron-updater's real download and checksum path
 * without attempting a platform installer handoff.
 */
export async function startUpdateFeedFixture(versionOrOptions) {
	const options = typeof versionOrOptions === "string" ? { version: versionOrOptions } : versionOrOptions;
	const version = options.version;
	const artifact = options.downloadable
		? (() => {
			const body = Buffer.from("vetta-packaged-e2e-update\n", "utf8");
			return {
				name: "Vetta-e2e-update.AppImage",
				body,
				sha512: createHash("sha512").update(body).digest("base64"),
			};
		})()
		: undefined;
	const feedVersion = artifact ? incrementPatch(version) : version;
	const server = createServer((request, response) => {
		const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
		if (artifact && pathname === `/${artifact.name}`) {
			response.writeHead(200, {
				"Content-Type": "application/octet-stream",
				"Content-Length": artifact.body.length,
				"Cache-Control": "no-store",
			});
			response.end(request.method === "HEAD" ? undefined : artifact.body);
			return;
		}
		if (!/^\/latest(?:-mac|-linux)?\.yml$/.test(pathname)) {
			response.writeHead(404).end();
			return;
		}
		const body = yamlForVersion(feedVersion, artifact);
		response.writeHead(200, {
			"Content-Type": "application/yaml",
			"Content-Length": Buffer.byteLength(body),
			"Cache-Control": "no-store",
		});
		response.end(body);
	});
	server.listen(0, "127.0.0.1");
	await new Promise((resolve, reject) => {
		server.once("listening", resolve);
		server.once("error", reject);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Unable to start the packaged E2E update feed fixture");
	}
	return {
		server,
		url: `http://127.0.0.1:${address.port}/`,
	};
}
