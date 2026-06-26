import { describe, expect, it } from "vitest";

import {
  pendingImageIdentifier,
  resetAdaptiveOverlayForImageField,
  runLimitedBrightnessTasks,
} from "./banner-brightness";

describe("banner brightness helpers", () => {
  it("creates a changed image identifier for a pending upload before save", () => {
    const file = new File(["image"], "hero.png", {
      type: "image/png",
      lastModified: 123,
    });

    expect(
      pendingImageIdentifier("slide-1", "desktopImage", file, "selection-1"),
    ).toBe("pending-upload:slide-1:desktopImage:hero.png:5:123:selection-1");
  });

  it("uses the selection nonce to distinguish files with identical metadata", () => {
    const file = new File(["image"], "hero.png", {
      type: "image/png",
      lastModified: 123,
    });

    expect(
      pendingImageIdentifier("slide-1", "desktopImage", file, "selection-1"),
    ).not.toBe(
      pendingImageIdentifier("slide-1", "desktopImage", file, "selection-2"),
    );
  });

  it("resets stale desktop brightness when a new desktop image is pending", () => {
    expect(resetAdaptiveOverlayForImageField("desktopImage")).toEqual({
      desktopAverageBrightness: 0,
      desktopAdaptiveOverlayVariant: "black",
      desktopAdaptiveOverlayOpacity: 30,
    });
  });

  it("runs brightness tasks with a real concurrency limit and waits for completion", async () => {
    let active = 0;
    let maxActive = 0;
    let completed = 0;

    const tasks = Array.from({ length: 8 }, () => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      completed += 1;
    });

    await runLimitedBrightnessTasks(tasks, 3);

    expect(completed).toBe(8);
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
