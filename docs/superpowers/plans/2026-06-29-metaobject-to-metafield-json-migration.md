# Metaobjects to Metafields JSON Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the store configuration from legacy custom Shopify Metaobjects to AppInstallation JSON Metafields, simplifying codebase complexity and improving reliability.

**Architecture:** We will deploy in two phases. In Phase 1, we will declare new AppInstallation Metafield definitions while keeping legacy Metaobject permissions. The server logic will handle idempotent migration fallbacks using a `migrationCompleted: true` schema flag, calling legacy loaders from `metaobjects.server.ts` before writing to the new metafield. Shopify hosted videos will store both the resolved video CDN URL and the preview poster URL. Storefront Liquid templates will retrieve media using native `file_img_url` filters on filenames, handcrafting the responsive `srcset` to prevent performance regression.

**Tech Stack:** Shopify CLI, GraphQL Admin API (2026-04), React Router / Remix, Liquid Templating, Vitest.

## Global Constraints
- Target GID format: `gid://shopify/AppInstallation/<id>`
- Liquid App namespace: `app.metafields.app.<key>.value`
- GraphQL App namespace: `metafield(namespace: "$app", key: "<key>")`
- Access Scopes (Phase 1): MUST include `write_metafields`, `read_metafields`, `read_metaobjects`, `read_metaobject_definitions`.

---

### Task 1: Update Configuration TOML Files (Phase 1)

**Files:**
- Modify: `shopify.app.toml`
- Modify: `shopify.app.localhost.toml`
- Modify: `shopify.app.render.toml`

**Interfaces:**
- Produces: AppInstallation metafield definitions `navigation_config` and `banner_config` under `$app` namespace. Keeps legacy Metaobjects definitions for safe data extraction during fallback phase.

- [ ] **Step 1: Modify shopify.app.toml**
  Edit `shopify.app.toml` to add the new `[app.metafields]` sections and update `scopes`. Keep the `[metaobjects.app...]` sections.
  ```toml
  # In shopify.app.toml
  scopes = "write_products,write_metafields,read_metafields,read_metaobjects,read_metaobject_definitions,read_online_store_navigation,write_files"

  [app.metafields.app.navigation_config]
  name = "Navigation Configuration"
  type = "json"
  access.admin = "merchant_read_write"
  access.storefront = "public_read"

  [app.metafields.app.banner_config]
  name = "Banner Configuration"
  type = "json"
  access.admin = "merchant_read_write"
  access.storefront = "public_read"
  ```

- [ ] **Step 2: Modify shopify.app.localhost.toml**
  Apply the exact same scopes and metafield configuration changes to `shopify.app.localhost.toml`, keeping metaobjects.
  ```toml
  # In shopify.app.localhost.toml
  scopes = "write_products,write_metafields,read_metafields,read_metaobjects,read_metaobject_definitions,read_online_store_navigation,write_files"

  [app.metafields.app.navigation_config]
  name = "Navigation Configuration"
  type = "json"
  access.admin = "merchant_read_write"
  access.storefront = "public_read"

  [app.metafields.app.banner_config]
  name = "Banner Configuration"
  type = "json"
  access.admin = "merchant_read_write"
  access.storefront = "public_read"
  ```

- [ ] **Step 3: Modify shopify.app.render.toml**
  Apply the exact same changes to `shopify.app.render.toml`.
  ```toml
  # In shopify.app.render.toml
  scopes = "write_products,write_metafields,read_metafields,read_metaobjects,read_metaobject_definitions,read_online_store_navigation,write_files"

  [app.metafields.app.navigation_config]
  name = "Navigation Configuration"
  type = "json"
  access.admin = "merchant_read_write"
  access.storefront = "public_read"

  [app.metafields.app.banner_config]
  name = "Banner Configuration"
  type = "json"
  access.admin = "merchant_read_write"
  access.storefront = "public_read"
  ```

---

### Task 2: Update config-types.ts, config.server.ts, and config.server.test.ts

**Files:**
- Modify: `app/lib/bc-design/config-types.ts`
- Create: `app/lib/bc-design/config.server.ts`
- Create: `app/lib/bc-design/config.server.test.ts`
- Keep: `app/lib/bc-design/metaobjects.server.ts` (Do NOT delete in Phase 1)

**Interfaces:**
- Consumes: Type definitions in `config-types.ts`
- Produces:
  - `extractFilename(url?: string | null): string`
  - `loadNavigationConfig(admin: AdminGraphqlClient): Promise<NavigationConfig>`
  - `saveNavigationConfig(admin: AdminGraphqlClient, config: NavigationConfig): Promise<void>`
  - `loadBannerConfig(admin: AdminGraphqlClient): Promise<BannerConfig>`
  - `saveBannerConfig(admin: AdminGraphqlClient, config: BannerConfig): Promise<void>`

- [ ] **Step 1: Update config-types.ts**
  Add the optional filename and URL properties to configuration types in `app/lib/bc-design/config-types.ts`, preserving brightness fields.
  ```typescript
  export type NavigationSecondLevelConfig = {
    level1Index: number;
    level2Index: number;
    level1Title: string;
    level2Title: string;
    layoutType: NavigationLayoutType;
    bigImage1?: string;
    bigImage1Filename?: string; // NEW
    bigImage2?: string;
    bigImage2Filename?: string; // NEW
    bigImage3?: string;
    bigImage3Filename?: string; // NEW
    adImage?: string;
    adImageFilename?: string; // NEW
    adUrl?: string;
    id?: string;
  };

  export type NavigationConfig = {
    fixedNavigation: boolean;
    logoType: LogoType;
    logoText: string;
    logoFile?: string;
    logoFileFilename?: string; // NEW
    navBackgroundColor: string;
    primaryNavTextColor: string;
    secondaryNavTextColor: string;
    iconColor: string;
    menuHandle: string;
    secondLevelConfigs: NavigationSecondLevelConfig[];
    migrationCompleted?: boolean; // NEW
  };

  export type BannerSlideConfig = {
    id: string;
    desktopImage?: string;
    desktopImageFilename?: string; // NEW
    mobileImage?: string;
    mobileImageFilename?: string; // NEW
    video?: string;
    videoFileUrl?: string; // NEW
    videoPosterUrl?: string; // NEW
    videoUrl?: string;
    heading: string;
    subheading: string;
    primaryButtonLabel: string;
    primaryButtonLink: string;
    secondaryButtonLabel: string;
    secondaryButtonLink: string;
    desktopAverageBrightness?: number; // PRESERVED
    desktopAdaptiveOverlayVariant?: "black" | "white";
    desktopAdaptiveOverlayOpacity?: number;
    mobileAverageBrightness?: number; // PRESERVED
    mobileAdaptiveOverlayVariant?: "black" | "white";
    mobileAdaptiveOverlayOpacity?: number;
  };

  export type BannerConfig = {
    autoplay: boolean;
    autoplaySpeed: number;
    pauseOnHover: boolean;
    showIndicators: boolean;
    mobileHeight: number;
    overlayOpacity: number;
    brightnessAdaptiveOverlayEnabled: boolean;
    slides: BannerSlideConfig[];
    migrationCompleted?: boolean; // NEW
  };
  ```

- [ ] **Step 2: Write unit tests in config.server.test.ts**
  Create `app/lib/bc-design/config.server.test.ts` and write tests for `extractFilename and data migration mapping structure validation.
  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { extractFilename, loadNavigationConfig } from "./config.server";
  import { adminGraphql } from "./admin-graphql.server";

  vi.mock("./admin-graphql.server", () => ({
    adminGraphql: vi.fn(),
  }));

  describe("extractFilename", () => {
    it("should extract filenames", () => {
      expect(extractFilename("https://cdn.shopify.com/files/logo.jpg?v=123")).toBe("logo.jpg");
    });
    it("should decode url encoded characters", () => {
      expect(extractFilename("https://cdn.shopify.com/files/summer%20banner.png?v=456")).toBe("summer banner.png");
    });
  });

  describe("loadNavigationConfig", () => {
    it("should return configuration from metafield if migrationCompleted is true", async () => {
      vi.mocked(adminGraphql).mockResolvedValue({
        currentAppInstallation: {
          id: "gid://shopify/AppInstallation/1",
          navigation: {
            jsonValue: {
              fixedNavigation: true,
              logoText: "Store",
              migrationCompleted: true,
            },
          },
        },
      });

      const config = await loadNavigationConfig({} as any);
      expect(config.migrationCompleted).toBe(true);
      expect(config.logoText).toBe("Store");
    });
  });
  ```

- [ ] **Step 3: Run test to verify it fails**
  Run: `npm run test`
  Expected: FAIL.

- [ ] **Step 4: Implement config.server.ts**
  Create `app/lib/bc-design/config.server.ts` and implement file-name extraction, standard CRUD methods, GID-to-filename resolving migration path, progressive video READY loader synchronization, and lightweight ID queries for save operations.
  ```typescript
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
          sources {
            url
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
        legacyConfig.secondLevelConfigs?.length > 0 ||
        legacyConfig.logoFile
      )) {
        // Collect GIDs to resolve filenames
        const gids: string[] = [];
        if (legacyConfig.logoFile) gids.push(legacyConfig.logoFile);
        for (const child of legacyConfig.secondLevelConfigs) {
          if (child.bigImage1) gids.push(child.bigImage1);
          if (child.bigImage2) gids.push(child.bigImage2);
          if (child.bigImage3) gids.push(child.bigImage3);
          if (child.adImage) gids.push(child.adImage);
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
        for (const child of legacyConfig.secondLevelConfigs) {
          if (child.bigImage1 && fileUrls[child.bigImage1]) child.bigImage1Filename = extractFilename(fileUrls[child.bigImage1]);
          if (child.bigImage2 && fileUrls[child.bigImage2]) child.bigImage2Filename = extractFilename(fileUrls[child.bigImage2]);
          if (child.bigImage3 && fileUrls[child.bigImage3]) child.bigImage3Filename = extractFilename(fileUrls[child.bigImage3]);
          if (child.adImage && fileUrls[child.adImage]) child.adImageFilename = extractFilename(fileUrls[child.adImage]);
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
        if (legacyConfig && legacyConfig.slides?.length > 0) {
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
      .filter((s) => s.video && (!s.videoFileUrl || !s.videoPosterUrl))
      .map((s) => s.video as string);

    if (pendingVideoGids.length > 0) {
      try {
        const filesData = await adminGraphql<any>(admin, GET_FILE_DETAILS, { ids: pendingVideoGids });
        for (const node of filesData.nodes || []) {
          if (!node) continue; // Null check to prevent TypeError
          if (node.fileStatus === "READY") {
            const slide = config.slides.find((s) => s.video === node.id);
            if (slide) {
              if (node.sources?.[0]?.url) slide.videoFileUrl = node.sources[0].url;
              if (node.preview?.image?.url) slide.videoPosterUrl = node.preview.image.url;
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
          value: JSON.stringify(payload),
        },
      ],
    });
    if (result.metafieldsSet.userErrors?.length > 0) {
      throw new Error(JSON.stringify(result.metafieldsSet.userErrors));
    }
  }
  ```

- [ ] **Step 5: Run tests**
  Run: `npm run test`
  Expected: PASS.

---

### Task 3: Decouple GID to Filename/URL Resolution in Route Actions & Clean Up Metaobject Warning Stubs

**Files:**
- Modify: `app/routes/app.navigation.tsx`
- Modify: `app/routes/app.banner.tsx`

**Interfaces:**
- Consumes: `config.server.ts` APIs and exports
- Produces: Correctly updated `config` objects with pre-populated `logoFileFilename`, `desktopImageFilename`, etc. during Remix action upload handling. Handles 2-parameter save calls.

- [ ] **Step 1: Clean up imports and stubs in app.navigation.tsx**
  Edit `app/routes/app.navigation.tsx`:
  - Change import from `../lib/bc-design/metaobjects.server` to `../lib/bc-design/config.server`.
  - Remove imports of `missingMetaobjectDefinitionsMessage` and `getMissingBcDesignMetaobjectDefinitions`.
  - In `loader`: remove `getMissingBcDesignMetaobjectDefinitions` query and its return value.
  - In `action`: remove the `missingMetaobjectDefinitions` check.
  - In the React component: delete the warning banner rendering stubs.
  - In the save configuration call: change `saveNavigationConfig(admin, config, previous)` to `saveNavigationConfig(admin, config)`.

- [ ] **Step 2: Update mergeUploadedFiles in app.navigation.tsx**
  Modify file upload merging logic in `app/routes/app.navigation.tsx` to resolve filenames at upload time:
  ```typescript
  async function mergeUploadedFiles(
    admin: AdminGraphqlClient,
    formData: FormData,
    config: NavigationConfig,
    previous: NavigationConfig,
  ) {
    const logoFile = formData.get("logoFile");
    if (logoFile instanceof File && logoFile.size > 0) {
      const uploaded = await createShopifyFileFromUpload(admin, logoFile);
      config.logoFile = uploaded.id;
      config.logoFileFilename = extractFilename(uploaded.url);
    } else if (!config.logoFile) { // Preserved condition guard
      config.logoFile = previous.logoFile;
      config.logoFileFilename = previous.logoFileFilename;
    }

    for (const [index, child] of config.secondLevelConfigs.entries()) {
      const previousChild = previous.secondLevelConfigs.find(
        (saved) =>
          saved.level1Index === child.level1Index &&
          saved.level2Index === child.level2Index,
      );

      const mediaFields =
        child.layoutType === "big_image"
          ? (["bigImage1", "bigImage2", "bigImage3"] as const)
          : (["adImage"] as const);

      for (const field of mediaFields) {
        const uploadedFile = formData.get(
          `secondLevelConfigs.${index}.${field}`,
        );
        if (uploadedFile instanceof File && uploadedFile.size > 0) {
          const result = await createShopifyFileFromUpload(admin, uploadedFile);
          child[field] = result.id;
          child[`${field}Filename`] = extractFilename(result.url);
        } else if (!child[field]) { // Preserved condition guard
          child[field] = previousChild?.[field];
          child[`${field}Filename`] = previousChild?.[`${field}Filename` as keyof typeof previousChild] as string;
        }
      }
    }
  }
  ```

- [ ] **Step 3: Modify app.banner.tsx and query Video Poster using shared GET_FILE_DETAILS**
  Edit `app/routes/app.banner.tsx`:
  - Change config server import to include `GET_FILE_DETAILS` query to avoid duplicate definitions.
  - Update save calls to pass only `(admin, config)`.
  - Update file uploads merging to resolve filenames/urls at upload time, querying for the poster URL:
    ```typescript
    if (uploadedFile instanceof File && uploadedFile.size > 0) {
      const result = await createShopifyFileFromUpload(admin, uploadedFile);
      if (field === "video") {
        slide.video = result.id;
        slide.videoFileUrl = result.url; // Shopify CDN URL
        
        // Fetch poster preview image using shared GraphQL query from config.server
        try {
          const previewResult = await adminGraphql<any>(admin, GET_FILE_DETAILS, { ids: [result.id] });
          const fileNode = previewResult?.nodes?.[0];
          slide.videoPosterUrl = fileNode?.preview?.image?.url || "";
        } catch (e) {
          console.warn("Failed to retrieve video poster image URL during upload", e);
        }
      } else {
        slide[field] = result.id;
        slide[`${field}Filename`] = extractFilename(result.url);
      }
    } else if (field === "video" ? !slide.video : !slide[field]) { // Preserved condition guard
      slide[field] = previousSlide?.[field];
      if (field === "video") {
        slide.videoFileUrl = previousSlide?.videoFileUrl;
        slide.videoPosterUrl = previousSlide?.videoPosterUrl;
      } else {
        slide[`${field}Filename`] = previousSlide?.[`${field}Filename` as keyof typeof previousSlide];
      }
    }
    ```

---

### Task 4: Update storefront Liquid templates to use file_img_url and manual responsive srcset

**Files:**
- Modify: `extensions/bc-design-theme/blocks/banner_carousel.liquid`
- Modify: `extensions/bc-design-theme/snippets/banner_carousel_slide.liquid`
- Modify: `extensions/bc-design-theme/blocks/navigation_menu.liquid`
- Modify: `extensions/bc-design-theme/snippets/nav_dropdown_big_images.liquid`
- Modify: `extensions/bc-design-theme/snippets/nav_dropdown_product_ad.liquid`

**Interfaces:**
- Consumes: JSON metafield properties from `app.metafields.app.navigation_config.value` and `app.metafields.app.banner_config.value`.

- [ ] **Step 1: Update banner_carousel.liquid**
  Edit `extensions/bc-design-theme/blocks/banner_carousel.liquid` to read config safely. Define `brightness_adaptive_overlay_enabled` before the loop.
  ```liquid
  {% assign banner_config_meta = app.metafields.app.banner_config %}
  {% if banner_config_meta != blank %}
    {% assign banner_config = banner_config_meta.value %}
    {% assign brightness_adaptive_overlay_enabled = banner_config.brightnessAdaptiveOverlayEnabled | default: false %}
    ...
    {% for slide in banner_config.slides %}
      {% if forloop.first %}
        {% assign loading_attr = 'eager' %}
      {% else %}
        {% assign loading_attr = 'lazy' %}
      {% endif %}
      {% render 'banner_carousel_slide',
        desktop_image_filename: slide.desktopImageFilename,
        mobile_image_filename: slide.mobileImageFilename,
        video_url: slide.videoUrl,
        video_file_url: slide.videoFileUrl,
        video_poster_url: slide.videoPosterUrl,
        heading: slide.heading,
        ...
        eager_load: loading_attr
      %}
    {% endfor %}
  {% endif %}
  ```

- [ ] **Step 2: Update banner_carousel_slide.liquid**
  Edit `extensions/bc-design-theme/snippets/banner_carousel_slide.liquid` to render responsive images using standard HTML `<picture>` and `<img>` tags with a handcrafted `srcset` parameter mapping:
  ```liquid
  {%- if video_url != blank -%}
    <video class="bc-banner-slide__video" src="{{ video_url | escape }}" autoplay muted loop playsinline preload="metadata"></video>
  {%- elsif video_file_url != blank -%}
    <video class="bc-banner-slide__video" src="{{ video_file_url }}" poster="{{ video_poster_url }}" autoplay muted loop playsinline preload="metadata"></video>
  {%- elsif desktop_image_filename != blank -%}
    {%- if mobile_image_filename != blank -%}
      <picture>
        <source media="(max-width: 749px)" srcset="{{ mobile_image_filename | file_img_url: '900x' }}">
        <img
          class="bc-banner-slide__image"
          src="{{ desktop_image_filename | file_img_url: '2880x' }}"
          srcset="{{ desktop_image_filename | file_img_url: '960x' }} 960w, {{ desktop_image_filename | file_img_url: '1440x' }} 1440w, {{ desktop_image_filename | file_img_url: '1920x' }} 1920w, {{ desktop_image_filename | file_img_url: '2400x' }} 2400w, {{ desktop_image_filename | file_img_url: '2880x' }} 2880w"
          sizes="100vw"
          loading="{{ eager_load }}"
        >
      </picture>
    {%- else -%}
      <img
        class="bc-banner-slide__image"
        src="{{ desktop_image_filename | file_img_url: '2880x' }}"
        srcset="{{ desktop_image_filename | file_img_url: '960x' }} 960w, {{ desktop_image_filename | file_img_url: '1440x' }} 1440w, {{ desktop_image_filename | file_img_url: '1920x' }} 1920w, {{ desktop_image_filename | file_img_url: '2400x' }} 2400w, {{ desktop_image_filename | file_img_url: '2880x' }} 2880w"
        sizes="100vw"
        loading="{{ eager_load }}"
      >
    {%- endif -%}
  {%- endif -%}
  ```

- [ ] **Step 3: Update navigation_menu.liquid**
  Edit `extensions/bc-design-theme/blocks/navigation_menu.liquid` to read `logoFileFilename` and `bigImage1Filename` with null-checks.
  ```liquid
  {% assign nav_config_meta = app.metafields.app.navigation_config %}
  {% if nav_config_meta != blank %}
    {% assign nav_config = nav_config_meta.value %}
    {% assign logo_file_url = nav_config.logoFileFilename | file_img_url: 'master' %}
  {% endif %}
  ```

- [ ] **Step 4: Update dropdown snippets**
  Edit `extensions/bc-design-theme/snippets/nav_dropdown_big_images.liquid` and `nav_dropdown_product_ad.liquid` to resolve images via `file_img_url` using filenames.
  ```liquid
  # In nav_dropdown_big_images.liquid
  {% if custom_image_1_filename != blank %}
    {% assign main_image = custom_image_1_filename | file_img_url: '912x' %}
  {% endif %}
  ```
