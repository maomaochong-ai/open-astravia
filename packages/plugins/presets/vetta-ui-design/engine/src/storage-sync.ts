/**
 * 画布与离屏截图窗口之间的 localStorage 同步。
 *
 * 画布上的 frame 是嵌在应用窗口里的跨站 iframe，Chromium 的第三方存储分区让它的
 * localStorage 按顶层站点另开一个桶；离屏截图窗口却是直接打开引擎地址的顶层页面，
 * 用的是第一方那个桶。两边同源却互相看不见：用户在 frame 里切到深色主题、写进
 * localStorage，画布上别的 iframe 都读得到，离屏窗口永远读到默认值——位图一律是
 * 浅色，点进去的活体又是深色。
 *
 * 所以状态由画布那一侧说了算：iframe 里的 bridge 把整份快照报给画布，画布截图时把
 * 快照拼进离屏窗口的地址，引擎启动、设计稿代码读存储之前先把它写进去。
 *
 * 这个模块在 import 时不能有副作用：画布侧（插件 UI）也直接 import 它，跟 routes.ts
 * 一样。watchLocalStorage 会改 Storage 原型，只由引擎里的 bridge 调用。
 */

/** 离屏窗口地址上携带快照的查询参数。 */
export const STORAGE_SEED_PARAM = "vetd-storage";

export type StorageEntries = Record<string, string>;

/** 读出整份存储。键按字典序排好，同样的内容序列化出来的字符串也一样，便于判等。 */
export function readStorageEntries(storage: Storage): StorageEntries {
	const keys: string[] = [];
	for (let index = 0; index < storage.length; index += 1) {
		const key = storage.key(index);
		if (key !== null) keys.push(key);
	}
	keys.sort();
	const entries: StorageEntries = {};
	for (const key of keys) {
		const value = storage.getItem(key);
		if (value !== null) entries[key] = value;
	}
	return entries;
}

/** 消息里收到的快照只信「字符串到字符串」的平面对象，其余一律当无效。 */
export function parseStorageEntries(value: unknown): StorageEntries | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const entries: StorageEntries = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item !== "string") return null;
		entries[key] = item;
	}
	return entries;
}

/**
 * 地址上带着快照时，用它整个替换本地存储，再把参数从地址栏抹掉。
 *
 * 必须在设计稿代码读存储之前跑：主题这类状态几乎都是启动时读一次就放进内存。
 * 抹掉参数是为了让路由和页面自己看到的地址跟画布 iframe 里的一样干净。
 *
 * 返回是否应用了快照。
 */
export function applyStorageSeed(target: { location: Location; history: History; localStorage: Storage }): boolean {
	const url = new URL(target.location.href);
	const raw = url.searchParams.get(STORAGE_SEED_PARAM);
	if (raw === null) return false;
	url.searchParams.delete(STORAGE_SEED_PARAM);
	target.history.replaceState(target.history.state, "", `${url.pathname}${url.search}${url.hash}`);
	let entries: StorageEntries | null = null;
	try {
		entries = parseStorageEntries(JSON.parse(raw));
	} catch {
		entries = null;
	}
	if (entries === null) return false;
	try {
		const storage = target.localStorage;
		storage.clear();
		for (const [key, value] of Object.entries(entries)) storage.setItem(key, value);
	} catch {
		// 存储不可用（配额、被禁用）：退回页面自己的默认状态，截图照常进行。
		return false;
	}
	return true;
}

/** 一连串写入合并成一次上报的等待时间：输入框逐字保存这类写法不该逐字触发重截。 */
const STORAGE_REPORT_DELAY_MS = 120;

/**
 * 把 localStorage 的变化报给画布（为什么要报见文件头）。
 *
 * 挂上时先报一次整份快照，之后每次写入合并上报。`user` 标记这批写入里是否有发生在
 * 用户操作（点击、按键）的激活期内的：画布只拿这种变化去重截所有 frame，页面启动时
 * 自己写的默认值、按路由记下的访问痕迹不算——那些一旦也触发重截和重载，别的 frame
 * 重新加载时又会写一遍，来回互相踢。
 *
 * 拦的是 Storage.prototype 上的写方法，`localStorage.foo = x` 这种属性赋值拦不到；
 * 主流的持久化库（zustand persist、next-themes 等）都走 setItem。sessionStorage 的写入
 * 也会触发一次上报，但报的永远是 localStorage 的快照，内容没变画布那边就当没发生。
 */
export function watchLocalStorage(report: (message: Record<string, unknown>) => void): void {
	let storage: Storage;
	try {
		storage = window.localStorage;
	} catch {
		return;
	}
	let timer: ReturnType<typeof setTimeout> | null = null;
	let byUser = false;
	const flush = (): void => {
		timer = null;
		const user = byUser;
		byUser = false;
		report({ type: "storage", entries: readStorageEntries(storage), user });
	};
	onStorageWrite = () => {
		if (window.navigator.userActivation?.isActive === true) byUser = true;
		if (timer === null) timer = setTimeout(flush, STORAGE_REPORT_DELAY_MS);
	};
	patchStorageWrites();
	flush();
}

/** 当前的写入监听。原型只改一次，重复挂载时换掉的是这里。 */
let onStorageWrite: (() => void) | null = null;
let storagePatched = false;

function patchStorageWrites(): void {
	if (storagePatched) return;
	storagePatched = true;
	const proto = Storage.prototype;
	const { setItem, removeItem, clear } = proto;
	proto.setItem = function (this: Storage, key: string, value: string): void {
		setItem.call(this, key, value);
		onStorageWrite?.();
	};
	proto.removeItem = function (this: Storage, key: string): void {
		removeItem.call(this, key);
		onStorageWrite?.();
	};
	proto.clear = function (this: Storage): void {
		clear.call(this);
		onStorageWrite?.();
	};
}
