import type { BannerConfig, BannerSlideConfig } from "../../lib/bc-design/config-types";

export type BannerSlidePreview = BannerSlideConfig & {
  desktopImagePreview?: string;
  mobileImagePreview?: string;
  videoPreview?: string;
};

export type BannerPreviewConfig = Omit<BannerConfig, "slides"> & {
  slides: BannerSlidePreview[];
};

type ComputationStatus =
  | "not_calculated"
  | "calculating"
  | "calculated"
  | "failed";

type SlideComputationState = {
  desktop: ComputationStatus;
  mobile: ComputationStatus;
};

type BannerPreviewProps = {
  config: BannerPreviewConfig;
  computationStates?: Record<string, SlideComputationState>;
};

function resolveImageUrl(slide: BannerSlidePreview) {
  if (slide.desktopImagePreview) {
    return slide.desktopImagePreview;
  }
  if (slide.desktopImage?.startsWith("http")) {
    return slide.desktopImage;
  }
  return undefined;
}

function isAdaptiveComputed(
  slide: BannerSlidePreview,
  computationStates: Record<string, SlideComputationState> | undefined,
): boolean {
  if (!computationStates) return false;
  const state = computationStates[slide.id];
  if (!state) return false;
  return (
    state.desktop === "calculated" ||
    state.desktop === "failed" ||
    state.mobile === "calculated" ||
    state.mobile === "failed"
  );
}

function getSlideClasses(
  slide: BannerSlidePreview,
  enabled: boolean,
  computed: boolean,
): string {
  if (!enabled || !computed) return "bc-banner-slide is-active";
  const desktopVariant = slide.desktopAdaptiveOverlayVariant ?? "black";
  const mobileVariant = slide.mobileAdaptiveOverlayVariant ?? desktopVariant;
  return `bc-banner-slide is-active bc-banner-slide--adaptive-enabled bc-banner-slide--adaptive-desktop-${desktopVariant} bc-banner-slide--adaptive-mobile-${mobileVariant}`;
}

function getOverlayStyle(
  slide: BannerSlidePreview,
  config: BannerPreviewConfig,
  enabled: boolean,
  computed: boolean,
): React.CSSProperties {
  const base = {
    "--bc-banner-overlay-opacity": String(config.overlayOpacity / 100),
  } as React.CSSProperties;

  if (!enabled || !computed) return base;

  return {
    ...base,
    "--bc-banner-adaptive-desktop-opacity": String(
      (slide.desktopAdaptiveOverlayOpacity ?? 30) / 100,
    ),
    "--bc-banner-adaptive-mobile-opacity": String(
      (slide.mobileAdaptiveOverlayOpacity ?? 30) / 100,
    ),
  } as React.CSSProperties;
}

export function BannerPreview({ config, computationStates }: BannerPreviewProps) {
  const firstSlide = config.slides[0];
  const imageUrl = firstSlide ? resolveImageUrl(firstSlide) : undefined;
  const enabled = config.brightnessAdaptiveOverlayEnabled;
  const computed = firstSlide
    ? isAdaptiveComputed(firstSlide, computationStates)
    : false;

  return (
    <div
      className="bc-banner-carousel"
      style={
        {
          "--bc-banner-aspect-ratio": "2.4 / 1",
          "--bc-banner-mobile-height": `${config.mobileHeight}px`,
        } as React.CSSProperties
      }
    >
      <div className="bc-banner-carousel__track">
        {firstSlide ? (
          <div
            className={getSlideClasses(firstSlide, enabled, computed)}
            aria-hidden="false"
          >
            <div
              className="bc-banner-slide__media bc-banner-slide__overlay"
              style={getOverlayStyle(firstSlide, config, enabled, computed)}
            >
              {imageUrl ? (
                <img
                  className="bc-banner-slide__image"
                  src={imageUrl}
                  alt=""
                />
              ) : null}
            </div>
            <div className="bc-banner-slide__content">
              <h2 className="bc-banner-slide__heading">{firstSlide.heading}</h2>
              <p className="bc-banner-slide__subheading">
                {firstSlide.subheading}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
