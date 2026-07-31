import { describe, expect, it } from "vitest";
import { explicitTabVisibility, withPluginTabVisibility } from "./attached-tabs";

const CWD = "/repo";
const GIT = "git:changes";

describe("explicitTabVisibility", () => {
	it("is null when the plugin never said anything (falls back to initiallyVisible)", () => {
		expect(explicitTabVisibility([], GIT)).toBeNull();
		expect(explicitTabVisibility(["image-gen:history"], GIT)).toBeNull();
	});

	it("reads both the legacy attach entry and the negative entry", () => {
		expect(explicitTabVisibility([GIT], GIT)).toBe(true);
		expect(explicitTabVisibility([`-${GIT}`], GIT)).toBe(false);
	});
});

describe("withPluginTabVisibility", () => {
	it("records an explicit show for a cwd with no record yet", () => {
		expect(withPluginTabVisibility(new Map(), CWD, GIT, true)?.get(CWD)).toEqual([GIT]);
	});

	it("records an explicit hide, which is distinct from 'never said'", () => {
		const next = withPluginTabVisibility(new Map(), CWD, GIT, false);
		expect(next?.get(CWD)).toEqual([`-${GIT}`]);
		expect(explicitTabVisibility(next?.get(CWD) ?? [], GIT)).toBe(false);
	});

	it("flips an existing entry instead of keeping both polarities", () => {
		const shown = new Map([[CWD, [GIT]]]);
		expect(withPluginTabVisibility(shown, CWD, GIT, false)?.get(CWD)).toEqual([`-${GIT}`]);
		const hidden = new Map([[CWD, [`-${GIT}`]]]);
		expect(withPluginTabVisibility(hidden, CWD, GIT, true)?.get(CWD)).toEqual([GIT]);
	});

	it("leaves other plugins' entries for that cwd alone", () => {
		const map = new Map([[CWD, ["image-gen:history", `-${GIT}`]]]);
		expect(withPluginTabVisibility(map, CWD, GIT, true)?.get(CWD)).toEqual(["image-gen:history", GIT]);
	});

	it("returns null when already in the requested state (no needless store write)", () => {
		expect(withPluginTabVisibility(new Map([[CWD, [GIT]]]), CWD, GIT, true)).toBeNull();
		expect(withPluginTabVisibility(new Map([[CWD, [`-${GIT}`]]]), CWD, GIT, false)).toBeNull();
	});

	it("never mutates the input map (other cwds stay untouched)", () => {
		const map = new Map([
			[CWD, [GIT]],
			["/other", [GIT]],
		]);
		const next = withPluginTabVisibility(map, CWD, GIT, false);
		expect(map.get(CWD)).toEqual([GIT]);
		expect(next?.get("/other")).toEqual([GIT]);
	});
});
