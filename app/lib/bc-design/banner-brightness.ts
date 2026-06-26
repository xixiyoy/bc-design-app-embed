import type { BannerSlideConfig } from "./config-types";

const PENDING_UPLOAD_PREFIX = "pending-upload";
const ADAPTIVE_OVERLAY_FALLBACK_OPACITY = 30;

type SlideImageField = "desktopImage" | "mobileImage";

export type BrightnessTask = () => Promise<void> | void;

export function pendingImageIdentifier(
  slideId: string,
  field: SlideImageField,
  file: File,
  selectionNonce: string,
) {
  return [
    PENDING_UPLOAD_PREFIX,
    slideId,
    field,
    file.name,
    file.size,
    file.lastModified,
    selectionNonce,
  ].join(":");
}

export function resetAdaptiveOverlayForImageField(
  field: SlideImageField,
): Partial<BannerSlideConfig> {
  if (field === "desktopImage") {
    return {
      desktopAverageBrightness: 0,
      desktopAdaptiveOverlayVariant: "black",
      desktopAdaptiveOverlayOpacity: ADAPTIVE_OVERLAY_FALLBACK_OPACITY,
    };
  }

  return {
    mobileAverageBrightness: 0,
    mobileAdaptiveOverlayVariant: "black",
    mobileAdaptiveOverlayOpacity: ADAPTIVE_OVERLAY_FALLBACK_OPACITY,
  };
}

export async function runLimitedBrightnessTasks(
  tasks: BrightnessTask[],
  limit: number,
) {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), tasks.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < tasks.length) {
        const task = tasks[nextIndex++];
        await task();
      }
    }),
  );
}
