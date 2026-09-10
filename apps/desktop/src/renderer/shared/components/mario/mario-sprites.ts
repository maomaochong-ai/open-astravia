/**
 * 马里奥装饰件的像素素材：砖块、问号砖块、蘑菇，各是一张 16×16 的点阵。
 *
 * 点阵写成「一行一个字符串 + 调色板」而不是直接堆 box-shadow：原素材是 256 条
 * box-shadow，改一个像素要在一坨坐标里找位置，而这里改哪个像素一眼就看得出来。
 * 加载时按行做游程合并，压成几十个矩形交给 SVG 画——SVG 缩放不糊，装饰件和设置页
 * 预览卡就能共用同一份素材，只换 unit。
 */

/** 三张点阵都是 16×16；渲染方按这个数算 viewBox 与实际尺寸。 */
export const SPRITE_SIZE = 16;

/** 一段同色的横向游程：`x` 起点、`w` 长度，单位都是像素格。 */
export interface SpriteRect {
	readonly fill: string;
	readonly w: number;
	readonly x: number;
	readonly y: number;
}

export interface PixelSprite {
	readonly rects: readonly SpriteRect[];
}

/** 把点阵按行做游程合并；`.` 是透明格，直接跳过。 */
function compile(palette: Readonly<Record<string, string>>, rows: readonly string[]): PixelSprite {
	const rects: SpriteRect[] = [];
	rows.forEach((row, y) => {
		let x = 0;
		while (x < row.length) {
			const key = row[x];
			let width = 1;
			while (x + width < row.length && row[x + width] === key) width += 1;
			const fill = palette[key];
			if (fill) rects.push({ fill, w: width, x, y });
			x += width;
		}
	});
	return { rects };
}

/** 砖块：横向四道砖缝，顶边一条高光。 */
export const BRICK_SPRITE = compile({ a: "#cc3300", b: "#000000", c: "#ff9999" }, [
	"cccccccccccccccc",
	"aaaaaaabaaaaaaab",
	"aaaaaaabaaaaaaab",
	"bbbbbbbbbbbbbbbb",
	"aaabaaaaaaabaaaa",
	"aaabaaaaaaabaaaa",
	"aaabaaaaaaabaaaa",
	"bbbbbbbbbbbbbbbb",
	"aaaaaaabaaaaaaab",
	"aaaaaaabaaaaaaab",
	"aaaaaaabaaaaaaab",
	"bbbbbbbbbbbbbbbb",
	"aaabaaaaaaabaaaa",
	"aaabaaaaaaabaaaa",
	"aaabaaaaaaabaaaa",
	"bbbbbbbbbbbbbbbb",
]);

/** 问号砖块：橙底、深色描边，中间一个带阴影的问号。 */
export const QUESTION_SPRITE = compile({ a: "#ff9c31", b: "#ce3100", c: "#000000" }, [
	".bbbbbbbbbbbbbb.",
	"baaaaaaaaaaaaaac",
	"bacaaaaaaaaaacac",
	"baaaabbbbbaaaaac",
	"baaabbcccbbaaaac",
	"baaabbcaabbcaaac",
	"baaabbcaabbcaaac",
	"baaaaccabbbcaaac",
	"baaaaaabbcccaaac",
	"baaaaaabbcaaaaac",
	"baaaaaaaccaaaaac",
	"baaaaaabbaaaaaac",
	"baaaaaabbcaaaaac",
	"bacaaaaaccaaacac",
	"baaaaaaaaaaaaaac",
	"cccccccccccccccc",
]);

/** 超级蘑菇：红伞白斑、米色的柄。 */
export const MUSHROOM_SPRITE = compile({ a: "#fc9838", b: "#d82800", c: "#ffffff" }, [
	"......aaaa......",
	".....aaaabb.....",
	"....aaaabbbb....",
	"...aaaaabbbbb...",
	"..aaaaaaabbbaa..",
	".aabbbaaaaaaaaa.",
	".abbbbbaaaaaaaa.",
	"aabbbbbaaaaabbaa",
	"aabbbbbaaaaabbba",
	"aaabbbaaaaaaabba",
	"aaaaaaaaaaaaaaaa",
	".abbbccccccbbba.",
	"....cccccccc....",
	"....ccccccac....",
	"....ccccccac....",
	".....ccccac.....",
]);
