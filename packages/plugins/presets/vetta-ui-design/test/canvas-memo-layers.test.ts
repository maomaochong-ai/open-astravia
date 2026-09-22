/**
 * 拖动/框选/改尺寸时 DesignCanvas 每帧都会重渲染；world 层里这几个不受这些操作
 * 影响的子层必须是 memo，否则整层跟着每帧重算。
 */
import { expect, it } from "vitest";
import { NotesLayer } from "../src/canvas/NotesLayer";
import { SelectionAskBadge } from "../src/canvas/SelectionAskBadge";

it("keeps the world-layer overlays memoized", () => {
	const memoType = Symbol.for("react.memo");
	expect((NotesLayer as unknown as { $$typeof: symbol }).$$typeof).toBe(memoType);
	expect((SelectionAskBadge as unknown as { $$typeof: symbol }).$$typeof).toBe(memoType);
});
