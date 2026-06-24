# Navigation And Banner Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the legacy Navigation and Banner storefront features into this Shopify app, with merchant configuration moved from theme editor settings into embedded app admin pages.

**Architecture:** Shopify app-owned metaobjects are the shared configuration layer. The embedded app writes Navigation and Banner configs through Admin GraphQL, while the Theme App Extension reads those configs in Liquid and preserves the legacy storefront HTML/CSS/JS as closely as possible. Admin pages provide live previews from form state; final visual acceptance remains the real storefront Liquid render.

**Tech Stack:** Shopify React Router app, Polaris web components, Admin GraphQL, app-owned metaobjects, Shopify Files, Theme App Extension Liquid/CSS/JS, TypeScript, Vitest for pure utility tests.

---

## File Structure

### App Config

- Modify `shopify.app.toml`: replace template demo custom data with Navigation/Banner metaobject definitions and required scopes.
- Modify `shopify.app.localhost.toml`: keep local URLs intact, mirror required scopes if this config contains its own `[access_scopes]`.

### Shared App Code

- Create `app/lib/bc-design/config-types.ts`: TypeScript config types, constants, default values, handle rules, enum guards.
- Create `app/lib/bc-design/config-types.test.ts`: tests for defaults, handle rules, enum guards, banner numeric clamps.
- Create `app/lib/bc-design/admin-graphql.server.ts`: small typed helper around `admin.graphql`, response parsing, userErrors extraction.
- Create `app/lib/bc-design/metaobjects.server.ts`: load/upsert/delete Navigation and Banner metaobjects.
- Create `app/lib/bc-design/menus.server.ts`: read Shopify Online Store menus with `read_online_store_navigation`.
- Create `app/lib/bc-design/files.server.ts`: `stagedUploadsCreate` + upload + `fileCreate`.
- Create `app/lib/bc-design/product-badges.server.ts`: idempotently create/pin `custom.nav_tag` and `custom.tips_tag` PRODUCT metafield definitions.

### Admin Routes

- Modify `app/routes/app.tsx`: replace template nav links with Home, Navigation, Banner.
- Modify `app/routes/app._index.tsx`: replace product demo with feature overview and setup status.
- Create `app/routes/app.navigation.tsx`: Navigation config loader/action/UI/live preview.
- Create `app/routes/app.banner.tsx`: Banner config loader/action/UI/live preview.
- Create `app/components/bc-design/NavigationPreview.tsx`: app-side approximation of legacy navigation.
- Create `app/components/bc-design/BannerPreview.tsx`: app-side approximation of legacy banner.
- Create `app/components/bc-design/MediaField.tsx`: shared Shopify Files uploader/select display.

### Theme Extension

- Replace demo extension content in `extensions/bc-design-theme` with migrated feature files.
- Create or replace `extensions/bc-design-theme/blocks/navigation_menu.liquid`.
- Create or replace `extensions/bc-design-theme/blocks/banner_carousel.liquid`.
- Remove or make inert `extensions/bc-design-theme/blocks/banner_slide.liquid` if present after migration.
- Copy and minimally adapt snippets:
  - `extensions/bc-design-theme/snippets/banner_carousel_slide.liquid`
  - `extensions/bc-design-theme/snippets/nav_dropdown_big_images.liquid`
  - `extensions/bc-design-theme/snippets/nav_dropdown_product_ad.liquid`
  - `extensions/bc-design-theme/snippets/nav_dropdown_product_card.liquid`
  - `extensions/bc-design-theme/snippets/nav_dropdown_products.liquid`
  - `extensions/bc-design-theme/snippets/nav_header_icons.liquid`
  - `extensions/bc-design-theme/snippets/nav_mobile_collection_products.liquid`
- Copy and minimally adapt assets:
  - `extensions/bc-design-theme/assets/navigation-menu.css`
  - `extensions/bc-design-theme/assets/navigation-animations.js`
  - `extensions/bc-design-theme/assets/gsap.min.js`
  - `extensions/bc-design-theme/assets/banner-carousel.css`
  - `extensions/bc-design-theme/assets/banner-carousel.js`
  - `extensions/bc-design-theme/assets/cursor-nav-prev.svg`
  - `extensions/bc-design-theme/assets/cursor-nav-next.svg`
- Remove demo-only files when no longer referenced:
  - `extensions/bc-design-theme/blocks/floating_demo.liquid`
  - `extensions/bc-design-theme/blocks/star_rating.liquid`
  - `extensions/bc-design-theme/snippets/stars.liquid`
  - `extensions/bc-design-theme/assets/floating-demo.css`
  - `extensions/bc-design-theme/assets/floating-demo.js`

### Verification Docs

- Append verified Liquid path and file/video adapter notes to `docs/superpowers/specs/2026-06-24-navigation-banner-migration-design.md` after the spike if the observed syntax differs from the expected `$app:*` lookup.

---

## Implementation Constants

Use these exact values unless a Shopify CLI/API validation error forces a documented adjustment:

```ts
export const NAVIGATION_CONFIG_TYPE = "$app:navigation_config";
export const NAVIGATION_CONFIG_HANDLE = "global";
export const NAVIGATION_SECOND_LEVEL_TYPE = "$app:navigation_second_level";
export const BANNER_CONFIG_TYPE = "$app:banner_config";
export const BANNER_CONFIG_HANDLE = "global";
export const BANNER_SLIDE_TYPE = "$app:banner_slide";

export const LOGO_TYPES = ["text", "image"] as const;
export const NAVIGATION_LAYOUT_TYPES = ["product_list", "big_image"] as const;

export const BANNER_DEFAULTS = {
  autoplay: true,
  autoplaySpeed: 5,
  pauseOnHover: true,
  showIndicators: true,
  mobileHeight: 560,
  overlayOpacity: 20,
};
```

Handle rules:

```ts
export function secondLevelHandle(level1Index: number, level2Index: number) {
  return `l1-${level1Index}-l2-${level2Index}`;
}

export function bannerSlideHandle(id: string) {
  return `slide-${id}`;
}
```

Banner admin ranges:

- `autoplay_speed`: seconds, min 3, max 10, default 5.
- `overlay_opacity`: percent, min 0, max 60, step 5, default 20.
- `mobile_height`: px, min 360, max 760, step 20, default 560.

Product badge definitions:

- Owner type: `PRODUCT`
- Namespace: `custom`
- Keys: `nav_tag`, `tips_tag`
- Type: `file_reference`
- Access: storefront public read if available in the API version.

---

## Task 1: Spike App-Owned Metaobjects And File References

**Files:**
- Modify: `shopify.app.toml`
- Modify: `extensions/bc-design-theme/blocks/floating_demo.liquid` temporarily during spike only, then revert or replace in later tasks
- Document: `docs/superpowers/specs/2026-06-24-navigation-banner-migration-design.md`

- [ ] **Step 1: Add minimal spike TOML definitions**

Add the smallest deployable subset needed to test Liquid access, a child reference list, one image file reference, and one video file reference. Use the final names so the spike informs the real implementation:

```toml
[metaobjects.app.navigation_config]
name = "Navigation configuration"
display_name_field = "title"

  [metaobjects.app.navigation_config.access]
  admin = "merchant_read_write"

[metaobjects.app.navigation_config.fields.title]
name = "Title"
type = "single_line_text_field"
required = true

[metaobjects.app.navigation_config.fields.menu_handle]
name = "Menu handle"
type = "single_line_text_field"

[metaobjects.app.banner_config]
name = "Banner configuration"
display_name_field = "title"

  [metaobjects.app.banner_config.access]
  admin = "merchant_read_write"

[metaobjects.app.banner_config.fields.title]
name = "Title"
type = "single_line_text_field"
required = true

[metaobjects.app.banner_config.fields.slides]
name = "Slides"
type = "list.metaobject_reference<$app:banner_slide>"

[metaobjects.app.banner_slide]
name = "Banner slide"
display_name_field = "title"

  [metaobjects.app.banner_slide.access]
  admin = "merchant_read_write"

[metaobjects.app.banner_slide.fields.title]
name = "Title"
type = "single_line_text_field"
required = true

[metaobjects.app.banner_slide.fields.desktop_image]
name = "Desktop image"
type = "file_reference"

[metaobjects.app.banner_slide.fields.video]
name = "Shopify-hosted video"
type = "file_reference"
```

- [ ] **Step 2: Deploy or run dev with updated config**

Run:

```bash
npm run dev:localhost
```

Expected: Shopify CLI prompts for scope/config changes or starts successfully. If it fails on TOML syntax, fix only the reported schema syntax and rerun.

- [ ] **Step 3: Create one `global` test metaobject**

Use the embedded app GraphiQL/Admin API or a temporary route action to run:

```graphql
mutation UpsertSpikeNavigationConfig($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
    metaobject {
      id
      handle
      type
    }
    userErrors {
      field
      message
    }
  }
}
```

Variables:

```json
{
  "handle": {
    "type": "$app:navigation_config",
    "handle": "global"
  },
  "metaobject": {
    "fields": [
      { "key": "title", "value": "Global navigation" },
      { "key": "menu_handle", "value": "main-menu" }
    ]
  }
}
```

Expected: `userErrors` is empty and a metaobject ID is returned.

- [ ] **Step 4: Verify Liquid lookup path**

Temporarily add this visible diagnostic to the existing demo block:

```liquid
{% assign nav_config = metaobjects['$app:navigation_config']['global'] %}
<div class="bc-spike-metaobject">
  {% if nav_config != blank %}
    Metaobject OK: {{ nav_config.menu_handle.value }}
  {% else %}
    Metaobject missing
  {% endif %}
</div>
```

Run the theme preview and inspect storefront output.

Expected: storefront displays `Metaobject OK: main-menu`. If it displays `Metaobject missing`, test the app-resolved type string shown by Admin GraphQL and document the working lookup path.

- [ ] **Step 5: Verify file and video reference rendering**

Create one test `banner_slide` metaobject with a `file_reference` image and, if a Shopify-hosted video file is available in the dev store, a video file. Add that slide GID to the parent banner config `slides` list. Verify:

```liquid
{{ slide.desktop_image.value | image_url: width: 2880 | image_tag }}
{{ slide.video.value | video_tag: autoplay: true, loop: true, muted: true, controls: false, image_size: '2880x' }}
```

Expected: image renders with Shopify CDN URL; video branch outputs playable HTML comparable to the old theme `video` setting branch. If no video file is available, record that the image/list-reference spike passed and keep video verification as a Task 8 hard gate. If video differs, document the exact Liquid adapter required before Task 7.

- [ ] **Step 6: Commit spike notes or revert temporary storefront diagnostic**

If only documentation changed:

```bash
git add docs/superpowers/specs/2026-06-24-navigation-banner-migration-design.md
git commit -m "docs: record Shopify custom data spike findings"
```

If implementation files were temporarily modified, revert the temporary diagnostic before committing the real implementation.

---

## Task 2: Configure Shopify Custom Data And Scopes

**Files:**
- Modify: `shopify.app.toml`
- Modify: `shopify.app.localhost.toml` if it contains duplicated scopes or config

- [ ] **Step 1: Replace template scopes**

Set the main config scopes to:

```toml
[access_scopes]
scopes = "write_products,write_metaobjects,write_metaobject_definitions,read_online_store_navigation,write_files"
```

Expected: `write_products` is included because Product badge definition setup remains in scope.

- [ ] **Step 2: Replace demo custom data definitions**

Remove these template sections:

```toml
[product.metafields.app.demo_info]
[metaobjects.app.example]
```

Add the full `navigation_config`, `navigation_second_level`, `banner_config`, and `banner_slide` definitions from the spec. Add validation choices if Shopify TOML validation supports them for this field syntax; otherwise enforce choices in the app form layer:

```toml
[metaobjects.app.navigation_config.fields.logo_type]
name = "Logo type"
type = "single_line_text_field"

[metaobjects.app.navigation_second_level.fields.layout_type]
name = "Layout type"
type = "single_line_text_field"
required = true
```

- [ ] **Step 3: Validate Shopify config**

Run:

```bash
npm run config:use -- --config localhost
npm run dev:localhost
```

Expected: CLI accepts the config or reports specific TOML/schema errors. Fix only those errors, preserving the same field semantics.

- [ ] **Step 4: Commit config changes**

```bash
git add shopify.app.toml shopify.app.localhost.toml
git commit -m "feat(config): define navigation and banner custom data"
```

---

## Task 3: Add Shared Config Types And Tests

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `app/lib/bc-design/config-types.ts`
- Create: `app/lib/bc-design/config-types.test.ts`

- [ ] **Step 1: Add Vitest**

Run:

```bash
npm install -D vitest
```

Update scripts:

```json
"test": "vitest run"
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write failing tests for handles, enums, and banner clamps**

Create `app/lib/bc-design/config-types.test.ts`:

```ts
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
    expect(secondLevelHandle(1, 2)).toBe("l1-1-l2-2");
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
    });
  });

  it("clamps banner numeric settings to legacy ranges", () => {
    expect(clampBannerNumber("autoplaySpeed", 1)).toBe(3);
    expect(clampBannerNumber("autoplaySpeed", 11)).toBe(10);
    expect(clampBannerNumber("overlayOpacity", 63)).toBe(60);
    expect(clampBannerNumber("mobileHeight", 120)).toBe(360);
  });
});
```

- [ ] **Step 3: Run test and verify failure**

Run:

```bash
npm test -- app/lib/bc-design/config-types.test.ts
```

Expected: FAIL because `config-types.ts` does not exist.

- [ ] **Step 4: Implement config types**

Create `app/lib/bc-design/config-types.ts`:

```ts
export const NAVIGATION_CONFIG_TYPE = "$app:navigation_config";
export const NAVIGATION_CONFIG_HANDLE = "global";
export const NAVIGATION_SECOND_LEVEL_TYPE = "$app:navigation_second_level";
export const BANNER_CONFIG_TYPE = "$app:banner_config";
export const BANNER_CONFIG_HANDLE = "global";
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
  mobileHeight: 560,
  overlayOpacity: 20,
  slides: [],
};

export function secondLevelHandle(level1Index: number, level2Index: number) {
  return `l1-${level1Index}-l2-${level2Index}`;
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

export function clampBannerNumber(
  field: "autoplaySpeed" | "overlayOpacity" | "mobileHeight",
  value: number,
) {
  if (field === "autoplaySpeed") return Math.min(10, Math.max(3, value));
  if (field === "overlayOpacity") return Math.min(60, Math.max(0, value));
  return Math.min(760, Math.max(360, value));
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm test -- app/lib/bc-design/config-types.test.ts
npm run typecheck
```

Expected: both pass.

Commit:

```bash
git add package.json package-lock.json app/lib/bc-design/config-types.ts app/lib/bc-design/config-types.test.ts
git add vitest.config.ts
git commit -m "feat(app): add bc design config types"
```

---

## Task 4: Build Admin GraphQL Service Layer

**Files:**
- Create: `app/lib/bc-design/admin-graphql.server.ts`
- Create: `app/lib/bc-design/metaobjects.server.ts`
- Create: `app/lib/bc-design/menus.server.ts`
- Create: `app/lib/bc-design/files.server.ts`
- Create: `app/lib/bc-design/product-badges.server.ts`

- [ ] **Step 1: Add Admin GraphQL helper**

Create `admin-graphql.server.ts`:

```ts
export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ShopifyUserError = {
  field?: string[] | null;
  message: string;
};

export async function adminGraphql<TData>(
  admin: AdminGraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
) {
  const response = await admin.graphql(query, { variables });
  const json = (await response.json()) as {
    data?: TData;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }

  if (!json.data) {
    throw new Error("Shopify Admin GraphQL returned no data.");
  }

  return json.data;
}

export function assertNoUserErrors(errors: ShopifyUserError[] | undefined) {
  if (errors?.length) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
}
```

- [ ] **Step 2: Implement menu loading**

Create `menus.server.ts` with `loadMenus(admin)` and `loadMenu(admin, idOrHandle)`.

GraphQL shape:

```graphql
query MenusForBcDesign($first: Int!) {
  menus(first: $first) {
    nodes {
      id
      handle
      title
      items {
        id
        title
        url
        type
        items {
          id
          title
          url
          type
          items {
            id
            title
            url
            type
          }
        }
      }
    }
  }
}
```

Expected return type:

```ts
export type ShopifyMenu = {
  id: string;
  handle: string;
  title: string;
  items: ShopifyMenuItem[];
};
```

- [ ] **Step 3: Implement metaobject load/upsert/delete functions**

In `metaobjects.server.ts`, implement:

```ts
export async function loadNavigationConfig(admin: AdminGraphqlClient): Promise<NavigationConfig>;
export async function saveNavigationConfig(admin: AdminGraphqlClient, config: NavigationConfig, previous?: NavigationConfig): Promise<NavigationConfig>;
export async function loadBannerConfig(admin: AdminGraphqlClient): Promise<BannerConfig>;
export async function saveBannerConfig(admin: AdminGraphqlClient, config: BannerConfig, previous?: BannerConfig): Promise<BannerConfig>;
export async function deleteMetaobjectsByIds(admin: AdminGraphqlClient, ids: string[]): Promise<void>;
```

Use this load query shape for both parent configs. If `metaobjectByHandle` returns `null`, return `NAVIGATION_DEFAULTS` or `BANNER_DEFAULTS`; do not auto-create `global` during load. First save creates the parent config.

```graphql
query BcDesignMetaobjectByHandle($handle: MetaobjectHandleInput!) {
  metaobjectByHandle(handle: $handle) {
    id
    handle
    type
    fields {
      key
      jsonValue
      value
      reference {
        ... on MediaImage {
          id
          image {
            url
          }
        }
        ... on Video {
          id
          sources {
            url
            mimeType
          }
        }
        ... on Metaobject {
          id
          handle
          type
          fields {
            key
            jsonValue
            value
          }
        }
      }
      references(first: 250) {
        nodes {
          ... on Metaobject {
            id
            handle
            type
            fields {
              key
              jsonValue
              value
            }
          }
        }
      }
    }
  }
}
```

Variables:

```json
{
  "handle": {
    "type": "$app:navigation_config",
    "handle": "global"
  }
}
```

If the Admin API rejects `references` on `MetaobjectField`, fall back to parsing `jsonValue` as a GID array and loading child metaobjects by IDs in a second query. If the API rejects app-owned `metaobjectByHandle` without `read_metaobjects`, add `read_metaobjects` in Task 2 and document the dev-store result.

Use this upsert mutation:

```graphql
mutation UpsertBcDesignMetaobject($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
    metaobject {
      id
      handle
      type
    }
    userErrors {
      field
      message
    }
  }
}
```

Child save order:

1. Upsert every `navigation_second_level` with `l1-{level_1_index}-l2-{level_2_index}`.
2. Upsert every `banner_slide` with `slide-{id}`.
3. Upsert parent `global` with reference list in display order.

For required `title` fields:

- Navigation child title is `${level1Title} › ${level2Title}`.
- Banner slide title is the explicit admin `title`; if blank, use `heading || "Slide ${index + 1}"`.

For `list.metaobject_reference` fields, pass the field `value` as a JSON stringified GID array:

```ts
{
  key: "slides",
  value: JSON.stringify([
    "gid://shopify/Metaobject/1",
    "gid://shopify/Metaobject/2",
  ]),
}
```

The array order is the storefront `.value` iteration order.

Implement delete support:

```graphql
mutation DeleteBcDesignMetaobject($id: ID!) {
  metaobjectDelete(id: $id) {
    deletedId
    userErrors {
      field
      message
    }
  }
}
```

Navigation save must compare previous child GIDs with the newly saved current menu index set. Delete any previous child whose `(level1Index, level2Index)` is no longer present in the selected menu or no longer referenced by the saved parent list. Banner save must compare previous slide IDs/GIDs with the submitted slide IDs and delete slides removed in the UI.

- [ ] **Step 4: Implement file upload functions**

In `files.server.ts`, implement:

```ts
export async function createShopifyFileFromUpload(
  admin: AdminGraphqlClient,
  file: File,
): Promise<{ id: string; url?: string }>;
```

Use `stagedUploadsCreate`, upload the file with `fetch(stagedTarget.url, { method: "POST", body: formData })`, then call `fileCreate`.

- [ ] **Step 5: Implement product badge definition setup**

In `product-badges.server.ts`, implement an idempotent version of the legacy helper:

```ts
export async function ensureProductBadgeMetafieldDefinitions(
  admin: AdminGraphqlClient,
): Promise<{ ok: boolean; message: string }>;
```

Create/pin:

```ts
const PRODUCT_BADGE_DEFINITIONS = [
  { namespace: "custom", key: "nav_tag", name: "Navigation tag" },
  { namespace: "custom", key: "tips_tag", name: "Tips tag" },
];
```

Definition input type must use `type: "file_reference"` and `ownerType: "PRODUCT"`.

- [ ] **Step 6: Validate and commit**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both pass.

Commit:

```bash
git add app/lib/bc-design
git commit -m "feat(app): add bc design admin services"
```

---

## Task 5: Implement Navigation Admin Page

**Files:**
- Modify: `app/routes/app.tsx`
- Modify: `app/routes/app._index.tsx`
- Create: `app/routes/app.navigation.tsx`
- Create: `app/components/bc-design/NavigationPreview.tsx`
- Create: `app/components/bc-design/MediaField.tsx`

- [ ] **Step 1: Update app navigation**

In `app/routes/app.tsx`, replace:

```tsx
<s-link href="/app">Home</s-link>
<s-link href="/app/additional">Additional page</s-link>
```

with:

```tsx
<s-link href="/app">Home</s-link>
<s-link href="/app/navigation">Navigation</s-link>
<s-link href="/app/banner">Banner</s-link>
```

- [ ] **Step 2: Replace app home copy**

In `app/routes/app._index.tsx`, remove the template product-creation action. The page should link to Navigation and Banner setup:

```tsx
<s-page heading="BC Design">
  <s-section heading="Storefront modules">
    <s-paragraph>
      Configure the storefront Navigation and Banner modules from the app admin.
    </s-paragraph>
    <s-stack direction="inline" gap="base">
      <s-link href="/app/navigation">Configure navigation</s-link>
      <s-link href="/app/banner">Configure banner</s-link>
    </s-stack>
  </s-section>
</s-page>
```

- [ ] **Step 3: Implement route loader/action**

Create `app/routes/app.navigation.tsx`.

Loader responsibilities:

```ts
const { admin } = await authenticate.admin(request);
return {
  config: await loadNavigationConfig(admin),
  menus: await loadMenus(admin),
};
```

Action intents:

- `saveNavigation`: parse `FormData`, upload any file fields, save child configs, save parent.
- `setupProductBadges`: call `ensureProductBadgeMetafieldDefinitions`.

FormData serialization:

- Submit a single JSON field named `config` containing scalar fields and arrays.
- Submit files separately with deterministic names:
  - `logoFile`
  - `secondLevelConfigs.${index}.bigImage1`
  - `secondLevelConfigs.${index}.bigImage2`
  - `secondLevelConfigs.${index}.bigImage3`
  - `secondLevelConfigs.${index}.adImage`

Example `config` payload:

```json
{
  "fixedNavigation": true,
  "logoType": "text",
  "logoText": "BC Design",
  "menuHandle": "main-menu",
  "secondLevelConfigs": [
    {
      "level1Index": 1,
      "level2Index": 1,
      "level1Title": "Products",
      "level2Title": "Printers",
      "layoutType": "product_list",
      "adUrl": "/collections/all"
    }
  ]
}
```

- [ ] **Step 4: Implement dynamic second-level UI**

When a menu is selected, render every level 2 item under its level 1 parent. Each card includes:

- hidden `level1Index`
- hidden `level2Index`
- hidden `level1Title`
- hidden `level2Title`
- `s-select` for `layoutType` with only `product_list` and `big_image`
- media fields for `bigImage1`, `bigImage2`, `bigImage3`, `adImage`
- `s-url-field` for `adUrl`

Default each missing card to `layoutType: "product_list"`.

When the selected menu structure differs from saved title snapshots or saved indexes, show an `s-banner` warning:

```tsx
<s-banner tone="warning" heading="Menu structure changed">
  Saved second-level menu settings are matched by menu position. Review the cards below before saving.
</s-banner>
```

On save, delete orphaned child metaobjects through `deleteMetaobjectsByIds`.

- [ ] **Step 5: Implement Navigation preview**

Create `NavigationPreview.tsx` with the same high-level classes:

```tsx
export function NavigationPreview({ config, menu }: Props) {
  return (
    <div className="phaetus-nav-root">
      <nav className="navbar">
        <div className="navbar-inner">
          <a className="logo-wrap" href="/">
            {config.logoType === "image" && config.logoFile ? (
              <img className="logo-img" src={config.logoFile} alt={config.logoText || "Logo"} />
            ) : (
              <span className="logo-text">{config.logoText || "Logo"}</span>
            )}
          </a>
          <ul className="nav-menu">
            {menu.items.map((item) => (
              <li className="nav-item" key={item.id}>
                <a href={item.url || "#"}>{item.title}</a>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </div>
  );
}
```

The preview may simplify dropdown product cards; do not use it as final visual acceptance.

`MediaField` preview behavior:

- For a newly selected local file, show `URL.createObjectURL(file)` until save completes.
- For an existing saved Shopify File GID, show the preview URL returned by the loader when available.
- Storefront rendering must still use Liquid `image_url` or `video_tag`; admin preview URLs are only for the embedded app UI.

- [ ] **Step 6: Validate and commit**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both pass.

Commit:

```bash
git add app/routes/app.tsx app/routes/app._index.tsx app/routes/app.navigation.tsx app/components/bc-design
git commit -m "feat(app): add navigation configuration page"
```

---

## Task 6: Implement Banner Admin Page

**Files:**
- Create: `app/routes/app.banner.tsx`
- Create: `app/components/bc-design/BannerPreview.tsx`
- Modify: `app/components/bc-design/MediaField.tsx`

- [ ] **Step 1: Implement route loader/action**

Create `app/routes/app.banner.tsx`.

Loader:

```ts
const { admin } = await authenticate.admin(request);
return { config: await loadBannerConfig(admin) };
```

Action:

- Parse carousel fields.
- Clamp numeric values with `clampBannerNumber`.
- Preserve existing `slide.id` values.
- Generate `crypto.randomUUID()` for new slides.
- Upload files through `createShopifyFileFromUpload`.
- Save slides first, then save parent reference list.
- Compare previous slide IDs/GIDs with submitted slide IDs and delete removed slide metaobjects.

FormData serialization:

- Submit a single JSON field named `config` containing carousel fields and slides in UI order.
- Submit files separately with deterministic names:
  - `slides.${index}.desktopImage`
  - `slides.${index}.mobileImage`
  - `slides.${index}.video`

Example `config` payload:

```json
{
  "autoplay": true,
  "autoplaySpeed": 5,
  "pauseOnHover": true,
  "showIndicators": true,
  "mobileHeight": 560,
  "overlayOpacity": 20,
  "slides": [
    {
      "id": "8fd6e7f8-a7bb-4c58-9d40-b88e7a3d0176",
      "title": "Slide 1",
      "heading": "DXC2 Extruder",
      "subheading": "Engineered for the Creality K2 Series",
      "primaryButtonLabel": "BUY",
      "primaryButtonLink": "/collections/all",
      "secondaryButtonLabel": "More",
      "secondaryButtonLink": "/pages/details"
    }
  ]
}
```

- [ ] **Step 2: Implement carousel settings UI**

Use these controls:

- `s-switch` for `autoplay`
- `s-number-field` for `autoplaySpeed`, min 3, max 10
- `s-switch` for `pauseOnHover`
- `s-switch` for `showIndicators`
- `s-number-field` for `mobileHeight`, min 360, max 760, step 20
- `s-number-field` for `overlayOpacity`, min 0, max 60, step 5

- [ ] **Step 3: Implement unlimited slide editor**

Each slide editor includes:

- Hidden `id`
- Text field `title`
- Media fields `desktopImage`, `mobileImage`, `video`
- URL field `videoUrl`
- Text fields `heading`, `subheading`
- URL/text fields for primary and secondary buttons
- Buttons for move up, move down, delete

Order must be submitted as a list in the current UI order. Parent `slides` reference list controls storefront order.

- [ ] **Step 4: Implement Banner preview**

Create `BannerPreview.tsx`:

```tsx
export function BannerPreview({ config }: { config: BannerConfig }) {
  const firstSlide = config.slides[0];

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
              {firstSlide.desktopImage ? (
                <img className="bc-banner-slide__image" src={firstSlide.desktopImage} alt="" />
              ) : null}
              <div className="bc-banner-slide__overlay" />
            </div>
            <div className="bc-banner-slide__content">
              <h2 className="bc-banner-slide__heading">{firstSlide.heading}</h2>
              <p className="bc-banner-slide__subheading">{firstSlide.subheading}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Validate and commit**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both pass.

Commit:

```bash
git add app/routes/app.banner.tsx app/components/bc-design
git commit -m "feat(app): add banner configuration page"
```

---

## Task 7: Migrate Theme Extension Files

**Files:**
- Modify/Create files under `extensions/bc-design-theme/blocks`
- Modify/Create files under `extensions/bc-design-theme/snippets`
- Modify/Create files under `extensions/bc-design-theme/assets`
- Modify: `extensions/bc-design-theme/locales/en.default.json`

- [ ] **Step 1: Copy legacy assets and snippets**

Set the legacy extension path and copy from it into `extensions/bc-design-theme`:

```bash
LEGACY_EXTENSION="/Users/xixi/projects/bc/shopify/extensions/bc-design-mega-menu"
cp "$LEGACY_EXTENSION/assets/navigation-menu.css" "extensions/bc-design-theme/assets/navigation-menu.css"
cp "$LEGACY_EXTENSION/assets/navigation-animations.js" "extensions/bc-design-theme/assets/navigation-animations.js"
cp "$LEGACY_EXTENSION/assets/gsap.min.js" "extensions/bc-design-theme/assets/gsap.min.js"
cp "$LEGACY_EXTENSION/assets/banner-carousel.css" "extensions/bc-design-theme/assets/banner-carousel.css"
cp "$LEGACY_EXTENSION/assets/banner-carousel.js" "extensions/bc-design-theme/assets/banner-carousel.js"
cp "$LEGACY_EXTENSION/assets/cursor-nav-prev.svg" "extensions/bc-design-theme/assets/cursor-nav-prev.svg"
cp "$LEGACY_EXTENSION/assets/cursor-nav-next.svg" "extensions/bc-design-theme/assets/cursor-nav-next.svg"
cp "$LEGACY_EXTENSION"/snippets/*.liquid extensions/bc-design-theme/snippets/
```

- [ ] **Step 2: Replace Navigation block data source**

Start from legacy `navigation_menu.liquid`. Replace block settings with:

```liquid
{% assign nav_config = metaobjects['$app:navigation_config']['global'] %}
{% if nav_config == blank %}
  <div class="phaetus-nav-empty" {{ block.shopify_attributes }}>Configure navigation in the BC Design app.</div>
{% else %}
  {% assign selected_menu_handle = nav_config.menu_handle.value %}
  {% assign menu = linklists[selected_menu_handle] %}
  {% assign fixed_navigation = nav_config.fixed_navigation.value %}
  {% assign logo_type = nav_config.logo_type.value | default: 'text' %}
  {% assign logo_text = nav_config.logo_text.value | strip %}
  {% assign logo_file = nav_config.logo_file.value %}
  {% assign icon_color = nav_config.icon_color.value | default: '#7a7b7e' %}
  {% assign nav_background_color = nav_config.nav_background_color.value | default: '#ffffff' %}
  {% assign primary_nav_text_color = nav_config.primary_nav_text_color.value | default: '#7a7b7e' %}
  {% assign secondary_nav_text_color = nav_config.secondary_nav_text_color.value | default: '#7a7b7e' %}
{% endif %}
```

Replace the old `layout_config_1..5` if-chain with:

```liquid
{% assign child_layout = 'product_list' %}
{% assign big_image_1 = nil %}
{% assign big_image_2 = nil %}
{% assign big_image_3 = nil %}
{% assign ad_image = nil %}
{% assign ad_url = '' %}

{% for cfg in nav_config.second_level_configs.value %}
  {% assign cfg_level_1_index = cfg.level_1_index.value | plus: 0 %}
  {% assign cfg_level_2_index = cfg.level_2_index.value | plus: 0 %}
  {% if cfg_level_1_index == level_1_index and cfg_level_2_index == level_2_index %}
    {% assign child_layout = cfg.layout_type.value | default: 'product_list' %}
    {% assign big_image_1 = cfg.big_image_1.value %}
    {% assign big_image_2 = cfg.big_image_2.value %}
    {% assign big_image_3 = cfg.big_image_3.value %}
    {% assign ad_image = cfg.ad_image.value %}
    {% assign ad_url = cfg.ad_url.value %}
  {% endif %}
{% endfor %}
```

Keep class names and snippet calls intact.

Replace the logo branch with a `file_reference` adapter:

```liquid
<a href="{{ routes.root_url }}" class="logo-wrap">
  {% if logo_type == 'image' and logo_file != blank %}
    {{
      logo_file
      | image_url: width: 480
      | image_tag:
        class: 'logo-img',
        alt: logo_text,
        widths: '120, 180, 240, 360, 480',
        loading: 'eager'
    }}
  {% else %}
    <span class="logo-text">{{ logo_text | default: shop.name }}</span>
  {% endif %}
</a>
```

For `nav_dropdown_big_images.liquid` and `nav_dropdown_product_ad.liquid`, treat custom image parameters as file drops that already support `image_url`; keep snippet call names and classes unchanged.

- [ ] **Step 3: Replace Banner block structure**

Use the legacy `banner_carousel.liquid` as the base. Keep its stylesheet/script tags, cursor SVG CSS variables, prev/next buttons, and indicators container. Replace only the data source and track content so slides render directly inside the track:

```liquid
<link rel="stylesheet" href="{{ 'banner-carousel.css' | asset_url }}">
<script src="{{ 'banner-carousel.js' | asset_url }}" defer></script>

{% assign bid = block.id %}
<style>
  #shopify-block-{{ bid }} {
    position: relative;
    z-index: 1;
    width: 100vw;
    max-width: 100vw;
    margin-left: calc(50% - 50vw);
    margin-right: calc(50% - 50vw);
  }

  .bc-banner-carousel {
    --bc-cursor-nav-prev: url('{{ 'cursor-nav-prev.svg' | asset_url }}') 20 20, w-resize;
    --bc-cursor-nav-next: url('{{ 'cursor-nav-next.svg' | asset_url }}') 20 20, e-resize;
  }
</style>

{% assign banner_config = metaobjects['$app:banner_config']['global'] %}
{% if banner_config == blank %}
  <div class="bc-banner-carousel-empty" {{ block.shopify_attributes }}>Configure banner in the BC Design app.</div>
{% else %}
  <banner-carousel
    class="bc-banner-carousel"
    style="--bc-banner-aspect-ratio: 2.4 / 1; --bc-banner-mobile-height: {{ banner_config.mobile_height.value | default: 560 }}px; --bc-banner-overlay-opacity: {{ banner_config.overlay_opacity.value | default: 20 | divided_by: 100.0 }};"
    data-autoplay="{{ banner_config.autoplay.value }}"
    data-autoplay-speed="{{ banner_config.autoplay_speed.value | default: 5 | times: 1000 }}"
    data-pause-on-hover="{{ banner_config.pause_on_hover.value }}"
    data-show-indicators="{{ banner_config.show_indicators.value }}"
    tabindex="0"
    {{ block.shopify_attributes }}
  >
    <div class="bc-banner-carousel__track">
      {% for slide in banner_config.slides.value %}
        {% render 'banner_carousel_slide',
          desktop_image: slide.desktop_image.value,
          mobile_image: slide.mobile_image.value,
          video: slide.video.value,
          video_url: slide.video_url.value,
          heading: slide.heading.value,
          subheading: slide.subheading.value,
          primary_button_label: slide.primary_button_label.value,
          primary_button_link: slide.primary_button_link.value,
          secondary_button_label: slide.secondary_button_label.value,
          secondary_button_link: slide.secondary_button_link.value,
          eager_load: 'lazy'
        %}
      {% endfor %}
    </div>
    <button type="button" class="bc-banner-carousel__nav bc-banner-carousel__nav--prev" aria-label="Previous slide" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <button type="button" class="bc-banner-carousel__nav bc-banner-carousel__nav--next" aria-label="Next slide" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <div class="bc-banner-carousel__indicators" aria-label="Banner carousel pagination"></div>
  </banner-carousel>
{% endif %}
```

- [ ] **Step 4: Update Banner JS**

In `banner-carousel.js`, replace `collectSlides()` with track-local collection:

```js
collectSlides() {
  if (!this.track) return;
  this.slides = Array.from(this.track.querySelectorAll('.bc-banner-slide'));
}
```

Remove `externalSlides.slice(0, 5)` and any `bc-banner-slide-host--empty` behavior that only supported sibling blocks.

- [ ] **Step 5: Minimize theme block schemas**

Navigation and Banner blocks should have `target: "section"` and only a paragraph explaining configuration happens in the app admin. Do not expose content/style settings duplicated from app admin.

Example:

```json
{
  "name": "Navigation Menu",
  "target": "section",
  "settings": [
    {
      "type": "paragraph",
      "content": "Configure this module in Apps → BC Design → Navigation."
    }
  ]
}
```

- [ ] **Step 6: Validate and commit**

Run:

```bash
npm run typecheck
npm run lint
npm run dev:localhost
```

Expected: TypeScript/lint pass; Shopify CLI accepts extension files or reports specific Liquid/theme validation errors.

Commit:

```bash
git add extensions/bc-design-theme
git commit -m "feat(theme): migrate navigation and banner modules"
```

---

## Task 8: End-To-End Verification And Cleanup

**Files:**
- Modify: `docs/superpowers/specs/2026-06-24-navigation-banner-migration-design.md` if spike notes differ from spec
- Modify: implementation files only for fixes found during verification

- [ ] **Step 1: Run full automated checks**

Run:

```bash
npm test
npm run typecheck
npm run lint
```

Expected: all pass.

- [ ] **Step 2: Validate app and extension in Shopify dev**

Run:

```bash
npm run dev:localhost
```

Expected: app starts; scopes/config changes are accepted; extension is available in the theme editor.

- [ ] **Step 3: Manual admin verification**

Verify:

- `/app/navigation` loads with defaults.
- Selecting a menu dynamically renders every second-level item.
- Every new second-level item defaults to Product list.
- Changing a second-level item to Big image saves and reloads.
- Product badge setup creates `custom.nav_tag` and `custom.tips_tag` file_reference definitions.
- `/app/banner` can add, delete, reorder, save, and reload more than five slides.
- Banner numeric fields enforce 3-10, 0-60, and 360-760 ranges.
- File upload stores Shopify File GIDs in metaobjects.

- [ ] **Step 4: Manual storefront verification**

Verify:

- Navigation block renders from `metaobjects['$app:navigation_config']['global']` or the verified lookup path.
- Desktop nav layout, hover dropdowns, fixed behavior, close button, and scroll controls match legacy behavior.
- Mobile drawer and accordion match legacy behavior.
- Product-list layout and Big-image layout render from per-second-level metaobjects.
- Product badges render from `custom.nav_tag` and `custom.tips_tag`.
- Banner renders all slides, including more than five.
- Banner image ratios, overlay, alignment, indicators, cursor navigation, autoplay, pause on hover, mobile height, buttons, and video fallback match legacy behavior.
- If Task 1 did not verify Shopify-hosted video, verify `slide.video.value | video_tag` now before merge.

- [ ] **Step 5: Final cleanup**

Remove unused demo files and routes after confirming nothing references them:

- `app/routes/app.additional.tsx`
- demo floating/star extension files
- template product-create code

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both pass.

- [ ] **Step 6: Commit verification fixes**

```bash
git add .
git commit -m "chore: verify navigation and banner migration"
```

---

## Self-Review Checklist

- Spec coverage: The plan covers app-owned metaobjects, scopes, singleton handles, dynamic second-level config, unlimited slides, Shopify Files upload, product badges, app previews, Liquid rendering, and verification.
- v2 review coverage: The plan includes child handle rules, Banner ranges, enum enforcement, `write_products` for badge setup, video/file reference spike, and Liquid second-level matching pseudocode.
- Placeholder scan: No placeholder markers or open-ended deferred-work steps are allowed in execution. If a Shopify validation issue changes syntax, document the exact validated syntax in the spec.
- Type consistency: Use `level1Index`/`level2Index` in TypeScript and `level_1_index`/`level_2_index` in metaobject fields. Use `autoplaySpeed` in TypeScript and `autoplay_speed` in metaobject fields.
