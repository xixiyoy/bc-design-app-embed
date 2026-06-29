import { adminGraphql, type AdminGraphqlClient } from "./admin-graphql.server";
import {
  type NavigationConfig,
  type BannerConfig,
  NAVIGATION_DEFAULTS,
  BANNER_DEFAULTS,
} from "./config-types";
import {
  loadNavigationConfig as loadLegacyNavigation,
  loadBannerConfig as loadLegacyBanner,
} from "./metaobjects.server";

export function extractFilename(url?: string | null): string {
  if (!url) return "";
  const cleanUrl = url.split("?")[0];
  const filename = cleanUrl.substring(cleanUrl.lastIndexOf("/") + 1);
  return filename ? decodeURIComponent(filename) : "";
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
    }
  }
`;

export async function loadNavigationConfig(admin: AdminGraphqlClient): Promise<NavigationConfig> {
  const data = await adminGraphql<{ currentAppInstallation: any }>(admin, GET_CONFIG_QUERY);
  const metafield = data.currentAppInstallation?.navigation;
  if (metafield?.jsonValue && metafield.jsonValue.migrationCompleted === true) {
    return metafield.jsonValue as NavigationConfig;
  }
  
  // Fallback migration: Query legacy metaobjects
  let config: NavigationConfig;
  let needsSave = false;

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
          if (!node) continue; // Null check to prevent TypeError
          if (node.preview?.image?.url) {
            fileUrls[node.id] = node.preview.image.url;
          }
        }
      }

      // Map filenames back to configuration
      if (legacyConfig.logoFile && fileUrls[legacyConfig.logoFile]) {
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

  if (needsSave) {
    await saveNavigationConfig(admin, config);
  }
  
  return config;
}

export async function saveNavigationConfig(admin: AdminGraphqlClient, config: NavigationConfig): Promise<void> {
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
            if (!node) continue; // Null check to prevent TypeError
            if (node.preview?.image?.url) fileUrls[node.id] = node.preview.image.url;
            if (node.sources?.[0]?.url) videoSources[node.id] = node.sources[0].url;
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

  // Progressive check: Retrieve poster URL / CDN url for processing videos
  const pendingVideoGids = config.slides
    .filter((s) => s.video && (!s.videoFileUrl || s.videoPosterUrl === undefined))
    .map((s) => s.video as string);

  if (pendingVideoGids.length > 0) {
    try {
      const filesData = await adminGraphql<any>(admin, GET_FILE_DETAILS, { ids: pendingVideoGids });
      for (const node of filesData.nodes || []) {
        if (!node) continue; // Null check to prevent TypeError
        if (node.fileStatus === "READY") {
          const slide = config.slides.find((s) => s.video === node.id);
          if (slide) {
            if (node.sources?.[0]?.url) {
              slide.videoFileUrl = node.sources[0].url;
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
  }

  if (needsSave) {
    await saveBannerConfig(admin, config);
  }

  return config;
}

export async function saveBannerConfig(admin: AdminGraphqlClient, config: BannerConfig): Promise<void> {
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
