import type { BannerConfig, BannerSlideConfig } from "../../lib/bc-design/config-types";

export type BannerSlidePreview = BannerSlideConfig & {
  desktopImagePreview?: string;
  mobileImagePreview?: string;
  videoPreview?: string;
};

export type BannerPreviewConfig = Omit<BannerConfig, "slides"> & {
  slides: BannerSlidePreview[];
};

type BannerPreviewProps = {
  config: BannerPreviewConfig;
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

function getSlideClasses(slide: BannerSlidePreview, enabled: boolean): string {
  if (!enabled) return "bc-banner-slide is-active";
  const desktopVariant = slide.desktopAdaptiveOverlayVariant ?? "black";
  const mobileVariant = slide.mobileAdaptiveOverlayVariant ?? desktopVariant;
  return `bc-banner-slide is-active bc-banner-slide--adaptive-enabled bc-banner-slide--adaptive-desktop-${desktopVariant} bc-banner-slide--adaptive-mobile-${mobileVariant}`;
}

function getSlideStyle(slide: BannerSlidePreview, enabled: boolean): React.CSSProperties {
  const base: React.CSSProperties = {};
  if (!enabled) return base;
  const desktopOpacity = ((slide.desktopAdaptiveOverlayOpacity ?? 30) / 100).toString();
  const mobileOpacity = ((slide.mobileAdaptiveOverlayOpacity ?? 30) / 100).toString();
  return {
    "--bc-banner-adaptive-desktop-opacity": desktopOpacity,
    "--bc-banner-adaptive-mobile-opacity": mobileOpacity,
  } as React.CSSProperties;
}

export function BannerPreview({ config }: BannerPreviewProps) {
  const firstSlide = config.slides[0];
  const imageUrl = firstSlide ? resolveImageUrl(firstSlide) : undefined;
  const enabled = config.brightnessAdaptiveOverlayEnabled;

  return (
    <div
      className="bc-banner-carousel"
      style={
        {
          "--bc-banner-aspect-ratio": "2.4 / 1",
          "--bc-banner-mobile-height": `${config.mobileHeight}px`,
          "--bc-banner-overlay-opacity": String(config.overlayOpacity / 100),
        } as React.CSSProperties
      }
    >
      <div className="bc-banner-carousel__track">
        {firstSlide ? (
          <div
            className={getSlideClasses(firstSlide, enabled)}
            style={getSlideStyle(firstSlide, enabled)}
            aria-hidden="false"
          >
            <div className="bc-banner-slide__media">
              {imageUrl ? (
                <img
                  className="bc-banner-slide__image"
                  src={imageUrl}
                  alt=""
                />
              ) : null}
              <div className="bc-banner-slide__overlay" />
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
