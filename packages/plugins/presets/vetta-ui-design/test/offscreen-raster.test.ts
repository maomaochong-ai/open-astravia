import { expect, it } from "vitest";
import { framePrepareScript } from "../src/canvas/offscreen-raster";

it("invalidates the previous paint marker before requesting a reused frame", () => {
	const script = framePrepareScript('detail"quoted');
	expect(script.indexOf("window.__vetdPainted = null")).toBeLessThan(script.indexOf("window.postMessage"));
	expect(script).toContain('id: "detail\\\"quoted"');
});
