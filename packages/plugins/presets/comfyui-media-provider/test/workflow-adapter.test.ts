import { describe, expect, it } from "vitest";
import { adaptMinimaxWorkflow, type ComfyPrompt } from "../src/workflow-adapter";

const template: ComfyPrompt = {
	load: { class_type: "LoadImage", inputs: { image: "old.png" } },
	resolution: { class_type: "ResolutionSelector", inputs: { aspect_ratio: "1:1 (Square)" } },
	noise: { class_type: "RandomNoise", inputs: { noise_seed: 1 } },
	duration: { class_type: "PrimitiveFloat", inputs: { value: 5 }, _meta: { title: "Float (duration)" } },
	generate: { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: "old" } },
	save: { class_type: "SaveVideo", inputs: {} },
};

describe("adaptMinimaxWorkflow", () => {
	it("maps the stable media request onto provider-owned ComfyUI nodes", () => {
		const result = adaptMinimaxWorkflow(
			template,
			{
				kind: "video",
				mode: "image-to-video",
				prompt: "camera slowly moves forward",
				aspectRatio: "16:9",
				durationSeconds: 10,
				references: [{ id: "image-1", kind: "image" }],
			},
			"uploaded/input.png",
			42,
		);

		expect(result.outputNodeId).toBe("save");
		expect(result.prompt.load.inputs.image).toBe("uploaded/input.png");
		expect(result.prompt.generate.inputs.prompt).toBe("camera slowly moves forward");
		expect(result.prompt.resolution.inputs.aspect_ratio).toBe("16:9 (Widescreen)");
		expect(result.prompt.duration.inputs.value).toBe(10);
		expect(result.prompt.noise.inputs.noise_seed).toBe(42);
		expect(template.load.inputs.image).toBe("old.png");
	});
});
