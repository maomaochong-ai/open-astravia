/**
 * 画布位图的跨会话缓存。
 *
 * 位图本身是 useFrameRasters 的组件 state，画布一关就没了——于是每次进画布都要把
 * 全部 frame 重新挂 iframe、渲染、截图一遍，二十帧的设计稿就是二十帧一起转圈，
 * 挨个消解。缓存的作用是让上一次的成果先顶上：进画布立刻有画面，刷新在后台跑。
 *
 * 为什么是 IndexedDB 而不是 ctx.storage：位图是纯派生数据，必须能删（frame 删了、
 * 设计稿删了），而 storage API 只有 readJson/writeJson/putBlob 一类的写入口，没有
 * 删除能力，拿它做缓存等于让磁盘只涨不落。也不写进设计包的 .snapshots/——那是
 * 用户项目里的目录，几 MB 的派生位图不该落在那儿。
 */

const DB_NAME = "vetta-ui-design";
const STORE = "rasters";
/**
 * 画廊封面：整块画布的全景图，一份设计一张，key 就是 vetdPath。
 *
 * 与 frame 位图同库不同表：来源相同（都是画布截出来的派生位图）、失效条件相同
 * （设计没了就该一起没），分表只是为了「取封面」不必扫一遍 frame 键。
 */
const COVER_STORE = "covers";
/**
 * 3 而不是 2：2 曾经发布过一版**只升版本号、没建 covers 表**的实现，那些库现在停在
 * 「version=2 且没有 covers」的状态上。`open(name, 2)` 对已经是 v2 的库不触发升级，
 * 不再升一版的话它们永远补不上这张表。
 */
const DB_VERSION = 3;

/** 这个库应该有的全部表。升级时按缺什么补什么，不依赖「从哪一版升上来」。 */
const STORES = [STORE, COVER_STORE] as const;

/** `${vetdPath}::${frameId}`——设计文档之间天然隔离，同一份里按 frame 取。 */
function keyOf(vetdPath: string, frameId: string): string {
	return `${vetdPath}::${frameId}`;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise<IDBDatabase | null>((resolve) => {
		try {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				for (const store of STORES) {
					if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
				}
			};
			request.onsuccess = () => resolve(request.result);
			// 缓存不可用不该让画布挂掉：隐私模式、配额耗尽都可能走到这里，
			// 退回「每次进画布重新截」的老行为即可。
			request.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
	return dbPromise;
}

function runStore<T>(
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest<T>,
	storeName: string = STORE,
): Promise<T | null> {
	return openDb().then(
		(db) =>
			new Promise<T | null>((resolve) => {
				if (!db) return resolve(null);
				// 表不存在是**代码错误**（漏了建表 / 漏了升版本），不是环境问题。下面那层
				// try/catch 会把它和「配额耗尽」一样静默咽掉——真发生过：covers 表整整一版
				// 没被建出来，封面每次都静默丢弃，表面上只是「一直没有封面」。
				if (!db.objectStoreNames.contains(storeName)) {
					console.error(
						`[vetta-ui-design] IndexedDB store "${storeName}" is missing (db v${db.version}); bump DB_VERSION so the upgrade runs.`,
					);
					return resolve(null);
				}
				try {
					const request = run(db.transaction(storeName, mode).objectStore(storeName));
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => resolve(null);
				} catch {
					resolve(null);
				}
			}),
	);
}

/** 读回这份设计稿已缓存的位图。缺失/失败一律当作没有缓存。 */
export async function loadRasters(
	vetdPath: string,
	frameIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
	const found = new Map<string, string>();
	await Promise.all(
		frameIds.map(async (frameId) => {
			const value = await runStore<unknown>("readonly", (store) => store.get(keyOf(vetdPath, frameId)));
			if (typeof value === "string") found.set(frameId, value);
		}),
	);
	return found;
}

export async function saveRaster(vetdPath: string, frameId: string, dataUrl: string): Promise<void> {
	await runStore("readwrite", (store) => store.put(dataUrl, keyOf(vetdPath, frameId)));
}

/**
 * 删掉这份设计稿里已经不存在的 frame 的位图。只在打开设计稿时对账一次：删 frame 的
 * 那一刻不清，反正下次打开就收掉了，而画布运行期间反复扫全库不值当。
 *
 * 整份设计稿被删除的情况不处理——没有全局索引就无从知道哪些 vetdPath 已经不在了，
 * 为几百 KB 的条目维护一张索引不划算。
 */
export async function pruneRasters(vetdPath: string, keep: readonly string[]): Promise<void> {
	const alive = new Set(keep.map((frameId) => keyOf(vetdPath, frameId)));
	const prefix = `${vetdPath}::`;
	const keys = await runStore<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
	if (!keys) return;
	await Promise.all(
		keys.map(async (key) => {
			if (typeof key !== "string" || !key.startsWith(prefix) || alive.has(key)) return;
			await runStore("readwrite", (store) => store.delete(key));
		}),
	);
}

/** 读回这份设计稿的画廊封面（jpeg dataURL）。没有就是没有——画廊自己出占位。 */
export async function loadCover(vetdPath: string): Promise<string | null> {
	const value = await runStore<unknown>("readonly", (store) => store.get(vetdPath), COVER_STORE);
	return typeof value === "string" ? value : null;
}

export async function saveCover(vetdPath: string, dataUrl: string): Promise<void> {
	await runStore("readwrite", (store) => store.put(dataUrl, vetdPath), COVER_STORE);
}

export async function deleteCover(vetdPath: string): Promise<void> {
	await runStore("readwrite", (store) => store.delete(vetdPath), COVER_STORE);
}
