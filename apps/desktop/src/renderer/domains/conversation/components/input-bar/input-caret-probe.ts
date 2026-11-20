/**
 * [input-caret-probe] 输入框「点不进去」的取证探针。
 *
 * 现象：会话回复流式输出期间，点击输入框不出现插入光标，过一阵又恢复正常。代码里已经
 * 排除了两条常见原因——编辑器没有变成 `contenteditable=false`（那样鼠标会显示禁止符号），
 * 也没有任何 `mousedown` 处理器调用 `preventDefault`。剩下最可能的原因是某个透明/动画中的
 * 元素盖在了输入框上方，把点击吃掉了；但「谁盖住了」必须由现场决定，不能靠猜。
 *
 * 探针只回答一件事：用户点下去的那一下，点击实际落在哪个元素上，以及随后编辑器有没有拿到焦点。
 * 它不修改任何行为，默认关闭。
 *
 * 开启：DevTools 执行 `localStorage.setItem("astravia-input-caret-probe", "1")` 后刷新。
 * 关闭：`localStorage.removeItem("astravia-input-caret-probe")`。
 * 报告以 `[input-caret-probe]` 前缀写入 Renderer 日志。
 */

const ENABLED_KEY = "astravia-input-caret-probe";

export interface CaretProbeReport {
	/** 点击命中的元素（`elementFromPoint` 的结果，按视觉层级）。 */
	readonly hit: string;
	/** 事件 target，通常是输入框外层的某个容器。 */
	readonly target: string;
	/** 点击后编辑器是否拿到焦点。 */
	readonly editorFocused: boolean;
	/** 焦点实际落在哪里。 */
	readonly activeElement: string;
}

export function isCaretProbeEnabled(): boolean {
	try {
		return window.localStorage.getItem(ENABLED_KEY) === "1";
	} catch {
		return false;
	}
}

/** 只描述结构信息：标签、类名片段、data 属性，不包含用户输入的文本。 */
export function describeElement(element: Element | null): string {
	if (!element) return "null";
	const tag = element.tagName.toLowerCase();
	const className =
		typeof element.className === "string" ? element.className.trim().split(/\s+/).slice(0, 4).join(".") : "";
	const dataParts: string[] = [];
	for (const attribute of Array.from(element.attributes)) {
		if (!attribute.name.startsWith("data-")) continue;
		// 只留标记存在与否，避免把 data 里可能出现的用户内容带进日志。
		dataParts.push(attribute.value ? `${attribute.name}="${attribute.value.slice(0, 24)}"` : attribute.name);
		if (dataParts.length >= 3) break;
	}
	return [tag, className].filter(Boolean).join(".") + (dataParts.length > 0 ? `[${dataParts.join(" ")}]` : "");
}

/** 编辑器是否有焦点；`contenteditable` 内部会先聚焦到编辑器根节点。 */
export function isEditorFocused(editor: Element | null): boolean {
	if (!editor) return false;
	const active = document.activeElement;
	if (!active) return false;
	return active === editor || editor.contains(active);
}

export function installCaretProbe(options: {
	/** 输入栏根元素：只有点在它内部的点击才取证。 */
	readonly root: HTMLElement;
	readonly enabled?: () => boolean;
}): () => void {
	const enabled = options.enabled ?? isCaretProbeEnabled;
	const onPointerDown = (event: PointerEvent): void => {
		if (!enabled()) return;
		if (!(event.target instanceof Element) || !options.root.contains(event.target)) return;
		// event.target 是 getter，instanceof 收窄穿不过下面的 rAF 闭包，先捕到局部变量。
		const targetElement = event.target;
		const { clientX, clientY } = event;
		// 让这一次点击走完默认行为（聚焦、放置光标）之后再判断它有没有生效。
		window.requestAnimationFrame(() => {
			const editor = options.root.querySelector("[contenteditable]");
			if (isEditorFocused(editor)) return;
			const report: CaretProbeReport = {
				hit: describeElement(document.elementFromPoint(clientX, clientY)),
				target: describeElement(targetElement),
				editorFocused: false,
				activeElement: describeElement(document.activeElement),
			};
			console.warn("[input-caret-probe] caret not placed", report);
		});
	};
	window.addEventListener("pointerdown", onPointerDown, true);
	return () => window.removeEventListener("pointerdown", onPointerDown, true);
}
