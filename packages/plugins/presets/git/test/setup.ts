import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Desktop shares React through Module Federation. Bun can install a separate
// React peer for the host UI's CJS dependencies; mirror that singleton in tests.
const pluginRequire = createRequire(import.meta.url);
const uiRequire = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../ui/package.json"));
const sharedReact: unknown = pluginRequire("react");
uiRequire("react");
const hostReact = uiRequire.cache[uiRequire.resolve("react")];
if (hostReact) hostReact.exports = sharedReact;
