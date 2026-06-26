import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { calculateImageBrightness } from "./image-brightness.client";

describe("calculateImageBrightness", () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;

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
    globalThis.document = originalDocument;
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

  it("returns null when document.createElement throws", async () => {
    globalThis.document = {
      createElement: () => {
        throw new Error("canvas unavailable");
      },
    } as unknown as Document;

    const result = await calculateImageBrightness("data:text/plain,not-image");
    expect(result).toBeNull();
  });

  it("returns null when canvas context is unavailable", async () => {
    globalThis.document = {
      createElement: () => ({
        getContext: () => null,
      }),
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

  it("appends width=100 for Shopify CDN URLs and omits it for non-Shopify URLs", async () => {
    const capturedSrcs: string[] = [];

    class CapturingMockImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        capturedSrcs.push(value);
        this.onload?.();
      }
    }

    globalThis.Image = CapturingMockImage as unknown as typeof Image;

    await calculateImageBrightness("https://cdn.shopify.com/image.jpg?v=123");
    await calculateImageBrightness("https://example.com/image.jpg?v=123");

    expect(capturedSrcs[0]).toContain("width=100");
    expect(capturedSrcs[1]).not.toContain("width=100");
  });
});
