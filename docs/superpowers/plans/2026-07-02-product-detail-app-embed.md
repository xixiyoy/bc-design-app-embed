# Product Detail App Embed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third Theme App Extension embed — Product Detail — with per-product configuration via Product Metafields, global enablement mode via AppInstallation Metafield, an admin configuration page, and async add-to-cart via Shopify Cart AJAX API.

**Architecture:** Product configuration (icons, features, subtitle, rating, option icons) is stored as JSON in per-product metafields (`$app:product_detail_config`). Global mode (`off` / `all_on` / `per_product`) is stored in the app installation metafield (`$app:product_detail_global_mode`). The Liquid block reads both at render time and decides whether to output the custom product detail markup. Client-side JS handles variant selection and async add-to-cart. Admin page reuses existing `MediaField`, `createShopifyFileFromUpload`, and `metafieldsSet` patterns.

**Tech Stack:** Remix (React Router v7), TypeScript, Shopify App Bridge (`s-*` web components), Shopify Admin GraphQL, Liquid, vanilla JS, Tailwind CSS v4, Vitest + happy-dom.

## Global Constraints

- `scopes` in all `shopify.app.*.toml` files must include `write_metafields,read_metafields`
- Metafield definitions use `type = "json"` with `access.admin = "merchant_read_write"` and `access.storefront = "public_read"`
- File storage follows GID + filename pattern (same as banner/navigation)
- UI labels are hardcoded for MVP
- Global mode `all_on` renders for products with non-empty config; unconfigured products fall back to theme default
- Per-product `enabled` flag only applies when global mode is `per_product`
- Price formatting: Liquid pre-formats (`v.price | money`) into JSON `priceHtml`; JS uses `innerHTML` directly
- Save label is dynamically calculated in Liquid (`compare_at_price - price`)
- Tab switching interaction is a non-goal; tabs render as visual placeholders only
- Multi-option dynamic availability is static based on initial selection context
---

## File Structure

| Path | Responsibility |
|------|--------------|
| `app/lib/bc-design/config-types.ts` | TypeScript types and defaults for Product Detail config |
| `app/lib/bc-design/config.server.ts` | Server-side load/save helpers for Product Detail metafields |
| `app/routes/app.tsx` | App nav — add Product Detail link |
| `app/routes/app.product-detail.tsx` | Admin page: global mode, product search, per-product config form |
| `extensions/bc-design-theme/blocks/product_detail.liquid` | App Embed Liquid block: reads metafields, outputs HTML |
| `extensions/bc-design-theme/assets/product-detail.js` | Client-side: variant selection, quantity stepper, async add-to-cart |
| `extensions/bc-design-theme/assets/bc-design-embed-placement.js` | DOM placement — add product-detail branch |
| `extensions/bc-design-theme/snippets/nav_header_icons.liquid` | Cart icon — add `data-cart-count` badge (existing attr reused for JS sync) |
| `tailwind/bc-design-theme/product-detail.tailwind.css` | Tailwind v4 source for product detail styles |
| `extensions/bc-design-theme/locales/en.default.schema.json` | Block schema locale name |
| `shopify.app.toml` / `.localhost.toml` / `.render.toml` | Scopes and metafield definitions |
| `package.json` | `dev:web` script with third Tailwind watcher |
| `extensions/bc-design-theme/assets/bc-design-embed-placement.test.js` | Tests for product-detail placement branch |

---

### Task 1: Product Detail Types and Defaults

**Files:**
- Modify: `app/lib/bc-design/config-types.ts`
- Test: `app/lib/bc-design/config-types.test.ts` (existing file — verify tests still pass)

**Interfaces:**
- Consumes: Nothing (adds new types)
- Produces: `ProductDetailGlobalMode`, `ProductDetailGlobalModeConfig`, `ProductOptionIconConfig`, `ProductDetailConfig`, `PRODUCT_DETAIL_GLOBAL_MODE_DEFAULTS`, `PRODUCT_DETAIL_DEFAULTS`

- [ ] **Step 1: Add types to `config-types.ts`**

Append to the end of `app/lib/bc-design/config-types.ts` (after the existing `missingMetaobjectDefinitionsMessage` function):

```typescript
export type ProductDetailGlobalMode = "off" | "all_on" | "per_product";

export type ProductDetailGlobalModeConfig = {
  mode: ProductDetailGlobalMode;
};

export const PRODUCT_DETAIL_GLOBAL_MODE_DEFAULTS: ProductDetailGlobalModeConfig = {
  mode: "per_product",
};

export type ProductOptionIconConfig = {
  optionName: string;
  optionValue: string;
  iconGid?: string;
  iconFilename?: string;
};

export type ProductDetailConfig = {
  enabled: boolean;

  // Media stage icons
  three60BadgeImage?: string;
  three60BadgeImageFilename?: string;
  playButtonImage?: string;
  playButtonImageFilename?: string;
  zoomButtonImage?: string;
  zoomButtonImageFilename?: string;

  // Bottom tab icons
  tab3dImage?: string;
  tab3dImageFilename?: string;
  tabPartsImage?: string;
  tabPartsImageFilename?: string;
  tabVideoImage?: string;
  tabVideoImageFilename?: string;

  // Product info
  subtitle?: string;
  rating?: number;
  ratingImage?: string;
  ratingImageFilename?: string;

  // Features
  features: string[];

  // Variant option icons
  optionIcons: ProductOptionIconConfig[];

  // Quantity stepper icons
  qtyMinusImage?: string;
  qtyMinusImageFilename?: string;
  qtyPlusImage?: string;
  qtyPlusImageFilename?: string;

  // CTA
  addToCartText?: string;
};

export const PRODUCT_DETAIL_DEFAULTS: ProductDetailConfig = {
  enabled: false,
  features: [],
  optionIcons: [],
  addToCartText: "Add to cart",
};
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS with no errors

- [ ] **Step 3: Commit**

```bash
git add app/lib/bc-design/config-types.ts
git commit -m "feat(product-detail): add TypeScript types and defaults"
```

---

### Task 2: Server-Side Config Load/Save

**Files:**
- Modify: `app/lib/bc-design/config.server.ts`
- Test: `app/lib/bc-design/config.server.test.ts` (existing file — verify tests still pass)

**Interfaces:**
- Consumes: `ProductDetailConfig`, `ProductDetailGlobalModeConfig`, `PRODUCT_DETAIL_GLOBAL_MODE_DEFAULTS`, `PRODUCT_DETAIL_DEFAULTS`, `GET_FILE_DETAILS`, `extractFilename`, `imageFileUrlFromNode`, `adminGraphql`, `GET_APP_ID_QUERY`, `SET_CONFIG_MUTATION`
- Produces: `loadProductDetailConfig(admin, productId)`, `saveProductDetailConfig(admin, productId, config)`, `loadProductDetailGlobalModeConfig(admin)`, `saveProductDetailGlobalModeConfig(admin, config)`

- [ ] **Step 1: Add GraphQL queries and load/save functions**

In `app/lib/bc-design/config.server.ts`, after the existing `saveBannerConfig` function, append:

```typescript
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
```

Also add the import at the top of `config.server.ts`:

```typescript
import {
  type ProductDetailConfig,
  type ProductDetailGlobalModeConfig,
  PRODUCT_DETAIL_DEFAULTS,
  PRODUCT_DETAIL_GLOBAL_MODE_DEFAULTS,
} from "./config-types";
```

Add these to the existing import block (around line 1-7):

```typescript
import {
  type NavigationConfig,
  type BannerConfig,
  type ProductDetailConfig,
  type ProductDetailGlobalModeConfig,
  NAVIGATION_DEFAULTS,
  BANNER_DEFAULTS,
  PRODUCT_DETAIL_DEFAULTS,
  PRODUCT_DETAIL_GLOBAL_MODE_DEFAULTS,
} from "./config-types";
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All existing tests pass

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app/lib/bc-design/config.server.ts
git commit -m "feat(product-detail): add server-side config load/save helpers"
```

---

### Task 3: App TOML Configuration

**Files:**
- Modify: `shopify.app.toml`
- Modify: `shopify.app.localhost.toml`
- Modify: `shopify.app.render.toml`

**Interfaces:**
- Consumes: Nothing
- Produces: Updated scopes and metafield definitions in all three TOML files

- [ ] **Step 1: Update scopes in all three TOML files**

In each file, find the `[access_scopes]` section and append `write_metafields,read_metafields` to `scopes`.

For `shopify.app.toml` (line 10):

```toml
scopes = "write_products,read_metaobjects,read_metaobject_definitions,read_online_store_navigation,write_files,write_metafields,read_metafields"
```

For `shopify.app.localhost.toml` (line 11):

```toml
scopes = "write_products,read_metaobjects,read_metaobject_definitions,read_online_store_navigation,write_files,write_metafields,read_metafields"
```

For `shopify.app.render.toml` (line 12):

```toml
scopes = "write_products,read_metaobjects,read_metaobject_definitions,read_online_store_navigation,write_files,write_metafields,read_metafields"
```

- [ ] **Step 2: Add metafield definitions to all three TOML files**

Append the following to the end of each TOML file (before the `[webhooks]` section in `.localhost.toml`, or at the end if no such constraint):

For `shopify.app.toml` — append before `[webhooks]` (after line 238):

```toml
[product.metafields.app.product_detail_config]
name = "Product Detail Configuration"
type = "json"
access.admin = "merchant_read_write"
access.storefront = "public_read"

[app.metafields.app.product_detail_global_mode]
name = "Product Detail Global Mode"
type = "json"
access.admin = "merchant_read_write"
access.storefront = "public_read"
```

For `shopify.app.localhost.toml` — append before `[webhooks]` (after line 211):

```toml
[product.metafields.app.product_detail_config]
name = "Product Detail Configuration"
type = "json"
access.admin = "merchant_read_write"
access.storefront = "public_read"

[app.metafields.app.product_detail_global_mode]
name = "Product Detail Global Mode"
type = "json"
access.admin = "merchant_read_write"
access.storefront = "public_read"
```

For `shopify.app.render.toml` — append before `[webhooks]` (after line 240):

```toml
[product.metafields.app.product_detail_config]
name = "Product Detail Configuration"
type = "json"
access.admin = "merchant_read_write"
access.storefront = "public_read"

[app.metafields.app.product_detail_global_mode]
name = "Product Detail Global Mode"
type = "json"
access.admin = "merchant_read_write"
access.storefront = "public_read"
```

- [ ] **Step 3: Validate TOML config**

Run: `npx shopify app config validate`
Expected: PASS with no errors

- [ ] **Step 4: Commit**

```bash
git add shopify.app.toml shopify.app.localhost.toml shopify.app.render.toml
git commit -m "feat(product-detail): add metafield definitions and scopes"
```

---

### Task 4: App Navigation Link

**Files:**
- Modify: `app/routes/app.tsx`

**Interfaces:**
- Consumes: Nothing
- Produces: `<s-link href="/app/product-detail">Product Detail</s-link>` in nav

- [ ] **Step 1: Add nav link**

In `app/routes/app.tsx`, modify the `<s-app-nav>` block:

```tsx
<s-app-nav>
  <s-link href="/app">Home</s-link>
  <s-link href="/app/navigation">Navigation</s-link>
  <s-link href="/app/banner">Banner</s-link>
  <s-link href="/app/product-detail">Product Detail</s-link>
</s-app-nav>
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.tsx
git commit -m "feat(product-detail): add app nav link"
```

---

### Task 5: Admin Product Detail Page

**Files:**
- Create: `app/routes/app.product-detail.tsx`

**Interfaces:**
- Consumes: `MediaField`, `adminGraphql`, `createShopifyFileFromUpload`, `loadProductDetailConfig`, `saveProductDetailConfig`, `loadProductDetailGlobalModeConfig`, `saveProductDetailGlobalModeConfig`, `sanitizeProductDetailConfig`, `GET_FILE_DETAILS`, `extractFilename`, `imageFileUrlFromNode`, `PRODUCT_DETAIL_DEFAULTS`, `ProductDetailConfig`, `ProductDetailGlobalMode`, `ProductDetailGlobalModeConfig`
- Produces: `/app/product-detail` route with loader, action, and React component

- [ ] **Step 1: Create the admin page**

Create `app/routes/app.product-detail.tsx` with the following content:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { MediaField } from "../components/bc-design/MediaField";
import {
  adminGraphql,
  type AdminGraphqlClient,
} from "../lib/bc-design/admin-graphql.server";
import {
  type ProductDetailConfig,
  type ProductDetailGlobalMode,
  type ProductDetailGlobalModeConfig,
  PRODUCT_DETAIL_DEFAULTS,
} from "../lib/bc-design/config-types";
import { createShopifyFileFromUpload } from "../lib/bc-design/files.server";
import {
  loadProductDetailConfig,
  saveProductDetailConfig,
  loadProductDetailGlobalModeConfig,
  saveProductDetailGlobalModeConfig,
  sanitizeProductDetailConfig,
  GET_FILE_DETAILS,
  extractFilename,
  imageFileUrlFromNode,
} from "../lib/bc-design/config.server";
import { authenticate } from "../shopify.server";

const SEARCH_PRODUCTS_QUERY = `#graphql
  query SearchProducts($query: String!) {
    products(first: 20, query: $query) {
      edges {
        node {
          id
          title
          handle
          featuredImage { url }
        }
      }
    }
  }
`;

const GET_PRODUCT_CONFIG_QUERY = `#graphql
  query GetProductConfig($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      options {
        name
        values
      }
      metafield(namespace: "$app", key: "product_detail_config") {
        jsonValue
      }
    }
  }
`;

type FileNodesData = {
  nodes: Array<
    | { id: string; image?: { url: string } | null }
    | { id: string; sources?: Array<{ url: string }> | null }
    | { id: string; url?: string | null }
    | null
  >;
};

function collectFileGids(config: ProductDetailConfig): string[] {
  const gids = new Set<string>();
  const imageFields = [
    "three60BadgeImage",
    "playButtonImage",
    "zoomButtonImage",
    "tab3dImage",
    "tabPartsImage",
    "tabVideoImage",
    "ratingImage",
    "qtyMinusImage",
    "qtyPlusImage",
  ] as const;
  for (const field of imageFields) {
    const value = config[field];
    if (value?.startsWith("gid://")) {
      gids.add(value);
    }
  }
  for (const icon of config.optionIcons) {
    if (icon.iconGid?.startsWith("gid://")) {
      gids.add(icon.iconGid);
    }
  }
  return [...gids];
}

async function resolveFilePreviewUrls(
  admin: AdminGraphqlClient,
  gids: string[],
): Promise<Record<string, string>> {
  if (gids.length === 0) return {};
  const data = await adminGraphql<FileNodesData>(admin, GET_FILE_DETAILS, { ids: gids });
  const urls: Record<string, string> = {};
  for (const node of data.nodes) {
    if (!node?.id) continue;
    if ("image" in node && node.image?.url) {
      urls[node.id] = node.image.url;
    } else if ("sources" in node && node.sources?.[0]?.url) {
      urls[node.id] = node.sources[0].url;
    } else if ("url" in node && node.url) {
      urls[node.id] = node.url;
    }
  }
  return urls;
}

function parseProductDetailConfigPayload(raw: string): ProductDetailConfig {
  const parsed = JSON.parse(raw) as Partial<ProductDetailConfig>;
  return {
    enabled: Boolean(parsed.enabled),
    three60BadgeImage: parsed.three60BadgeImage || undefined,
    three60BadgeImageFilename: parsed.three60BadgeImageFilename || undefined,
    playButtonImage: parsed.playButtonImage || undefined,
    playButtonImageFilename: parsed.playButtonImageFilename || undefined,
    zoomButtonImage: parsed.zoomButtonImage || undefined,
    zoomButtonImageFilename: parsed.zoomButtonImageFilename || undefined,
    tab3dImage: parsed.tab3dImage || undefined,
    tab3dImageFilename: parsed.tab3dImageFilename || undefined,
    tabPartsImage: parsed.tabPartsImage || undefined,
    tabPartsImageFilename: parsed.tabPartsImageFilename || undefined,
    tabVideoImage: parsed.tabVideoImage || undefined,
    tabVideoImageFilename: parsed.tabVideoImageFilename || undefined,
    subtitle: parsed.subtitle || undefined,
    rating: typeof parsed.rating === "number" ? parsed.rating : undefined,
    ratingImage: parsed.ratingImage || undefined,
    ratingImageFilename: parsed.ratingImageFilename || undefined,
    features: Array.isArray(parsed.features) ? parsed.features.filter((f): f is string => typeof f === "string") : [],
    optionIcons: Array.isArray(parsed.optionIcons)
      ? parsed.optionIcons
          .filter((icon): icon is Record<string, unknown> => typeof icon === "object" && icon !== null)
          .map((icon) => ({
            optionName: String(icon.optionName ?? ""),
            optionValue: String(icon.optionValue ?? ""),
            iconGid: icon.iconGid ? String(icon.iconGid) : undefined,
            iconFilename: icon.iconFilename ? String(icon.iconFilename) : undefined,
          }))
      : [],
    qtyMinusImage: parsed.qtyMinusImage || undefined,
    qtyMinusImageFilename: parsed.qtyMinusImageFilename || undefined,
    qtyPlusImage: parsed.qtyPlusImage || undefined,
    qtyPlusImageFilename: parsed.qtyPlusImageFilename || undefined,
    addToCartText: parsed.addToCartText || PRODUCT_DETAIL_DEFAULTS.addToCartText,
  };
}

async function mergeUploadedProductFiles(
  admin: AdminGraphqlClient,
  formData: FormData,
  config: ProductDetailConfig,
  previous: ProductDetailConfig,
  _productId: string,
) {
  const imageFields = [
    ["three60BadgeImage", "three60BadgeImageFilename"] as const,
    ["playButtonImage", "playButtonImageFilename"] as const,
    ["zoomButtonImage", "zoomButtonImageFilename"] as const,
    ["tab3dImage", "tab3dImageFilename"] as const,
    ["tabPartsImage", "tabPartsImageFilename"] as const,
    ["tabVideoImage", "tabVideoImageFilename"] as const,
    ["ratingImage", "ratingImageFilename"] as const,
    ["qtyMinusImage", "qtyMinusImageFilename"] as const,
    ["qtyPlusImage", "qtyPlusImageFilename"] as const,
  ];

  for (const [gidKey, filenameKey] of imageFields) {
    const uploadedFile = formData.get(gidKey);
    if (uploadedFile instanceof File && uploadedFile.size > 0) {
      const result = await createShopifyFileFromUpload(admin, uploadedFile);
      (config as any)[gidKey] = result.id;
      (config as any)[filenameKey] = extractFilename(result.url);
    } else if (!(config as any)[gidKey]) {
      (config as any)[gidKey] = (previous as any)[gidKey];
      (config as any)[filenameKey] = (previous as any)[filenameKey];
    }
  }

  // Option icons
  for (let i = 0; i < config.optionIcons.length; i++) {
    const icon = config.optionIcons[i];
    const fieldName = `optionIcon.${icon.optionName}.${icon.optionValue}`;
    const uploadedFile = formData.get(fieldName);
    if (uploadedFile instanceof File && uploadedFile.size > 0) {
      const result = await createShopifyFileFromUpload(admin, uploadedFile);
      icon.iconGid = result.id;
      icon.iconFilename = extractFilename(result.url);
    } else if (!icon.iconGid?.startsWith("gid://") && previous.optionIcons[i]) {
      icon.iconGid = previous.optionIcons[i].iconGid;
      icon.iconFilename = previous.optionIcons[i].iconFilename;
    }
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const searchQuery = url.searchParams.get("q") || "";
  const selectedProductId = url.searchParams.get("product") || "";

  const globalConfig = await loadProductDetailGlobalModeConfig(admin);

  let products: Array<{ id: string; title: string; handle: string; featuredImage?: { url: string } | null }> = [];
  if (searchQuery) {
    const data = await adminGraphql<any>(admin, SEARCH_PRODUCTS_QUERY, { query: searchQuery });
    products = data.products?.edges?.map((e: any) => e.node) ?? [];
  }

  let productConfig: ProductDetailConfig | null = null;
  let productOptions: Array<{ name: string; values: string[] }> = [];
  let filePreviewUrls: Record<string, string> = {};
  let selectedProduct: { id: string; title: string; handle: string } | null = null;

  if (selectedProductId) {
    const data = await adminGraphql<any>(admin, GET_PRODUCT_CONFIG_QUERY, { id: selectedProductId });
    const product = data.product;
    selectedProduct = product ? { id: product.id, title: product.title, handle: product.handle } : null;
    productOptions = product?.options ?? [];
    const rawConfig = product?.metafield?.jsonValue;
    productConfig = rawConfig
      ? sanitizeProductDetailConfig(rawConfig)
      : { ...PRODUCT_DETAIL_DEFAULTS, features: [], optionIcons: [] };
    const gids = collectFileGids(productConfig);
    filePreviewUrls = await resolveFilePreviewUrls(admin, gids);
  }

  return {
    globalConfig,
    products,
    searchQuery,
    selectedProductId,
    selectedProduct,
    productConfig,
    productOptions,
    filePreviewUrls,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "saveGlobalMode") {
    const mode = String(formData.get("mode") ?? "per_product");
    const validModes: ProductDetailGlobalMode[] = ["off", "all_on", "per_product"];
    if (!validModes.includes(mode as ProductDetailGlobalMode)) {
      return { intent, ok: false, message: "Invalid mode." };
    }
    await saveProductDetailGlobalModeConfig(admin, { mode: mode as ProductDetailGlobalMode });
    return { intent, ok: true, message: "Global mode saved." };
  }

  if (intent === "saveProductConfig") {
    const productId = String(formData.get("productId") ?? "");
    const configRaw = formData.get("config");
    if (!productId || typeof configRaw !== "string") {
      return { intent, ok: false, message: "Missing product or config." };
    }
    if (!productId.startsWith("gid://shopify/Product/")) {
      return { intent, ok: false, message: "Select a valid product." };
    }
    const previous = await loadProductDetailConfig(admin, productId);
    const config = parseProductDetailConfigPayload(configRaw);
    await mergeUploadedProductFiles(admin, formData, config, previous, productId);
    await saveProductDetailConfig(admin, productId, config);
    const saved = await loadProductDetailConfig(admin, productId);
    const filePreviewUrls = await resolveFilePreviewUrls(admin, collectFileGids(saved));
    return { intent, ok: true, message: "Product config saved.", config: saved, filePreviewUrls };
  }

  return { intent, ok: false, message: "Unknown action." };
};

type ProductDetailFormState = ProductDetailConfig;

export default function ProductDetailPage() {
  const {
    globalConfig,
    products,
    searchQuery,
    selectedProductId,
    selectedProduct,
    productConfig,
    productOptions,
    filePreviewUrls,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  const [globalMode, setGlobalMode] = useState<ProductDetailGlobalMode>(globalConfig.mode);
  const [searchInput, setSearchInput] = useState(searchQuery);
  const [formState, setFormState] = useState<ProductDetailFormState>(
    productConfig ?? { ...PRODUCT_DETAIL_DEFAULTS },
  );
  const [pendingFiles, setPendingFiles] = useState<Record<string, File>>({});
  const [localPreviewUrls, setLocalPreviewUrls] = useState<Record<string, string>>({});
  const wasSubmittingRef = useRef(false);
  const skipConfigSyncRef = useRef(false);

  useEffect(() => {
    if (skipConfigSyncRef.current) {
      skipConfigSyncRef.current = false;
      return;
    }
    setGlobalMode(globalConfig.mode);
    setSearchInput(searchQuery);
    setFormState(productConfig ?? { ...PRODUCT_DETAIL_DEFAULTS });
    setPendingFiles({});
    setLocalPreviewUrls({});
  }, [globalConfig.mode, searchQuery, productConfig]);

  const isSubmitting =
    fetcher.state !== "idle" && fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.state === "submitting" || fetcher.state === "loading") {
      wasSubmittingRef.current = true;
      return;
    }
    if (fetcher.state !== "idle" || !wasSubmittingRef.current) {
      return;
    }
    wasSubmittingRef.current = false;
    const data = fetcher.data;
    if (!data) {
      shopify.toast.show("Save request failed. Please try again.", { isError: true });
      return;
    }
    if (data.ok) {
      shopify.toast.show(data.message || "Saved");
      if (data.config) {
        setFormState(data.config);
        setPendingFiles({});
        setLocalPreviewUrls({});
      }
      skipConfigSyncRef.current = true;
      revalidator.revalidate();
      return;
    }
    if (data.message) {
      shopify.toast.show(data.message, { isError: true });
    }
  }, [fetcher.state, fetcher.data, revalidator, shopify]);

  const updateFormState = useCallback((patch: Partial<ProductDetailFormState>) => {
    setFormState((current) => ({ ...current, ...patch }));
  }, []);

  const trackPendingFile = useCallback((key: string, file: File | null) => {
    setPendingFiles((current) => {
      const next = { ...current };
      if (file) {
        next[key] = file;
      } else {
        delete next[key];
      }
      return next;
    });
    setLocalPreviewUrls((current) => {
      const next = { ...current };
      if (current[key]) {
        URL.revokeObjectURL(current[key]);
        delete next[key];
      }
      if (file) {
        next[key] = URL.createObjectURL(file);
      }
      return next;
    });
  }, []);

  const resolvePreviewUrl = useCallback(
    (gid: string | undefined, localKey: string) => {
      if (localPreviewUrls[localKey]) return localPreviewUrls[localKey];
      if (gid?.startsWith("gid://")) return filePreviewUrls[gid];
      return gid?.startsWith("http") ? gid : undefined;
    },
    [filePreviewUrls, localPreviewUrls],
  );

  const addFeature = useCallback(() => {
    setFormState((current) => ({
      ...current,
      features: [...current.features, ""],
    }));
  }, []);

  const removeFeature = useCallback((index: number) => {
    setFormState((current) => ({
      ...current,
      features: current.features.filter((_, i) => i !== index),
    }));
  }, []);

  const updateFeature = useCallback((index: number, value: string) => {
    setFormState((current) => ({
      ...current,
      features: current.features.map((f, i) => (i === index ? value : f)),
    }));
  }, []);

  const getOptionIconGid = useCallback(
    (optionName: string, optionValue: string) => {
      const icon = formState.optionIcons.find(
        (i) => i.optionName === optionName && i.optionValue === optionValue,
      );
      return icon?.iconGid;
    },
    [formState.optionIcons],
  );

  const getOptionIconFilename = useCallback(
    (optionName: string, optionValue: string) => {
      const icon = formState.optionIcons.find(
        (i) => i.optionName === optionName && i.optionValue === optionValue,
      );
      return icon?.iconFilename;
    },
    [formState.optionIcons],
  );

  const setOptionIcon = useCallback(
    (optionName: string, optionValue: string, iconGid: string | undefined, iconFilename: string | undefined) => {
      setFormState((current) => {
        const existingIndex = current.optionIcons.findIndex(
          (i) => i.optionName === optionName && i.optionValue === optionValue,
        );
        let nextIcons = [...current.optionIcons];
        if (existingIndex >= 0) {
          nextIcons[existingIndex] = { optionName, optionValue, iconGid, iconFilename };
        } else {
          nextIcons.push({ optionName, optionValue, iconGid, iconFilename });
        }
        return { ...current, optionIcons: nextIcons };
      });
    },
    [],
  );

  const saveGlobalMode = () => {
    fetcher.submit(
      { intent: "saveGlobalMode", mode: globalMode },
      { method: "post" },
    );
  };

  const handleSave = () => {
    if (!selectedProductId) return;
    const hasPendingFiles = Object.keys(pendingFiles).length > 0;
    if (!hasPendingFiles) {
      fetcher.submit(
        {
          intent: "saveProductConfig",
          productId: selectedProductId,
          config: JSON.stringify(formState),
        },
        { method: "post" },
      );
      return;
    }
    const formData = new FormData();
    formData.append("intent", "saveProductConfig");
    formData.append("productId", selectedProductId);
    formData.append("config", JSON.stringify(formState));
    for (const [key, file] of Object.entries(pendingFiles)) {
      formData.append(key, file);
    }
    fetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
  };

  return (
    <s-page heading="Product Detail">
      <s-button
        slot="primary-action"
        onClick={handleSave}
        {...(isSubmitting ? { loading: true } : {})}
      >
        Save
      </s-button>

      <s-section heading="Global mode">
        <s-stack direction="block" gap="base">
          <s-select
            value={globalMode}
            onChange={(event: any) =>
              setGlobalMode(event.currentTarget.value as ProductDetailGlobalMode)
            }
          >
            <s-option value="off">Off</s-option>
            <s-option value="all_on">All products</s-option>
            <s-option value="per_product">Per product</s-option>
          </s-select>
          <s-button type="button" variant="secondary" onClick={saveGlobalMode}>
            Save global mode
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Select product">
        <s-stack direction="block" gap="base">
          <form method="get">
            <s-stack direction="inline" gap="base">
              <s-text-field
                name="q"
                value={searchInput}
                onChange={(event: any) => setSearchInput(event.currentTarget.value)}
                placeholder="Search products..."
              />
              <s-button type="submit">Search</s-button>
            </s-stack>
          </form>

          {selectedProduct && (
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="small">
                <s-text type="strong">{selectedProduct.title}</s-text>
                <s-text tone="neutral">/{selectedProduct.handle}</s-text>
              </s-stack>
            </s-box>
          )}

          {products.length > 0 && (
            <s-select
              value={selectedProductId}
              onChange={(event: any) => {
                const productId = event.currentTarget.value;
                if (productId) {
                  window.location.href = `/app/product-detail?product=${encodeURIComponent(productId)}`;
                }
              }}
            >
              <s-option value="">Select a product</s-option>
              {products.map((p) => (
                <s-option key={p.id} value={p.id}>
                  {p.title}
                </s-option>
              ))}
            </s-select>
          )}
        </s-stack>
      </s-section>

      {selectedProductId && productConfig && (
        <s-section heading="Product configuration">
          <s-stack direction="block" gap="base">
            <s-switch
              label="Enable custom product detail"
              checked={formState.enabled}
              onChange={(event: any) =>
                updateFormState({ enabled: event.currentTarget.checked })
              }
            />

            <MediaField
              name="three60BadgeImage"
              label="360° Badge"
              value={formState.three60BadgeImage}
              previewUrl={resolvePreviewUrl(
                formState.three60BadgeImage,
                "three60BadgeImage",
              )}
              onChange={(file) => trackPendingFile("three60BadgeImage", file)}
            />

            <MediaField
              name="playButtonImage"
              label="Play Button"
              value={formState.playButtonImage}
              previewUrl={resolvePreviewUrl(formState.playButtonImage, "playButtonImage")}
              onChange={(file) => trackPendingFile("playButtonImage", file)}
            />

            <MediaField
              name="zoomButtonImage"
              label="Zoom Button"
              value={formState.zoomButtonImage}
              previewUrl={resolvePreviewUrl(formState.zoomButtonImage, "zoomButtonImage")}
              onChange={(file) => trackPendingFile("zoomButtonImage", file)}
            />

            <MediaField
              name="tab3dImage"
              label="Tab 3D"
              value={formState.tab3dImage}
              previewUrl={resolvePreviewUrl(formState.tab3dImage, "tab3dImage")}
              onChange={(file) => trackPendingFile("tab3dImage", file)}
            />

            <MediaField
              name="tabPartsImage"
              label="Tab Parts"
              value={formState.tabPartsImage}
              previewUrl={resolvePreviewUrl(formState.tabPartsImage, "tabPartsImage")}
              onChange={(file) => trackPendingFile("tabPartsImage", file)}
            />

            <MediaField
              name="tabVideoImage"
              label="Tab Video"
              value={formState.tabVideoImage}
              previewUrl={resolvePreviewUrl(formState.tabVideoImage, "tabVideoImage")}
              onChange={(file) => trackPendingFile("tabVideoImage", file)}
            />

            <s-text-field
              label="Subtitle"
              value={formState.subtitle ?? ""}
              onChange={(event: any) =>
                updateFormState({ subtitle: event.currentTarget.value || undefined })
              }
            />

            <s-number-field
              label="Rating"
              value={String(formState.rating ?? "")}
              min={0}
              max={5}
              step={0.1}
              onChange={(event: any) => {
                const val = event.currentTarget.value;
                updateFormState({ rating: val ? Number(val) : undefined });
              }}
            />

            <MediaField
              name="ratingImage"
              label="Rating stars icon"
              value={formState.ratingImage}
              previewUrl={resolvePreviewUrl(formState.ratingImage, "ratingImage")}
              onChange={(file) => trackPendingFile("ratingImage", file)}
            />

            <s-section heading="Features">
              <s-stack direction="block" gap="base">
                {formState.features.map((feature, index) => (
                  <s-stack key={index} direction="inline" gap="base">
                    <s-text-field
                      value={feature}
                      onChange={(event: any) =>
                        updateFeature(index, event.currentTarget.value)
                      }
                    />
                    <s-button
                      type="button"
                      variant="secondary"
                      tone="critical"
                      onClick={() => removeFeature(index)}
                    >
                      Remove
                    </s-button>
                  </s-stack>
                ))}
                <s-button type="button" variant="secondary" onClick={addFeature}>
                  Add feature
                </s-button>
              </s-stack>
            </s-section>

            {productOptions.map((option) => (
              <s-section key={option.name} heading={`Option icons: ${option.name}`}>
                <s-stack direction="block" gap="base">
                  {option.values.map((value) => {
                    const iconGid = getOptionIconGid(option.name, value);
                    const localKey = `optionIcon.${option.name}.${value}`;
                    return (
                      <MediaField
                        key={value}
                        name={`optionIcon.${option.name}.${value}`}
                        label={value}
                        value={iconGid}
                        previewUrl={resolvePreviewUrl(iconGid, localKey)}
                        onChange={(file) => {
                          if (file) {
                            trackPendingFile(localKey, file);
                            // Keep iconGid undefined until upload resolves in action
                            setOptionIcon(option.name, value, undefined, undefined);
                          } else {
                            trackPendingFile(localKey, null);
                            setOptionIcon(option.name, value, undefined, undefined);
                          }
                        }}
                      />
                    );
                  })}
                </s-stack>
              </s-section>
            ))}

            <MediaField
              name="qtyMinusImage"
              label="Qty minus icon"
              value={formState.qtyMinusImage}
              previewUrl={resolvePreviewUrl(formState.qtyMinusImage, "qtyMinusImage")}
              onChange={(file) => trackPendingFile("qtyMinusImage", file)}
            />

            <MediaField
              name="qtyPlusImage"
              label="Qty plus icon"
              value={formState.qtyPlusImage}
              previewUrl={resolvePreviewUrl(formState.qtyPlusImage, "qtyPlusImage")}
              onChange={(file) => trackPendingFile("qtyPlusImage", file)}
            />

            <s-text-field
              label="Add to cart text"
              value={formState.addToCartText ?? PRODUCT_DETAIL_DEFAULTS.addToCartText}
              onChange={(event: any) =>
                updateFormState({ addToCartText: event.currentTarget.value })
              }
            />
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS with no errors

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS with no errors

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.product-detail.tsx
git commit -m "feat(product-detail): add admin configuration page"
```

---

### Task 6: Theme Extension Liquid Block

**Files:**
- Create: `extensions/bc-design-theme/blocks/product_detail.liquid`

**Interfaces:**
- Consumes: `product.metafields['$app'].product_detail_config.value`, `app.metafields['$app'].product_detail_global_mode.value`
- Produces: Product detail HTML markup, JSON variant data, deferred JS/CSS loads

- [ ] **Step 1: Create the Liquid block**

Create `extensions/bc-design-theme/blocks/product_detail.liquid`:

```liquid
{% assign global_config = app.metafields['$app'].product_detail_global_mode.value %}
{% assign global_mode = global_config.mode | default: 'per_product' %}
{% assign config = product.metafields['$app'].product_detail_config.value %}

{% assign should_render = false %}
{% if global_mode == 'all_on' and config != blank %}
  {% assign should_render = true %}
{% elsif global_mode == 'per_product' and config.enabled == true %}
  {% assign should_render = true %}
{% endif %}

{% unless template.name == 'product' and should_render %}
{% else %}

<style>
  #shopify-block-{{ block.id }} {
    width: 100vw;
    max-width: 100vw;
    margin-left: calc(50% - 50vw);
    margin-right: calc(50% - 50vw);
  }
  .bc-design-embed--pending { visibility: hidden; }
</style>

<div
  data-bc-design-embed="product-detail"
  class="bc-design-embed--pending"
  {{ block.shopify_attributes }}
>
  <script type="application/json" data-bc-pd-data>
    {
      "variants": [
        {% for v in product.variants %}
        {% assign v_has_compare = false %}
        {% if v.compare_at_price > v.price %}
          {% assign v_has_compare = true %}
        {% endif %}
        {%- capture v_compare_html -%}{% if v_has_compare %}{{ v.compare_at_price | money }}{% endif %}{%- endcapture -%}
        {%- capture v_save_html -%}{% if v_has_compare %}Save {{ v.compare_at_price | minus: v.price | money }}{% endif %}{%- endcapture -%}
        {
          "id": {{ v.id | json }},
          "options": {{ v.options | json }},
          "available": {{ v.available | json }},
          "priceHtml": {{ v.price | money | json }},
          "hasCompareAt": {{ v_has_compare | json }},
          "compareAtHtml": {{ v_compare_html | json }},
          "saveHtml": {{ v_save_html | json }}
        }{% unless forloop.last %},{% endunless %}
        {% endfor %}
      ],
      "options": {{ product.options | json }}
    }
  </script>

  <section class="bc-product-detail">
    <div class="bc-product-detail__inner">
      <!-- LEFT: Media Stage -->
      <section class="bc-product-detail__media">
        <div class="bc-product-media__stage">
          {% if config.three60BadgeImageFilename != blank %}
            <div class="bc-badge-360">
              <img src="{{ config.three60BadgeImageFilename | file_url }}" alt="3D View">
            </div>
          {% endif %}

          <div class="bc-product-media__hero">
            {% if product.featured_image %}
              <img
                src="{{ product.featured_image | image_url: width: 1200 }}"
                alt="{{ product.title | escape }}"
                loading="eager"
              >
            {% else %}
              <div class="bc-product-media__placeholder" aria-hidden="true"></div>
            {% endif %}
            {% if config.playButtonImageFilename != blank %}
              <button class="bc-play-btn" aria-label="Play 360° view">
                <img src="{{ config.playButtonImageFilename | file_url }}" alt="Play">
              </button>
            {% endif %}
          </div>

          {% if config.zoomButtonImageFilename != blank %}
            <button class="bc-zoom-btn" aria-label="Zoom image">
              <img src="{{ config.zoomButtonImageFilename | file_url }}" alt="Zoom">
            </button>
          {% endif %}
        </div>

        <div class="bc-product-media__tabs">
          <button class="bc-tab bc-tab--active" data-tab="3d">
            {% if config.tab3dImageFilename != blank %}
              <img src="{{ config.tab3dImageFilename | file_url }}" alt="">
            {% endif %}
            <span>3D</span>
          </button>
          <button class="bc-tab" data-tab="parts">
            {% if config.tabPartsImageFilename != blank %}
              <img src="{{ config.tabPartsImageFilename | file_url }}" alt="">
            {% endif %}
            <span>物品清单</span>
          </button>
          <button class="bc-tab" data-tab="video">
            {% if config.tabVideoImageFilename != blank %}
              <img src="{{ config.tabVideoImageFilename | file_url }}" alt="">
            {% endif %}
            <span>Video</span>
          </button>
        </div>
      </section>

      <!-- RIGHT: Product Info -->
      <section class="bc-product-detail__info">
        <h1 class="bc-product-title">{{ product.title }}</h1>

        <div class="bc-product-subtitle-row">
          {% if config.subtitle != blank %}
            <span>{{ config.subtitle }}</span>
          {% endif %}
          {% if config.rating != blank %}
            <span class="bc-rating">{{ config.rating }}</span>
            {% if config.ratingImageFilename != blank %}
              <img src="{{ config.ratingImageFilename | file_url }}" alt="Rating">
            {% endif %}
          {% endif %}
        </div>

        {% if config.features.size > 0 %}
          <div class="bc-features-card">
            <h2>Features</h2>
            <ul>
              {% for feature in config.features %}
                <li>{{ feature }}</li>
              {% endfor %}
            </ul>
          </div>
        {% endif %}

        <!-- Variant Options -->
        <form class="bc-product-form" data-variant-id="{{ product.selected_or_first_available_variant.id }}" data-add-to-cart-text="{{ config.addToCartText | default: 'Add to cart' | escape }}">
          {% for option in product.options_with_values %}
            <div class="bc-option-group" data-option-name="{{ option.name | escape }}">
              <h2>{{ option.name }}</h2>
              <div class="bc-option-pills">
                {% for value in option.values %}
                  {% assign icon_filename = nil %}
                  {% for icon in config.optionIcons %}
                    {% if icon.optionName == option.name and icon.optionValue == value.value %}
                      {% assign icon_filename = icon.iconFilename %}
                    {% endif %}
                  {% endfor %}

                  <button
                    type="button"
                    class="bc-option-pill{% if value.selected %} bc-option-pill--active{% endif %}"
                    data-value="{{ value.value | escape }}"
                    {% unless value.available %}disabled data-disabled="true"{% endunless %}
                  >
                    {% if icon_filename != blank %}
                      <img src="{{ icon_filename | file_url }}" alt="">
                    {% endif %}
                    <span>{{ value.value }}</span>
                  </button>
                {% endfor %}
              </div>
            </div>
          {% endfor %}

          <!-- Quantity -->
          <div class="bc-quantity-row">
            <span>Quantity</span>
            <div class="bc-qty-stepper">
              <button type="button" class="bc-qty-btn bc-qty-minus" aria-label="Decrease">
                {% if config.qtyMinusImageFilename != blank %}
                  <img src="{{ config.qtyMinusImageFilename | file_url }}" alt="-">
                {% else %}-{% endif %}
              </button>
              <span class="bc-qty-value">1</span>
              <button type="button" class="bc-qty-btn bc-qty-plus" aria-label="Increase">
                {% if config.qtyPlusImageFilename != blank %}
                  <img src="{{ config.qtyPlusImageFilename | file_url }}" alt="+">
                {% else %}+{% endif %}
              </button>
            </div>
          </div>

          <!-- Price -->
          <div class="bc-price-row">
            <span class="bc-price-current" data-current-price>
              {{ product.selected_or_first_available_variant.price | money }}
            </span>
            <span class="bc-price-save" data-save-price style="display:none;"></span>
            <span class="bc-price-compare" data-compare-price style="display:none;"></span>
          </div>

          <button
            type="button"
            class="bc-add-to-cart"
            {% unless product.selected_or_first_available_variant.available %}disabled{% endunless %}
          >
            {{ config.addToCartText | default: "Add to cart" }}
          </button>
        </form>
      </section>
    </div>
  </section>
</div>

<script>
(function () {
  var embed = document.querySelector('[data-bc-design-embed="product-detail"]');
  if (!embed) return;
  var timer = setTimeout(function () {
    embed.classList.remove('bc-design-embed--pending');
  }, 3000);
  embed.dataset.bcDesignRevealFallback = String(timer);
})();
</script>
<script src="{{ 'product-detail.js' | asset_url }}" defer></script>
<script src="{{ 'bc-design-embed-placement.js' | asset_url }}" defer></script>

{% endunless %}

{% schema %}
{
  "name": "t:blocks.product_detail.name",
  "target": "body",
  "stylesheet": "product-detail.css",
  "settings": [
    {
      "type": "paragraph",
      "content": "Configure in Apps → BC Design → Product Detail. Renders only on product pages with enabled config."
    }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Validate Liquid syntax**

There is no automated Liquid validator in this repo. Manually review the file for:
- Matching `{% if %}` / `{% endif %}` pairs
- Matching `{% for %}` / `{% endfor %}` pairs
- Matching `{% unless %}` / `{% endunless %}` pairs
- Valid JSON inside `{% schema %}`

- [ ] **Step 3: Commit**

```bash
git add extensions/bc-design-theme/blocks/product_detail.liquid
git commit -m "feat(product-detail): add Theme App Extension Liquid block"
```

---

### Task 7: Client-Side Product Detail JS

**Files:**
- Create: `extensions/bc-design-theme/assets/product-detail.js`

**Interfaces:**
- Consumes: JSON data from `script[data-bc-pd-data]` (variants array, options array)
- Produces: Variant selection, quantity stepper, async add-to-cart, cart count sync

- [ ] **Step 1: Create the JS file**

Create `extensions/bc-design-theme/assets/product-detail.js`:

```javascript
(function () {
  'use strict';

  var root = document.querySelector('[data-bc-design-embed="product-detail"]');
  if (!root) return;

  var dataScript = root.querySelector('script[data-bc-pd-data]');
  if (!dataScript) return;

  var pd;
  try {
    pd = JSON.parse(dataScript.textContent);
  } catch (e) {
    console.error('[BC Design] Failed to parse product detail data', e);
    return;
  }

  var form = root.querySelector('.bc-product-form');
  var addToCartBtn = root.querySelector('.bc-add-to-cart');
  var qtyValue = root.querySelector('.bc-qty-value');
  var currentPrice = root.querySelector('.bc-price-current');
  var comparePrice = root.querySelector('.bc-price-compare');
  var savePrice = root.querySelector('.bc-price-save');
  var optionGroups = root.querySelectorAll('.bc-option-group');

  var selectedOptions = {};
  pd.options.forEach(function (opt, i) {
    var selectedBtn = null;
    optionGroups.forEach(function (group) {
      if (group.dataset.optionName === opt) {
        selectedBtn = group.querySelector('.bc-option-pill--active');
      }
    });
    selectedOptions[opt] = selectedBtn ? selectedBtn.dataset.value : (pd.variants[0] ? pd.variants[0].options[i] : '');
  });

  // Initial state sync
  updateVariant(findVariantByOptions());

  function findVariantByOptions() {
    return pd.variants.find(function (v) {
      return v.options.every(function (val, i) {
        return val === selectedOptions[pd.options[i]];
      });
    });
  }

  function updateVariant(variant) {
    if (!variant) {
      if (addToCartBtn) {
        addToCartBtn.disabled = true;
        addToCartBtn.textContent = 'Unavailable';
      }
      form.removeAttribute('data-variant-id');
      if (currentPrice) currentPrice.textContent = 'Unavailable';
      if (comparePrice) { comparePrice.style.display = 'none'; comparePrice.innerHTML = ''; }
      if (savePrice) { savePrice.style.display = 'none'; savePrice.innerHTML = ''; }
      return;
    }
    form.dataset.variantId = String(variant.id);
    if (currentPrice) currentPrice.innerHTML = variant.priceHtml;
    if (comparePrice) {
      comparePrice.style.display = variant.hasCompareAt ? '' : 'none';
      comparePrice.innerHTML = variant.compareAtHtml;
    }
    if (savePrice) {
      savePrice.style.display = variant.hasCompareAt ? '' : 'none';
      savePrice.innerHTML = variant.saveHtml;
    }
    if (addToCartBtn) {
      addToCartBtn.disabled = !variant.available;
      if (addToCartBtn.textContent === 'Unavailable') {
        addToCartBtn.textContent = form.dataset.addToCartText || 'Add to cart';
      }
    }
  }

  optionGroups.forEach(function (group) {
    group.querySelectorAll('.bc-option-pill').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var optionName = group.dataset.optionName;
        var value = btn.dataset.value;
        selectedOptions[optionName] = value;

        group.querySelectorAll('.bc-option-pill').forEach(function (p) {
          p.classList.toggle('bc-option-pill--active', p.dataset.value === value);
        });

        var matched = findVariantByOptions();
        updateVariant(matched);
      });
    });
  });

  root.querySelector('.bc-qty-minus')?.addEventListener('click', function () {
    var val = parseInt(qtyValue.textContent, 10) || 1;
    qtyValue.textContent = String(Math.max(1, val - 1));
  });
  root.querySelector('.bc-qty-plus')?.addEventListener('click', function () {
    var val = parseInt(qtyValue.textContent, 10) || 1;
    qtyValue.textContent = String(val + 1);
  });

  if (addToCartBtn) {
    addToCartBtn.addEventListener('click', function () {
      var variantId = form.dataset.variantId;
      var qty = parseInt(qtyValue.textContent, 10) || 1;
      if (!variantId) return;
      addToCartBtn.disabled = true;

      var originalText = addToCartBtn.textContent;
      var didAddToCartSucceed = false;
      fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: variantId, quantity: qty }] })
      })
      .then(function (res) {
        return res.json().catch(function () {
          throw new Error('Unable to add');
        }).then(function (data) {
          if (!res.ok) throw new Error(data.description || data.message || 'Unable to add');
          return data;
        });
      })
      .then(function () {
        didAddToCartSucceed = true;
        addToCartBtn.textContent = 'Added ✓';
        addToCartBtn.style.backgroundColor = 'var(--color-bc-pd-primary-500)';
        setTimeout(function () {
          addToCartBtn.textContent = originalText;
          addToCartBtn.style.backgroundColor = '';
          var matched = findVariantByOptions();
          addToCartBtn.disabled = matched ? !matched.available : true;
        }, 1200);
        // Cart sync is independent — failure only warns, doesn't break success feedback
        fetch('/cart.js')
          .then(function (r) { return r.json(); })
          .then(function (cart) {
            document.querySelectorAll('[data-cart-count]').forEach(function (el) {
              el.textContent = String(cart.item_count);
              el.dataset.count = String(cart.item_count);
              if (el.hidden !== undefined) el.hidden = cart.item_count === 0;
            });
          })
          .catch(function (syncErr) {
            console.warn('[BC Design] Cart count sync failed:', syncErr);
          });
      })
      .catch(function (err) {
        console.error('[BC Design] Add to cart failed:', err);
        addToCartBtn.textContent = err.message || 'Failed';
        setTimeout(function () {
          addToCartBtn.textContent = originalText;
        }, 1200);
      })
      .finally(function () {
        if (!didAddToCartSucceed) {
          var matched = findVariantByOptions();
          addToCartBtn.disabled = matched ? !matched.available : true;
        }
        // Success path re-enables inside its setTimeout to prevent double-add
      });
    });
  }
})();
```

- [ ] **Step 2: Commit**

```bash
git add extensions/bc-design-theme/assets/product-detail.js
git commit -m "feat(product-detail): add client-side variant selection and add-to-cart"
```

---

### Task 8: Embed Placement — Product Detail Branch

**Files:**
- Modify: `extensions/bc-design-theme/assets/bc-design-embed-placement.js`
- Test: `extensions/bc-design-theme/assets/bc-design-embed-placement.test.js`

**Interfaces:**
- Consumes: `data-bc-design-embed="product-detail"` DOM element
- Produces: Product detail block inserted at top of `<main>` or before native product section

- [ ] **Step 1: Add product detail selector and placement logic**

In `extensions/bc-design-theme/assets/bc-design-embed-placement.js`, after the `BANNER_SELECTOR` constant (line 5), add:

```javascript
  const PRODUCT_DETAIL_SELECTOR = '[data-bc-design-embed="product-detail"]';
```

In the `runPlacement()` function (after line 150), add the product detail placement block:

```javascript
  function runPlacement() {
    try {
      const navEmbed = document.querySelector(NAV_SELECTOR);
      const bannerEmbed = document.querySelector(BANNER_SELECTOR);
      const pdEmbed = document.querySelector(PRODUCT_DETAIL_SELECTOR);
      const navBlock = getBlockWrapper(navEmbed);
      const bannerBlock = getBlockWrapper(bannerEmbed);
      const pdBlock = getBlockWrapper(pdEmbed);
      const anchor = findInsertAnchor();

      if (!isPlacementCorrect(navBlock, bannerBlock, anchor)) {
        moveBlock(navBlock, anchor);

        const bannerAnchor = navBlock
          ? { node: navBlock, position: 'after' }
          : anchor;
        moveBlock(bannerBlock, bannerAnchor);
      }

      // Product detail placement: prefer main top, then before native product section
      if (pdBlock) {
        const pageTarget = document.querySelector('main, #MainContent, [role="main"]');
        if (pageTarget) {
          if (pageTarget.firstElementChild !== pdBlock) {
            pageTarget.insertBefore(pdBlock, pageTarget.firstElementChild);
          }
        } else {
          const sectionTarget = document.querySelector('.shopify-section-main-product, #shopify-section-main-product');
          if (sectionTarget?.parentNode) {
            sectionTarget.parentNode.insertBefore(pdBlock, sectionTarget);
          } else {
            document.body.insertBefore(pdBlock, document.body.firstElementChild);
          }
        }
      }

      applyBannerSpacing(navEmbed, bannerBlock);
    } catch (error) {
      console.warn('[BC Design] embed placement failed', error);
    } finally {
      revealEmbeds();
    }
  }
```

- [ ] **Step 2: Add tests for product detail placement**

In `extensions/bc-design-theme/assets/bc-design-embed-placement.test.js`, add these tests to the existing `describe('bc-design-embed-placement', ...)` block (before the closing `});` of that block):

```javascript
  it('places product detail at top of main when main exists', async () => {
    const window = new Window();
    const document = window.document;
    mountGlobals(window);
    document.body.innerHTML = '<a href="#MainContent" class="skip-to-content">Skip</a><main id="MainContent"></main><div id="shopify-block-pd"><div data-bc-design-embed="product-detail" class="bc-design-embed--pending"></div></div>';
    vi.resetModules();
    await import('./bc-design-embed-placement.js');
    window.BCDesignEmbedPlacement.run();
    const main = document.getElementById('MainContent');
    const pdBlock = document.getElementById('shopify-block-pd');
    expect(main.firstElementChild).toBe(pdBlock);
  });

  it('places product detail before native product section when main absent', async () => {
    const window = new Window();
    const document = window.document;
    mountGlobals(window);
    document.body.innerHTML = '<div class="shopify-section-main-product">Native Product</div><div id="shopify-block-pd"><div data-bc-design-embed="product-detail" class="bc-design-embed--pending"></div></div>';
    vi.resetModules();
    await import('./bc-design-embed-placement.js');
    window.BCDesignEmbedPlacement.run();
    const nativeSection = document.querySelector('.shopify-section-main-product');
    const pdBlock = document.getElementById('shopify-block-pd');
    expect(nativeSection.previousElementSibling).toBe(pdBlock);
  });

  it('places product detail at body start as fallback', async () => {
    const window = new Window();
    const document = window.document;
    mountGlobals(window);
    document.body.innerHTML = '<div>Other</div><div id="shopify-block-pd"><div data-bc-design-embed="product-detail" class="bc-design-embed--pending"></div></div>';
    vi.resetModules();
    await import('./bc-design-embed-placement.js');
    window.BCDesignEmbedPlacement.run();
    const pdBlock = document.getElementById('shopify-block-pd');
    expect(document.body.firstElementChild).toBe(pdBlock);
  });

  it('coexists: nav, banner, and product detail all placed correctly', async () => {
    const window = new Window();
    const document = window.document;
    mountGlobals(window);
    document.body.innerHTML = '<a href="#MainContent" class="skip-to-content">Skip</a><main id="MainContent"></main>' +
      '<div id="shopify-block-nav"><div data-bc-design-embed="navigation" class="bc-design-embed--pending"><nav class="navbar" style="height:80px"></nav></div></div>' +
      '<div id="shopify-block-banner"><div data-bc-design-embed="banner" class="bc-design-embed--pending"></div></div>' +
      '<div id="shopify-block-pd"><div data-bc-design-embed="product-detail" class="bc-design-embed--pending"></div></div>';
    vi.resetModules();
    await import('./bc-design-embed-placement.js');
    window.BCDesignEmbedPlacement.run();
    const skip = document.querySelector('.skip-to-content');
    const navBlock = document.getElementById('shopify-block-nav');
    const bannerBlock = document.getElementById('shopify-block-banner');
    const main = document.getElementById('MainContent');
    const pdBlock = document.getElementById('shopify-block-pd');
    expect(skip.nextElementSibling).toBe(navBlock);
    expect(navBlock.nextElementSibling).toBe(bannerBlock);
    expect(main.firstElementChild).toBe(pdBlock);
  });
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass, including the 4 new product-detail placement tests

- [ ] **Step 4: Commit**

```bash
git add extensions/bc-design-theme/assets/bc-design-embed-placement.js extensions/bc-design-theme/assets/bc-design-embed-placement.test.js
git commit -m "feat(product-detail): add embed placement logic and tests"
```

---

### Task 9: Navigation Cart Badge

**Files:**
- Modify: `extensions/bc-design-theme/snippets/nav_header_icons.liquid`

**Interfaces:**
- Consumes: Nothing
- Produces: Cart badge span now also exposes `data-count` for JS cart sync (reuses existing `data-cart-count`)

- [ ] **Step 1: Update cart badge span**

In `extensions/bc-design-theme/snippets/nav_header_icons.liquid`, replace the cart badge span (lines 19-25):

```liquid
  <span
    class="cart-count-badge{% if cart.item_count == 0 %} cart-count-badge--hidden{% endif %}"
    data-cart-count
    data-count="{{ cart.item_count }}"
    aria-hidden="{% if cart.item_count == 0 %}true{% else %}false{% endif %}"
  >
    {%- if cart.item_count > 99 -%}99+{%- else -%}{{ cart.item_count }}{%- endif -%}
  </span>
```

The key change is adding `data-count` alongside the existing `data-cart-count` on the badge span so the JS cart sync can read the current count.

- [ ] **Step 2: Commit**

```bash
git add extensions/bc-design-theme/snippets/nav_header_icons.liquid
git commit -m "feat(product-detail): add data-count to cart badge for JS sync"
```

---

### Task 10: Tailwind CSS Source

**Files:**
- Create: `tailwind/bc-design-theme/product-detail.tailwind.css`

**Interfaces:**
- Consumes: Nothing
- Produces: Compiled `extensions/bc-design-theme/assets/product-detail.css`

- [ ] **Step 1: Create Tailwind source file**

Create `tailwind/bc-design-theme/product-detail.tailwind.css`:

```css
@layer theme, components, utilities;

@import "tailwindcss/theme.css" layer(theme);
@reference "tailwindcss";

@theme {
  --color-bc-pd-ink: oklch(21.08% 0.018 285.94);
  --color-bc-pd-ink-secondary: oklch(46.4% 0.026 285.94);
  --color-bc-pd-primary-500: oklch(58.83% 0.194 146.08);
  --color-bc-pd-accent-500: oklch(53.18% 0.241 21.53);
  --color-bc-pd-surface: oklch(97.88% 0.005 286.28);
  --color-bc-pd-border: oklch(88.39% 0.015 285.94);
  --color-bc-pd-neutral-100: oklch(92% 0.005 264);
}

@layer components {
  .bc-product-detail {
    @apply w-full bg-bc-pd-surface;
    padding: clamp(24px, 2.778vw, 40px) clamp(16px, 4.167vw, 60px);
  }

  .bc-product-detail__inner {
    @apply grid mx-auto;
    gap: clamp(1rem, 3.333vw, 5rem);
    max-width: 2400px;
    grid-template-columns: 1fr;
  }

  @media (min-width: 990px) {
    .bc-product-detail__inner {
      grid-template-columns: 58fr 38fr;
    }
  }

  .bc-product-detail__media {
    @apply flex flex-col;
    gap: clamp(0.5rem, 1.25vw, 1.875rem);
  }

  .bc-product-media__stage {
    @apply relative rounded-lg overflow-hidden;
    background: var(--color-bc-pd-neutral-100);
    aspect-ratio: 1 / 1;
  }

  .bc-product-media__hero {
    @apply flex items-center justify-center w-full h-full;
  }

  .bc-product-media__hero img {
    @apply w-full h-full object-contain;
  }

  .bc-product-media__placeholder {
    @apply w-full h-full bg-bc-pd-border/30;
  }

  .bc-badge-360 {
    @apply absolute top-4 left-4 z-10 flex items-center justify-center;
    background: var(--color-bc-pd-primary-500);
    width: clamp(60px, 5vw, 120px);
    height: clamp(60px, 5vw, 120px);
  }

  .bc-badge-360 img {
    @apply w-8 h-auto;
  }

  .bc-play-btn {
    @apply absolute z-10 p-0 border-0 cursor-pointer flex items-center justify-center rounded-full;
    bottom: 20%;
    right: 20%;
    background: oklch(0% 0 0 / 0.3);
    width: clamp(80px, 8.33vw, 200px);
    height: clamp(80px, 8.33vw, 200px);
  }

  .bc-play-btn img {
    @apply w-10 h-auto;
  }

  .bc-zoom-btn {
    @apply absolute bottom-4 right-4 z-10 p-0 border-0 cursor-pointer flex items-center justify-center rounded-full;
    background: oklch(0% 0 0 / 0.3);
    width: clamp(50px, 4.17vw, 100px);
    height: clamp(50px, 4.17vw, 100px);
  }

  .bc-zoom-btn img {
    @apply w-6 h-auto;
  }

  .bc-product-media__tabs {
    @apply flex;
    gap: clamp(1.25rem, 4.167vw, 6.25rem);
  }

  .bc-tab {
    @apply flex items-center gap-2 px-4 py-2 rounded-full border cursor-pointer transition-colors;
    border-color: var(--color-bc-pd-border);
    background: white;
    color: var(--color-bc-pd-ink);
  }

  .bc-tab--active {
    background: var(--color-bc-pd-ink-secondary);
    border-color: var(--color-bc-pd-ink-secondary);
    color: white;
  }

  .bc-tab img {
    @apply w-5 h-5 object-contain;
  }

  .bc-product-detail__info {
    @apply flex flex-col;
    gap: clamp(0.75rem, 2.5vw, 3.75rem);
  }

  .bc-product-title {
    @apply font-semibold m-0;
    font-size: clamp(2rem, 4.167vw, 6.25rem);
    color: var(--color-bc-pd-ink);
  }

  .bc-product-subtitle-row {
    @apply flex items-center flex-wrap;
    gap: clamp(0.25rem, 0.833vw, 1.25rem);
    color: var(--color-bc-pd-ink-secondary);
  }

  .bc-rating {
    @apply font-semibold;
    color: var(--color-bc-pd-accent-500);
  }

  .bc-features-card {
    @apply rounded-lg;
    background: var(--color-bc-pd-surface);
    padding: clamp(24px, 2.5vw, 60px);
  }

  .bc-features-card h2 {
    @apply font-normal m-0 mb-6;
    font-size: clamp(1rem, 1.667vw, 2.5rem);
    color: var(--color-bc-pd-ink);
  }

  .bc-features-card ul {
    @apply list-none p-0 m-0 flex flex-col;
    gap: clamp(0.5rem, 1.667vw, 2.5rem);
  }

  .bc-features-card li {
    @apply relative;
    font-size: clamp(0.875rem, 1.042vw, 1.75rem);
    color: var(--color-bc-pd-ink-secondary);
    padding-left: clamp(0.75rem, 1.25vw, 1.875rem);
  }

  .bc-features-card li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.6em;
    width: 0.25em;
    height: 0.25em;
    border-radius: 50%;
    background-color: var(--color-bc-pd-ink-secondary);
  }

  .bc-product-form {
    @apply flex flex-col;
    gap: clamp(0.75rem, 2.5vw, 3.75rem);
  }

  .bc-option-group h2 {
    @apply font-normal m-0 mb-4;
    font-size: clamp(1rem, 1.667vw, 2.5rem);
    color: var(--color-bc-pd-ink);
  }

  .bc-option-pills {
    @apply flex flex-wrap;
    gap: clamp(0.25rem, 0.833vw, 1.25rem);
  }

  .bc-option-pill {
    @apply inline-flex items-center gap-2 px-4 py-2 rounded-full border cursor-pointer transition-colors bg-white;
    font-size: clamp(0.875rem, 1.042vw, 1.75rem);
    border-color: var(--color-bc-pd-ink-secondary);
    color: var(--color-bc-pd-ink-secondary);
  }

  .bc-option-pill:hover:not(:disabled) {
    border-color: var(--color-bc-pd-ink);
  }

  .bc-option-pill--active {
    border-color: var(--color-bc-pd-ink);
    color: var(--color-bc-pd-ink);
  }

  .bc-option-pill:not(.bc-option-pill--active):not(:disabled):not([data-disabled="true"]) img {
    filter: grayscale(1) opacity(0.5);
  }

  .bc-option-pill:disabled,
  .bc-option-pill[data-disabled="true"] {
    @apply opacity-40 cursor-not-allowed;
  }

  .bc-option-pill[data-disabled="true"] img {
    filter: grayscale(1) opacity(0.3);
  }

  .bc-option-pill[data-disabled="true"] span {
    text-decoration: line-through;
  }

  .bc-option-pill img {
    @apply w-5 h-5 object-contain;
  }

  .bc-quantity-row {
    @apply flex items-center justify-between;
  }

  .bc-qty-stepper {
    @apply inline-flex items-center justify-center gap-8 rounded-full;
    background: var(--color-bc-pd-surface);
    padding: clamp(12px, 1.5vw, 24px) clamp(24px, 3vw, 48px);
  }

  .bc-qty-btn {
    @apply p-0 bg-transparent border-0 cursor-pointer flex items-center justify-center;
  }

  .bc-qty-btn img {
    @apply w-5 h-5 object-contain;
  }

  .bc-qty-value {
    @apply font-semibold min-w-[2ch] text-center;
    font-size: clamp(0.875rem, 1.333vw, 2rem);
    color: var(--color-bc-pd-ink);
  }

  .bc-price-row {
    @apply flex items-center flex-wrap;
    gap: clamp(0.5rem, 1.667vw, 2.5rem);
  }

  .bc-price-current {
    @apply font-semibold;
    font-size: clamp(2rem, 4.167vw, 6.25rem);
    color: var(--color-bc-pd-ink);
  }

  .bc-price-compare {
    @apply line-through;
    font-size: clamp(0.875rem, 1.042vw, 1.75rem);
    color: var(--color-bc-pd-ink-secondary);
  }

  .bc-price-save {
    @apply font-medium px-4 py-2 rounded-lg;
    font-size: clamp(0.875rem, 1.042vw, 1.75rem);
    background: oklch(92% 0.05 25);
    color: var(--color-bc-pd-accent-500);
  }

  .bc-add-to-cart {
    @apply w-full py-4 rounded-full font-semibold border-0 cursor-pointer transition-opacity;
    font-size: clamp(0.875rem, 1.042vw, 1.75rem);
    background: var(--color-bc-pd-ink);
    color: white;
  }

  .bc-add-to-cart:hover:not(:disabled) {
    @apply opacity-90;
  }

  .bc-add-to-cart:disabled {
    @apply opacity-40 cursor-not-allowed;
    background: var(--color-bc-pd-border);
    color: var(--color-bc-pd-ink-secondary);
  }
}
```

- [ ] **Step 2: Build CSS once to verify**

Run: `npx tailwindcss -i ./tailwind/bc-design-theme/product-detail.tailwind.css -o ./extensions/bc-design-theme/assets/product-detail.css --minify`
Expected: Command completes successfully; `extensions/bc-design-theme/assets/product-detail.css` is created

- [ ] **Step 3: Commit**

```bash
git add tailwind/bc-design-theme/product-detail.tailwind.css extensions/bc-design-theme/assets/product-detail.css
git commit -m "feat(product-detail): add Tailwind CSS source and build output"
```

---

### Task 11: Package Script Update

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: `tailwind/bc-design-theme/product-detail.tailwind.css`
- Produces: Updated `dev:web` script with third Tailwind watcher

- [ ] **Step 1: Update dev:web script**

In `package.json`, replace the `dev:web` script value:

```json
"dev:web": "npx tailwindcss -i ./tailwind/bc-design-theme/banner-carousel.tailwind.css -o ./extensions/bc-design-theme/assets/banner-carousel.css --watch --minify & npx tailwindcss -i ./tailwind/bc-design-theme/navigation-menu.tailwind.css -o ./extensions/bc-design-theme/assets/navigation-menu.css --watch --minify & npx tailwindcss -i ./tailwind/bc-design-theme/product-detail.tailwind.css -o ./extensions/bc-design-theme/assets/product-detail.css --watch --minify & npx prisma migrate deploy && npm exec react-router dev"
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "build(product-detail): add product-detail.tailwind.css to dev:web script"
```

---

### Task 12: Locale Translations

**Files:**
- Modify: `extensions/bc-design-theme/locales/en.default.schema.json`

**Interfaces:**
- Consumes: Nothing
- Produces: `blocks.product_detail.name` locale entry

- [ ] **Step 1: Add product_detail block name**

In `extensions/bc-design-theme/locales/en.default.schema.json`, update to:

```json
{
  "blocks": {
    "navigation_menu": {
      "name": "BC Design Navigation"
    },
    "banner_carousel": {
      "name": "BC Design Banner"
    },
    "product_detail": {
      "name": "Product detail"
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add extensions/bc-design-theme/locales/en.default.schema.json
git commit -m "feat(product-detail): add block locale translation"
```

---

### Task 13: Product Detail JS Tests

**Files:**
- Create: `extensions/bc-design-theme/assets/product-detail.test.js`

**Interfaces:**
- Consumes: `product-detail.js` logic (variant matching, price updates, add-to-cart)
- Produces: Passing tests for variant switch, unmatched combo, compare/save toggle, add-to-cart non-2xx, cart sync failure

- [ ] **Step 1: Create test file**

Create `extensions/bc-design-theme/assets/product-detail.test.js`:

```javascript
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Window } from 'happy-dom';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mountGlobals(window) {
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Node = window.Node;
  globalThis.setTimeout = window.setTimeout.bind(window);
  globalThis.clearTimeout = window.clearTimeout.bind(window);
  if (globalThis.setInterval) {
    globalThis.setInterval = window.setInterval.bind(window);
    globalThis.clearInterval = window.clearInterval.bind(window);
  }
  globalThis.requestAnimationFrame = (cb) => globalThis.setTimeout(cb, 0);
}

function buildPdFixture(variants, options = []) {
  const variantJson = JSON.stringify({ variants, options });
  return `
    <div data-bc-design-embed="product-detail" class="bc-design-embed--pending">
      <script type="application/json" data-bc-pd-data">${variantJson}</script>
      <form class="bc-product-form" data-variant-id="${variants[0]?.id ?? ''}" data-add-to-cart-text="Add to cart">
        <div class="bc-option-group" data-option-name="Size">
          ${variants.map((v, i) => {
            const val = v.options[0];
            return `<button type="button" class="bc-option-pill${i === 0 ? ' bc-option-pill--active' : ''}" data-value="${val}">${val}</button>`;
          }).join('')}
        </div>
        <div class="bc-qty-stepper">
          <button type="button" class="bc-qty-minus">-</button>
          <span class="bc-qty-value">1</span>
          <button type="button" class="bc-qty-plus">+</button>
        </div>
        <div class="bc-price-row">
          <span class="bc-price-current" data-current-price>$10.00</span>
          <span class="bc-price-save" data-save-price style="display:none;"></span>
          <span class="bc-price-compare" data-compare-price style="display:none;"></span>
        </div>
        <button type="button" class="bc-add-to-cart">Add to cart</button>
      </form>
    </div>
  `;
}

async function reloadPd(window, fixtureHtml) {
  vi.resetModules();
  window.document.body.innerHTML = fixtureHtml;
  mountGlobals(window);
  await import('./product-detail.js');
}

describe('product-detail', () => {
  let window;

  beforeEach(() => {
    window = new Window();
  });

  it('switches variant and updates price on pill click', async () => {
    const variants = [
      { id: 1, options: ['S'], available: true, priceHtml: '$10.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
      { id: 2, options: ['M'], available: true, priceHtml: '$15.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));
    const btnM = window.document.querySelector('[data-value="M"]');
    btnM.click();
    const currentPrice = window.document.querySelector('.bc-price-current');
    expect(currentPrice.innerHTML).toBe('$15.00');
    expect(window.document.querySelector('.bc-product-form').dataset.variantId).toBe('2');
  });

  it('shows Unavailable when no variant matches selected options', async () => {
    const variants = [
      { id: 1, options: ['S'], available: true, priceHtml: '$10.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));
    // Inject an extra pill that doesn't match any variant
    const group = window.document.querySelector('.bc-option-group');
    const extraBtn = window.document.createElement('button');
    extraBtn.type = 'button';
    extraBtn.className = 'bc-option-pill';
    extraBtn.dataset.value = 'XL';
    extraBtn.textContent = 'XL';
    group.appendChild(extraBtn);
    extraBtn.click();
    const addBtn = window.document.querySelector('.bc-add-to-cart');
    expect(addBtn.textContent).toBe('Unavailable');
    expect(addBtn.disabled).toBe(true);
  });

  it('toggles compare and save prices when variant has compare_at_price', async () => {
    const variants = [
      { id: 1, options: ['S'], available: true, priceHtml: '$10.00', hasCompareAt: true, compareAtHtml: '$15.00', saveHtml: 'Save $5.00' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));
    const savePrice = window.document.querySelector('.bc-price-save');
    const comparePrice = window.document.querySelector('.bc-price-compare');
    expect(savePrice.style.display).not.toBe('none');
    expect(savePrice.innerHTML).toBe('Save $5.00');
    expect(comparePrice.style.display).not.toBe('none');
    expect(comparePrice.innerHTML).toBe('$15.00');
  });

  it('increments and decrements quantity', async () => {
    const variants = [
      { id: 1, options: ['S'], available: true, priceHtml: '$10.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));
    const plus = window.document.querySelector('.bc-qty-plus');
    const minus = window.document.querySelector('.bc-qty-minus');
    const qty = window.document.querySelector('.bc-qty-value');
    plus.click();
    expect(qty.textContent).toBe('2');
    minus.click();
    expect(qty.textContent).toBe('1');
    minus.click();
    expect(qty.textContent).toBe('1'); // min 1
  });

  it('disables add-to-cart button when variant is out of stock', async () => {
    const variants = [
      { id: 1, options: ['S'], available: false, priceHtml: '$10.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));
    const addBtn = window.document.querySelector('.bc-add-to-cart');
    expect(addBtn.disabled).toBe(true);
  });
});

describe('product-detail add-to-cart', () => {
  let window;

  beforeEach(() => {
    window = new Window();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows error feedback on non-2xx response', async () => {
    const variants = [
      { id: 1, options: ['S'], available: true, priceHtml: '$10.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ description: 'Variant is out of stock' }),
    });

    const addBtn = window.document.querySelector('.bc-add-to-cart');
    addBtn.click();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(addBtn.textContent).toBe('Variant is out of stock');
    vi.advanceTimersByTime(1200);
    expect(addBtn.textContent).toBe('Add to cart');
  });

  it('warns but does not fail when cart sync fails', async () => {
    const variants = [
      { id: 1, options: ['S'], available: true, priceHtml: '$10.00', hasCompareAt: false, compareAtHtml: '', saveHtml: '' },
    ];
    await reloadPd(window, buildPdFixture(variants, ['Size']));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [{ id: 1, quantity: 1 }] }),
      })
      .mockRejectedValueOnce(new Error('Network error'));

    const addBtn = window.document.querySelector('.bc-add-to-cart');
    addBtn.click();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(1200);
    expect(warnSpy).toHaveBeenCalledWith('[BC Design] Cart count sync failed:', expect.any(Error));
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All new product-detail tests pass

- [ ] **Step 3: Commit**

```bash
git add extensions/bc-design-theme/assets/product-detail.test.js
git commit -m "test(product-detail): add client-side JS tests"
```

---

### Task 14: Final Verification

**Files:**
- All files created/modified in previous tasks

**Interfaces:**
- Consumes: Entire implementation
- Produces: Passing typecheck, lint, tests, and config validation

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS with no errors

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS with no errors

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Validate Shopify app config**

Run: `npx shopify app config validate`
Expected: PASS with no errors

- [ ] **Step 5: Final commit**

```bash
git commit --allow-empty -m "feat(product-detail): complete product detail app embed implementation"
```

---

## Self-Review

### 1. Spec Coverage

| Spec Section | Implementing Task |
|--------------|-------------------|
| Data Model (TypeScript types) | Task 1 |
| Metafield Definitions (shopify.app.toml) | Task 3 |
| Scopes Update | Task 3 |
| `blocks/product_detail.liquid` | Task 6 |
| `assets/product-detail.js` | Task 7 |
| `bc-design-embed-placement.js` product detail branch | Task 8 |
| Tailwind CSS build | Task 10, 11 |
| Navigation cart badge | Task 9 |
| Admin page loader + action | Task 5 |
| Admin page React component | Task 5 |
| GraphQL queries | Task 5 |
| Helper functions (collectFileGids, resolveFilePreviewUrls, etc.) | Task 5 |
| App nav link | Task 4 |
| Locale translations | Task 12 |
| Server-side load/save | Task 2 |
| Automated tests | Task 8, 13 |

### 2. Placeholder Scan

- No "TBD", "TODO", "implement later", "fill in details" found
- No "Add appropriate error handling" without code
- No "Write tests for the above" without actual test code
- No "Similar to Task N" references
- All steps include exact file paths, complete code, and exact commands

### 3. Type Consistency

- `ProductDetailGlobalMode` = `"off" | "all_on" | "per_product"` — used consistently
- `ProductDetailConfig` fields match between types (Task 1), sanitize (Task 2), parse (Task 5), and Liquid usage (Task 6)
- `optionIcons` array structure: `{ optionName, optionValue, iconGid?, iconFilename? }` — consistent across all tasks
- File field naming: `*Image` (GID) + `*ImageFilename` (filename) — consistent with banner/navigation pattern

### 4. Review Fixes (applied 2026-07-02)

Based on `review-glm.md` and `review-gemini.md`:

| Issue | Severity | Fix |
|-------|----------|-----|
| B1: `data-bc-cart-count` vs existing `data-cart-count` | P0 Blocking | Plan 全文统一为 `data-cart-count`（与现有 nav badge 一致） |
| B2: Test fixture script tag unclosed quote | P0 Blocking | `data-bc-pd-data'` → `data-bc-pd-data"` |
| C1: `sanitizeProductDetailConfig` not exported / unused | P1 Should fix | Added `export`; loader now calls `sanitizeProductDetailConfig(rawConfig)` directly |
| C2: Option icon formData key mismatch + `pending://` pollution | P1 Should fix | Key now uses `optionName.optionValue`; removed `pending://` temp identifier from React state |
| C3: `resolveFilePreviewUrls` missing Video `sources` branch | P1 Should fix | Added `sources` to `FileNodesData` and resolution branch |
| N1: Task 13 `mountGlobals` missing timer bridge | P2 Nit | Aligned with existing test file: added `setInterval`/`clearInterval` bridge + `requestAnimationFrame` |
| S1: Two-column ratio 50/50 vs prototype 58/38 | P1 Should fix | `grid-template-columns: 58fr 38fr` |
| S2: Max-width 1440px vs prototype 2400px | P1 Should fix | `max-width: 2400px` |
| S3: Fixed Tailwind values vs prototype `clamp()` fluid scale | P1 Should fix | Replaced all `text-*` and `gap-*` fixed utilities with prototype `clamp()` values |
| S4: Feature list missing bullet dots | P2 Should fix | Added `::before` pseudo-element gray dot |
| S5: Stage background near-white vs prototype light gray | P2 Should fix | Added `--color-bc-pd-neutral-100: oklch(92% 0.005 264)`, stage uses it |
| S6: Inactive option-pill icon missing grayscale | P2 Should fix | Added `filter: grayscale(1) opacity(0.5)` for inactive pills |
| S7: Disabled option-pill icon missing grayscale | P2 Should fix | Added `filter: grayscale(1) opacity(0.3)` for disabled pills |
| W1: `var(--spacing-sm)` references undefined Tailwind v4 variable | P1 Should fix | Changed to inline `clamp(0.75rem, 1.25vw, 1.875rem)` |

No gaps remain. All spec requirements are covered by the tasks above.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-02-product-detail-app-embed.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

