/**
 * 输入框胶囊的载荷。
 *
 * 这组用例守的是「选中即上下文」这条链路的合同：胶囊里必须带得出画框源码的绝对
 * 路径与元素的插桩位置（agent 靠它定位改哪一行），截图是可选的（只有单选才截），
 * 并且同一次选中重复发布要能被识别出来——否则截图落地时的第二次发布会把用户刚
 * 摘掉的胶囊贴回去。
 */
import { expect, it } from "vitest";
import type { SelectedElementPayload } from "../src/canvas/bridge-client";
import {
	createDesignSelectionPromptAttachment,
	type DesignSelectionAttachmentInput,
	designSelectionSignature,
	isCurrentDesignSelectionPromptAttachment,
} from "../src/canvas/selection-prompt-context";
import type { VetdFrameEntry } from "../src/vetd/manifest-types";

const frame = (id: string, title = id): VetdFrameEntry => ({
	id,
	file: `frames/${id}.tsx`,
	x: 0,
	y: 0,
	width: 390,
	height: 844,
	title,
	meta: { width: 390, height: 844, title },
});

const element = (overrides: Partial<SelectedElementPayload> = {}): SelectedElementPayload => ({
	tag: "button",
	domPath: "div > button",
	classes: "px-4 py-2",
	text: "登录",
	rect: { x: 0, y: 0, width: 120.4, height: 40.6 },
	source: "frames/login.tsx:12",
	...overrides,
});

const input = (overrides: Partial<DesignSelectionAttachmentInput> = {}): DesignSelectionAttachmentInput => ({
	vetdPath: "/w/app.vetd",
	dirPath: "/w/app.vetd.d",
	frames: [frame("login", "登录页")],
	element: null,
	screenshot: null,
	label: "登录页",
	...overrides,
});

it("carries each selected frame's absolute source path", () => {
	const attachment = createDesignSelectionPromptAttachment(
		input({ frames: [frame("login", "登录页"), frame("home", "首页")], label: "2 个画框" }),
	);

	expect(attachment?.context?.payload.selection.frameIds).toEqual(["login", "home"]);
	expect(attachment?.context?.payload.selection.frames.map((entry) => entry.file)).toEqual([
		"/w/app.vetd.d/frames/login.tsx",
		"/w/app.vetd.d/frames/home.tsx",
	]);
	expect(attachment?.context?.payload.design).toEqual({
		document: "/w/app.vetd",
		sourcesDir: "/w/app.vetd.d",
	});
});

it("returns null when nothing is selected", () => {
	expect(createDesignSelectionPromptAttachment(input({ frames: [] }))).toBeNull();
});

it("keeps the element's instrumented source location and marks the highlighted shot", () => {
	const attachment = createDesignSelectionPromptAttachment(
		input({
			element: { frameId: "login", payload: element() },
			screenshot: { frameId: "login", path: "/w/app.vetd.d/.snapshots/ask-login-1.png" },
		}),
	);

	expect(attachment?.context?.payload.selection.element).toEqual({
		frameId: "login",
		tag: "button",
		domPath: "div > button",
		source: "frames/login.tsx:12",
		classes: "px-4 py-2",
		text: "登录",
		renderedWidth: 120,
		renderedHeight: 41,
		highlightedInScreenshot: true,
	});
	expect(attachment?.context?.payload.selection.frames[0].screenshot).toBe(
		"/w/app.vetd.d/.snapshots/ask-login-1.png",
	);
});

it("omits empty element fields rather than sending null (the context must stay JSON-safe)", () => {
	const attachment = createDesignSelectionPromptAttachment(
		input({ element: { frameId: "login", payload: element({ source: null, classes: "", text: "" }) } }),
	);
	const selected = attachment?.context?.payload.selection.element;

	expect(selected && "source" in selected).toBe(false);
	expect(selected && "classes" in selected).toBe(false);
	expect(selected && "text" in selected).toBe(false);
	expect(selected?.highlightedInScreenshot).toBe(false);
});

it("leaves the screenshot out when the capture belongs to another frame", () => {
	const attachment = createDesignSelectionPromptAttachment(
		input({ screenshot: { frameId: "home", path: "/w/app.vetd.d/.snapshots/ask-home-1.png" } }),
	);

	expect(attachment?.context?.payload.selection.frames[0].screenshot).toBeUndefined();
});

it("identifies a selection by what is selected, not by titles or screenshots", () => {
	expect(designSelectionSignature(["b", "a"], null)).toBe(designSelectionSignature(["a", "b"], null));
	expect(designSelectionSignature(["a"], null)).not.toBe(designSelectionSignature(["a", "b"], null));
	expect(designSelectionSignature(["login"], { frameId: "login", domPath: "div > button" })).not.toBe(
		designSelectionSignature(["login"], { frameId: "login", domPath: "div > a" }),
	);
});

it("treats a re-published selection as current only while the payload matches", () => {
	const published = createDesignSelectionPromptAttachment(input());
	const same = createDesignSelectionPromptAttachment(input());
	const withShot = createDesignSelectionPromptAttachment(
		input({ screenshot: { frameId: "login", path: "/w/app.vetd.d/.snapshots/ask-login-1.png" } }),
	);
	if (!published || !same || !withShot) throw new Error("attachment expected");

	expect(isCurrentDesignSelectionPromptAttachment(published, same)).toBe(true);
	// 截图晚于选中落地，那一次必须被认成「需要重新发布」。
	expect(isCurrentDesignSelectionPromptAttachment(published, withShot)).toBe(false);
	expect(isCurrentDesignSelectionPromptAttachment(null, same)).toBe(false);
	expect(isCurrentDesignSelectionPromptAttachment({ id: "other", label: "x" }, same)).toBe(false);
});
