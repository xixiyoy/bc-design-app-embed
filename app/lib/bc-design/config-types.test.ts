import { describe, expect, it } from "vitest";
import {
  BANNER_DEFAULTS,
  bannerSlideHandle,
  clampBannerNumber,
  isLogoType,
  isNavigationLayoutType,
  secondLevelHandle,
} from "./config-types";

describe("bc design config helpers", () => {
  it("creates stable second-level handles from 1-based indexes", () => {
    expect(secondLevelHandle(1, 2)).toBe("l1-01-l2-02");
  });

  it("creates banner slide handles from persisted ids", () => {
    expect(bannerSlideHandle("abc-123")).toBe("slide-abc-123");
  });

  it("guards enum values", () => {
    expect(isLogoType("text")).toBe(true);
    expect(isLogoType("image")).toBe(true);
    expect(isLogoType("photo")).toBe(false);
    expect(isNavigationLayoutType("product_list")).toBe(true);
    expect(isNavigationLayoutType("big_image")).toBe(true);
    expect(isNavigationLayoutType("none")).toBe(false);
  });

  it("keeps banner defaults aligned with the legacy theme schema", () => {
    expect(BANNER_DEFAULTS).toEqual({
      autoplay: true,
      autoplaySpeed: 5,
      pauseOnHover: true,
      showIndicators: true,
      mobileHeight: 560,
      overlayOpacity: 20,
      brightnessAdaptiveOverlayEnabled: false,
      slides: [],
    });
  });

  it("clamps banner numeric settings to legacy ranges", () => {
    expect(clampBannerNumber("autoplaySpeed", 1)).toBe(3);
    expect(clampBannerNumber("autoplaySpeed", 11)).toBe(10);
    expect(clampBannerNumber("overlayOpacity", 63)).toBe(60);
    expect(clampBannerNumber("mobileHeight", 120)).toBe(360);
    expect(clampBannerNumber("desktopAdaptiveOverlayOpacity", 80)).toBe(60);
    expect(clampBannerNumber("desktopAdaptiveOverlayOpacity", -5)).toBe(0);
    expect(clampBannerNumber("mobileAdaptiveOverlayOpacity", 45)).toBe(45);
  });
});
