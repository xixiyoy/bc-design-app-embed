import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "react-router";
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
  type ProductOptionIconConfig,
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

type SearchProductsData = {
  products?: {
    edges?: Array<{
      node: {
        id: string;
        title: string;
        handle: string;
        featuredImage?: { url: string } | null;
      };
    }>;
  };
};

type GetProductConfigData = {
  product?: {
    id: string;
    title: string;
    handle: string;
    options?: Array<{ name: string; values: string[] }>;
    metafield?: { jsonValue: unknown } | null;
  } | null;
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

function sanitizeOptionIcons(icons: unknown): ProductOptionIconConfig[] {
  if (!Array.isArray(icons)) return [];
  return icons
    .filter((icon): icon is Record<string, unknown> => typeof icon === "object" && icon !== null)
    .map((icon) => ({
      optionName: String(icon.optionName ?? ""),
      optionValue: String(icon.optionValue ?? ""),
      iconGid: icon.iconGid ? String(icon.iconGid) : undefined,
      iconFilename: icon.iconFilename ? String(icon.iconFilename) : undefined,
    }));
}

function parseProductDetailConfigPayload(raw: string): ProductDetailConfig {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    enabled: Boolean(parsed.enabled),
    three60BadgeImage: parsed.three60BadgeImage ? String(parsed.three60BadgeImage) : undefined,
    three60BadgeImageFilename: parsed.three60BadgeImageFilename
      ? String(parsed.three60BadgeImageFilename)
      : undefined,
    playButtonImage: parsed.playButtonImage ? String(parsed.playButtonImage) : undefined,
    playButtonImageFilename: parsed.playButtonImageFilename
      ? String(parsed.playButtonImageFilename)
      : undefined,
    zoomButtonImage: parsed.zoomButtonImage ? String(parsed.zoomButtonImage) : undefined,
    zoomButtonImageFilename: parsed.zoomButtonImageFilename
      ? String(parsed.zoomButtonImageFilename)
      : undefined,
    tab3dImage: parsed.tab3dImage ? String(parsed.tab3dImage) : undefined,
    tab3dImageFilename: parsed.tab3dImageFilename ? String(parsed.tab3dImageFilename) : undefined,
    tabPartsImage: parsed.tabPartsImage ? String(parsed.tabPartsImage) : undefined,
    tabPartsImageFilename: parsed.tabPartsImageFilename
      ? String(parsed.tabPartsImageFilename)
      : undefined,
    tabVideoImage: parsed.tabVideoImage ? String(parsed.tabVideoImage) : undefined,
    tabVideoImageFilename: parsed.tabVideoImageFilename
      ? String(parsed.tabVideoImageFilename)
      : undefined,
    subtitle: parsed.subtitle ? String(parsed.subtitle) : undefined,
    rating: typeof parsed.rating === "number" ? parsed.rating : undefined,
    ratingImage: parsed.ratingImage ? String(parsed.ratingImage) : undefined,
    ratingImageFilename: parsed.ratingImageFilename ? String(parsed.ratingImageFilename) : undefined,
    features: Array.isArray(parsed.features)
      ? parsed.features.filter((f): f is string => typeof f === "string")
      : [],
    optionIcons: sanitizeOptionIcons(parsed.optionIcons),
    qtyMinusImage: parsed.qtyMinusImage ? String(parsed.qtyMinusImage) : undefined,
    qtyMinusImageFilename: parsed.qtyMinusImageFilename
      ? String(parsed.qtyMinusImageFilename)
      : undefined,
    qtyPlusImage: parsed.qtyPlusImage ? String(parsed.qtyPlusImage) : undefined,
    qtyPlusImageFilename: parsed.qtyPlusImageFilename
      ? String(parsed.qtyPlusImageFilename)
      : undefined,
    addToCartText: parsed.addToCartText
      ? String(parsed.addToCartText)
      : PRODUCT_DETAIL_DEFAULTS.addToCartText,
  };
}

async function mergeUploadedProductFiles(
  admin: AdminGraphqlClient,
  formData: FormData,
  config: ProductDetailConfig,
  previous: ProductDetailConfig,
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
      config[gidKey] = result.id;
      config[filenameKey] = extractFilename(result.url);
    } else if (!config[gidKey]) {
      config[gidKey] = previous[gidKey];
      config[filenameKey] = previous[filenameKey];
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
    const data = await adminGraphql<SearchProductsData>(admin, SEARCH_PRODUCTS_QUERY, {
      query: searchQuery,
    });
    products = data.products?.edges?.map((e) => e.node) ?? [];
  }

  let productConfig: ProductDetailConfig | null = null;
  let productOptions: Array<{ name: string; values: string[] }> = [];
  let filePreviewUrls: Record<string, string> = {};
  let selectedProduct: { id: string; title: string; handle: string } | null = null;

  if (selectedProductId) {
    const data = await adminGraphql<GetProductConfigData>(admin, GET_PRODUCT_CONFIG_QUERY, {
      id: selectedProductId,
    });
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
    await mergeUploadedProductFiles(admin, formData, config, previous);
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
  const navigate = useNavigate();
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

  const setOptionIcon = useCallback(
    (optionName: string, optionValue: string, iconGid: string | undefined, iconFilename: string | undefined) => {
      setFormState((current) => {
        const existingIndex = current.optionIcons.findIndex(
          (i) => i.optionName === optionName && i.optionValue === optionValue,
        );
        const nextIcons = [...current.optionIcons];
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

  const runSearch = () => {
    const query = searchInput.trim();
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    navigate(`/app/product-detail${params.size ? `?${params.toString()}` : ""}`);
  };

  const handleSearch = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    runSearch();
  };

  const handleSelectProduct = (productId: string) => {
    if (!productId) return;
    const params = new URLSearchParams();
    params.set("product", productId);
    if (searchQuery) params.set("q", searchQuery);
    navigate(`/app/product-detail?${params.toString()}`);
  };

  return (
    <s-page heading="Product Detail">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleSave}
        {...(isSubmitting ? { loading: true } : {})}
      >
        Save
      </s-button>

      <s-section heading="Global mode">
        <s-stack direction="block" gap="base">
          <s-select
            label="Global mode"
            value={globalMode}
            onChange={(event) =>
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
          <form onSubmit={handleSearch}>
            <s-stack direction="inline" gap="base">
              <s-text-field
                label="Search products"
                name="q"
                value={searchInput}
                onChange={(event) => setSearchInput(event.currentTarget.value)}
                placeholder="Search products..."
              />
              <s-button type="button" onClick={runSearch}>
                Search
              </s-button>
            </s-stack>
          </form>

          {searchQuery && products.length === 0 && (
            <s-text tone="neutral">No products found for &quot;{searchQuery}&quot;.</s-text>
          )}

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
              label="Select a product"
              value={selectedProductId}
              onChange={(event) => handleSelectProduct(event.currentTarget.value)}
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
              onChange={(event) =>
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
              onChange={(event) =>
                updateFormState({ subtitle: event.currentTarget.value || undefined })
              }
            />

            <s-number-field
              label="Rating"
              value={String(formState.rating ?? "")}
              min={0}
              max={5}
              step={0.1}
              onChange={(event) => {
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
                      onChange={(event) =>
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
              onChange={(event) =>
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
