export const NAVIGATION_CONFIG_TYPE = "$app:navigation_config";
export const NAVIGATION_CONFIG_HANDLE = "default";
export const NAVIGATION_SECOND_LEVEL_TYPE = "$app:navigation_second_level";
export const BANNER_CONFIG_TYPE = "$app:banner_config";
export const BANNER_CONFIG_HANDLE = "default";
export const BANNER_SLIDE_TYPE = "$app:banner_slide";

export const LOGO_TYPES = ["text", "image"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

export const NAVIGATION_LAYOUT_TYPES = ["product_list", "big_image"] as const;
export type NavigationLayoutType = (typeof NAVIGATION_LAYOUT_TYPES)[number];

export type NavigationSecondLevelConfig = {
  id?: string;
  level1Index: number;
  level2Index: number;
  level1Title: string;
  level2Title: string;
  layoutType: NavigationLayoutType;
  bigImage1?: string;
  bigImage2?: string;
  bigImage3?: string;
  adImage?: string;
  adUrl?: string;
};

export type NavigationConfig = {
  fixedNavigation: boolean;
  logoType: LogoType;
  logoText: string;
  logoFile?: string;
  navBackgroundColor: string;
  primaryNavTextColor: string;
  secondaryNavTextColor: string;
  iconColor: string;
  menuHandle: string;
  secondLevelConfigs: NavigationSecondLevelConfig[];
};

export type BannerSlideConfig = {
  id: string;
  title: string;
  desktopImage?: string;
  mobileImage?: string;
  video?: string;
  videoUrl?: string;
  heading: string;
  subheading: string;
  primaryButtonLabel: string;
  primaryButtonLink: string;
  secondaryButtonLabel: string;
  secondaryButtonLink: string;
};

export type BannerConfig = {
  autoplay: boolean;
  autoplaySpeed: number;
  pauseOnHover: boolean;
  showIndicators: boolean;
  mobileHeight: number;
  overlayOpacity: number;
  slides: BannerSlideConfig[];
};

export const NAVIGATION_DEFAULTS: NavigationConfig = {
  fixedNavigation: true,
  logoType: "text",
  logoText: "",
  navBackgroundColor: "#ffffff",
  primaryNavTextColor: "#7a7b7e",
  secondaryNavTextColor: "#7a7b7e",
  iconColor: "#7a7b7e",
  menuHandle: "",
  secondLevelConfigs: [],
};

export const BANNER_DEFAULTS: BannerConfig = {
  autoplay: true,
  autoplaySpeed: 5,
  pauseOnHover: true,
  showIndicators: true,
  mobileHeight: 500,
  overlayOpacity: 20,
  slides: [],
};

export function secondLevelHandle(level1Index: number, level2Index: number) {
  const l1 = String(level1Index).padStart(2, "0");
  const l2 = String(level2Index).padStart(2, "0");
  return `l1-${l1}-l2-${l2}`;
}

export function bannerSlideHandle(id: string) {
  return `slide-${id}`;
}

export function isLogoType(value: string): value is LogoType {
  return LOGO_TYPES.includes(value as LogoType);
}

export function isNavigationLayoutType(
  value: string,
): value is NavigationLayoutType {
  return NAVIGATION_LAYOUT_TYPES.includes(value as NavigationLayoutType);
}

export function sanitizeNavigationSecondLevelConfig(
  config: NavigationSecondLevelConfig,
): NavigationSecondLevelConfig {
  const base = {
    id: config.id,
    level1Index: config.level1Index,
    level2Index: config.level2Index,
    level1Title: config.level1Title,
    level2Title: config.level2Title,
    layoutType: config.layoutType,
  };

  if (config.layoutType === "big_image") {
    return {
      ...base,
      bigImage1: config.bigImage1,
      bigImage2: config.bigImage2,
      bigImage3: config.bigImage3,
    };
  }

  return {
    ...base,
    adImage: config.adImage,
    adUrl: config.adUrl ?? "",
  };
}

export function clampBannerNumber(
  field: "autoplaySpeed" | "overlayOpacity" | "mobileHeight",
  value: number,
) {
  if (field === "autoplaySpeed") return Math.min(10, Math.max(3, value));
  if (field === "overlayOpacity") return Math.min(60, Math.max(0, value));
  return Math.min(760, Math.max(360, value));
}

export function missingMetaobjectDefinitionsMessage(missing: string[]) {
  const labels = missing.map((type) => type.replace(/^\$app:/, "")).join(", ");
  return `This store is missing app metaobject definitions for the current app install (${labels}). Run "shopify app deploy --config render", then uninstall and reinstall the app on this store so Shopify syncs the definitions and new access scopes.`;
}
