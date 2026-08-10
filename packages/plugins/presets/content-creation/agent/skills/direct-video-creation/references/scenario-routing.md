# Specialized video scenario routing

Load the smallest recipe family that matches the requested motion artifact.

| User request | Primary reference | Key shape |
| --- | --- | --- |
| Seedance-style instructional prompt, multi-reference, first/last frame | `reference-role-and-timed-directing.md` | Capability check -> role manifest -> timed director brief |
| Animated logo, jewelry or product commercial | `product-brand-and-logo-video-recipes.md` | Approved still authority -> motion proof -> final shot(s) |
| Giant product or ingredient explosion | `product-brand-and-logo-video-recipes.md` | Readable impossible still -> physically directed motion |
| UGC ad, creator review, fashion performance | `character-performance-and-ugc-video-recipes.md` | Person/product composite -> script beats -> natural performance |
| Motion transfer, cartoon dance, talking character | `character-performance-and-ugc-video-recipes.md` | Identity/style anchor + motion/audio role -> coherence gate |
| Ceremony, freeze-time effect, staged social spectacle | `character-performance-and-ugc-video-recipes.md` | Role-locked references -> timecoded event -> audio arc |
| Fight or high-cut-density action | `narrative-action-and-tutorial-video-recipes.md` | geography/identity -> storyboard -> proof -> sequence |
| Character story or music video | `narrative-action-and-tutorial-video-recipes.md` | authority ledger -> ordered scene/keyframe branches -> timeline |
| Cooking or process tutorial from a person photo | `narrative-action-and-tutorial-video-recipes.md` | identity anchor + action/environment board -> video proof |
| Drone, aerial, one-shot, FPV/flythrough | `camera-social-and-clipping-video-recipes.md` | path + destination + physical camera constraints |
| Brand-aware platform social video | `camera-social-and-clipping-video-recipes.md` | brand read -> post/storyboard -> platform-native director brief |
| Long video to Shorts/Reels/TikTok | `camera-social-and-clipping-video-recipes.md` | transcript/candidates -> rank/dedupe -> crop/timeline -> audit |

## Selection rules

- A named visual effect does not replace a shot plan. Define event, camera, sound, and final state.
- A multi-shot request becomes separate shot nodes and timeline clips unless inspected capabilities explicitly support multi-shot direction in one generation.
- A provider-specific recipe is a behavioral pattern, not permission to select an unavailable model or endpoint.
- When the current graph cannot transcribe, rank highlights, render audio, or perform motion transfer, preserve the upstream plan and surface the missing production step instead of pretending it ran.

