import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { calculateImageBrightness } from "./image-brightness.client";

describe("calculateImageBrightness", () => {
  const originalImage = globalThis.Image;

  beforeEach(() => {
    class MockImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onload?.();
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;
    globalThis.document = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
  });

  afterEach(() => {
    globalThis.Image = originalImage;
  });

  it("returns null when image fails to load", async () => {
    class FailingMockImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onerror?.();
      }
    }

    globalThis.Image = FailingMockImage as unknown as typeof Image;
    const result = await calculateImageBrightness("invalid-url");
    expect(result).toBeNull();
  });

  it("returns null when canvas throws", async () => {
    globalThis.document = {
      createElement: () => {
        throw new Error("canvas unavailable");
      },
    } as unknown as Document;

    const result = await calculateImageBrightness("data:text/plain,not-image");
    expect(result).toBeNull();
  });

  it("appends brightness-compute query param for CORS isolation", async () => {
    let capturedSrc = "";

    class CapturingMockImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        capturedSrc = value;
        this.onload?.();
      }
    }

    globalThis.Image = CapturingMockImage as unknown as typeof Image;

    await calculateImageBrightness("https://cdn.shopify.com/image.jpg?v=123");
    expect(capturedSrc).toContain("brightness-compute=1");
    expect(capturedSrc).not.toContain("timestamp");
  });
});
