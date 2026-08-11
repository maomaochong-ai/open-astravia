import { describe, expect, it } from "vitest";
import { adaptMinimaxWorkflow, isCompatibleMinimaxPrompt, type ComfyPrompt } from "../src/workflow-adapter";

const frameTemplate: ComfyPrompt = {
	first: { class_type: "LoadImage", inputs: { image: "old-first.png" } },
	last: { class_type: "LoadImage", inputs: { image: "old-last.png" } },
	resolution: { class_type: "ResolutionSelector", inputs: { aspect_ratio: "1:1 (Square)" } },
	noise: { class_type: "RandomNoise", inputs: { noise_seed: 1 } },
	duration: { class_type: "PrimitiveFloat", inputs: { value: 5 }, _meta: { title: "Float (duration)" } },
	generate: {
		class_type: "MiniMaxH3ImageToVideo",
		inputs: { prompt: "old", first_frame: ["first", 0], last_frame: ["last", 0] },
	},
	save: { class_type: "SaveVideo", inputs: {} },
};

const referenceTemplate: ComfyPrompt = {
	image: { class_type: "LoadImage", inputs: { image: "old-image.png" } },
	video: { class_type: "LoadVideo", inputs: { video: "old-video.mp4" } },
	audio: { class_type: "LoadAudio", inputs: { audio: "old-audio.wav" } },
	generate: {
		class_type: "MiniMaxH3ReferenceToVideo",
		inputs: {
			prompt: "old",
			"ref_images.ref_image_0": ["image", 0],
			"ref_videos.ref_video_0": ["video", 0],
			"ref_video_audios.ref_video_audio_0": ["video", 1],
			"ref_audios.ref_audio_0": ["audio", 0],
		},
	},
	save: { class_type: "SaveVideo", inputs: {} },
};

const referenceTemplateWithoutMediaLoaders: ComfyPrompt = {
	generate: {
		class_type: "MiniMaxH3ReferenceToVideo",
		inputs: { prompt: "old" },
	},
	save: { class_type: "SaveVideo", inputs: {} },
};

describe("adaptMinimaxWorkflow", () => {
	it("connects first and last frames to their distinct MiniMax H3 inputs", () => {
		const result = adaptMinimaxWorkflow(
			frameTemplate,
			{
				operation: "generate",
				kind: "video",
				mode: "image-to-video",
				prompt: "camera slowly moves forward",
				aspectRatio: "16:9",
				durationSeconds: 10,
				inputs: [],
			},
			[
				{ id: "first", role: "firstFrame", kind: "image", path: "uploaded/first.png" },
				{ id: "last", role: "lastFrame", kind: "image", path: "uploaded/last.png" },
			],
			42,
		);

		expect(result.outputNodeId).toBe("save");
		expect(result.prompt.first.inputs.image).toBe("uploaded/first.png");
		expect(result.prompt.last.inputs.image).toBe("uploaded/last.png");
		expect(result.prompt.generate.inputs).toMatchObject({
			prompt: "camera slowly moves forward",
			first_frame: ["first", 0],
			last_frame: ["last", 0],
		});
		expect(result.prompt.resolution.inputs.aspect_ratio).toBe("16:9 (Widescreen)");
		expect(result.prompt.duration.inputs.value).toBe(10);
		expect(result.prompt.noise.inputs.noise_seed).toBe(42);
		expect(frameTemplate.first.inputs.image).toBe("old-first.png");
	});

	it("maps numbered image, video, video-audio, and audio references", () => {
		const result = adaptMinimaxWorkflow(
			referenceTemplate,
			{
				operation: "generate",
				kind: "video",
				mode: "reference-to-video",
				prompt: "use <Picture 1>, <Picture 2>, <Video 1> and <Audio 1>",
				inputs: [],
			},
			[
				{ id: "image-1", role: "referenceImages", kind: "image", path: "uploads/image-1.png" },
				{ id: "image-2", role: "referenceImages", kind: "image", path: "uploads/image-2.png" },
				{ id: "video-1", role: "referenceVideos", kind: "video", path: "uploads/video-1.mp4" },
				{ id: "audio-1", role: "referenceAudios", kind: "audio", path: "uploads/audio-1.wav" },
			],
			7,
		);

		const generator = result.prompt.generate.inputs;
		expect(generator["ref_images.ref_image_0"]).toEqual(["image", 0]);
		expect(generator["ref_images.ref_image_1"]).toEqual(["vetta_image_input_1", 0]);
		expect(generator["ref_videos.ref_video_0"]).toEqual(["video", 0]);
		expect(generator["ref_video_audios.ref_video_audio_0"]).toEqual(["video", 1]);
		expect(generator["ref_audios.ref_audio_0"]).toEqual(["audio", 0]);
		expect(result.prompt.vetta_image_input_1.inputs.image).toBe("uploads/image-2.png");
		expect(result.prompt.video.inputs.video).toBe("uploads/video-1.mp4");
		expect(result.prompt.audio.inputs.audio).toBe("uploads/audio-1.wav");
	});

	it("creates standard video and audio loaders when the reference template has no prototypes", () => {
		const result = adaptMinimaxWorkflow(
			referenceTemplateWithoutMediaLoaders,
			{
				operation: "generate",
				kind: "video",
				mode: "reference-to-video",
				prompt: "use <Video 1> and <Audio 1>",
				inputs: [],
			},
			[
				{ id: "video-1", role: "referenceVideos", kind: "video", path: "uploads/video-1.mp4" },
				{ id: "audio-1", role: "referenceAudios", kind: "audio", path: "uploads/audio-1.wav" },
			],
			7,
		);

		expect(result.prompt.vetta_video_input_1).toEqual({
			class_type: "LoadVideo",
			inputs: { file: "uploads/video-1.mp4" },
		});
		expect(result.prompt.vetta_audio_input_1).toEqual({
			class_type: "LoadAudio",
			inputs: { audio: "uploads/audio-1.wav" },
		});
		expect(result.prompt.generate.inputs).toMatchObject({
			"ref_videos.ref_video_0": ["vetta_video_input_1", 0],
			"ref_video_audios.ref_video_audio_0": ["vetta_video_input_1", 1],
			"ref_audios.ref_audio_0": ["vetta_audio_input_1", 0],
		});
	});

	it("recognizes only templates compatible with the selected mode", () => {
		expect(isCompatibleMinimaxPrompt(frameTemplate, "image-to-video")).toBe(true);
		expect(isCompatibleMinimaxPrompt(frameTemplate, "reference-to-video")).toBe(false);
		expect(isCompatibleMinimaxPrompt(referenceTemplate, "reference-to-video")).toBe(true);
	});
});
