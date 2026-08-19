import { createRequire } from "node:module";
import type { RemoteInputMessage } from "@vetta/remote-desktop";
import type * as Koffi from "koffi";
import { getAppLogger } from "../logger.js";

export interface SystemInputAdapter {
	readonly supported: boolean;
	setEnabled(enabled: boolean): void;
	apply(message: RemoteInputMessage): void;
}

const log = (() => {
	try {
		return getAppLogger("remote-desktop-input");
	} catch {
		return {
			debug: () => undefined,
			info: () => undefined,
			warn: () => undefined,
		};
	}
})();

/**
 * System input is deliberately opt-in. Remote media can be enabled without
 * granting a relay peer the ability to control the local machine.
 */
export function createSystemInputAdapter(options: { readonly enabled: boolean }): SystemInputAdapter {
	if (!options.enabled || process.platform !== "win32") {
		return {
			supported: false,
			setEnabled: () => undefined,
			apply(message) {
				log.debug("remote input ignored", {
					type: message.type,
					reason: options.enabled ? "unsupported_platform" : "disabled",
				});
			},
		};
	}

	return createWindowsInputAdapter();
}

function createWindowsInputAdapter(): SystemInputAdapter {
	// Loaded lazily so Linux/macOS builds do not resolve the native DLL binding.
	const koffi = createRequire(import.meta.url)("koffi") as typeof Koffi;
	const user32 = koffi.load("user32.dll");
	const MOUSEINPUT = koffi.struct({
		dx: "long",
		dy: "long",
		mouseData: "uint32_t",
		dwFlags: "uint32_t",
		time: "uint32_t",
		dwExtraInfo: "uintptr_t",
	});
	const KEYBDINPUT = koffi.struct({
		wVk: "uint16_t",
		wScan: "uint16_t",
		dwFlags: "uint32_t",
		time: "uint32_t",
		dwExtraInfo: "uintptr_t",
	});
	const HARDWAREINPUT = koffi.struct({
		uMsg: "uint32_t",
		wParamL: "uint16_t",
		wParamH: "uint16_t",
	});
	const INPUT = koffi.struct({
		type: "uint32_t",
		u: koffi.union({ mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT }),
	});
	const SendInput = user32.func("uint32 __stdcall SendInput(uint32, _In_ INPUT *, int)");
	const SetCursorPos = user32.func("int __stdcall SetCursorPos(int, int)");
	const GetSystemMetrics = user32.func("int __stdcall GetSystemMetrics(int)");
	const MapVirtualKey = user32.func("uint32 __stdcall MapVirtualKeyW(uint32, uint32)");

	let enabled = true;
	return {
		supported: true,
		setEnabled(value) {
			enabled = value;
			log.info("remote input grant changed", { enabled: value });
		},
		apply(message) {
			if (!enabled) return;
			if (message.type === "pointer.move" || message.type === "pointer.button") {
				const width = GetSystemMetrics(0);
				const height = GetSystemMetrics(1);
				SetCursorPos(
					Math.round(message.x * Math.max(1, width - 1)),
					Math.round(message.y * Math.max(1, height - 1)),
				);
				if (message.type === "pointer.button") {
					const flags = buttonFlag(message.button, message.action);
					SendInput(
						1,
						{ type: 0, u: { mi: { dx: 0, dy: 0, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } },
						koffi.sizeof(INPUT),
					);
				}
				return;
			}
			if (message.type === "pointer.scroll") {
				SendInput(
					1,
					{
						type: 0,
						u: {
							mi: { dx: 0, dy: 0, mouseData: message.deltaY >>> 0, dwFlags: 0x0800, time: 0, dwExtraInfo: 0 },
						},
					},
					koffi.sizeof(INPUT),
				);
				return;
			}
			if (message.type === "key") {
				const key = virtualKey(message.code);
				if (!key) return;
				const scan = MapVirtualKey(key.virtualKey, 0);
				const flags = 0x0008 | (key.extended ? 0x0001 : 0) | (message.action === "up" ? 0x0002 : 0);
				SendInput(
					1,
					{ type: 1, u: { ki: { wVk: 0, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } } },
					koffi.sizeof(INPUT),
				);
			}
		},
	};
}

function buttonFlag(button: "left" | "middle" | "right", action: "down" | "up"): number {
	const flags = {
		left: [0x0002, 0x0004],
		middle: [0x0020, 0x0040],
		right: [0x0008, 0x0010],
	} as const;
	return flags[button][action === "down" ? 0 : 1];
}

function virtualKey(code: string): { readonly virtualKey: number; readonly extended?: boolean } | undefined {
	if (/^Key[A-Z]$/.test(code)) return { virtualKey: code.charCodeAt(3) };
	if (/^Digit[0-9]$/.test(code)) return { virtualKey: code.charCodeAt(5) };
	const virtualKey = {
		Enter: 0x0d,
		Escape: 0x1b,
		Backspace: 0x08,
		Tab: 0x09,
		Space: 0x20,
		ArrowUp: 0x26,
		ArrowDown: 0x28,
		ArrowLeft: 0x25,
		ArrowRight: 0x27,
		Delete: 0x2e,
		Home: 0x24,
		End: 0x23,
		PageUp: 0x21,
		PageDown: 0x22,
		ShiftLeft: 0xa0,
		ControlLeft: 0xa2,
		AltLeft: 0xa4,
		MetaLeft: 0x5b,
	} as Record<string, number>;
	const value = virtualKey[code];
	return value === undefined
		? undefined
		: { virtualKey: value, extended: /^(Arrow|Delete|Home|End|Page|Meta)/.test(code) };
}
