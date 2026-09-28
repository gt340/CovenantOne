// Media decision engine (Phase 16 amendment §8-§11). The language model is
// NEVER allowed to trigger generation directly. Whether media is produced is
// decided here, deterministically, from: the configured mode, the member's
// explicit request, provider availability, account state, and the safety scan.
// Generation additionally has to pass server-side rate limiting.
//
// Modes:
//   OFF              no media, ever
//   SELECTIVE        images only when the member explicitly asks for one
//   IMAGE            explicit images, plus an *offer* button on teaching topics
//   IMAGE_AND_VIDEO  as IMAGE, and explicit video requests are allowed
// An "offer" only shows a button; it never generates anything by itself.

export type MediaMode = "OFF" | "SELECTIVE" | "IMAGE" | "IMAGE_AND_VIDEO";
export const MEDIA_MODES: MediaMode[] = ["OFF", "SELECTIVE", "IMAGE", "IMAGE_AND_VIDEO"];

export type MediaDecision = {
  shouldGenerateImage: boolean;
  shouldGenerateVideo: boolean;
  offerImage: boolean;
  reason: string;
  requestedFormat: "none" | "image" | "video";
  estimatedCostTier: "NONE" | "LOW" | "HIGH";
};

export type MediaDecisionInput = {
  message: string;
  topic: string;
  mode: MediaMode;
  imageReady: boolean;
  videoReady: boolean;
  safetyTriggered: boolean;
  accountActive: boolean;
  /** Set by the media endpoint, where clicking a button IS the explicit request. */
  explicit?: "image" | "video";
};

const IMAGE_REQUEST =
  /\b(illustrat\w*|artwork|drawing|infographic)\b|\b(create|generate|make|draw|produce|show me|give me)\b.{0,40}\b(image|picture|graphic|visual|diagram)\b/i;
const VIDEO_REQUEST =
  /\b(create|generate|make|produce|turn)\b.{0,60}\b(video|animation|animated)\b|\b(video|animated)\s+(lesson|introduction|version)\b/i;

const NONE = (reason: string, requestedFormat: MediaDecision["requestedFormat"] = "none"): MediaDecision => ({
  shouldGenerateImage: false,
  shouldGenerateVideo: false,
  offerImage: false,
  reason,
  requestedFormat,
  estimatedCostTier: "NONE",
});

export function decideMedia(input: MediaDecisionInput): MediaDecision {
  const wantsVideo = input.explicit === "video" || (!input.explicit && VIDEO_REQUEST.test(input.message));
  const wantsImage = input.explicit === "image" || (!input.explicit && !wantsVideo && IMAGE_REQUEST.test(input.message));
  const requested: MediaDecision["requestedFormat"] = wantsVideo ? "video" : wantsImage ? "image" : "none";

  if (!input.accountActive) return NONE("ACCOUNT_NOT_ACTIVE", requested);
  if (input.safetyTriggered) return NONE("SAFETY_BOUNDARY", requested);
  if (input.mode === "OFF") return NONE("MEDIA_MODE_OFF", requested);

  if (wantsVideo) {
    if (input.mode !== "IMAGE_AND_VIDEO") return NONE("VIDEO_NOT_ENABLED", "video");
    if (!input.videoReady) return NONE("VIDEO_PROVIDER_NOT_READY", "video");
    return { ...NONE("EXPLICIT_VIDEO_REQUEST", "video"), shouldGenerateVideo: true, estimatedCostTier: "HIGH" };
  }

  if (wantsImage) {
    if (!input.imageReady) return NONE("IMAGE_PROVIDER_NOT_READY", "image");
    return { ...NONE("EXPLICIT_IMAGE_REQUEST", "image"), shouldGenerateImage: true, estimatedCostTier: "LOW" };
  }

  if ((input.mode === "IMAGE" || input.mode === "IMAGE_AND_VIDEO") && input.imageReady && input.topic !== "GENERAL") {
    return { ...NONE("OFFER_ONLY"), offerImage: true };
  }
  return NONE("NO_MEDIA_REQUESTED");
}

export const AI_MEDIA_LABEL = {
  IMAGE: "AI-generated illustration — not a historical depiction",
  VIDEO: "AI-generated video — an illustration, not a historical depiction",
} as const;

export function sanitizeSubject(subject: string): string {
  return subject.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

const GUARDRAIL =
  "Style: respectful, symbolic, painterly illustration for a Christian educational lesson. Include no text or captions. " +
  "Do not depict God or Jesus with a realistic face; use symbolic or indirect imagery instead (light, silhouettes, hands, scenery). " +
  "This is an artistic illustration, not a historical depiction.";

export function buildImagePrompt(subject: string): string {
  return `Create an illustration. Subject: ${sanitizeSubject(subject)}. ${GUARDRAIL}`;
}

export function buildVideoPrompt(subject: string): string {
  return `Create a short, calm educational video. Subject: ${sanitizeSubject(subject)}. ${GUARDRAIL}`;
}
