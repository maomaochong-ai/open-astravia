import { parentPort } from "node:worker_threads";
import { startSessionSearchWorker } from "./conversations/session-search-worker-runtime.js";

if (!parentPort) throw new Error("Session search requires a worker port");
startSessionSearchWorker(parentPort);
