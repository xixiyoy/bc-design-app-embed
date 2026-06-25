import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  BannerPreview,
  type BannerPreviewConfig,
} from "../components/bc-design/BannerPreview";
import { MediaField } from "../components/bc-design/MediaField";
import {
  adminGraphql,
  type AdminGraphqlClient,
} from "../lib/bc-design/admin-graphql.server";
import {
  BANNER_DEFAULTS,
  clampBannerNumber,
  type BannerConfig,
  type BannerSlideConfig,
} from "../lib/bc-design/config-types";
import { createShopifyFileFromUpload } from "../lib/bc-design/files.server";
import {
  loadBannerConfig,
  saveBannerConfig,
} from "../lib/bc-design/metaobjects.server";
import { authenticate } from "../shopify.server";

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
  query BcDesignBannerFilePreviewUrls($ids: [ID!]!) {
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

const SLIDE_MEDIA_FIELDS = [
  "desktopImage",
  "mobileImage",
  "video",
] as const;

function collectFileGids(config: BannerConfig): string[] {
  const gids = new Set<string>();
  for (const slide of config.slides) {
    for (const field of SLIDE_MEDIA_FIELDS) {
      const value = slide[field];
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

function createEmptySlide(): BannerSlideConfig {
  return {
    id: crypto.randomUUID(),
    title: "",
    heading: "",
    subheading: "",
    primaryButtonLabel: "",
    primaryButtonLink: "",
    secondaryButtonLabel: "",
    secondaryButtonLink: "",
  };
}

function parseBannerSlidePayload(
  slide: Partial<BannerSlideConfig>,
  previousIds: Set<string>,
): BannerSlideConfig {
  const id =
    slide.id && previousIds.has(slide.id) ? slide.id : crypto.randomUUID();

  return {
    id,
    title: slide.title ?? "",
    desktopImage: slide.desktopImage || undefined,
    mobileImage: slide.mobileImage || undefined,
    video: slide.video || undefined,
    videoUrl: slide.videoUrl ?? "",
    heading: slide.heading ?? "",
    subheading: slide.subheading ?? "",
    primaryButtonLabel: slide.primaryButtonLabel ?? "",
    primaryButtonLink: slide.primaryButtonLink ?? "",
    secondaryButtonLabel: slide.secondaryButtonLabel ?? "",
    secondaryButtonLink: slide.secondaryButtonLink ?? "",
  };
}

function parseBannerConfigPayload(
  raw: string,
  previous: BannerConfig,
): BannerConfig {
  const parsed = JSON.parse(raw) as BannerConfig;
  const previousIds = new Set(previous.slides.map((slide) => slide.id));

  return {
    autoplay: Boolean(parsed.autoplay),
    autoplaySpeed: clampBannerNumber(
      "autoplaySpeed",
      Number(parsed.autoplaySpeed ?? BANNER_DEFAULTS.autoplaySpeed),
    ),
    pauseOnHover: Boolean(parsed.pauseOnHover),
    showIndicators: Boolean(parsed.showIndicators),
    mobileHeight: clampBannerNumber(
      "mobileHeight",
      Number(parsed.mobileHeight ?? BANNER_DEFAULTS.mobileHeight),
    ),
    overlayOpacity: clampBannerNumber(
      "overlayOpacity",
      Number(parsed.overlayOpacity ?? BANNER_DEFAULTS.overlayOpacity),
    ),
    slides: (parsed.slides ?? []).map((slide) =>
      parseBannerSlidePayload(slide, previousIds),
    ),
  };
}

async function mergeUploadedSlideFiles(
  admin: AdminGraphqlClient,
  formData: FormData,
  config: BannerConfig,
  previous: BannerConfig,
) {
  for (const [index, slide] of config.slides.entries()) {
    const previousSlide = previous.slides.find(
      (saved) => saved.id === slide.id,
    );

    for (const field of SLIDE_MEDIA_FIELDS) {
      const uploadedFile = formData.get(`slides.${index}.${field}`);
      if (uploadedFile instanceof File && uploadedFile.size > 0) {
        const result = await createShopifyFileFromUpload(admin, uploadedFile);
        slide[field] = result.id;
      } else if (!slide[field]) {
        slide[field] = previousSlide?.[field];
      }
    }
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const config = await loadBannerConfig(admin);
  const filePreviewUrls = await resolveFilePreviewUrls(
    admin,
    collectFileGids(config),
  );

  return { config, filePreviewUrls };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent !== "saveBanner") {
    return { intent, ok: false, message: "Unknown action." };
  }

  const configRaw = formData.get("config");
  if (typeof configRaw !== "string") {
    return { intent, ok: false, message: "Missing banner config." };
  }

  const previous = await loadBannerConfig(admin);
  const config = parseBannerConfigPayload(configRaw, previous);
  await mergeUploadedSlideFiles(admin, formData, config, previous);
  const saved = await saveBannerConfig(admin, config, previous);
  return { intent, ok: true, message: "Banner saved.", config: saved };
};

type BannerFormState = BannerConfig;

export default function BannerPage() {
  const { config, filePreviewUrls } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  const [formState, setFormState] = useState<BannerFormState>(config);
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
    setFormState(config);
    setPendingFiles({});
    setLocalPreviewUrls({});
  }, [config]);

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
    if (!data) return;

    if (data.intent === "saveBanner" && data.ok) {
      shopify.toast.show("Banner saved");
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

  const updateFormState = useCallback((patch: Partial<BannerFormState>) => {
    setFormState((current) => ({ ...current, ...patch }));
  }, []);

  const updateSlide = useCallback(
    (index: number, patch: Partial<BannerSlideConfig>) => {
      setFormState((current) => ({
        ...current,
        slides: current.slides.map((slide, slideIndex) =>
          slideIndex === index ? { ...slide, ...patch } : slide,
        ),
      }));
    },
    [],
  );

  const addSlide = useCallback(() => {
    setFormState((current) => ({
      ...current,
      slides: [...current.slides, createEmptySlide()],
    }));
  }, []);

  const removeSlide = useCallback((slideId: string) => {
    setFormState((current) => ({
      ...current,
      slides: current.slides.filter((slide) => slide.id !== slideId),
    }));
    setPendingFiles((current) => {
      const next: Record<string, File> = {};
      for (const [key, file] of Object.entries(current)) {
        if (!key.startsWith(`${slideId}.`)) {
          next[key] = file;
        }
      }
      return next;
    });
    setLocalPreviewUrls((current) => {
      const next: Record<string, string> = {};
      for (const [key, url] of Object.entries(current)) {
        if (key.startsWith(`${slideId}.`)) {
          URL.revokeObjectURL(url);
        } else {
          next[key] = url;
        }
      }
      return next;
    });
  }, []);

  const moveSlide = useCallback((index: number, direction: -1 | 1) => {
    setFormState((current) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.slides.length) {
        return current;
      }

      const slides = [...current.slides];
      const [moved] = slides.splice(index, 1);
      slides.splice(targetIndex, 0, moved);
      return { ...current, slides };
    });
  }, []);

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

  const previewConfig = useMemo<BannerPreviewConfig>(
    () => ({
      ...formState,
      slides: formState.slides.map((slide) => ({
        ...slide,
        desktopImagePreview: resolvePreviewUrl(
          slide.desktopImage,
          `${slide.id}.desktopImage`,
        ),
        mobileImagePreview: resolvePreviewUrl(
          slide.mobileImage,
          `${slide.id}.mobileImage`,
        ),
        videoPreview: resolvePreviewUrl(slide.video, `${slide.id}.video`),
      })),
    }),
    [formState, resolvePreviewUrl],
  );

  const handleSave = () => {
    const formData = new FormData();
    formData.append("intent", "saveBanner");
    formData.append("config", JSON.stringify(formState));

    formState.slides.forEach((slide, index) => {
      for (const field of SLIDE_MEDIA_FIELDS) {
        const file = pendingFiles[`${slide.id}.${field}`];
        if (file) {
          formData.append(`slides.${index}.${field}`, file);
        }
      }
    });

    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  return (
    <s-page heading="Banner">
      <s-button
        slot="primary-action"
        onClick={handleSave}
        {...(isSubmitting ? { loading: true } : {})}
      >
        Save
      </s-button>

      <s-section heading="Carousel settings">
        <s-stack direction="block" gap="base">
          <s-switch
            label="Autoplay"
            checked={formState.autoplay}
            onChange={(event) =>
              updateFormState({ autoplay: event.currentTarget.checked })
            }
          />

          <s-number-field
            label="Autoplay speed (seconds)"
            value={String(formState.autoplaySpeed)}
            min={3}
            max={10}
            onChange={(event) =>
              updateFormState({
                autoplaySpeed: Number(event.currentTarget.value),
              })
            }
          />

          <s-switch
            label="Pause on hover"
            checked={formState.pauseOnHover}
            onChange={(event) =>
              updateFormState({ pauseOnHover: event.currentTarget.checked })
            }
          />

          <s-switch
            label="Show indicators"
            checked={formState.showIndicators}
            onChange={(event) =>
              updateFormState({ showIndicators: event.currentTarget.checked })
            }
          />

          <s-number-field
            label="Mobile height (px)"
            value={String(formState.mobileHeight)}
            min={360}
            max={760}
            step={20}
            onChange={(event) =>
              updateFormState({
                mobileHeight: Number(event.currentTarget.value),
              })
            }
          />

          <s-number-field
            label="Overlay opacity (%)"
            value={String(formState.overlayOpacity)}
            min={0}
            max={60}
            step={5}
            onChange={(event) =>
              updateFormState({
                overlayOpacity: Number(event.currentTarget.value),
              })
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Slides">
        <s-stack direction="block" gap="base">
          {formState.slides.length === 0 ? (
            <s-paragraph>
              No slides yet. Add a slide to configure the banner carousel.
            </s-paragraph>
          ) : null}

          {formState.slides.map((slide, index) => (
            <s-box
              key={slide.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base">
                  <s-heading>
                    {slide.title.trim() || slide.heading.trim() || `Slide ${index + 1}`}
                  </s-heading>
                  <s-button
                    type="button"
                    variant="secondary"
                    onClick={() => moveSlide(index, -1)}
                    disabled={index === 0}
                  >
                    Move up
                  </s-button>
                  <s-button
                    type="button"
                    variant="secondary"
                    onClick={() => moveSlide(index, 1)}
                    disabled={index === formState.slides.length - 1}
                  >
                    Move down
                  </s-button>
                  <s-button
                    type="button"
                    variant="secondary"
                    tone="critical"
                    onClick={() => removeSlide(slide.id)}
                  >
                    Delete
                  </s-button>
                </s-stack>

                <s-text-field
                  label="Title"
                  value={slide.title}
                  onChange={(event) =>
                    updateSlide(index, { title: event.currentTarget.value })
                  }
                />

                <MediaField
                  name={`slides.${index}.desktopImage`}
                  label="Desktop image"
                  value={slide.desktopImage}
                  previewUrl={resolvePreviewUrl(
                    slide.desktopImage,
                    `${slide.id}.desktopImage`,
                  )}
                  onChange={(file) =>
                    trackPendingFile(`${slide.id}.desktopImage`, file)
                  }
                />

                <MediaField
                  name={`slides.${index}.mobileImage`}
                  label="Mobile image"
                  value={slide.mobileImage}
                  previewUrl={resolvePreviewUrl(
                    slide.mobileImage,
                    `${slide.id}.mobileImage`,
                  )}
                  onChange={(file) =>
                    trackPendingFile(`${slide.id}.mobileImage`, file)
                  }
                />

                <MediaField
                  name={`slides.${index}.video`}
                  label="Shopify-hosted video"
                  value={slide.video}
                  previewUrl={resolvePreviewUrl(
                    slide.video,
                    `${slide.id}.video`,
                  )}
                  accept="video/*"
                  mediaKind="video"
                  onChange={(file) =>
                    trackPendingFile(`${slide.id}.video`, file)
                  }
                />

                <s-url-field
                  label="External video URL"
                  value={slide.videoUrl ?? ""}
                  onChange={(event) =>
                    updateSlide(index, { videoUrl: event.currentTarget.value })
                  }
                />

                <s-text-field
                  label="Heading"
                  value={slide.heading}
                  onChange={(event) =>
                    updateSlide(index, { heading: event.currentTarget.value })
                  }
                />

                <s-text-field
                  label="Subheading"
                  value={slide.subheading}
                  onChange={(event) =>
                    updateSlide(index, { subheading: event.currentTarget.value })
                  }
                />

                <s-text-field
                  label="Primary button label"
                  value={slide.primaryButtonLabel}
                  onChange={(event) =>
                    updateSlide(index, {
                      primaryButtonLabel: event.currentTarget.value,
                    })
                  }
                />

                <s-url-field
                  label="Primary button link"
                  value={slide.primaryButtonLink}
                  onChange={(event) =>
                    updateSlide(index, {
                      primaryButtonLink: event.currentTarget.value,
                    })
                  }
                />

                <s-text-field
                  label="Secondary button label"
                  value={slide.secondaryButtonLabel}
                  onChange={(event) =>
                    updateSlide(index, {
                      secondaryButtonLabel: event.currentTarget.value,
                    })
                  }
                />

                <s-url-field
                  label="Secondary button link"
                  value={slide.secondaryButtonLink}
                  onChange={(event) =>
                    updateSlide(index, {
                      secondaryButtonLink: event.currentTarget.value,
                    })
                  }
                />
              </s-stack>
            </s-box>
          ))}

          <s-button type="button" variant="secondary" onClick={addSlide}>
            Add slide
          </s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Preview">
        <BannerPreview config={previewConfig} />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
