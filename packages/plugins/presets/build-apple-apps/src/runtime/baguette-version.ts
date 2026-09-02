/**
 * baguette 运行时的版本门禁。
 *
 * 为什么要比版本而不只是「跑得起来」：手势注入走 SimulatorKit 私有符号，
 * iOS 26 / Xcode 26 改过调用约定，旧版会静默丢消息——用户和模型都只看到
 * 「点了没反应」，而不是一条能读懂的报错。解析不出版本时一律判为不兼容。
 */

/** 锁定的最低版本：低于此版本的手势注入在 iOS 26 上不可靠。 */
export const MINIMUM_BAGUETTE_VERSION = "0.1.97";

/** 从 `baguette --version` 输出里取版本号。 */
export function parseBaguetteVersion(output: string): string | null {
	return output.match(/(\d+)\.(\d+)\.(\d+)/)?.[0] ?? null;
}

function parseTriple(value: string): number[] | null {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** fail-closed：版本读不出来就当作不兼容，宁可提示升级也不要静默失败。 */
export function isBaguetteCompatible(version: string | null, minimum = MINIMUM_BAGUETTE_VERSION): boolean {
	const actual = version === null ? null : parseTriple(version);
	const required = parseTriple(minimum);
	if (!actual || !required) return false;
	for (let index = 0; index < 3; index++) {
		if (actual[index] > required[index]) return true;
		if (actual[index] < required[index]) return false;
	}
	return true;
}
