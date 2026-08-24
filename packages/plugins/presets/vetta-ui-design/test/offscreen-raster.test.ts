import { expect, it } from "vitest";
import { framePrepareScript, isOffscreenServerUnavailable } from "../src/canvas/offscreen-raster";

it("invalidates the previous paint marker before requesting a reused frame", () => {
	const script = framePrepareScript('detail"quoted');
	expect(script.indexOf("window.__vetdPainted = null")).toBeLessThan(script.indexOf("window.postMessage"));
	expect(script).toContain('id: "detail\\\"quoted"');
});

it("recognizes localhost preview server connection failures", () => {
	expect(
		isOffscreenServerUnavailable(
			new Error("Error invoking remote method 'vetta:plugins:offscreen-capture': ERR_CONNECTION_REFUSED (-102)"),
		),
	).toBe(true);
	expect(isOffscreenServerUnavailable(new Error("connect ECONNREFUSED 127.0.0.1:53114"))).toBe(true);
	expect(isOffscreenServerUnavailable(new Error("capture timed out"))).toBe(false);
});
