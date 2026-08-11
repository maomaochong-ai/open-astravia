/**
 * 备注标注图二次合成：把编号气泡画到已截好的 frame 截图上。
 *
 * 为什么在画布侧合成而不是让引擎画：气泡属于画布层（world div），根本不在 iframe
 * 的 document 里，html-to-image 截不到它；而例行质检截图必须保持干净（agent 会把
 * 图上的一切当设计元素来评审），所以只有 vetd_notes 这条路才现画。
 */

export interface NotePin {
	/** frame 内坐标（frame 声明尺寸的像素系）。 */
	fx: number;
	fy: number;
	/** 图上圆圈里的编号——必须与 vetd_notes 返回列表的下标严格同序同号。 */
	label: number;
}

/** 与画布气泡同一个主题色（--vetd-accent 的字面值，合成时读不到 CSS 变量）。 */
const PIN_FILL = "#6366f1";
const PIN_RADIUS = 14;

/** 把钉点收进图内，气泡贴边放也至少露出一半。 */
export function clampPin(value: number, max: number): number {
	return Math.min(Math.max(value, 0), max);
}

/**
 * 在截图 dataUrl 上合成编号气泡，返回新的 png dataUrl。
 * `frameSize` 是 frame 的声明尺寸；截图实际分辨率除以它得出 pixelRatio，
 * 气泡按同一比例放大，保证不同倍率下视觉大小一致。
 */
export async function composeNotePins(
	dataUrl: string,
	frameSize: { width: number; height: number },
	pins: readonly NotePin[],
): Promise<string> {
	if (pins.length === 0) return dataUrl;
	const image = await loadImage(dataUrl);
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("2d canvas context unavailable");
	ctx.drawImage(image, 0, 0);

	const ratio = frameSize.width > 0 ? image.naturalWidth / frameSize.width : 1;
	const radius = PIN_RADIUS * ratio;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	for (const pin of pins) {
		const x = clampPin(pin.fx * ratio, canvas.width);
		const y = clampPin(pin.fy * ratio, canvas.height);
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, Math.PI * 2);
		ctx.fillStyle = PIN_FILL;
		ctx.fill();
		ctx.lineWidth = 2 * ratio;
		ctx.strokeStyle = "#ffffff";
		ctx.stroke();
		ctx.fillStyle = "#ffffff";
		ctx.font = `600 ${Math.round(radius * 1.1)}px system-ui, sans-serif`;
		ctx.fillText(String(pin.label), x, y + ratio);
	}
	return canvas.toDataURL("image/png");
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("failed to decode screenshot for note annotation"));
		image.src = dataUrl;
	});
}
