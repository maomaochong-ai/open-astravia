import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import {
	DOMAIN_QUICK_PANEL_CAPABILITIES,
	DOMAIN_QUICK_PANEL_CAPABILITY_CATALOG,
	DOMAIN_SHORTCUT_CAPABILITIES,
	DOMAIN_SHORTCUT_CAPABILITY_CATALOG,
	QUICK_PANEL_POST_SEND_BEHAVIORS,
	QUICK_PANEL_TRIGGERS,
} from "../../src/domain.js";

describe("shortcut and quick panel domain capabilities", () => {
	it("uses one stable id per shortcut and quick panel operation", () => {
		expect(Object.values(DOMAIN_SHORTCUT_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}shortcut.settings.get`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}shortcut.binding.set`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}shortcut.binding.reset`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}shortcut.binding.reset-all`,
		]);
		expect(Object.values(DOMAIN_QUICK_PANEL_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}quick-panel.trigger.set`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}quick-panel.post-send-behavior.set`,
		]);
	});

	it("validates shortcut settings and quick panel mutations", () => {
		expect(
			DOMAIN_SHORTCUT_CAPABILITIES.GET_SETTINGS.parseOutput({
				bindings: [
					{
						id: "new-session",
						defaultShortcut: "mod+n",
						shortcut: "mod+shift+n",
						isDefault: false,
						ignored: true,
					},
				],
				quickPanel: {
					trigger: QUICK_PANEL_TRIGGERS.MOD,
					postSendBehavior: QUICK_PANEL_POST_SEND_BEHAVIORS.BACKGROUND,
					ignored: true,
				},
				ignored: true,
			}),
		).not.toHaveProperty("quickPanel.ignored");
		expect(
			DOMAIN_SHORTCUT_CAPABILITIES.SET_BINDING.parseInput({
				id: "new-session",
				shortcut: "",
				ignored: true,
			}),
		).toEqual({ id: "new-session", shortcut: "" });
		expect(() =>
			DOMAIN_SHORTCUT_CAPABILITIES.SET_BINDING.parseInput({ id: "new-session", shortcut: false }),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() => DOMAIN_SHORTCUT_CAPABILITIES.RESET_BINDING.parseInput({ id: "   " })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() => DOMAIN_QUICK_PANEL_CAPABILITIES.SET_TRIGGER.parseInput({ trigger: "control" })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() =>
			DOMAIN_QUICK_PANEL_CAPABILITIES.SET_POST_SEND_BEHAVIOR.parseOutput({
				trigger: "none",
				postSendBehavior: "hidden",
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
	});

	it("publishes separate shortcut and quick panel catalogs", () => {
		expect(DOMAIN_SHORTCUT_CAPABILITY_CATALOG).toHaveLength(4);
		expect(DOMAIN_QUICK_PANEL_CAPABILITY_CATALOG).toHaveLength(2);
		expect(DOMAIN_SHORTCUT_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({
			type: "object",
			required: ["bindings", "quickPanel"],
			properties: {
				bindings: {
					type: "array",
					items: {
						type: "object",
						required: ["id", "defaultShortcut", "shortcut", "isDefault"],
					},
				},
			},
		});
		expect(DOMAIN_SHORTCUT_CAPABILITY_CATALOG[1]?.inputSchema).toMatchObject({
			required: ["id", "shortcut"],
			properties: {
				id: { type: "string", pattern: "\\S" },
				shortcut: { type: "string" },
			},
		});
		expect(DOMAIN_QUICK_PANEL_CAPABILITY_CATALOG[0]?.inputSchema).toMatchObject({
			properties: {
				trigger: {
					anyOf: [
						{ const: QUICK_PANEL_TRIGGERS.NONE, type: "string" },
						{ const: QUICK_PANEL_TRIGGERS.MOD, type: "string" },
						{ const: QUICK_PANEL_TRIGGERS.ALT, type: "string" },
						{ const: QUICK_PANEL_TRIGGERS.SHIFT, type: "string" },
					],
				},
			},
		});
		expect(() =>
			JSON.stringify([...DOMAIN_SHORTCUT_CAPABILITY_CATALOG, ...DOMAIN_QUICK_PANEL_CAPABILITY_CATALOG]),
		).not.toThrow();
	});
});
