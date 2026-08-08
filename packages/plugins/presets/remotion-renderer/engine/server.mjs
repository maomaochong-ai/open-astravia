import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";

const portFlagIndex = process.argv.indexOf("--port");
const port = Number(portFlagIndex >= 0 ? process.argv[portFlagIndex + 1] : process.env.PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("A valid --port is required");

const jobs = new Map();
let queue = Promise.resolve();
const MAX_RETAINED_JOBS = 100;

function sendJson(response, status, body) {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
	});
	response.end(payload);
}

function publicJob(job) {
	return {
		id: job.id,
		status: job.status,
		progress: job.progress,
		...(job.status === "succeeded" ? { artifact: { path: job.document.outputPath } } : {}),
		...(job.error ? { error: job.error } : {}),
	};
}

function requireRecord(value, label) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}

function requireString(value, label) {
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
	return value.trim();
}

function parseDocument(value) {
	const record = requireRecord(value, "Remotion document");
	if (record.schemaVersion !== 1) throw new Error("Unsupported Remotion document version");
	const projectRoot = requireString(record.projectRoot, "projectRoot");
	const entryPoint = requireString(record.entryPoint, "entryPoint");
	const compositionId = requireString(record.compositionId, "compositionId");
	const outputPath = requireString(record.outputPath, "outputPath");
	if (!isAbsolute(projectRoot) || !isAbsolute(outputPath)) throw new Error("Project and output paths must be absolute");
	if (record.codec !== "h264") throw new Error("Only H.264 MP4 output is supported");
	return {
		schemaVersion: 1,
		projectRoot,
		entryPoint,
		compositionId,
		inputProps: requireRecord(record.inputProps, "inputProps"),
		outputPath,
		codec: "h264",
	};
}

async function uploadedDocument(request) {
	const webRequest = new Request(`http://127.0.0.1:${port}${request.url ?? "/jobs"}`, {
		method: request.method,
		headers: request.headers,
		body: Readable.toWeb(request),
		duplex: "half",
	});
	const form = await webRequest.formData();
	const file = form.get("document");
	if (!file || typeof file === "string" || typeof file.text !== "function") {
		throw new Error("Multipart field 'document' is required");
	}
	return parseDocument(JSON.parse(await file.text()));
}

function resolveCli(projectRoot) {
	const projectRequire = createRequire(join(projectRoot, "package.json"));
	const packagePath = projectRequire.resolve("@remotion/cli/package.json");
	const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
	const relativeBin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.remotion;
	if (typeof relativeBin !== "string") throw new Error("@remotion/cli does not declare the remotion executable");
	return resolve(dirname(packagePath), relativeBin);
}

function updateProgress(job, text) {
	job.outputTail = `${job.outputTail}${text}`.slice(-16_000);
	const clean = text.replace(/\u001b\[[0-9;]*m/g, "");
	const frames = /(?:Rendered|Encoded)\s+(\d+)\s*\/\s*(\d+)/i.exec(clean);
	if (frames) {
		const current = Number(frames[1]);
		const total = Number(frames[2]);
		if (total > 0) job.progress = Math.max(job.progress, Math.min(0.95, 0.15 + (current / total) * 0.8));
		return;
	}
	if (/bundl/i.test(clean)) job.progress = Math.max(job.progress, 0.08);
	if (/composition/i.test(clean)) job.progress = Math.max(job.progress, 0.12);
}

function terminate(job) {
	const child = job.child;
	if (!child?.pid) return;
	if (process.platform === "win32") {
		spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
		return;
	}
	try {
		process.kill(-child.pid, "SIGTERM");
	} catch {
		child.kill("SIGTERM");
	}
}

async function runJob(job) {
	if (job.status === "cancelled") return;
	job.status = "running";
	job.progress = 0.02;
	const document = job.document;
	const entryPoint = resolve(document.projectRoot, document.entryPoint);
	const propsPath = `${document.outputPath}.${job.id}.props.json`;
	try {
		if (!existsSync(join(document.projectRoot, "package.json"))) throw new Error("package.json was not found");
		if (!existsSync(entryPoint)) throw new Error(`Remotion entry point was not found: ${document.entryPoint}`);
		const cliPath = resolveCli(document.projectRoot);
		await mkdir(dirname(document.outputPath), { recursive: true });
		await writeFile(propsPath, JSON.stringify(document.inputProps), "utf8");
		await new Promise((resolveRun, rejectRun) => {
			const child = spawn(
				process.execPath,
				[
					cliPath,
					"render",
					entryPoint,
					document.compositionId,
					document.outputPath,
					`--props=${propsPath}`,
					"--codec=h264",
					"--log=info",
				],
				{
					cwd: document.projectRoot,
					windowsHide: true,
					detached: process.platform !== "win32",
					env: process.env,
				},
			);
			job.child = child;
			child.stdout?.on("data", (chunk) => updateProgress(job, chunk.toString()));
			child.stderr?.on("data", (chunk) => updateProgress(job, chunk.toString()));
			child.once("error", rejectRun);
			child.once("exit", (exitCode, signal) => {
				job.child = null;
				if (job.status === "cancelled" || exitCode === 0) resolveRun();
				else rejectRun(new Error(`Remotion exited with ${exitCode ?? signal ?? "unknown status"}`));
			});
		});
		if (job.status === "cancelled") return;
		if (!existsSync(document.outputPath)) throw new Error("Remotion completed without creating the MP4 output");
		job.status = "succeeded";
		job.progress = 1;
	} catch (error) {
		if (job.status === "cancelled") return;
		job.status = "failed";
		const reason = error instanceof Error ? error.message : String(error);
		const details = job.outputTail.trim();
		job.error = details ? `${reason}\n${details}` : reason;
	} finally {
		job.child = null;
		await rm(propsPath, { force: true }).catch(() => undefined);
	}
}

function enqueue(job) {
	queue = queue.then(() => runJob(job)).catch(() => undefined);
}

function pruneTerminalJobs() {
	if (jobs.size < MAX_RETAINED_JOBS) return;
	for (const [id, job] of jobs) {
		if (job.status === "queued" || job.status === "running") continue;
		jobs.delete(id);
		if (jobs.size < MAX_RETAINED_JOBS) return;
	}
}

const server = createServer(async (request, response) => {
	try {
		const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
		if (request.method === "GET" && url.pathname === "/health") {
			sendJson(response, 200, { ok: true });
			return;
		}
		if (request.method === "POST" && url.pathname === "/jobs") {
			const document = await uploadedDocument(request);
			pruneTerminalJobs();
			const id = crypto.randomUUID();
			const job = { id, status: "queued", progress: 0, document, child: null, outputTail: "" };
			jobs.set(id, job);
			enqueue(job);
			sendJson(response, 202, publicJob(job));
			return;
		}
		const match = /^\/jobs\/([^/]+)$/.exec(url.pathname);
		if (match && request.method === "GET") {
			const job = jobs.get(decodeURIComponent(match[1]));
			if (!job) sendJson(response, 404, { error: "Render job was not found" });
			else sendJson(response, 200, publicJob(job));
			return;
		}
		if (match && request.method === "DELETE") {
			const job = jobs.get(decodeURIComponent(match[1]));
			if (!job) {
				sendJson(response, 404, { error: "Render job was not found" });
				return;
			}
			if (job.status === "queued" || job.status === "running") {
				job.status = "cancelled";
				terminate(job);
			}
			sendJson(response, 200, publicJob(job));
			return;
		}
		sendJson(response, 404, { error: "Not found" });
	} catch (error) {
		sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
	}
});

server.listen(port, "127.0.0.1", () => {
	process.stdout.write(`remotion-renderer listening on ${port}\n`);
});

function shutdown() {
	for (const job of jobs.values()) {
		if (job.status === "queued" || job.status === "running") {
			job.status = "cancelled";
			terminate(job);
		}
	}
	server.close(() => process.exit(0));
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
