import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useRevalidator,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { MediaField } from "../components/bc-design/MediaField";
import { NavigationPreview } from "../components/bc-design/NavigationPreview";
import {
  adminGraphql,
  type AdminGraphqlClient,
} from "../lib/bc-design/admin-graphql.server";
import {
  isLogoType,
  isNavigationLayoutType,
  NAVIGATION_LAYOUT_TYPES,
  sanitizeNavigationSecondLevelConfig,
  type NavigationConfig,
  type NavigationSecondLevelConfig,
} from "../lib/bc-design/config-types";
import { createShopifyFileFromUpload } from "../lib/bc-design/files.server";
import {
  loadMenus,
  type ShopifyMenu,
  type ShopifyMenuItem,
} from "../lib/bc-design/menus.server";
import {
  loadNavigationConfig,
  saveNavigationConfig,
  extractFilename,
} from "../lib/bc-design/config.server";
import { ensureProductBadgeMetafieldDefinitions } from "../lib/bc-design/product-badges.server";
import { authenticate } from "../shopify.server";

type SecondLevelMenuItem = {
  level1Index: number;
  level2Index: number;
  level1Title: string;
  level2Title: string;
};

type FileNodesData = {
  nodes: Array<
    | {
        id: string;
        image?: { url: string } | null;
      }
    | {
        id: string;
        url?: string | null;
      }
    | {
        id: string;
        sources?: Array<{ url: string }> | null;
      }
    | null
  >;
};

const FILE_NODES_QUERY = `#graphql
  query BcDesignFilePreviewUrls($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on MediaImage {
        id
        image {
          url
        }
      }
      ... on GenericFile {
        id
        url
      }
      ... on Video {
        id
        sources {
          url
        }
      }
    }
  }
`;

function collectFileGids(config: NavigationConfig): string[] {
  const gids = new Set<string>();
  if (config.logoFile?.startsWith("gid://")) {
    gids.add(config.logoFile);
  }
  for (const child of config.secondLevelConfigs) {
    for (const field of [
      "bigImage1",
      "bigImage2",
      "bigImage3",
      "adImage",
    ] as const) {
      const value = child[field];
      if (value?.startsWith("gid://")) {
        gids.add(value);
      }
    }
  }
  return [...gids];
}

async function resolveFilePreviewUrls(
  admin: AdminGraphqlClient,
  gids: string[],
): Promise<Record<string, string>> {
  if (gids.length === 0) {
    return {};
  }

  const data = await adminGraphql<FileNodesData>(admin, FILE_NODES_QUERY, {
    ids: gids,
  });

  const urls: Record<string, string> = {};
  for (const node of data.nodes) {
    if (!node?.id) continue;
    if ("image" in node && node.image?.url) {
      urls[node.id] = node.image.url;
    } else if ("url" in node && node.url) {
      urls[node.id] = node.url;
    } else if ("sources" in node && node.sources?.[0]?.url) {
      urls[node.id] = node.sources[0].url;
    }
  }
  return urls;
}

function collectSecondLevelMenuItems(menu: ShopifyMenu): SecondLevelMenuItem[] {
  const items: SecondLevelMenuItem[] = [];
  menu.items.forEach((level1: ShopifyMenuItem, level1Offset) => {
    level1.items.forEach((level2: ShopifyMenuItem, level2Offset) => {
      items.push({
        level1Index: level1Offset + 1,
        level2Index: level2Offset + 1,
        level1Title: level1.title,
        level2Title: level2.title,
      });
    });
  });
  return items;
}

function secondLevelKey(level1Index: number, level2Index: number) {
  return `${level1Index}:${level2Index}`;
}

function mergeSecondLevelConfigs(
  menuItems: SecondLevelMenuItem[],
  saved: NavigationSecondLevelConfig[],
): NavigationSecondLevelConfig[] {
  const savedByKey = new Map(
    saved.map((config) => [
      secondLevelKey(config.level1Index, config.level2Index),
      config,
    ]),
  );

  return menuItems.map((item) => {
    const existing = savedByKey.get(
      secondLevelKey(item.level1Index, item.level2Index),
    );
    return sanitizeNavigationSecondLevelConfig({
      level1Index: item.level1Index,
      level2Index: item.level2Index,
      level1Title: item.level1Title,
      level2Title: item.level2Title,
      layoutType: existing?.layoutType ?? "product_list",
      bigImage1: existing?.bigImage1,
      bigImage2: existing?.bigImage2,
      bigImage3: existing?.bigImage3,
      adImage: existing?.adImage,
      adUrl: existing?.adUrl ?? "",
      id: existing?.id,
    });
  });
}

function hasMenuStructureMismatch(
  menuItems: SecondLevelMenuItem[],
  saved: NavigationSecondLevelConfig[],
): boolean {
  if (saved.length === 0) {
    return false;
  }

  const menuByKey = new Map(
    menuItems.map((item) => [
      secondLevelKey(item.level1Index, item.level2Index),
      item,
    ]),
  );

  for (const config of saved) {
    const menuItem = menuByKey.get(
      secondLevelKey(config.level1Index, config.level2Index),
    );
    if (!menuItem) {
      return true;
    }
    if (
      menuItem.level1Title !== config.level1Title ||
      menuItem.level2Title !== config.level2Title
    ) {
      return true;
    }
  }

  return false;
}

function parseNavigationConfigPayload(raw: string): NavigationConfig {
  const parsed = JSON.parse(raw) as NavigationConfig;
  if (!isLogoType(parsed.logoType)) {
    throw new Error("Invalid logo type.");
  }

  return {
    fixedNavigation: Boolean(parsed.fixedNavigation),
    logoType: parsed.logoType,
    logoText: parsed.logoText ?? "",
    logoFile: parsed.logoFile || undefined,
    navBackgroundColor: parsed.navBackgroundColor ?? "#ffffff",
    primaryNavTextColor: parsed.primaryNavTextColor ?? "#7a7b7e",
    secondaryNavTextColor: parsed.secondaryNavTextColor ?? "#7a7b7e",
    iconColor: parsed.iconColor ?? "#7a7b7e",
    menuHandle: parsed.menuHandle ?? "",
    secondLevelConfigs: (parsed.secondLevelConfigs ?? []).map((child) =>
      sanitizeNavigationSecondLevelConfig({
        ...child,
        layoutType: isNavigationLayoutType(child.layoutType)
          ? child.layoutType
          : "product_list",
        adUrl: child.adUrl ?? "",
      }),
    ),
  };
}

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const [config, menus] = await Promise.all([
    loadNavigationConfig(admin),
    loadMenus(admin),
  ]);
  const filePreviewUrls = await resolveFilePreviewUrls(
    admin,
    collectFileGids(config),
  );

  return { config, menus, filePreviewUrls };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "setupProductBadges") {
    const result = await ensureProductBadgeMetafieldDefinitions(admin);
    return { intent, ...result };
  }

  if (intent === "saveNavigation") {
    const configRaw = formData.get("config");
    if (typeof configRaw !== "string") {
      return { intent, ok: false, message: "Missing navigation config." };
    }

    try {
      const previous = await loadNavigationConfig(admin);
      const config = parseNavigationConfigPayload(configRaw);
      config.secondLevelConfigs = config.secondLevelConfigs.map(
        sanitizeNavigationSecondLevelConfig,
      );
      await mergeUploadedFiles(admin, formData, config, previous);
      config.secondLevelConfigs = config.secondLevelConfigs.map(
        sanitizeNavigationSecondLevelConfig,
      );
      const saved = await saveNavigationConfig(admin, config);
      return { intent, ok: true, message: "Navigation saved.", config };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save navigation.";
      console.error("saveNavigation failed:", error);
      return { intent, ok: false, message };
    }
  }

  return { intent, ok: false, message: "Unknown action." };
};

type NavigationFormState = NavigationConfig;

function buildInitialFormState(
  config: NavigationConfig,
  selectedMenu: ShopifyMenu | null,
): NavigationFormState {
  const menuItems = selectedMenu
    ? collectSecondLevelMenuItems(selectedMenu)
    : [];
  return {
    ...config,
    secondLevelConfigs: selectedMenu
      ? mergeSecondLevelConfigs(menuItems, config.secondLevelConfigs)
      : [],
  };
}

export default function NavigationPage() {
  const { config, menus, filePreviewUrls } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  const [formState, setFormState] = useState<NavigationFormState>(() =>
    buildInitialFormState(
      config,
      menus.find((menu) => menu.handle === config.menuHandle) ?? null,
    ),
  );
  const [pendingFiles, setPendingFiles] = useState<Record<string, File>>({});
  const [localPreviewUrls, setLocalPreviewUrls] = useState<
    Record<string, string>
  >({});
  const wasSubmittingRef = useRef(false);
  const skipConfigSyncRef = useRef(false);

  useEffect(() => {
    if (skipConfigSyncRef.current) {
      skipConfigSyncRef.current = false;
      return;
    }
    const selectedMenu =
      menus.find((menu) => menu.handle === config.menuHandle) ?? null;
    setFormState(buildInitialFormState(config, selectedMenu));
    setPendingFiles({});
    setLocalPreviewUrls({});
  }, [config, menus]);

  const selectedMenu = useMemo(
    () => menus.find((menu) => menu.handle === formState.menuHandle) ?? null,
    [menus, formState.menuHandle],
  );

  const menuSecondLevelItems = useMemo(
    () => (selectedMenu ? collectSecondLevelMenuItems(selectedMenu) : []),
    [selectedMenu],
  );

  const showMenuStructureWarning = useMemo(
    () =>
      hasMenuStructureMismatch(menuSecondLevelItems, config.secondLevelConfigs),
    [menuSecondLevelItems, config.secondLevelConfigs],
  );

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
      shopify.toast.show(
        "Save request failed. The server may have timed out. Please try again.",
        { isError: true },
      );
      return;
    }

    if (data.intent === "saveNavigation" && data.ok) {
      shopify.toast.show("Navigation saved");
      const hadPendingFiles = Object.keys(pendingFiles).length > 0;
      if (data.config) {
        const selectedMenu =
          menus.find((menu) => menu.handle === data.config.menuHandle) ?? null;
        setFormState(buildInitialFormState(data.config, selectedMenu));
        setPendingFiles({});
        setLocalPreviewUrls({});
      }
      skipConfigSyncRef.current = true;
      if (hadPendingFiles) {
        revalidator.revalidate();
      }
      return;
    }

    if (data.intent === "setupProductBadges") {
      shopify.toast.show(data.message);
      return;
    }

    if (data.message) {
      shopify.toast.show(data.message, { isError: true });
    }
  }, [fetcher.state, fetcher.data, menus, pendingFiles, revalidator, shopify]);

  const updateFormState = useCallback(
    (patch: Partial<NavigationFormState>) => {
      setFormState((current) => ({ ...current, ...patch }));
    },
    [],
  );

  const handleMenuChange = useCallback(
    (menuHandle: string) => {
      const menu = menus.find((item) => item.handle === menuHandle) ?? null;
      const menuItems = menu ? collectSecondLevelMenuItems(menu) : [];
      setFormState((current) => ({
        ...current,
        menuHandle,
        secondLevelConfigs: menu
          ? mergeSecondLevelConfigs(menuItems, current.secondLevelConfigs)
          : [],
      }));
    },
    [menus],
  );

  const updateSecondLevelConfig = useCallback(
    (
      index: number,
      patch: Partial<NavigationSecondLevelConfig>,
    ) => {
      setFormState((current) => ({
        ...current,
        secondLevelConfigs: current.secondLevelConfigs.map((child, childIndex) => {
          if (childIndex !== index) {
            return child;
          }

          const next = sanitizeNavigationSecondLevelConfig({
            ...child,
            ...patch,
          });

          if (patch.layoutType && patch.layoutType !== child.layoutType) {
            const removedKeys =
              patch.layoutType === "big_image"
                ? [`${index}.adImage`]
                : [
                    `${index}.bigImage1`,
                    `${index}.bigImage2`,
                    `${index}.bigImage3`,
                  ];

            setPendingFiles((pending) => {
              const updated = { ...pending };
              for (const key of removedKeys) {
                delete updated[key];
              }
              return updated;
            });

            setLocalPreviewUrls((previews) => {
              const updated = { ...previews };
              for (const key of removedKeys) {
                if (updated[key]) {
                  URL.revokeObjectURL(updated[key]);
                  delete updated[key];
                }
              }
              return updated;
            });
          }

          return next;
        }),
      }));
    },
    [],
  );

  const trackPendingFile = useCallback(
    (key: string, file: File | null) => {
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
    },
    [],
  );

  const resolvePreviewUrl = useCallback(
    (gid: string | undefined, localKey: string) => {
      if (localPreviewUrls[localKey]) {
        return localPreviewUrls[localKey];
      }
      if (gid?.startsWith("gid://")) {
        return filePreviewUrls[gid];
      }
      return gid?.startsWith("http") ? gid : undefined;
    },
    [filePreviewUrls, localPreviewUrls],
  );

  const handleSave = () => {
    const logoFile = pendingFiles.logoFile;
    const hasPendingFiles =
      Boolean(logoFile) ||
      formState.secondLevelConfigs.some((child, index) => {
        const mediaFields =
          child.layoutType === "big_image"
            ? (["bigImage1", "bigImage2", "bigImage3"] as const)
            : (["adImage"] as const);
        return mediaFields.some((field) => pendingFiles[`${index}.${field}`]);
      });

    if (!hasPendingFiles) {
      fetcher.submit(
        {
          intent: "saveNavigation",
          config: JSON.stringify(formState),
        },
        { method: "post" },
      );
      return;
    }

    const formData = new FormData();
    formData.append("intent", "saveNavigation");
    formData.append("config", JSON.stringify(formState));

    if (logoFile) {
      formData.append("logoFile", logoFile);
    }

    formState.secondLevelConfigs.forEach((child, index) => {
      const mediaFields =
        child.layoutType === "big_image"
          ? (["bigImage1", "bigImage2", "bigImage3"] as const)
          : (["adImage"] as const);

      for (const field of mediaFields) {
        const file = pendingFiles[`${index}.${field}`];
        if (file) {
          formData.append(`secondLevelConfigs.${index}.${field}`, file);
        }
      }
    });

    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  const handleSetupProductBadges = () => {
    const formData = new FormData();
    formData.append("intent", "setupProductBadges");
    fetcher.submit(formData, { method: "post" });
  };

  const previewConfig = {
    ...formState,
    logoPreviewUrl:
      formState.logoType === "image"
        ? resolvePreviewUrl(formState.logoFile, "logoFile")
        : undefined,
  };

  return (
    <s-page heading="Navigation">
      <s-button
        slot="primary-action"
        onClick={handleSave}
        {...(isSubmitting ? { loading: true } : {})}
      >
        Save
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={handleSetupProductBadges}
        {...(isSubmitting ? { loading: true } : {})}
      >
        Set up product badges
      </s-button>


      <s-section heading="Navigation settings">
        <s-stack direction="block" gap="base">
          <s-switch
            label="Fixed navigation"
            checked={formState.fixedNavigation}
            onChange={(event) =>
              updateFormState({ fixedNavigation: event.currentTarget.checked })
            }
          />

          <s-select
            label="Logo type"
            value={formState.logoType}
            onChange={(event) =>
              updateFormState({
                logoType: isLogoType(event.currentTarget.value)
                  ? event.currentTarget.value
                  : "text",
              })
            }
          >
            <s-option value="text">Text</s-option>
            <s-option value="image">Image</s-option>
          </s-select>

          <s-text-field
            label="Logo text"
            value={formState.logoText}
            onChange={(event) =>
              updateFormState({ logoText: event.currentTarget.value })
            }
          />

          {formState.logoType === "image" ? (
            <MediaField
              name="logoFile"
              label="Logo image"
              value={formState.logoFile}
              previewUrl={resolvePreviewUrl(formState.logoFile, "logoFile")}
              onChange={(file) => trackPendingFile("logoFile", file)}
            />
          ) : null}

          <s-select
            label="Menu"
            value={formState.menuHandle}
            onChange={(event) => handleMenuChange(event.currentTarget.value)}
          >
            <s-option value="">Select a menu</s-option>
            {menus.map((menu) => (
              <s-option key={menu.id} value={menu.handle}>
                {menu.title} ({menu.handle})
              </s-option>
            ))}
          </s-select>

          <s-color-field
            label="Navigation background"
            value={formState.navBackgroundColor}
            onChange={(event) =>
              updateFormState({ navBackgroundColor: event.currentTarget.value })
            }
          />
          <s-color-field
            label="Primary nav text"
            value={formState.primaryNavTextColor}
            onChange={(event) =>
              updateFormState({
                primaryNavTextColor: event.currentTarget.value,
              })
            }
          />
          <s-color-field
            label="Secondary nav text"
            value={formState.secondaryNavTextColor}
            onChange={(event) =>
              updateFormState({
                secondaryNavTextColor: event.currentTarget.value,
              })
            }
          />
          <s-color-field
            label="Icon color"
            value={formState.iconColor}
            onChange={(event) =>
              updateFormState({ iconColor: event.currentTarget.value })
            }
          />
        </s-stack>
      </s-section>

      {selectedMenu ? (
        <s-section heading="Second-level menu items">
          <s-stack direction="block" gap="base">
            {showMenuStructureWarning ? (
              <s-banner tone="warning" heading="Menu structure changed">
                Saved second-level menu settings are matched by menu position.
                Review the cards below before saving.
              </s-banner>
            ) : null}

            {formState.secondLevelConfigs.length === 0 ? (
              <s-paragraph>
                This menu has no second-level items to configure.
              </s-paragraph>
            ) : null}

            {formState.secondLevelConfigs.map((child, index) => (
              <s-box
                key={`${child.level1Index}-${child.level2Index}`}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="base">
                  <s-heading>
                    {child.level1Title} › {child.level2Title}
                  </s-heading>

                  <s-select
                    label="Layout type"
                    value={child.layoutType}
                    onChange={(event) =>
                      updateSecondLevelConfig(index, {
                        layoutType: isNavigationLayoutType(
                          event.currentTarget.value,
                        )
                          ? event.currentTarget.value
                          : "product_list",
                      })
                    }
                  >
                    {NAVIGATION_LAYOUT_TYPES.map((layoutType) => (
                      <s-option key={layoutType} value={layoutType}>
                        {layoutType === "product_list"
                          ? "Product list"
                          : "Big image"}
                      </s-option>
                    ))}
                  </s-select>

                  {child.layoutType === "big_image" ? (
                    <>
                      <MediaField
                        name={`secondLevelConfigs.${index}.bigImage1`}
                        label="Big image 1"
                        value={child.bigImage1}
                        previewUrl={resolvePreviewUrl(
                          child.bigImage1,
                          `${index}.bigImage1`,
                        )}
                        onChange={(file) =>
                          trackPendingFile(`${index}.bigImage1`, file)
                        }
                      />
                      <MediaField
                        name={`secondLevelConfigs.${index}.bigImage2`}
                        label="Big image 2"
                        value={child.bigImage2}
                        previewUrl={resolvePreviewUrl(
                          child.bigImage2,
                          `${index}.bigImage2`,
                        )}
                        onChange={(file) =>
                          trackPendingFile(`${index}.bigImage2`, file)
                        }
                      />
                      <MediaField
                        name={`secondLevelConfigs.${index}.bigImage3`}
                        label="Big image 3"
                        value={child.bigImage3}
                        previewUrl={resolvePreviewUrl(
                          child.bigImage3,
                          `${index}.bigImage3`,
                        )}
                        onChange={(file) =>
                          trackPendingFile(`${index}.bigImage3`, file)
                        }
                      />
                    </>
                  ) : (
                    <>
                      <MediaField
                        name={`secondLevelConfigs.${index}.adImage`}
                        label="Ad image"
                        value={child.adImage}
                        previewUrl={resolvePreviewUrl(
                          child.adImage,
                          `${index}.adImage`,
                        )}
                        onChange={(file) =>
                          trackPendingFile(`${index}.adImage`, file)
                        }
                      />
                      <s-url-field
                        label="Ad URL"
                        value={child.adUrl ?? ""}
                        onChange={(event) =>
                          updateSecondLevelConfig(index, {
                            adUrl: event.currentTarget.value,
                          })
                        }
                      />
                    </>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      <s-section slot="aside" heading="Preview">
        <NavigationPreview config={previewConfig} menu={selectedMenu} />
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (error instanceof Error && error.message.includes("Failed to fetch")) {
    return (
      <s-page heading="Navigation">
        <s-banner tone="critical" heading="Network error">
          Save request timed out or could not reach the app server. This often
          happens when Render is waking up or when the menu has many items.
          Please wait a moment and try again.
        </s-banner>
      </s-page>
    );
  }
  return boundary.error(error);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
