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

export function BannerPreview({ config }: BannerPreviewProps) {
  const firstSlide = config.slides[0];
  const imageUrl = firstSlide ? resolveImageUrl(firstSlide) : undefined;

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
          <div className="bc-banner-slide is-active" aria-hidden="false">
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
