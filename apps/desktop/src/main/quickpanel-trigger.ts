// 全局键盘手势共享监听器（uiohook 宿主子进程的消费者管理）。
// Electron globalShortcut 无法监听裸功能键的双击/双键同按，这里用 uiohook-napi 做原生全局键盘监听。
// uIOhook 不在主进程运行：uiohook-napi ≤1.5.5 的 hook_enable() 存在启动竞态死锁，会把调用
// 进程的主线程永久冻住（macOS 彩虹圈），故隔离到 utilityProcess（uiohook-host.ts），由
// UiohookSupervisor 负责 spawn/看门狗/重试，键盘事件经 IPC 回传本模块的状态机。
// 两个消费者共用同一宿主：
//   - quickpanel：「干净双击」某个功能键唤出快捷面板；
//   - appshot：左右同一功能键「双键同按持按 250ms」触发前台窗口捕获。
// 活跃消费者集合管理启停：首个消费者出现时拉起宿主、集合清空时杀掉（不申请权限/无开销）。
// macOS 首次启动监听会触发系统「输入监控」授权；未授权时收不到事件——设置页有提示。

import { fileURLToPath } from "node:url";
import { utilityProcess } from "electron";
import { UiohookKey } from "uiohook-napi";
import type { AppshotGesture, QuickPanelTrigger } from "./config/desktop-config-store.js";
import { getAppLogger } from "./logger.js";
import { UiohookSupervisor } from "./uiohook-supervisor.js";

const log = getAppLogger("quickpanel-trigger");

/** 两次干净点按的最大间隔（ms）。 */
const DOUBLE_TAP_MS = 350;

/** appshot 双键同按需要的持按时长（ms）。 */
const APPSHOT_HOLD_MS = 250;

/** 触发对应的 uiohook keycode 集合（含左右两侧）。mod 按平台映射：mac=⌘，其余=Ctrl。 */
function keycodesFor(trigger: Exclude<QuickPanelTrigger, "none">): number[] {
	switch (trigger) {
		case "mod":
			return process.platform === "darwin"
				? [UiohookKey.Meta, UiohookKey.MetaRight]
				: [UiohookKey.Ctrl, UiohookKey.CtrlRight];
		case "alt":
			return [UiohookKey.Alt, UiohookKey.AltRight];
		case "shift":
			return [UiohookKey.Shift, UiohookKey.ShiftRight];
	}
}

/** appshot 手势对应的左右键对。mod 按平台映射：mac=⌘，其余=Ctrl。 */
function appshotKeycodesFor(gesture: AppshotGesture): number[] {
	switch (gesture) {
		case "both-mod":
			return process.platform === "darwin"
				? [UiohookKey.Meta, UiohookKey.MetaRight]
				: [UiohookKey.Ctrl, UiohookKey.CtrlRight];
		case "both-alt":
			return [UiohookKey.Alt, UiohookKey.AltRight];
		case "both-shift":
			return [UiohookKey.Shift, UiohookKey.ShiftRight];
	}
}

// ----- 共享 uiohook 生命周期 -----------------------------------------------

type UiohookConsumer = "quickpanel" | "appshot";

const activeConsumers = new Set<UiohookConsumer>();

let supervisor: UiohookSupervisor | null = null;

function getSupervisor(): UiohookSupervisor {
	if (!supervisor) {
		supervisor = new UiohookSupervisor({
			forkChild: () =>
				utilityProcess.fork(fileURLToPath(new URL("./uiohook-host.js", import.meta.url)), [], {
					serviceName: "vetta-uiohook-host",
				}),
			onKeydown: handleKeydown,
			onKeyup: handleKeyup,
		});
	}
	return supervisor;
}

/** 依据活跃消费者集合启停宿主子进程：首个出现拉起、集合空杀掉。 */
function syncHookLifecycle(): void {
	if (activeConsumers.size > 0) {
		getSupervisor().ensureRunning();
	} else {
		supervisor?.stop();
	}
}

// ----- quickpanel：干净双击状态机 -------------------------------------------

let qpTargets = new Set<number>();
let onQuickPanelTrigger: (() => void) | null = null;

// 单次「干净点按」检测状态：目标功能键按下→抬起、且期间没有按过其它键。
let modifierDown = false;
let pressedOtherDuringPress = false;
let lastCleanTapAt = 0;

function resetQuickPanelState(): void {
	modifierDown = false;
	pressedOtherDuringPress = false;
	lastCleanTapAt = 0;
}

function handleQuickPanelKeydown(keycode: number): void {
	if (qpTargets.size === 0) return;
	if (qpTargets.has(keycode)) {
		modifierDown = true;
		pressedOtherDuringPress = false;
	} else {
		// 任意非目标键：作废本次按压，并打断双击序列（避免打字途中误触发）。
		pressedOtherDuringPress = true;
		lastCleanTapAt = 0;
	}
}

function handleQuickPanelKeyup(keycode: number): void {
	if (!qpTargets.has(keycode) || !modifierDown) return;
	modifierDown = false;
	if (pressedOtherDuringPress) return; // 组合键（如 ⌘C）不算点按
	const now = Date.now();
	if (lastCleanTapAt && now - lastCleanTapAt <= DOUBLE_TAP_MS) {
		lastCleanTapAt = 0;
		try {
			onQuickPanelTrigger?.();
		} catch (err) {
			log.error("trigger callback failed", err);
		}
	} else {
		lastCleanTapAt = now;
	}
}

// ----- appshot：双键同按持按状态机 -------------------------------------------

let axTargets = new Set<number>();
let onAppshotGesture: (() => void) | null = null;

// 目标键「当前按下」且持按 250ms → 触发一次并立即整体重置。
// 鲁棒性设计（根治「只能用一次/间歇失效，需重新开关或重启才恢复」）：
//   1. 不用粘滞的 dirty 标志——它一旦因 keyup 丢失而无法清零就永久卡死状态机。
//   2. 触发瞬间 showMainWindow() 抢焦点常吞掉修饰键的 keyup，使某键的按下记录残留。
//      故改用带时间戳的按下表 axDownAt，每次 keydown 先 prune 掉超过 AX_STALE_MS 的陈旧
//      记录（时间自愈，不依赖脆弱的 keyup 配对）；且 keydown 用 set 覆盖时间戳——残留记录
//      既会被时间清掉、也不会阻止新一轮触发。
//   3. 触发后 reset 清空，靠「修饰键无 auto-repeat keydown」保证按住不放不会连发。
const axDownAt = new Map<number, number>(); // 目标键 keycode → 最近 keydown 时间(ms)
let axTimer: ReturnType<typeof setTimeout> | null = null;

/** keydown 记录超过此时长即视为陈旧（对应丢失的 keyup），下次按键时清理自愈。 */
const AX_STALE_MS = 1500;

function cancelAppshotTimer(): void {
	if (axTimer !== null) {
		clearTimeout(axTimer);
		axTimer = null;
	}
}

function resetAppshotState(): void {
	cancelAppshotTimer();
	axDownAt.clear();
}

/** 清理超过 AX_STALE_MS 的陈旧按下记录（keyup 丢失的自愈），不依赖 keyup 到达。 */
function pruneStaleAxDown(now: number): void {
	for (const [code, at] of axDownAt) {
		if (now - at > AX_STALE_MS) axDownAt.delete(code);
	}
}

function handleAppshotKeydown(keycode: number): void {
	if (axTargets.size === 0) return;
	if (!axTargets.has(keycode)) {
		// 其它键介入：取消进行中的持按计时（不设粘滞标志，避免卡死）。
		cancelAppshotTimer();
		return;
	}
	const now = Date.now();
	pruneStaleAxDown(now);
	axDownAt.set(keycode, now);
	if (axDownAt.size === axTargets.size && axTimer === null) {
		axTimer = setTimeout(() => {
			axTimer = null;
			// 防双 Shift 持按被双击状态机误判为 shift 双击：作废进行中的按压并清双击序列。
			pressedOtherDuringPress = true;
			lastCleanTapAt = 0;
			try {
				onAppshotGesture?.();
			} catch (err) {
				log.error("appshot gesture callback failed", err);
			} finally {
				// 触发即重置，不依赖后续 keyup（可能因焦点切换丢失）来重新武装。
				resetAppshotState();
			}
		}, APPSHOT_HOLD_MS);
	}
}

function handleAppshotKeyup(keycode: number): void {
	if (axTargets.size === 0 || !axTargets.has(keycode)) return;
	axDownAt.delete(keycode);
	cancelAppshotTimer();
}

// ----- 事件分发 --------------------------------------------------------------

function handleKeydown(keycode: number): void {
	handleQuickPanelKeydown(keycode);
	handleAppshotKeydown(keycode);
}

function handleKeyup(keycode: number): void {
	handleQuickPanelKeyup(keycode);
	handleAppshotKeyup(keycode);
}

// ----- 对外 API --------------------------------------------------------------

/** 设定双击触发回调（唤出/切换面板）。在 main 启动时调用一次。 */
export function setQuickPanelTriggerHandler(handler: () => void): void {
	onQuickPanelTrigger = handler;
}

/** 设定 appshot 双键同按触发回调（捕获前台窗口）。在 main 启动时调用一次。 */
export function setAppshotGestureHandler(handler: () => void): void {
	onAppshotGesture = handler;
}

/** 依据配置启停 quickpanel 消费者：none 注销；其它注册并设定目标功能键。设置变更后再次调用即可热切换。 */
export function applyQuickPanelTrigger(trigger: QuickPanelTrigger): void {
	resetQuickPanelState();
	if (trigger === "none") {
		qpTargets = new Set();
		activeConsumers.delete("quickpanel");
	} else {
		qpTargets = new Set(keycodesFor(trigger));
		activeConsumers.add("quickpanel");
		log.info("quick panel trigger set", { trigger });
	}
	syncHookLifecycle();
}

/** 依据配置启停 appshot 消费者：none 注销；其它注册并设定目标键对。设置变更后再次调用即可热切换。 */
export function applyAppshotGesture(gesture: AppshotGesture | "none"): void {
	resetAppshotState();
	if (gesture === "none") {
		axTargets = new Set();
		activeConsumers.delete("appshot");
	} else {
		axTargets = new Set(appshotKeycodesFor(gesture));
		activeConsumers.add("appshot");
		log.info("appshot gesture set", { gesture });
	}
	syncHookLifecycle();
}

/** 注销 quickpanel 消费者（关闭功能或 IPC teardown 时）；appshot 消费者仍活跃则底层监听不停。 */
export function stopQuickPanelTrigger(): void {
	resetQuickPanelState();
	qpTargets = new Set();
	activeConsumers.delete("quickpanel");
	syncHookLifecycle();
}

/** 注销全部消费者并停止底层监听（退出 APP 时，避免 uiohook 线程残留）。 */
export function stopAllUiohookConsumers(): void {
	resetQuickPanelState();
	resetAppshotState();
	qpTargets = new Set();
	axTargets = new Set();
	activeConsumers.clear();
	syncHookLifecycle();
}
