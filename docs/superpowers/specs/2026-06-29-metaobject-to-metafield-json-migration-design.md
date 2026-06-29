# Metaobjects to Metafields JSON Migration Design Spec (v6)

This specification outlines the technical plan to migrate the app configuration storage from Shopify App-owned Metaobjects to AppInstallation Metafields of type `json`.

## Goal

Currently, the configuration for the navigation menu and home banner carousel is stored in four custom app-owned Metaobjects:
1. `navigation_config`
2. `navigation_second_level`
3. `banner_config`
4. `banner_slide`

This multi-level relational structure is complex to manage, slow to save (requiring multiple nested GraphQL upserts and orphaned child cleanups), and prone to version syncing errors. We will migrate these to two AppInstallation Metafields of type `json`:
1. `currentAppInstallation.metafields.app.navigation_config`
2. `currentAppInstallation.metafields.app.banner_config`

The core benefits of this migration are:
- **Reduced Code Complexity**: No recursive/cascaded upserts or orphaned record deletions. Saving is a single API call.
- **Reduced API Usage**: High-speed single-mutation save instead of multiple sequential operations.
- **Enhanced Data Lifetime Control**: AppInstallation metafields are automatically deleted when the merchant uninstalls the app.

---

## Proposed Changes

### Component 1: Shopify Configuration Files (TOML) & Access Scopes

To ensure zero-downtime data migration for existing merchants, we will execute the TOML deployment and scope changes in **two distinct stages**:

#### Stage 1 (Migration Phase)
- **Files**: `shopify.app.toml`, `shopify.app.localhost.toml`, `shopify.app.render.toml`
- **Scopes**: Keep the legacy metaobject scopes (`read_metaobjects`, `read_metaobject_definitions`) so the migration script has read access to old data. Add the metafield scopes `write_metafields`, `read_metafields`.
  ```toml
  scopes = "write_products,write_metafields,read_metafields,read_metaobjects,read_metaobject_definitions,read_online_store_navigation,write_files"
  ```
- **Definitions**: Declare the new AppInstallation metafields under `[app.metafields]`. DO NOT delete the `[metaobjects.app...]` sections yet to prevent CLI configuration sync from deleting the definitions before migration completes.
  ```toml
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

#### Stage 2 (Cleanup Phase - Subsequent Release)
- Once migration has completed across all stores, deploy a follow-up commit to:
  - Remove all `[metaobjects.app...]` sections from the TOML files.
  - Remove `read_metaobjects` and `read_metaobject_definitions` from `scopes`.
  ```toml
  scopes = "write_products,write_metafields,read_metafields,read_online_store_navigation,write_files"
  ```

---

### Component 2: Backend Config Services & Route Actions

We will rename the service file, update configuration type definitions, update configuration read/write operations to use AppInstallation Metafields JSON, and implement idempotent automatic data migration.

#### [MODIFY] [config-types.ts](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/app/lib/bc-design/config-types.ts)
- Add new properties to configuration type definitions to hold the resolved filenames and URLs:
  - `logoFileFilename?: string` in `NavigationConfig`
  - `bigImage1Filename?: string`, `bigImage2Filename?: string`, `bigImage3Filename?: string`, `adImageFilename?: string` in `NavigationSecondLevelConfig`
  - `desktopImageFilename?: string`, `mobileImageFilename?: string`, `videoFileUrl?: string`, `videoPosterUrl?: string` in `BannerSlideConfig`
  - `migrationCompleted?: boolean` in both `NavigationConfig` and `BannerConfig`

#### [DELETE] [metaobjects.server.ts](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/app/lib/bc-design/metaobjects.server.ts)
#### [NEW] [config.server.ts](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/app/lib/bc-design/config.server.ts)

##### GraphQL Operations Update
- Query to read both metafields on the current app installation using `jsonValue`:
  ```graphql
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
  ```
- Mutation to save metafield values:
  ```graphql
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
  ```
  *Variables Payload Example (requires explicit `ownerId` GID from query)*:
  ```json
  {
    "metafields": [
      {
        "ownerId": "gid://shopify/AppInstallation/123456789",
        "namespace": "$app",
        "key": "navigation_config",
        "value": "..."
      }
    ]
  }
  ```

##### Image & Video JSON Storage Strategy
To support native storefront Liquid rendering filters while keeping the database decoupled from expiring CDN tokens:
1. **Images**: Store the GID (e.g. `logoFile` = `"gid://shopify/MediaImage/123"`) AND the filename (e.g. `logoFileFilename` = `"logo.jpg"`). Liquid resolves the image via `{{ filename | file_img_url }}`.
2. **Shopify Hosted Videos**: Store the GID (e.g. `video` = `"gid://shopify/Video/123"`), the CDN URL (e.g. `videoFileUrl`), and the cover image URL (e.g. `videoPosterUrl`). Rendered in Liquid using `<video src="{{ videoFileUrl }}" poster="{{ videoPosterUrl }}">`.
3. **External Videos**: Store the URL in the legacy `videoUrl` field (e.g., YouTube/Vimeo links).

##### Decoupling URL Resolution to Upload Phase
To maximize save performance and reliability:
- Resolve and extract filenames/URLs **at upload time** in Route Actions.
- When `createShopifyFileFromUpload` completes and returns `{ id, url }`, we immediately run `extractFilename(url)` and write both ID and filename/URL to the config state.
- **Video Asynchrony & Poster Resolution**: Shopify videos are processed asynchronously and their preview images (`previewImage`) are not immediately ready on upload. In the file creation query, we query `previewImage { url }`. If the video is still `PROCESSING`, the url is empty. The `videoFileUrl` and `videoPosterUrl` fields will be progressively populated and saved on the next configuration change or subsequent page load when the file achieves `READY` status.
- Saving remains a pure, fast `metafieldsSet` mutation.
- **Save Signature Simplification**: Change the save configuration functions `saveNavigationConfig` and `saveBannerConfig` to accept `(admin, config)` (removing the legacy `previous` parameter since diffing and cascading orphan deletes are no longer needed). Update Remix action caller invocations to match.

*Filename Extraction Helper (in config.server.ts)*:
```typescript
export function extractFilename(url?: string | null): string {
  if (!url) return "";
  const cleanUrl = url.split("?")[0];
  const filename = cleanUrl.substring(cleanUrl.lastIndexOf("/") + 1);
  return filename ? decodeURIComponent(filename) : "";
}
```

##### Admin UI Preview URL Resolution
Since `file_img_url` is a Liquid-only filter, the Admin UI React components will resolve preview URLs dynamically:
- Loaders in `app.navigation.tsx` / `app.banner.tsx` collect all GIDs in the loaded configuration, query the GraphQL `nodes(ids: $ids)` endpoint to fetch temporary CDN URLs, and pass them to the client as a `filePreviewUrls` mapping (`GID -> URL`). These are never stored in the database.

##### Idempotent Fallback/Migration Logic
To prevent half-completed migrations from blocking updates, we store a `migrationCompleted: true` flag in the configuration JSON.
- `loadNavigationConfig(admin)`:
  - Query the metafield. If `jsonValue` is present and `jsonValue.migrationCompleted === true`, return it.
  - If not completed, query the legacy Metaobjects, parse their relational data, call `resolveFilePreviewUrls` to retrieve temporary CDN URLs for all legacy image/video GIDs, parse the resulting URLs with `extractFilename` to assign their matching filenames, write the migrated payload to the metafield with `migrationCompleted: true`, and return.
- `loadBannerConfig(admin)`:
  - Query the metafield. If not completed, query legacy banner metaobjects, resolve GIDs to URLs, extract filenames, save to the metafield with `migrationCompleted: true`, and return.

##### API Warnings Cleanup
- `getMissingBcDesignMetaobjectDefinitions(admin)`: **Delete completely**.
- **Remix Route Loaders Clean Up**: In `app.navigation.tsx`, update the loader method to remove the Promise.all check for `getMissingBcDesignMetaobjectDefinitions(admin)` and remove `missingMetaobjectDefinitions` from the returned loader payload and from React warning banner renders.

---

### Component 3: Theme App Extension Blocks & Snippets

We will modify Liquid templates to read configuration from `app.metafields.app` and resolve filenames using `file_img_url`.

#### Retaining Full Responsive Srcset
To avoid performance regressions from loading large full-width banner images on smaller screens, we will construct the `srcset` attribute manually using Liquid's `file_img_url` sizes:

#### [MODIFY] [banner_carousel_slide.liquid](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/extensions/bc-design-theme/snippets/banner_carousel_slide.liquid)
- Render responsive images using standard HTML `<picture>` and `<img>` tags, manual `srcset`, and `sizes`:
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

#### [MODIFY] [banner_carousel.liquid](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/extensions/bc-design-theme/blocks/banner_carousel.liquid)
- Read configuration from `app.metafields.app.banner_config.value`.
- Render snippet passing both GID and resolved properties:
  ```liquid
  {% assign banner_config = app.metafields.app.banner_config.value %}
  ...
  {% render 'banner_carousel_slide',
    desktop_image_filename: slide.desktopImageFilename,
    mobile_image_filename: slide.mobileImageFilename,
    video_url: slide.videoUrl,
    video_file_url: slide.videoFileUrl,
    video_poster_url: slide.videoPosterUrl,
    ...
  %}
  ```

#### [MODIFY] [navigation_menu.liquid](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/extensions/bc-design-theme/blocks/navigation_menu.liquid)
- Read logo and configurations:
  ```liquid
  {% assign nav_config = app.metafields.app.navigation_config.value %}
  {% assign logo_file_url = nav_config.logoFileFilename | file_img_url: 'master' %}
  ```
- Loop over second level configs and pass filenames to snippets.

---

## Verification & Deployment Plan

### Phase 1: Migration Code Release
1. Update TOML files (keeping legacy definitions and scopes).
2. Deploy app code containing `config-types.ts` updates and `config.server.ts` with fallback migration logic.
3. Test migration path locally:
   - Ensure app loader successfully fetches legacy Metaobjects and migrates them to the AppInstallation metafield, setting `migrationCompleted: true`.
4. Run updated Vitest suite (`npm run test`), rewriting assertions to verify:
   - `extractFilename` edge cases.
   - Fallback migration data transformation.
   - Metafields JSON save serialization.

### Phase 2: Deprecation Release
1. Verify all stores have migrated configurations.
2. Update TOML files to delete legacy metaobjects definitions and remove obsolete metaobject scopes.
3. Delete the migration fallback code pathways in `config.server.ts`.
