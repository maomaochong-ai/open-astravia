import { usePromptAttachment, useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { getPluginCtx } from "../plugin-context";
import type { DesignSession } from "../vetd/design-session";
import type { VetdFrameEntry } from "../vetd/manifest-types";
import type { CanvasSelection } from "./DesignCanvas";
import {
	createDesignSelectionPromptAttachment,
	DESIGN_SELECTION_PROMPT_ATTACHMENT_ID,
	designSelectionSignature,
	isCurrentDesignSelectionPromptAttachment,
} from "./selection-prompt-context";

/**
 * 选中稳定多久才去截图。框选、连点、以及元素选择在 DOM 树里逐级上跳，都会在几百
 * 毫秒里连着换好几次选中；截图要先把画框拉回活体再静置，跟着每一次中间态跑一遍
 * 既费又白费。
 */
const CAPTURE_DEBOUNCE_MS = 350;

interface Options {
	session: DesignSession;
	selection: CanvasSelection;
	/** Selected frames in canvas order. */
	frames: readonly VetdFrameEntry[];
	capture(frameId: string, options?: { keepHighlight?: boolean }): Promise<string>;
}

/**
 * 把画布选中态挂到 AI 输入框上：选中画框或元素 → 输入框上方出现 `#画框名` 一行
 * 引用 → 用户在输入框里正常提问，选中作为结构化上下文一并发出。画布内不再自带
 * 输入框。
 *
 * 用户可以摘掉这行引用。摘掉之后不重挂，直到选中真的变了——否则截图落地时的那次
 * 重新发布会把它又贴回去。
 */
export function useSelectionPromptAttachment({ session, selection, frames, capture }: Options): void {
	const { t } = useTranslation();
	const promptAttachment = usePromptAttachment();
	/** 已落盘的选中截图；signature 用来丢弃跟不上选中的旧结果。 */
	const [screenshot, setScreenshot] = useState<{ signature: string; frameId: string; path: string } | null>(null);
	const publishedRef = useRef<string | null>(null);
	const dismissedRef = useRef<string | null>(null);
	const previousSignatureRef = useRef<string | null>(null);

	const element = selection?.kind === "dom" ? { frameId: selection.frameId, payload: selection.payload } : null;
	const frameIds = frames.map((frame) => frame.id);
	const signature = designSelectionSignature(
		frameIds,
		element ? { frameId: element.frameId, domPath: element.payload.domPath } : null,
	);
	/**
	 * 选中画框的内容指纹。signature 只认「选了谁」，而重命名、改尺寸也要让胶囊里的
	 * payload 跟着更新，所以下面的 memo 用它而不是 signature 当依赖。
	 */
	const framesKey = frames
		.map((frame) => `${frame.id}:${frame.title}:${frame.file}:${frame.width}x${frame.height}`)
		.join("|");
	/** 只有单选（一个画框，或画框里的一个元素）才在选中时截图。 */
	const captureFrameId = frames.length === 1 ? frames[0].id : null;
	const keepHighlight = captureFrameId !== null && element?.frameId === captureFrameId;

	// biome-ignore lint/correctness/useExhaustiveDependencies: signature 就是选中态的身份，frames/element 每次渲染都是新对象
	useEffect(() => {
		if (!captureFrameId) return;
		let cancelled = false;
		const timer = setTimeout(() => {
			void (async () => {
				try {
					const dataUrl = await capture(captureFrameId, { keepHighlight });
					if (cancelled) return;
					const base64 = dataUrl.split(",")[1] ?? "";
					const path = `${session.dirPath}/.snapshots/ask-${captureFrameId}-${Date.now()}.png`;
					await getPluginCtx().fs.writeFile(path, base64, "base64");
					if (!cancelled) setScreenshot({ signature, frameId: captureFrameId, path });
				} catch (error) {
					// 截图只是给附件加料，失败了引用照挂（agent 还能自己 vetd_screenshot），
					// 所以不打扰用户，只留一条诊断。
					console.warn("[plugin:vetta-ui-design] selection screenshot failed", error);
				}
			})();
		}, CAPTURE_DEBOUNCE_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [capture, captureFrameId, keepHighlight, session.dirPath, signature]);

	/**
	 * 输入框上逐条画成 `#xxx` 的条目：选了几个画框就是几条，钻进元素时再补一条
	 * `<tag>`——「3 个画框」这种汇总说法数不出到底是哪几个。
	 */
	const labels = useMemo(() => {
		if (frames.length === 0) return [];
		const titles = frames.map((frame) => frame.title || frame.id);
		return element ? [...titles, `<${element.payload.tag}>`] : titles;
		// biome-ignore lint/correctness/useExhaustiveDependencies: frames/element 每次渲染都是新对象，用 framesKey + signature 表示它们的内容
	}, [framesKey, signature]);

	/** 无障碍与回退用的单条说法（宿主在没有 labels 时用它）。 */
	const label = useMemo(() => {
		if (frames.length === 0) return "";
		const primary = element ? frames.find((frame) => frame.id === element.frameId) : undefined;
		const title = (primary ?? frames[0]).title || (primary ?? frames[0]).id;
		if (element) return t("canvas.attach.element", { tag: element.payload.tag, name: title });
		return frames.length === 1 ? title : t("canvas.attach.frames", { count: frames.length });
		// biome-ignore lint/correctness/useExhaustiveDependencies: 同上
	}, [framesKey, signature, t]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: 同上
	const attachment = useMemo(
		() =>
			createDesignSelectionPromptAttachment({
				vetdPath: session.vetdPath,
				dirPath: session.dirPath,
				frames,
				element,
				screenshot:
					screenshot && screenshot.signature === signature
						? { frameId: screenshot.frameId, path: screenshot.path }
						: null,
				label,
				labels,
			}),
		[framesKey, label, labels, screenshot, session.dirPath, session.vetdPath, signature],
	);

	useEffect(() => {
		if (previousSignatureRef.current !== signature) {
			previousSignatureRef.current = signature;
			publishedRef.current = null;
			dismissedRef.current = null;
		}
		const ui = getPluginCtx().ui;
		if (!attachment) {
			if (promptAttachment?.id === DESIGN_SELECTION_PROMPT_ATTACHMENT_ID) ui.setPromptAttachment(null);
			publishedRef.current = null;
			return;
		}
		// 别人的胶囊占着输入框时让位，等它自己让开。
		if (promptAttachment && promptAttachment.id !== DESIGN_SELECTION_PROMPT_ATTACHMENT_ID) {
			publishedRef.current = null;
			return;
		}
		if (!promptAttachment && publishedRef.current === signature) {
			dismissedRef.current = signature;
			publishedRef.current = null;
			return;
		}
		if (dismissedRef.current === signature) return;
		if (isCurrentDesignSelectionPromptAttachment(promptAttachment, attachment)) {
			publishedRef.current = signature;
			return;
		}
		ui.setPromptAttachment(attachment);
		publishedRef.current = signature;
	}, [attachment, promptAttachment, signature]);

	// 画布卸载（切走 Tab、关掉设计稿）时把引用摘掉：它描述的是这块画布上的选中。
	useEffect(
		() => () => {
			getPluginCtx().ui.setPromptAttachment(null);
		},
		[],
	);
}
