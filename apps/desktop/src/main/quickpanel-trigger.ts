// 全局键盘手势共享监听器（uiohook 宿主 worker 线程的消费者管理）。
// Electron globalShortcut 无法监听裸功能键的双击/双键同按，这里用 uiohook-napi 做原生全局键盘监听。
// uIOhook 不在主线程运行：uiohook-napi ≤1.5.5 的 hook_enable() 存在启动竞态死锁，会把**调用
// 线程**永久冻住（macOS 彩虹圈），故隔离到 worker 线程（uiohook-worker.ts），由
// UiohookSupervisor 负责 spawn/看门狗/重试，键盘事件经 parentPort 回传本模块的状态机。
// 宿主必须留在主进程内：实测 Electron utilityProcess 里的 CGEventTap 至多投递一个事件后就
// 永久失聪，双击 ⌘ / 双 Shift 同按依赖的修饰键事件一个都收不到（详见 uiohook-worker.ts）。
// 本模块（主线程）刻意**不 import uiohook-napi**：加载 addon 会在主线程 Environment
// 注册 env cleanup hook，退出时对 worker 的失效 CFRunLoopRef 调 hook_stop() 而 SIGTRAP。
// 键码常量走 uiohook-keycodes.ts，停止走 worker 自己的 uIOhook.stop()（uiohook-protocol.ts）。
// 两个消费者共用同一宿主：
//   - quickpanel：「干净双击」某个功能键唤出快捷面板；
//   - appshot：左右同一功能键「双键同按持按 250ms」触发前台窗口捕获。
// 活跃消费者集合管理启停：首个消费者出现时拉起宿主、集合清空时终止（不申请权限/无开销）。
// macOS 首次启动监听会触发系统「输入监控」授权；未授权时收不到事件——设置页有提示。

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { AppshotGesture, QuickPanelTrigger } from "./config/desktop-config-store.js";
import { getAppLogger } from "./logger.js";
import { UIOHOOK_KEYCODE } from "./uiohook-keycodes.js";
import type { UiohookHostChild } from "./uiohook-supervisor.js";
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
				? [UIOHOOK_KEYCODE.Meta, UIOHOOK_KEYCODE.MetaRight]
				: [UIOHOOK_KEYCODE.Ctrl, UIOHOOK_KEYCODE.CtrlRight];
		case "alt":
			return [UIOHOOK_KEYCODE.Alt, UIOHOOK_KEYCODE.AltRight];
		case "shift":
			return [UIOHOOK_KEYCODE.Shift, UIOHOOK_KEYCODE.ShiftRight];
	}
}

/** appshot 手势对应的左右键对。mod 按平台映射：mac=⌘，其余=Ctrl。 */
function appshotKeycodesFor(gesture: AppshotGesture): number[] {
	switch (gesture) {
		case "both-mod":
			return process.platform === "darwin"
				? [UIOHOOK_KEYCODE.Meta, UIOHOOK_KEYCODE.MetaRight]
				: [UIOHOOK_KEYCODE.Ctrl, UIOHOOK_KEYCODE.CtrlRight];
		case "both-alt":
			return [UIOHOOK_KEYCODE.Alt, UIOHOOK_KEYCODE.AltRight];
		case "both-shift":
			return [UIOHOOK_KEYCODE.Shift, UIOHOOK_KEYCODE.ShiftRight];
	}
}

// ----- 共享 uiohook 生命周期 -----------------------------------------------

type UiohookConsumer = "quickpanel" | "appshot";

const activeConsumers = new Set<UiohookConsumer>();

let supervisor: UiohookSupervisor | null = null;

// 宿主入口与本文件同目录输出（见 vite.main.config.ts 的多入口配置）。
// 必须用 dirname(import.meta.url) 拼路径：若改成把入口文件名作为字面量传给 new URL 再配
// import.meta.url，Vite 会将其识别为静态资源引用，把 uiohook-worker.ts 的源码内联成
// data:video/mp2t;base64,... URL，运行时 fileURLToPath 立即抛 ERR_INVALID_URL_SCHEME，
// 宿主永远起不来（快捷面板与应用快照整体失效）。守卫见 uiohook-host-entry.test.ts。
const HOST_DIR = dirname(fileURLToPath(import.meta.url));

/** 把 node:worker_threads 的 Worker 适配成 UiohookSupervisor 需要的最小句柄。 */
function spawnUiohookWorker(): UiohookHostChild {
	const worker = new Worker(join(HOST_DIR, "uiohook-worker.js"));
	// worker 抛错后仍会派发 exit，重试交给 supervisor；这里只补上失败原因日志。
	worker.on("error", (err) => log.error("uiohook worker error", err));
	return {
		on(event: "message" | "exit", listener: ((message: unknown) => void) | ((code: number) => void)) {
			// message 传 unknown、exit 传退出码，两者都是单参数；由 supervisor 侧收窄。
			const forward = listener as (value: unknown) => void;
			return worker.on(event, (value: unknown) => forward(value));
		},
		postMessage(message) {
			worker.postMessage(message);
		},
		// terminate() 是异步的，而 supervisor 只需要「已请求终止」的同步语义；
		// 真命中原生死锁时线程可能终止不掉，但那只泄漏一个 worker，主线程不受影响。
		kill() {
			void worker.terminate();
			return true;
		},
	};
}

function getSupervisor(): UiohookSupervisor {
	if (!supervisor) {
		supervisor = new UiohookSupervisor({
			forkChild: spawnUiohookWorker,
			onKeydown: handleKeydown,
			onKeyup: handleKeyup,
		});
	}
	return supervisor;
}

/**
 * 依据活跃消费者集合启停宿主 worker：首个出现拉起、集合空则优雅停止。
 * 返回停止完成的 Promise（拉起路径同步完成，返回 undefined 的已决态）。
 */
function syncHookLifecycle(): Promise<void> {
	if (activeConsumers.size > 0) {
		getSupervisor().ensureRunning();
		return Promise.resolve();
	}
	return supervisor?.stop() ?? Promise.resolve();
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
	void syncHookLifecycle();
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
	void syncHookLifecycle();
}

/** 注销 quickpanel 消费者（关闭功能或 IPC teardown 时）；appshot 消费者仍活跃则底层监听不停。 */
export function stopQuickPanelTrigger(): void {
	resetQuickPanelState();
	qpTargets = new Set();
	activeConsumers.delete("quickpanel");
	void syncHookLifecycle();
}

/**
 * 注销全部消费者并停止底层监听（退出 APP 时）。
 *
 * 必须 await：worker 需要自己跑完 uIOhook.stop() 才会把原生侧 is_worker_running 清零，
 * 否则进程退出时 uiohook-napi 的 env cleanup hook 会以 SIGTRAP 打死进程
 * （macOS 上就是「Vetta 意外退出」弹窗，详见 uiohook-protocol.ts）。
 */
export function stopAllUiohookConsumers(): Promise<void> {
	resetQuickPanelState();
	resetAppshotState();
	qpTargets = new Set();
	axTargets = new Set();
	activeConsumers.clear();
	return syncHookLifecycle();
}
