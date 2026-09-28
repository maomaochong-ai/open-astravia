/**
 * 配对二维码改为圆润风格后仍要能被扫出：定位角必须完整，中心只清出徽标那一小块，
 * 其余数据模块一个不少。
 */
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { inBadge, pairingQr, pairingQrSvg, roundedQrSvg } from "./remote-pairing-qr";

const CODE_QR = "VETTA://PAIR/K7Q29MXD/482913";

const LINK = `vetta://pair?${new URLSearchParams({
	v: "2",
	id: "a1B2c3D4e5F6g7H8i9J0kL",
	s: "b".repeat(43),
	k: "c".repeat(43),
	n: "MacBook Pro",
	lan: "192.168.1.8:43117",
	relay: "wss://relay.example.test",
})}`;

describe("配对二维码", () => {
	it("中心清出的区域远小于纠错能恢复的比例", () => {
		for (const text of [LINK, CODE_QR]) {
			const { size, badgeModules } = pairingQrSvg(text);
			let cleared = 0;
			for (let row = 0; row < size; row++)
				for (let col = 0; col < size; col++) if (inBadge(size, badgeModules, row, col)) cleared++;
			// A third of what each level recovers: 30% for the code-only QR, 15% for a whole link.
			expect(cleared / (size * size)).toBeLessThan(text === CODE_QR ? 0.1 : 0.05);
		}
	});

	it("只装连接码的二维码是 29×29 格，完整链接退回中等纠错", () => {
		expect(pairingQrSvg(CODE_QR).size).toBe(29);
		expect(pairingQrSvg(LINK).size).toBe(QRCode.create(LINK, { errorCorrectionLevel: "M" }).modules.size);
	});

	it("徽标比清出的区域小一圈，不会压到数据模块", () => {
		const { size, badgeModules } = pairingQrSvg(LINK);
		const { badge } = pairingQr(LINK);
		const radius = (badge * size) / 2;
		// 徽标边缘外至少还有半个模块的空白。
		for (let row = 0; row < size; row++)
			for (let col = 0; col < size; col++)
				if (Math.hypot(row + 0.5 - size / 2, col + 0.5 - size / 2) <= radius + 0.5)
					expect(inBadge(size, badgeModules, row, col)).toBe(true);
	});

	it("除中心与三个定位角外，每个深色模块都画出来", () => {
		const qr = QRCode.create(LINK, { errorCorrectionLevel: "M" });
		const { size, data } = qr.modules;
		const { badgeModules } = pairingQrSvg(LINK);
		const expected = [...data].filter((value, index) => {
			const row = Math.floor(index / size);
			const col = index % size;
			const finder = (row < 7 && col < 7) || (row < 7 && col >= size - 7) || (row >= size - 7 && col < 7);
			return value === 1 && !finder && !inBadge(size, badgeModules, row, col);
		}).length;
		const { svg } = pairingQrSvg(LINK);
		// 每个模块、定位角的外框、内孔和中心各以一个 M 开头。
		expect(svg.match(/M/g)?.length).toBe(expected + 3 * 3);
	});

	it("相邻模块连成一片：只有朝外的角是圆的", () => {
		// 顶部中间横向两格（避开定位角与中心）：左格只圆左侧两角，右格只圆右侧两角。
		const svg = roundedQrSvg({
			size: 21,
			badgeModules: 5,
			isDark: (row, col) => row === 1 && (col === 9 || col === 10),
		});
		const modules = svg.split("M").filter((part) => / 1H/.test(part.slice(0, 8)));
		expect(modules).toHaveLength(2);
		for (const module of modules) expect(module.match(/A/g)).toHaveLength(2);
	});
});
