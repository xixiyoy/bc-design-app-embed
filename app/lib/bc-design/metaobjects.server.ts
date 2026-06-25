import {
  adminGraphql,
  assertNoUserErrors,
  type AdminGraphqlClient,
} from "./admin-graphql.server";
import {
  BANNER_CONFIG_HANDLE,
  BANNER_CONFIG_TYPE,
  BANNER_DEFAULTS,
  BANNER_SLIDE_TYPE,
  NAVIGATION_CONFIG_HANDLE,
  NAVIGATION_CONFIG_TYPE,
  NAVIGATION_DEFAULTS,
  NAVIGATION_SECOND_LEVEL_TYPE,
  bannerSlideHandle,
  clampBannerNumber,
  secondLevelHandle,
  sanitizeNavigationSecondLevelConfig,
  type BannerConfig,
  type BannerSlideConfig,
  type NavigationConfig,
  type NavigationLayoutType,
  type NavigationSecondLevelConfig,
} from "./config-types";

type MetaobjectField = {
  key: string;
  jsonValue?: unknown;
  value?: string | null;
  reference?: {
    id?: string;
  } | null;
  references?: {
    nodes: ChildMetaobjectNode[];
  } | null;
};

type ChildMetaobjectNode = {
  id: string;
  handle: string;
  type: string;
  fields: MetaobjectField[];
};

type MetaobjectNode = {
  id: string;
  handle: string;
  type: string;
  fields: MetaobjectField[];
};

type MetaobjectByHandleData = {
  metaobjectByHandle: MetaobjectNode | null;
};

type MetaobjectsByIdsData = {
  nodes: Array<ChildMetaobjectNode | null>;
};

type MetaobjectUpsertData = {
  metaobjectUpsert: {
    metaobject?: { id: string } | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
};

type MetaobjectDeleteData = {
  metaobjectDelete: {
    deletedId?: string | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
};

const METAOBJECT_BY_HANDLE_QUERY = `#graphql
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
`;

const METAOBJECTS_BY_IDS_QUERY = `#graphql
  query BcDesignMetaobjectsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
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
`;

const UPSERT_METAOBJECT_MUTATION = `#graphql
  mutation UpsertBcDesignMetaobject(
    $handle: MetaobjectHandleInput!
    $metaobject: MetaobjectUpsertInput!
  ) {
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
`;

const DELETE_METAOBJECT_MUTATION = `#graphql
  mutation DeleteBcDesignMetaobject($id: ID!) {
    metaobjectDelete(id: $id) {
      deletedId
      userErrors {
        field
        message
      }
    }
  }
`;

const METAOBJECT_DEFINITIONS_QUERY = `#graphql
  query BcDesignMetaobjectDefinitions($first: Int!) {
    metaobjectDefinitions(first: $first) {
      nodes {
        id
        name
        type
      }
    }
  }
`;

const REQUIRED_APP_METAOBJECT_TYPES = [
  NAVIGATION_CONFIG_TYPE,
  NAVIGATION_SECOND_LEVEL_TYPE,
  BANNER_CONFIG_TYPE,
  BANNER_SLIDE_TYPE,
] as const;

type MetaobjectDefinitionsData = {
  metaobjectDefinitions: {
    nodes: Array<{ id: string; name: string; type: string }>;
  };
};

type MetaobjectTypeMap = Map<string, string>;

function logicalTypeSuffix(logicalType: string) {
  return logicalType.replace(/^\$app:/, "");
}

function matchesLogicalMetaobjectType(
  installedType: string,
  logicalType: string,
) {
  const suffix = logicalTypeSuffix(logicalType);
  return installedType === logicalType || installedType.endsWith(`--${suffix}`);
}

async function loadMetaobjectTypeMap(
  admin: AdminGraphqlClient,
): Promise<MetaobjectTypeMap> {
  const data = await adminGraphql<MetaobjectDefinitionsData>(
    admin,
    METAOBJECT_DEFINITIONS_QUERY,
    { first: 50 },
  );

  const typeMap: MetaobjectTypeMap = new Map();
  for (const node of data.metaobjectDefinitions.nodes) {
    for (const logicalType of REQUIRED_APP_METAOBJECT_TYPES) {
      if (
        matchesLogicalMetaobjectType(node.type, logicalType) &&
        !typeMap.has(logicalType)
      ) {
        typeMap.set(logicalType, node.type);
      }
    }
  }

  return typeMap;
}

function requireMetaobjectType(
  typeMap: MetaobjectTypeMap,
  logicalType: string,
): string {
  const resolvedType = typeMap.get(logicalType);
  if (!resolvedType) {
    throw new Error(
      `No metaobject definition exists for type "${logicalType}".`,
    );
  }
  return resolvedType;
}

export async function getMissingBcDesignMetaobjectDefinitions(
  admin: AdminGraphqlClient,
): Promise<string[]> {
  const typeMap = await loadMetaobjectTypeMap(admin);
  return REQUIRED_APP_METAOBJECT_TYPES.filter(
    (logicalType) => !typeMap.has(logicalType),
  );
}

export function missingMetaobjectDefinitionsMessage(missing: string[]) {
  const labels = missing.map((type) => type.replace(/^\$app:/, "")).join(", ");
  return `This store is missing app metaobject definitions (${labels}). Deploy the latest app version with "shopify app deploy --config render", then reinstall or update the app on this store.`;
}

function fieldMap(fields: MetaobjectField[]) {
  return new Map(fields.map((field) => [field.key, field]));
}

function textValue(field: MetaobjectField | undefined, fallback = "") {
  if (!field) return fallback;
  if (typeof field.value === "string") return field.value;
  if (field.jsonValue != null && typeof field.jsonValue !== "object") {
    return String(field.jsonValue);
  }
  return fallback;
}

function booleanValue(field: MetaobjectField | undefined, fallback: boolean) {
  if (!field) return fallback;
  if (typeof field.jsonValue === "boolean") return field.jsonValue;
  if (field.value === "true") return true;
  if (field.value === "false") return false;
  return fallback;
}

function numberValue(field: MetaobjectField | undefined, fallback: number) {
  if (!field) return fallback;
  if (typeof field.jsonValue === "number") return field.jsonValue;
  const parsed = Number(field.value ?? field.jsonValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fileReferenceGid(field: MetaobjectField | undefined) {
  if (!field) return undefined;
  if (field.reference?.id) return field.reference.id;
  if (typeof field.value === "string" && field.value.startsWith("gid://")) {
    return field.value;
  }
  return undefined;
}

function referenceGidArray(field: MetaobjectField | undefined) {
  if (!field) return [] as string[];
  if (field.references?.nodes?.length) {
    return field.references.nodes.map((node) => node.id);
  }
  if (Array.isArray(field.jsonValue)) {
    return field.jsonValue.filter(
      (value): value is string =>
        typeof value === "string" && value.startsWith("gid://"),
    );
  }
  return [];
}

async function loadChildMetaobjects(
  admin: AdminGraphqlClient,
  field: MetaobjectField | undefined,
): Promise<ChildMetaobjectNode[]> {
  if (!field) return [];

  if (field.references?.nodes?.length) {
    return field.references.nodes;
  }

  const ids = referenceGidArray(field);
  if (ids.length === 0) {
    return [];
  }

  const data = await adminGraphql<MetaobjectsByIdsData>(
    admin,
    METAOBJECTS_BY_IDS_QUERY,
    { ids },
  );

  return data.nodes.filter(
    (node): node is ChildMetaobjectNode => node != null,
  );
}

function parseSecondLevelConfig(node: ChildMetaobjectNode): NavigationSecondLevelConfig {
  const fields = fieldMap(node.fields);
  return {
    id: node.id,
    level1Index: numberValue(fields.get("level_1_index"), 1),
    level2Index: numberValue(fields.get("level_2_index"), 1),
    level1Title: textValue(fields.get("level_1_title")),
    level2Title: textValue(fields.get("level_2_title")),
    layoutType: textValue(
      fields.get("layout_type"),
      "product_list",
    ) as NavigationLayoutType,
    bigImage1: fileReferenceGid(fields.get("big_image_1")),
    bigImage2: fileReferenceGid(fields.get("big_image_2")),
    bigImage3: fileReferenceGid(fields.get("big_image_3")),
    adImage: fileReferenceGid(fields.get("ad_image")),
    adUrl: textValue(fields.get("ad_url")),
  };
}

function slideIdFromHandle(handle: string) {
  return handle.startsWith("slide-") ? handle.slice("slide-".length) : handle;
}

function parseBannerSlide(node: ChildMetaobjectNode): BannerSlideConfig {
  const fields = fieldMap(node.fields);
  return {
    id: slideIdFromHandle(node.handle),
    title: textValue(fields.get("title")),
    desktopImage: fileReferenceGid(fields.get("desktop_image")),
    mobileImage: fileReferenceGid(fields.get("mobile_image")),
    video: fileReferenceGid(fields.get("video")),
    videoUrl: textValue(fields.get("video_url")),
    heading: textValue(fields.get("heading")),
    subheading: textValue(fields.get("subheading")),
    primaryButtonLabel: textValue(fields.get("primary_button_label")),
    primaryButtonLink: textValue(fields.get("primary_button_link")),
    secondaryButtonLabel: textValue(fields.get("secondary_button_label")),
    secondaryButtonLink: textValue(fields.get("secondary_button_link")),
  };
}

async function loadMetaobjectByHandle(
  admin: AdminGraphqlClient,
  type: string,
  handle: string,
) {
  const data = await adminGraphql<MetaobjectByHandleData>(
    admin,
    METAOBJECT_BY_HANDLE_QUERY,
    {
      handle: { type, handle },
    },
  );
  return data.metaobjectByHandle;
}

async function upsertMetaobject(
  admin: AdminGraphqlClient,
  type: string,
  handle: string,
  fields: Array<{ key: string; value: string }>,
) {
  const data = await adminGraphql<MetaobjectUpsertData>(
    admin,
    UPSERT_METAOBJECT_MUTATION,
    {
      handle: { type, handle },
      metaobject: { fields },
    },
  );
  assertNoUserErrors(data.metaobjectUpsert.userErrors);
  return data.metaobjectUpsert.metaobject?.id;
}

function secondLevelPairKey(level1Index: number, level2Index: number) {
  return `${level1Index}:${level2Index}`;
}

function optionalField(key: string, value: string | undefined) {
  if (!value) return null;
  return { key, value };
}

export async function loadNavigationConfig(
  admin: AdminGraphqlClient,
): Promise<NavigationConfig> {
  const typeMap = await loadMetaobjectTypeMap(admin);
  const metaobject = await loadMetaobjectByHandle(
    admin,
    requireMetaobjectType(typeMap, NAVIGATION_CONFIG_TYPE),
    NAVIGATION_CONFIG_HANDLE,
  );
  if (!metaobject) {
    return { ...NAVIGATION_DEFAULTS };
  }

  const fields = fieldMap(metaobject.fields);
  const childNodes = await loadChildMetaobjects(
    admin,
    fields.get("second_level_configs"),
  );

  return {
    fixedNavigation: booleanValue(fields.get("fixed_navigation"), true),
    logoType: textValue(fields.get("logo_type"), "text") as NavigationConfig["logoType"],
    logoText: textValue(fields.get("logo_text")),
    logoFile: fileReferenceGid(fields.get("logo_file")),
    navBackgroundColor: textValue(
      fields.get("nav_background_color"),
      NAVIGATION_DEFAULTS.navBackgroundColor,
    ),
    primaryNavTextColor: textValue(
      fields.get("primary_nav_text_color"),
      NAVIGATION_DEFAULTS.primaryNavTextColor,
    ),
    secondaryNavTextColor: textValue(
      fields.get("secondary_nav_text_color"),
      NAVIGATION_DEFAULTS.secondaryNavTextColor,
    ),
    iconColor: textValue(fields.get("icon_color"), NAVIGATION_DEFAULTS.iconColor),
    menuHandle: textValue(fields.get("menu_handle")),
    secondLevelConfigs: childNodes.map(parseSecondLevelConfig),
  };
}

export async function loadBannerConfig(
  admin: AdminGraphqlClient,
): Promise<BannerConfig> {
  const typeMap = await loadMetaobjectTypeMap(admin);
  const metaobject = await loadMetaobjectByHandle(
    admin,
    requireMetaobjectType(typeMap, BANNER_CONFIG_TYPE),
    BANNER_CONFIG_HANDLE,
  );
  if (!metaobject) {
    return { ...BANNER_DEFAULTS };
  }

  const fields = fieldMap(metaobject.fields);
  const childNodes = await loadChildMetaobjects(admin, fields.get("slides"));

  return {
    autoplay: booleanValue(fields.get("autoplay"), BANNER_DEFAULTS.autoplay),
    autoplaySpeed: numberValue(
      fields.get("autoplay_speed"),
      BANNER_DEFAULTS.autoplaySpeed,
    ),
    pauseOnHover: booleanValue(
      fields.get("pause_on_hover"),
      BANNER_DEFAULTS.pauseOnHover,
    ),
    showIndicators: booleanValue(
      fields.get("show_indicators"),
      BANNER_DEFAULTS.showIndicators,
    ),
    mobileHeight: numberValue(
      fields.get("mobile_height"),
      BANNER_DEFAULTS.mobileHeight,
    ),
    overlayOpacity: numberValue(
      fields.get("overlay_opacity"),
      BANNER_DEFAULTS.overlayOpacity,
    ),
    slides: childNodes.map(parseBannerSlide),
  };
}

function buildSecondLevelFields(config: NavigationSecondLevelConfig) {
  const sanitized = sanitizeNavigationSecondLevelConfig(config);
  const shared = [
    {
      key: "title",
      value: `${sanitized.level1Title} › ${sanitized.level2Title}`,
    },
    { key: "level_1_index", value: String(sanitized.level1Index) },
    { key: "level_2_index", value: String(sanitized.level2Index) },
    { key: "level_1_title", value: sanitized.level1Title },
    { key: "level_2_title", value: sanitized.level2Title },
    { key: "layout_type", value: sanitized.layoutType },
  ];

  if (sanitized.layoutType === "big_image") {
    return [
      ...shared,
      optionalField("big_image_1", sanitized.bigImage1),
      optionalField("big_image_2", sanitized.bigImage2),
      optionalField("big_image_3", sanitized.bigImage3),
    ].filter((field): field is { key: string; value: string } => field != null);
  }

  return [
    ...shared,
    optionalField("ad_image", sanitized.adImage),
    optionalField("ad_url", sanitized.adUrl),
  ].filter((field): field is { key: string; value: string } => field != null);
}

function buildBannerSlideFields(slide: BannerSlideConfig, index: number) {
  const title =
    slide.title.trim() || slide.heading.trim() || `Slide ${index + 1}`;
  return [
    { key: "title", value: title },
    optionalField("desktop_image", slide.desktopImage),
    optionalField("mobile_image", slide.mobileImage),
    optionalField("video", slide.video),
    optionalField("video_url", slide.videoUrl),
    { key: "heading", value: slide.heading },
    { key: "subheading", value: slide.subheading },
    { key: "primary_button_label", value: slide.primaryButtonLabel },
    { key: "primary_button_link", value: slide.primaryButtonLink },
    { key: "secondary_button_label", value: slide.secondaryButtonLabel },
    { key: "secondary_button_link", value: slide.secondaryButtonLink },
  ].filter((field): field is { key: string; value: string } => field != null);
}

export async function saveNavigationConfig(
  admin: AdminGraphqlClient,
  config: NavigationConfig,
  previous?: NavigationConfig,
): Promise<NavigationConfig> {
  const typeMap = await loadMetaobjectTypeMap(admin);
  const navigationConfigType = requireMetaobjectType(
    typeMap,
    NAVIGATION_CONFIG_TYPE,
  );
  const navigationSecondLevelType = requireMetaobjectType(
    typeMap,
    NAVIGATION_SECOND_LEVEL_TYPE,
  );

  const childGids = (
    await Promise.all(
      config.secondLevelConfigs.map(async (child) => {
        const sanitized = sanitizeNavigationSecondLevelConfig(child);
        return upsertMetaobject(
          admin,
          navigationSecondLevelType,
          secondLevelHandle(sanitized.level1Index, sanitized.level2Index),
          buildSecondLevelFields(sanitized),
        );
      }),
    )
  ).filter((gid): gid is string => Boolean(gid));

  await upsertMetaobject(admin, navigationConfigType, NAVIGATION_CONFIG_HANDLE, [
    { key: "title", value: "Navigation" },
    { key: "fixed_navigation", value: String(config.fixedNavigation) },
    { key: "logo_type", value: config.logoType },
    { key: "logo_text", value: config.logoText },
    { key: "nav_background_color", value: config.navBackgroundColor },
    { key: "primary_nav_text_color", value: config.primaryNavTextColor },
    { key: "secondary_nav_text_color", value: config.secondaryNavTextColor },
    { key: "icon_color", value: config.iconColor },
    { key: "menu_handle", value: config.menuHandle },
    optionalField("logo_file", config.logoFile),
    {
      key: "second_level_configs",
      value: JSON.stringify(childGids),
    },
  ].filter((field): field is { key: string; value: string } => field != null));

  if (previous) {
    const nextPairs = new Set(
      config.secondLevelConfigs.map((child) =>
        secondLevelPairKey(child.level1Index, child.level2Index),
      ),
    );
    const orphanIds = previous.secondLevelConfigs
      .filter(
        (child) =>
          child.id &&
          !nextPairs.has(secondLevelPairKey(child.level1Index, child.level2Index)),
      )
      .map((child) => child.id as string);
    if (orphanIds.length > 0) {
      await deleteMetaobjectsByIds(admin, orphanIds);
    }
  }

  return loadNavigationConfig(admin);
}

export async function saveBannerConfig(
  admin: AdminGraphqlClient,
  config: BannerConfig,
  previous?: BannerConfig,
): Promise<BannerConfig> {
  const clampedConfig: BannerConfig = {
    ...config,
    autoplaySpeed: clampBannerNumber("autoplaySpeed", config.autoplaySpeed),
    overlayOpacity: clampBannerNumber("overlayOpacity", config.overlayOpacity),
    mobileHeight: clampBannerNumber("mobileHeight", config.mobileHeight),
  };

  const typeMap = await loadMetaobjectTypeMap(admin);
  const bannerConfigType = requireMetaobjectType(typeMap, BANNER_CONFIG_TYPE);
  const bannerSlideType = requireMetaobjectType(typeMap, BANNER_SLIDE_TYPE);

  const childGids = (
    await Promise.all(
      clampedConfig.slides.map((slide, index) =>
        upsertMetaobject(
          admin,
          bannerSlideType,
          bannerSlideHandle(slide.id),
          buildBannerSlideFields(slide, index),
        ),
      ),
    )
  ).filter((gid): gid is string => Boolean(gid));

  await upsertMetaobject(admin, bannerConfigType, BANNER_CONFIG_HANDLE, [
    { key: "title", value: "Banner" },
    { key: "autoplay", value: String(clampedConfig.autoplay) },
    {
      key: "autoplay_speed",
      value: String(clampedConfig.autoplaySpeed),
    },
    { key: "pause_on_hover", value: String(clampedConfig.pauseOnHover) },
    { key: "show_indicators", value: String(clampedConfig.showIndicators) },
    { key: "mobile_height", value: String(clampedConfig.mobileHeight) },
    { key: "overlay_opacity", value: String(clampedConfig.overlayOpacity) },
    { key: "slides", value: JSON.stringify(childGids) },
  ]);

  if (previous) {
    const nextSlideIds = new Set(clampedConfig.slides.map((slide) => slide.id));
    const removedSlideIds = previous.slides
      .map((slide) => slide.id)
      .filter((id) => !nextSlideIds.has(id));

    const orphanGids: string[] = [];
    for (const slideId of removedSlideIds) {
      const metaobject = await loadMetaobjectByHandle(
        admin,
        bannerSlideType,
        bannerSlideHandle(slideId),
      );
      if (metaobject?.id) {
        orphanGids.push(metaobject.id);
      }
    }

    if (orphanGids.length > 0) {
      await deleteMetaobjectsByIds(admin, orphanGids);
    }
  }

  return loadBannerConfig(admin);
}

export async function deleteMetaobjectsByIds(
  admin: AdminGraphqlClient,
  ids: string[],
): Promise<void> {
  for (const id of ids) {
    const data = await adminGraphql<MetaobjectDeleteData>(
      admin,
      DELETE_METAOBJECT_MUTATION,
      { id },
    );
    assertNoUserErrors(data.metaobjectDelete.userErrors);
  }
}
