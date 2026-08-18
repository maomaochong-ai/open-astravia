const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { app, utilityProcess } = require("electron");

const desktopRoot = join(__dirname, "..");
const hostPath = join(desktopRoot, "dist", "main", "speech-input-host.js");
const modelRoot = join(
	desktopRoot,
	"resources",
	"speech-models",
	"sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30",
);
const model = {
	encoder: join(modelRoot, "encoder.int8.onnx"),
	decoder: join(modelRoot, "decoder.onnx"),
	joiner: join(modelRoot, "joiner.int8.onnx"),
	tokens: join(modelRoot, "tokens.txt"),
};

function fail(message) {
	console.error(`[speech-input-smoke] ${message}`);
	app.exit(1);
}

if (!existsSync(hostPath)) {
	fail("build artifact missing; run bun run build:main first");
} else if (!Object.values(model).every(existsSync)) {
	fail("speech model missing; run bun run prepare:speech-models first");
} else {
	app.whenReady().then(() => {
		const startedAt = Date.now();
		const child = utilityProcess.fork(hostPath, [], {
			serviceName: "vetta-speech-input-smoke",
			stdio: ["ignore", "pipe", "pipe"],
		});
		child.stdout?.pipe(process.stdout);
		child.stderr?.pipe(process.stderr);
		child.on("spawn", () => console.log(`[speech-input-smoke] spawned pid=${child.pid ?? "unknown"}`));
		let completed = false;
		const finish = (exitCode, message) => {
			if (completed) return;
			completed = true;
			clearTimeout(timeout);
			if (message) (exitCode === 0 ? console.log : console.error)(message);
			child.kill();
			app.exit(exitCode);
		};
		const timeout = setTimeout(() => finish(1, "[speech-input-smoke] timed out"), 60_000);
		child.on("message", (message) => {
			if (!message || typeof message !== "object") return;
			if (message.type === "ready") {
				child.postMessage({ type: "initialize", model, sampleRate: 16_000 });
			} else if (message.type === "initialized") {
				child.postMessage({ type: "start", sessionId: "smoke-session" });
			} else if (message.type === "started" && message.sessionId === "smoke-session") {
				child.postMessage({
					type: "audio",
					sessionId: "smoke-session",
					samples: new Float32Array(1_600),
				});
				child.postMessage({ type: "stop", sessionId: "smoke-session" });
			} else if (message.type === "stopped" && message.sessionId === "smoke-session") {
				finish(0, `[speech-input-smoke] initialize/start/audio/stop passed in ${Date.now() - startedAt}ms`);
			} else if (message.type === "error") {
				finish(1, `[speech-input-smoke] host error: ${JSON.stringify(message)}`);
			}
		});
		child.on("exit", (code) => {
			if (!completed) finish(1, `[speech-input-smoke] host exited with code ${code}`);
		});
	});
}
