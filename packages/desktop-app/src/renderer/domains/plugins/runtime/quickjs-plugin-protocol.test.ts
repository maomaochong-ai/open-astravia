import { describe, expect, it } from "vitest";
import { parseQuickJsDeclarativeNode, parseQuickJsWorkerMessage } from "./quickjs-plugin-protocol";

describe("QuickJS plugin protocol", () => {
	it("accepts a bounded host-rendered form", () => {
		const view = parseQuickJsDeclarativeNode({
			type: "section",
			title: "Settings",
			children: [
				{ type: "input", action: "name.change", label: "Name", value: "Vetta" },
				{ type: "switch", action: "enabled.change", label: "Enabled", checked: true },
				{ type: "button", action: "save", label: "Save", variant: "primary" },
			],
		});

		expect(view.type).toBe("section");
	});

	it("rejects executable and unknown UI nodes", () => {
		expect(() => parseQuickJsDeclarativeNode({ type: "html", html: "<script>alert(1)</script>" })).toThrow(
			"Invalid QuickJS declarative node type",
		);
		expect(() => parseQuickJsDeclarativeNode({ type: "button", action: "../../host", label: "Escape" })).toThrow(
			"Invalid QuickJS action",
		);
	});

	it("rejects undeclared host methods", () => {
		expect(() =>
			parseQuickJsWorkerMessage({
				type: "hostCall",
				callId: 1,
				method: "command.run",
				args: ["powershell"],
			}),
		).toThrow("Invalid QuickJS host call");
	});

	it("accepts worker disposal acknowledgements", () => {
		expect(parseQuickJsWorkerMessage({ type: "disposed" })).toEqual({ type: "disposed" });
	});

	it("validates activity tab retention at the worker boundary", () => {
		expect(
			parseQuickJsWorkerMessage({
				type: "registerActivityTab",
				contribution: {
					id: "probe",
					label: "Probe",
					retention: "pinned",
					view: { type: "text", text: "Ready" },
				},
			}),
		).toMatchObject({ contribution: { retention: "pinned" } });
		expect(() =>
			parseQuickJsWorkerMessage({
				type: "registerActivityTab",
				contribution: {
					id: "probe",
					label: "Probe",
					retention: "forever",
					view: { type: "text", text: "Ready" },
				},
			}),
		).toThrow("Invalid QuickJS activity tab retention");
	});
});
