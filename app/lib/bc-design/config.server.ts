import { adminGraphql, type AdminGraphqlClient } from "./admin-graphql.server";
import {
  type NavigationConfig,
  type BannerConfig,
  type ProductDetailConfig,
  type ProductDetailGlobalModeConfig,
  type ProductDetailGlobalMode,
  type ProductOptionIconConfig,
  NAVIGATION_DEFAULTS,
  BANNER_DEFAULTS,
  PRODUCT_DETAIL_DEFAULTS,
  PRODUCT_DETAIL_GLOBAL_MODE_DEFAULTS,
} from "./config-types";
import {
  loadNavigationConfig as loadLegacyNavigation,
  loadBannerConfig as loadLegacyBanner,
} from "./metaobjects.server";

const SHOPIFY_FILE_SIZE_SUFFIXES = [
  "_pico",
  "_icon",
  "_thumb",
  "_small",
  "_compact",
  "_medium",
  "_large",
  "_grande",
  "_original",
  "_master",
] as const;

export function normalizeShopifyFileFilename(filename: string): string {
  if (!filename) return "";
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1) return filename;

  const base = filename.slice(0, dotIndex);
  const ext = filename.slice(dotIndex);
  for (const suffix of SHOPIFY_FILE_SIZE_SUFFIXES) {
    if (base.endsWith(suffix)) {
      return base.slice(0, -suffix.length) + ext;
    }
  }
  return filename;
}

export function extractFilename(url?: string | null): string {
  if (!url) return "";
  const cleanUrl = url.split("?")[0];
  const filename = cleanUrl.substring(cleanUrl.lastIndexOf("/") + 1);
  return filename
    ? normalizeShopifyFileFilename(decodeURIComponent(filename))
    : "";
}

function shopifyFileFilenameNeedsResolution(filename?: string): boolean {
  if (!filename) return true;
  return normalizeShopifyFileFilename(filename) !== filename;
}

type ImageFileNode = {
  id?: string;
  image?: { url?: string | null } | null;
  preview?: { image?: { url?: string | null } | null } | null;
};

export function imageFileUrlFromNode(node: ImageFileNode): string | undefined {
  return node.image?.url ?? node.preview?.image?.url ?? undefined;
}

type FileNodeWithVideoUrl = {
  id?: string;
  fileStatus?: string;
  url?: string | null;
  sources?: Array<{ url?: string | null }> | null;
  preview?: { image?: { url?: string | null } | null } | null;
};

export function videoFileUrlFromNode(node: FileNodeWithVideoUrl): string | undefined {
  return node.sources?.[0]?.url ?? node.url ?? undefined;
}

export const GET_CONFIG_QUERY = `#graphql
  query BcDesignGetConfig {
    currentAppInstallation {
      id
      navigation: metafield(namespace: "$app", key: "navigation_config") {
        jsonValue
      }
      banner: metafield(namespace: "$app", key: "banner_config") {
        jsonValue
      }
    }
  }
`;

export const GET_APP_ID_QUERY = `#graphql
  query BcDesignGetAppId {
    currentAppInstallation {
      id
    }
  }
`;

export const SET_CONFIG_MUTATION = `#graphql
  mutation BcDesignSetConfig($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        key
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const GET_FILE_DETAILS = `#graphql
  query BcDesignGetFileDetails($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on File {
        id
        fileStatus
        ... on MediaImage {
          image {
            url
          }
        }
        preview {
          image {
            url
          }
        }
      }
      ... on Video {
        id
        fileStatus
        sources {
          url
        }
        preview {
          image {
            url
          }
        }
      }
      ... on GenericFile {
        id
        fileStatus
        url
        preview {
          image {
            url
          }
        }
      }
    }
  }
`;

async function resolveBannerSlideImageFilenames(
  admin: AdminGraphqlClient,
  config: BannerConfig,
): Promise<boolean> {
  const pendingGids = new Set<string>();
  for (const slide of config.slides) {
    if (slide.desktopImage && !slide.desktopImageFilename) {
      pendingGids.add(slide.desktopImage);
    }
    if (slide.mobileImage && !slide.mobileImageFilename) {
      pendingGids.add(slide.mobileImage);
    }
  }
  if (pendingGids.size === 0) return false;

  let needsSave = false;
  try {
    const filesData = await adminGraphql<any>(admin, GET_FILE_DETAILS, {
      ids: [...pendingGids],
    });
    const fileUrls: Record<string, string> = {};
    for (const node of filesData.nodes || []) {
      const imageUrl = imageFileUrlFromNode(node);
      if (!node?.id || !imageUrl) continue;
      fileUrls[node.id] = imageUrl;
    }

    for (const slide of config.slides) {
      if (
        slide.desktopImage &&
        !slide.desktopImageFilename &&
        fileUrls[slide.desktopImage]
      ) {
        slide.desktopImageFilename = extractFilename(fileUrls[slide.desktopImage]);
        needsSave = true;
      }
      if (
        slide.mobileImage &&
        !slide.mobileImageFilename &&
        fileUrls[slide.mobileImage]
      ) {
        slide.mobileImageFilename = extractFilename(fileUrls[slide.mobileImage]);
        needsSave = true;
      }
    }
  } catch (e) {
    console.warn("Failed to resolve banner slide image filenames", e);
  }

  return needsSave;
}

async function resolveNavigationImageFilenames(
  admin: AdminGraphqlClient,
  config: NavigationConfig,
): Promise<boolean> {
  const pendingGids = new Set<string>();

  if (
    config.logoFile &&
    (!config.logoFileUrl ||
      shopifyFileFilenameNeedsResolution(config.logoFileFilename))
  ) {
    pendingGids.add(config.logoFile);
  }

  for (const child of config.secondLevelConfigs ?? []) {
    const imageFields = [
      ["bigImage1", "bigImage1Filename"],
      ["bigImage2", "bigImage2Filename"],
      ["bigImage3", "bigImage3Filename"],
      ["adImage", "adImageFilename"],
    ] as const;

    for (const [gidKey, filenameKey] of imageFields) {
      const gid = child[gidKey];
      if (gid && !child[filenameKey]) {
        pendingGids.add(gid);
      }
    }
  }

  if (pendingGids.size === 0) return false;

  let needsSave = false;
  try {
    const filesData = await adminGraphql<any>(admin, GET_FILE_DETAILS, {
      ids: [...pendingGids],
    });
    const fileUrls: Record<string, string> = {};
    for (const node of filesData.nodes || []) {
      const imageUrl = imageFileUrlFromNode(node);
      if (!node?.id || !imageUrl) continue;
      fileUrls[node.id] = imageUrl;
    }

    if (config.logoFile && fileUrls[config.logoFile]) {
      const logoImageUrl = fileUrls[config.logoFile];
      if (logoImageUrl !== config.logoFileUrl) {
        config.logoFileUrl = logoImageUrl;
        needsSave = true;
      }
      const resolvedLogoFilename = extractFilename(logoImageUrl);
      if (
        resolvedLogoFilename &&
        resolvedLogoFilename !== config.logoFileFilename
      ) {
        config.logoFileFilename = resolvedLogoFilename;
        needsSave = true;
      }
    }

    for (const child of config.secondLevelConfigs ?? []) {
      if (child.bigImage1 && !child.bigImage1Filename && fileUrls[child.bigImage1]) {
        child.bigImage1Filename = extractFilename(fileUrls[child.bigImage1]);
        needsSave = true;
      }
      if (child.bigImage2 && !child.bigImage2Filename && fileUrls[child.bigImage2]) {
        child.bigImage2Filename = extractFilename(fileUrls[child.bigImage2]);
        needsSave = true;
      }
      if (child.bigImage3 && !child.bigImage3Filename && fileUrls[child.bigImage3]) {
        child.bigImage3Filename = extractFilename(fileUrls[child.bigImage3]);
        needsSave = true;
      }
      if (child.adImage && !child.adImageFilename && fileUrls[child.adImage]) {
        child.adImageFilename = extractFilename(fileUrls[child.adImage]);
        needsSave = true;
      }
    }
  } catch (e) {
    console.warn("Failed to resolve navigation image filenames", e);
  }

  return needsSave;
}

export async function resolvePendingBannerVideoUrls(
  admin: AdminGraphqlClient,
  config: BannerConfig,
): Promise<boolean> {
  const pendingVideoGids = config.slides
    .filter((s) => s.video && (!s.videoFileUrl || s.videoPosterUrl === undefined))
    .map((s) => s.video as string);

  if (pendingVideoGids.length === 0) return false;

  let needsSave = false;
  try {
    const filesData = await adminGraphql<any>(admin, GET_FILE_DETAILS, {
      ids: pendingVideoGids,
    });
    for (const node of filesData.nodes || []) {
      if (!node) continue;
      if (node.fileStatus === "READY") {
        const slide = config.slides.find((s) => s.video === node.id);
        if (slide) {
          const resolvedVideoUrl = videoFileUrlFromNode(node);
          if (resolvedVideoUrl) {
            slide.videoFileUrl = resolvedVideoUrl;
            needsSave = true;
          }
          slide.videoPosterUrl = node.preview?.image?.url || "";
          needsSave = true;
        }
      }
    }
  } catch (e) {
    console.warn("Failed to progressively query READY video files", e);
  }

  return needsSave;
}

export async function loadNavigationConfig(admin: AdminGraphqlClient): Promise<NavigationConfig> {
  const data = await adminGraphql<{ currentAppInstallation: any }>(admin, GET_CONFIG_QUERY);
  const metafield = data.currentAppInstallation?.navigation;

  let config: NavigationConfig;
  let needsSave = false;

  if (metafield?.jsonValue && metafield.jsonValue.migrationCompleted === true) {
    config = metafield.jsonValue as NavigationConfig;
  } else {
  // Fallback migration: Query legacy metaobjects

  try {
    const legacyConfig = await loadLegacyNavigation(admin);
    if (legacyConfig && (
      legacyConfig.menuHandle ||
      legacyConfig.logoText ||
      (legacyConfig.secondLevelConfigs && legacyConfig.secondLevelConfigs.length > 0) ||
      legacyConfig.logoFile
    )) {
      // Collect GIDs to resolve filenames
      const gids: string[] = [];
      if (legacyConfig.logoFile) gids.push(legacyConfig.logoFile);
      if (legacyConfig.secondLevelConfigs) {
        for (const child of legacyConfig.secondLevelConfigs) {
          if (child.bigImage1) gids.push(child.bigImage1);
          if (child.bigImage2) gids.push(child.bigImage2);
          if (child.bigImage3) gids.push(child.bigImage3);
          if (child.adImage) gids.push(child.adImage);
        }
      }

      let fileUrls: Record<string, string> = {};
      if (gids.length > 0) {
        const filesData = await adminGraphql<any>(admin, GET_FILE_DETAILS, { ids: gids });
        for (const node of filesData.nodes || []) {
          if (!node) continue;
          const imageUrl = imageFileUrlFromNode(node);
          if (imageUrl) {
            fileUrls[node.id] = imageUrl;
          }
        }
      }

      // Map filenames back to configuration
      if (legacyConfig.logoFile && fileUrls[legacyConfig.logoFile]) {
        legacyConfig.logoFileUrl = fileUrls[legacyConfig.logoFile];
        legacyConfig.logoFileFilename = extractFilename(fileUrls[legacyConfig.logoFile]);
      }
      if (legacyConfig.secondLevelConfigs) {
        for (const child of legacyConfig.secondLevelConfigs) {
          if (child.bigImage1 && fileUrls[child.bigImage1]) child.bigImage1Filename = extractFilename(fileUrls[child.bigImage1]);
          if (child.bigImage2 && fileUrls[child.bigImage2]) child.bigImage2Filename = extractFilename(fileUrls[child.bigImage2]);
          if (child.bigImage3 && fileUrls[child.bigImage3]) child.bigImage3Filename = extractFilename(fileUrls[child.bigImage3]);
          if (child.adImage && fileUrls[child.adImage]) child.adImageFilename = extractFilename(fileUrls[child.adImage]);
        }
      }

      config = { ...legacyConfig, migrationCompleted: true };
      needsSave = true;
    } else {
      config = { ...NAVIGATION_DEFAULTS, migrationCompleted: true };
      needsSave = true;
    }
  } catch (e) {
    console.warn("Failed to migrate legacy navigation config, retrying next time", e);
    // Catch branch: return defaults WITHOUT setting migrationCompleted to true and WITHOUT saving
    return { ...NAVIGATION_DEFAULTS };
  }
  }

  if (await resolveNavigationImageFilenames(admin, config)) {
    needsSave = true;
  }

  if (needsSave) {
    await saveNavigationConfig(admin, config);
  }

  return config;
}

export async function saveNavigationConfig(admin: AdminGraphqlClient, config: NavigationConfig): Promise<void> {
  await resolveNavigationImageFilenames(admin, config);
  const idData = await adminGraphql<{ currentAppInstallation: { id: string } }>(admin, GET_APP_ID_QUERY);
  const ownerId = idData.currentAppInstallation.id;
  
  const payload = { ...config, migrationCompleted: true };
  const result = await adminGraphql<any>(admin, SET_CONFIG_MUTATION, {
    metafields: [
      {
        ownerId,
        namespace: "$app",
        key: "navigation_config",
        type: "json",
        value: JSON.stringify(payload),
      },
    ],
  });
  if (result.metafieldsSet.userErrors?.length > 0) {
    throw new Error(JSON.stringify(result.metafieldsSet.userErrors));
  }
}

export async function loadBannerConfig(admin: AdminGraphqlClient): Promise<BannerConfig> {
  const data = await adminGraphql<{ currentAppInstallation: any }>(admin, GET_CONFIG_QUERY);
  const metafield = data.currentAppInstallation?.banner;
  
  let config: BannerConfig;
  let needsSave = false;

  if (metafield?.jsonValue && metafield.jsonValue.migrationCompleted === true) {
    config = metafield.jsonValue as BannerConfig;
  } else {
    // Fallback migration: Query legacy banner metaobjects
    try {
      const legacyConfig = await loadLegacyBanner(admin);
      if (legacyConfig && legacyConfig.slides && legacyConfig.slides.length > 0) {
        // Resolve filenames/URLs
        const gids: string[] = [];
        for (const slide of legacyConfig.slides) {
          if (slide.desktopImage) gids.push(slide.desktopImage);
          if (slide.mobileImage) gids.push(slide.mobileImage);
          if (slide.video) gids.push(slide.video);
        }

        let fileUrls: Record<string, string> = {};
        let videoSources: Record<string, string> = {};
        if (gids.length > 0) {
          const filesData = await adminGraphql<any>(admin, GET_FILE_DETAILS, { ids: gids });
          for (const node of filesData.nodes || []) {
            if (!node) continue;
            const imageUrl = imageFileUrlFromNode(node);
            if (imageUrl) fileUrls[node.id] = imageUrl;
            const resolvedVideoUrl = videoFileUrlFromNode(node);
            if (resolvedVideoUrl) videoSources[node.id] = resolvedVideoUrl;
          }
        }

        for (const slide of legacyConfig.slides) {
          if (slide.desktopImage && fileUrls[slide.desktopImage]) {
            slide.desktopImageFilename = extractFilename(fileUrls[slide.desktopImage]);
          }
          if (slide.mobileImage && fileUrls[slide.mobileImage]) {
            slide.mobileImageFilename = extractFilename(fileUrls[slide.mobileImage]);
          }
          if (slide.video) {
            if (videoSources[slide.video]) slide.videoFileUrl = videoSources[slide.video];
            if (fileUrls[slide.video]) slide.videoPosterUrl = fileUrls[slide.video];
          }
        }

        config = { ...legacyConfig, migrationCompleted: true };
        needsSave = true;
      } else {
        config = { ...BANNER_DEFAULTS, migrationCompleted: true };
        needsSave = true;
      }
    } catch (e) {
      console.warn("Failed to migrate legacy banner config, retrying next time", e);
      // Catch branch: return defaults WITHOUT setting migrationCompleted to true and WITHOUT saving
      return { ...BANNER_DEFAULTS };
    }
  }

  if (await resolvePendingBannerVideoUrls(admin, config)) {
    needsSave = true;
  }

  if (await resolveBannerSlideImageFilenames(admin, config)) {
    needsSave = true;
  }

  if (needsSave) {
    await saveBannerConfig(admin, config);
  }

  return config;
}

export async function saveBannerConfig(admin: AdminGraphqlClient, config: BannerConfig): Promise<void> {
  await resolvePendingBannerVideoUrls(admin, config);
  await resolveBannerSlideImageFilenames(admin, config);
  const idData = await adminGraphql<{ currentAppInstallation: { id: string } }>(admin, GET_APP_ID_QUERY);
  const ownerId = idData.currentAppInstallation.id;

  const payload = { ...config, migrationCompleted: true };
  const result = await adminGraphql<any>(admin, SET_CONFIG_MUTATION, {
    metafields: [
      {
        ownerId,
        namespace: "$app",
        key: "banner_config",
        type: "json",
        value: JSON.stringify(payload),
      },
    ],
  });
  if (result.metafieldsSet.userErrors?.length > 0) {
    throw new Error(JSON.stringify(result.metafieldsSet.userErrors));
  }
}

const GET_PRODUCT_DETAIL_CONFIG_QUERY = `#graphql
  query BcDesignGetProductDetailConfig($id: ID!) {
    product(id: $id) {
      id
      metafield(namespace: "$app", key: "product_detail_config") {
        jsonValue
      }
    }
  }
`;

const GET_PRODUCT_DETAIL_GLOBAL_MODE_QUERY = `#graphql
  query BcDesignGetProductDetailGlobalMode {
    currentAppInstallation {
      id
      metafield(namespace: "$app", key: "product_detail_global_mode") {
        jsonValue
      }
    }
  }
`;

export async function loadProductDetailConfig(
  admin: AdminGraphqlClient,
  productId: string,
): Promise<ProductDetailConfig> {
  const data = await adminGraphql<any>(admin, GET_PRODUCT_DETAIL_CONFIG_QUERY, { id: productId });
  const jsonValue = data.product?.metafield?.jsonValue;
  if (!jsonValue) {
    return { ...PRODUCT_DETAIL_DEFAULTS };
  }
  return sanitizeProductDetailConfig(jsonValue);
}

export async function saveProductDetailConfig(
  admin: AdminGraphqlClient,
  productId: string,
  config: ProductDetailConfig,
): Promise<void> {
  const result = await adminGraphql<any>(admin, SET_CONFIG_MUTATION, {
    metafields: [
      {
        ownerId: productId,
        namespace: "$app",
        key: "product_detail_config",
        type: "json",
        value: JSON.stringify(config),
      },
    ],
  });
  if (result.metafieldsSet.userErrors?.length > 0) {
    throw new Error(JSON.stringify(result.metafieldsSet.userErrors));
  }
}

export async function loadProductDetailGlobalModeConfig(
  admin: AdminGraphqlClient,
): Promise<ProductDetailGlobalModeConfig> {
  const data = await adminGraphql<any>(admin, GET_PRODUCT_DETAIL_GLOBAL_MODE_QUERY);
  const jsonValue = data.currentAppInstallation?.metafield?.jsonValue;
  if (!jsonValue || !jsonValue.mode) {
    return { ...PRODUCT_DETAIL_GLOBAL_MODE_DEFAULTS };
  }
  const mode = jsonValue.mode;
  const validModes: ProductDetailGlobalMode[] = ["off", "all_on", "per_product"];
  if (!validModes.includes(mode)) {
    return { ...PRODUCT_DETAIL_GLOBAL_MODE_DEFAULTS };
  }
  return { mode };
}

export async function saveProductDetailGlobalModeConfig(
  admin: AdminGraphqlClient,
  config: ProductDetailGlobalModeConfig,
): Promise<void> {
  const idData = await adminGraphql<{ currentAppInstallation: { id: string } }>(admin, GET_APP_ID_QUERY);
  const ownerId = idData.currentAppInstallation.id;
  const result = await adminGraphql<any>(admin, SET_CONFIG_MUTATION, {
    metafields: [
      {
        ownerId,
        namespace: "$app",
        key: "product_detail_global_mode",
        type: "json",
        value: JSON.stringify(config),
      },
    ],
  });
  if (result.metafieldsSet.userErrors?.length > 0) {
    throw new Error(JSON.stringify(result.metafieldsSet.userErrors));
  }
}

export function sanitizeProductDetailConfig(raw: unknown): ProductDetailConfig {
  if (typeof raw !== "object" || raw === null) {
    return { ...PRODUCT_DETAIL_DEFAULTS };
  }
  const r = raw as Record<string, unknown>;

  const sanitizeOptionIcons = (icons: unknown): ProductOptionIconConfig[] => {
    if (!Array.isArray(icons)) return [];
    return icons
      .filter((icon): icon is Record<string, unknown> => typeof icon === "object" && icon !== null)
      .map((icon) => ({
        optionName: String(icon.optionName ?? ""),
        optionValue: String(icon.optionValue ?? ""),
        iconGid: icon.iconGid ? String(icon.iconGid) : undefined,
        iconFilename: icon.iconFilename ? String(icon.iconFilename) : undefined,
      }));
  };

  return {
    enabled: Boolean(r.enabled),
    three60BadgeImage: r.three60BadgeImage ? String(r.three60BadgeImage) : undefined,
    three60BadgeImageFilename: r.three60BadgeImageFilename ? String(r.three60BadgeImageFilename) : undefined,
    playButtonImage: r.playButtonImage ? String(r.playButtonImage) : undefined,
    playButtonImageFilename: r.playButtonImageFilename ? String(r.playButtonImageFilename) : undefined,
    zoomButtonImage: r.zoomButtonImage ? String(r.zoomButtonImage) : undefined,
    zoomButtonImageFilename: r.zoomButtonImageFilename ? String(r.zoomButtonImageFilename) : undefined,
    tab3dImage: r.tab3dImage ? String(r.tab3dImage) : undefined,
    tab3dImageFilename: r.tab3dImageFilename ? String(r.tab3dImageFilename) : undefined,
    tabPartsImage: r.tabPartsImage ? String(r.tabPartsImage) : undefined,
    tabPartsImageFilename: r.tabPartsImageFilename ? String(r.tabPartsImageFilename) : undefined,
    tabVideoImage: r.tabVideoImage ? String(r.tabVideoImage) : undefined,
    tabVideoImageFilename: r.tabVideoImageFilename ? String(r.tabVideoImageFilename) : undefined,
    subtitle: r.subtitle ? String(r.subtitle) : undefined,
    rating: typeof r.rating === "number" ? r.rating : undefined,
    ratingImage: r.ratingImage ? String(r.ratingImage) : undefined,
    ratingImageFilename: r.ratingImageFilename ? String(r.ratingImageFilename) : undefined,
    features: Array.isArray(r.features) ? r.features.filter((f): f is string => typeof f === "string") : [],
    optionIcons: sanitizeOptionIcons(r.optionIcons),
    qtyMinusImage: r.qtyMinusImage ? String(r.qtyMinusImage) : undefined,
    qtyMinusImageFilename: r.qtyMinusImageFilename ? String(r.qtyMinusImageFilename) : undefined,
    qtyPlusImage: r.qtyPlusImage ? String(r.qtyPlusImage) : undefined,
    qtyPlusImageFilename: r.qtyPlusImageFilename ? String(r.qtyPlusImageFilename) : undefined,
    addToCartText: r.addToCartText ? String(r.addToCartText) : PRODUCT_DETAIL_DEFAULTS.addToCartText,
  };
}
