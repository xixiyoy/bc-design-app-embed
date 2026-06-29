# Metaobjects to Metafields JSON Migration Design Spec

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

### Component 1: Shopify Configuration Files (TOML)

We will modify the three Shopify App configuration TOML files to remove all Metaobject definitions, declare two AppInstallation Metafields, and clean up access scopes.

#### [MODIFY] [shopify.app.toml](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/shopify.app.toml)
#### [MODIFY] [shopify.app.localhost.toml](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/shopify.app.localhost.toml)
#### [MODIFY] [shopify.app.render.toml](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/shopify.app.render.toml)

- Remove the `[metaobjects.app...]` sections.
- Define two AppInstallation metafields under `[app.metafields]`:
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
  *(Note: TOML `...metafields.app.key` maps to the reserved namespace `$app` in the GraphQL API and the namespace `app` in Liquid).*
- Update `access_scopes`:
  Remove legacy Metaobject scopes (`write_metaobjects,write_metaobject_definitions,read_metaobject_definitions,read_metaobjects`). Add `write_metafields` and `read_metafields` to allow app-owned metafield administration:
  ```toml
  scopes = "write_products,write_metafields,read_metafields,read_online_store_navigation,write_files"
  ```

---

### Component 2: Backend Config Services & Route Actions

We will rename the service file, update the configuration read/write operations to use AppInstallation Metafields JSON, and implement automatic migration of legacy data.

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
- Mutation to save metafield values. Note that `ownerId` (the `currentAppInstallation.id`) is a required non-null field (`ID!`) in `MetafieldsSetInput` and must be explicitly queried first and passed in the variables:
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
  *Variables Payload Example*:
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
Liquid filters like `image_url` or `file_url` cannot resolve raw GID strings. To bypass this while avoiding storing brittle, expiring CDN URLs in our database:
1. **Images**: Store the GID (e.g. `logoFile` = `"gid://shopify/MediaImage/123"`) AND the filename (e.g. `logoFileFilename` = `"logo.jpg"`). Liquid will resolve the image via `{{ filename | file_img_url: '...' }}`.
2. **Videos**: Store the GID (e.g. `video` = `"gid://shopify/Video/123"`) AND the CDN URL (e.g. `videoUrl` = `"https://cdn.shopify.com/.../video.mp4"`). Liquid will render the URL directly in the HTML `<video>` tag.

##### Decoupling URL Resolution from Save Action (Performance & Stability)
To prevent the `save` operation from being slow and dependent on multiple asynchronous GraphQL resolutions, we will **resolve and store the filenames and video URLs at upload time**, rather than at save time.
- During file upload in `app.navigation.tsx` / `app.banner.tsx` (remix route actions), when calling `createShopifyFileFromUpload`, we get `{ id, url }`.
- We will immediately extract the filename and video URL and assign them to the config object (e.g. `config.logoFile = uploaded.id; config.logoFileFilename = extractFilename(uploaded.url)`).
- When the config is saved, `saveNavigationConfig` / `saveBannerConfig` will do a pure, instantaneous stringify and single `metafieldsSet` call without any GraphQL lookups.

*Filename Extraction Helper (in config.server.ts)*:
```typescript
export function extractFilename(url?: string | null): string {
  if (!url) return "";
  const cleanUrl = url.split("?")[0];
  const filename = cleanUrl.substring(cleanUrl.lastIndexOf("/") + 1);
  return filename ? decodeURIComponent(filename) : "";
}
```

##### Methods to Implement in config.server.ts
- `loadNavigationConfig(admin)`: 
  - Fetch `currentAppInstallation.navigation.jsonValue`.
  - **Fallback/Data Migration Logic**: If empty, query legacy Metaobjects on the store, translate them into the new JSON schema, save, and return the migrated configuration.
- `saveNavigationConfig(admin, config)`:
  - Query the `currentAppInstallation.id` first.
  - Call `metafieldsSet` with `namespace: "$app"`, `key: "navigation_config"`, and the retrieved `ownerId`.
- `loadBannerConfig(admin)`:
  - Fetch `currentAppInstallation.banner.jsonValue`.
  - **Fallback/Data Migration Logic**: If empty, query legacy Metaobjects, convert to JSON format, save, and return.
- `saveBannerConfig(admin, config)`:
  - Query the `currentAppInstallation.id` first.
  - Call `metafieldsSet` with `namespace: "$app"`, `key: "banner_config"`, and the retrieved `ownerId`.
- `getMissingBcDesignMetaobjectDefinitions(admin)`: **Delete completely** along with warning banners in the React route pages.

---

### Component 3: Theme App Extension Blocks & Snippets

We will modify Liquid templates to read configuration from `app.metafields.app` and use the `file_img_url` filter on the stored filenames.

#### Technical Details & Trade-offs
- *file_img_url existence*: `file_img_url` is a fully supported and documented filter in the Shopify Liquid API (`https://shopify.dev/docs/api/liquid/filters/file_img_url`) that takes a filename string and generates its CDN URL.
- *json value resolution*: Shopify's Liquid automatically parses `json` metafield `value` values into Liquid objects/arrays, so we can access nested properties directly (e.g. `app.metafields.app.banner_config.value.slides`). We do not need (and cannot use) a `parse_json` filter as it is not part of Shopify's Liquid API.
- *image_tag filter compatibility*: To avoid compatibility warnings when piping raw URL strings into `image_tag`, we will render images using standard HTML `<img>` elements with the `src` attribute containing the resized `file_img_url` output.

#### [MODIFY] [banner_carousel.liquid](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/extensions/bc-design-theme/blocks/banner_carousel.liquid)
- Retrieve config using Liquid `app` namespace:
  ```liquid
  {% assign banner_config = app.metafields.app.banner_config.value %}
  ```
- Pass filename and video URL to the slide snippet:
  ```liquid
  {% render 'banner_carousel_slide',
    desktop_image_filename: slide.desktopImageFilename,
    mobile_image_filename: slide.mobileImageFilename,
    video_url: slide.videoUrl,
    ...
  %}
  ```

#### [MODIFY] [banner_carousel_slide.liquid](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/extensions/bc-design-theme/snippets/banner_carousel_slide.liquid)
- Accept `desktop_image_filename` and `mobile_image_filename`.
- Render responsive images using standard HTML `<picture>` and `<img>` tags:
  ```liquid
  {%- if video_url != blank -%}
    <video class="bc-banner-slide__video" src="{{ video_url | escape }}" autoplay muted loop playsinline></video>
  {%- elsif desktop_image_filename != blank -%}
    {%- if mobile_image_filename != blank -%}
      <picture>
        <source media="(max-width: 749px)" srcset="{{ mobile_image_filename | file_img_url: '900x' }}">
        <img class="bc-banner-slide__image" src="{{ desktop_image_filename | file_img_url: '2880x' }}" loading="{{ eager_load }}">
      </picture>
    {%- else -%}
      <img class="bc-banner-slide__image" src="{{ desktop_image_filename | file_img_url: '2880x' }}" loading="{{ eager_load }}">
    {%- endif -%}
  {%- endif -%}
  ```
  *(Note: `eager_load` is passed down from the parent `banner_carousel.liquid` render block, specifying "eager" for the first slide and "lazy" for subsequent slides).*

#### [MODIFY] [navigation_menu.liquid](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/extensions/bc-design-theme/blocks/navigation_menu.liquid)
- Retrieve config using Liquid `app` namespace:
  ```liquid
  {% assign nav_config = app.metafields.app.navigation_config.value %}
  ```
- Use logo filename in template:
  ```liquid
  {% assign logo_file_url = nav_config.logoFileFilename | file_img_url: 'master' %}
  ```
- Loop over second level configs and extract filenames:
  ```liquid
  {% for cfg in nav_config.secondLevelConfigs %}
    ...
    {% assign big_image_1_filename = cfg.bigImage1Filename %}
    ...
  {% endfor %}
  ```
- Render sub-dropdowns:
  ```liquid
  {% render 'nav_dropdown_big_images',
    custom_image_1_filename: big_image_1_filename,
    custom_image_2_filename: big_image_2_filename,
    custom_image_3_filename: big_image_3_filename,
    ...
  %}
  ```

#### [MODIFY] [nav_dropdown_big_images.liquid](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/extensions/bc-design-theme/snippets/nav_dropdown_big_images.liquid)
- Accept `custom_image_1_filename` etc.
- Resolve main and side images using `file_img_url` and render standard `<img>` tags:
  ```liquid
  {% if custom_image_1_filename != blank %}
    {% assign main_image = custom_image_1_filename | file_img_url: '912x' %}
  {% endif %}
  ```

#### [MODIFY] [nav_dropdown_product_ad.liquid](file:///Users/cutiechi/sources/xixiyoy/bc-design-app-embed/extensions/bc-design-theme/snippets/nav_dropdown_product_ad.liquid)
- Accept `ad_image_filename`.
- Resolve ad image using `file_img_url`:
  ```liquid
  {% assign ad_img_src = ad_image_filename | file_img_url: '400x' %}
  ```

---

## Verification Plan

### Automated Tests
- Rename legacy tests to reflect imports from `config.server.ts`.
- Run `npm run test` to verify all tests pass.

### Manual Verification
- Deploy using `shopify app dev --config localhost`.
- Verify the automatic migration logic triggers on the first load of the Admin UI (checks legacy Metaobjects, populates Metafields, page loads successfully).
- Modify banner configuration (add/remove slides, change settings), save, and check the GraphQL payload in the database.
- Load the Shopify Online Storefront, verify that the Navigation menu and Banner carousel render correctly with resized image assets.
