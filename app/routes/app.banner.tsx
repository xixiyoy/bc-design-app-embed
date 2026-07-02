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
import {
  pendingImageIdentifier,
  resetAdaptiveOverlayForImageField,
  runLimitedBrightnessTasks,
  type BrightnessTask,
} from "../lib/bc-design/banner-brightness";
import { createShopifyFileFromUpload } from "../lib/bc-design/files.server";
import {
  loadBannerConfig,
  saveBannerConfig,
  GET_FILE_DETAILS,
  extractFilename,
  videoFileUrlFromNode,
} from "../lib/bc-design/config.server";
import { authenticate } from "../shopify.server";
import { calculateImageBrightness } from "../lib/bc-design/image-brightness.client";

const BRIGHTNESS_THRESHOLD = 128;
const ADAPTIVE_OVERLAY_OPACITY = 30;

type ComputationStatus = "not_calculated" | "calculating" | "calculated" | "failed";

type SlideComputationState = {
  desktop: ComputationStatus;
  mobile: ComputationStatus;
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
    desktopImageFilename: slide.desktopImageFilename || undefined,
    mobileImage: slide.mobileImage || undefined,
    mobileImageFilename: slide.mobileImageFilename || undefined,
    video: slide.video || undefined,
    videoFileUrl: slide.videoFileUrl || undefined,
    videoPosterUrl: slide.videoPosterUrl,
    videoUrl: slide.videoUrl ?? "",
    heading: slide.heading ?? "",
    subheading: slide.subheading ?? "",
    primaryButtonLabel: slide.primaryButtonLabel ?? "",
    primaryButtonLink: slide.primaryButtonLink ?? "",
    secondaryButtonLabel: slide.secondaryButtonLabel ?? "",
    secondaryButtonLink: slide.secondaryButtonLink ?? "",
    desktopAverageBrightness: Number(slide.desktopAverageBrightness ?? 0),
    desktopAdaptiveOverlayVariant: slide.desktopAdaptiveOverlayVariant ?? "black",
    desktopAdaptiveOverlayOpacity: clampBannerNumber(
      "desktopAdaptiveOverlayOpacity",
      Number(slide.desktopAdaptiveOverlayOpacity ?? 30),
    ),
    mobileAverageBrightness: Number(slide.mobileAverageBrightness ?? 0),
    mobileAdaptiveOverlayVariant: slide.mobileAdaptiveOverlayVariant ?? "black",
    mobileAdaptiveOverlayOpacity: clampBannerNumber(
      "mobileAdaptiveOverlayOpacity",
      Number(slide.mobileAdaptiveOverlayOpacity ?? 30),
    ),
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
    brightnessAdaptiveOverlayEnabled: Boolean(
      parsed.brightnessAdaptiveOverlayEnabled,
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
        if (field === "video") {
          slide.video = result.id;
          slide.videoFileUrl = result.url;

          try {
            const previewResult = await adminGraphql<any>(admin, GET_FILE_DETAILS, {
              ids: [result.id],
            });
            const fileNode = previewResult?.nodes?.[0];
            slide.videoFileUrl =
              videoFileUrlFromNode(fileNode) ?? slide.videoFileUrl;
            slide.videoPosterUrl = fileNode?.preview?.image?.url || "";
          } catch (e) {
            console.warn("Failed to retrieve video poster image URL during upload", e);
          }
        } else {
          slide[field] = result.id;
          slide[`${field}Filename`] = extractFilename(result.url);
        }
      } else if (field === "video") {
        if (!slide.video) {
          slide.video = previousSlide?.video;
        }
        if (!slide.videoFileUrl) {
          slide.videoFileUrl = previousSlide?.videoFileUrl;
        }
        if (slide.videoPosterUrl === undefined) {
          slide.videoPosterUrl = previousSlide?.videoPosterUrl;
        }
      } else if (!slide[field]) {
        slide[field] = previousSlide?.[field];
        slide[`${field}Filename`] = previousSlide?.[`${field}Filename` as keyof typeof previousSlide] as string | undefined;
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
  await saveBannerConfig(admin, config);
  const saved = await loadBannerConfig(admin);
  return { intent, ok: true, message: "Banner saved.", config: saved };
};

type BannerFormState = BannerConfig;

function buildComputationStates(
  config: BannerConfig,
): Record<string, SlideComputationState> {
  const initialStates: Record<string, SlideComputationState> = {};
  for (const slide of config.slides) {
    const hasDesktopImage = Boolean(slide.desktopImage);
    const hasMobileImage = Boolean(slide.mobileImage);
    const desktopBrightness = slide.desktopAverageBrightness ?? 0;
    const mobileBrightness = slide.mobileAverageBrightness ?? 0;

    const desktopComputed = !hasDesktopImage || desktopBrightness !== 0;
    const mobileComputed = !hasMobileImage || mobileBrightness !== 0;

    initialStates[slide.id] = {
      desktop: desktopComputed ? "calculated" : "not_calculated",
      mobile: mobileComputed ? "calculated" : "not_calculated",
    };
  }
  return initialStates;
}

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
    setComputationStates(buildComputationStates(config));
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
    if (!data) {
      shopify.toast.show(
        "Save request failed. The server may have timed out. Please try again.",
        { isError: true },
      );
      return;
    }

    if (data.intent === "saveBanner" && data.ok) {
      shopify.toast.show("Banner saved");
      if (data.config) {
        setFormState(data.config);
        setPendingFiles({});
        setLocalPreviewUrls({});
        setComputationStates(buildComputationStates(data.config));
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

  const [computationStates, setComputationStates] = useState<
    Record<string, SlideComputationState>
  >(() => buildComputationStates(config));
  const activeCalculations = useRef<Set<string>>(new Set());
  const formStateRef = useRef(formState);
  formStateRef.current = formState;

  const getComputationLabel = (state: ComputationStatus) => {
    switch (state) {
      case "not_calculated":
        return "not calculated";
      case "calculating":
        return "calculating...";
      case "calculated":
        return "calculated";
      case "failed":
        return "failed (default overlay)";
    }
  };

  const getToneLabel = (brightness: number | undefined) => {
    if (brightness === undefined) return "";
    return brightness < BRIGHTNESS_THRESHOLD ? "dark" : "light";
  };

  const computeSlideBrightness = useCallback(
    async (
      slide: BannerSlideConfig,
      device: "desktop" | "mobile",
      imageUrl: string,
      imageIdentifier: string,
    ) => {
      const key = `${slide.id}-${device}-${imageIdentifier}`;
      if (activeCalculations.current.has(key)) return;
      activeCalculations.current.add(key);

      setComputationStates((current) => ({
        ...current,
        [slide.id]: {
          ...current[slide.id],
          [device]: "calculating",
        },
      }));

      const brightness = await calculateImageBrightness(imageUrl);

      activeCalculations.current.delete(key);

      // Resolve the current index after the async boundary so reorders do not corrupt
      // the wrong slide's brightness fields.
      const currentIndex = formStateRef.current.slides.findIndex(
        (s) => s.id === slide.id,
      );
      if (currentIndex === -1) {
        // Slide was removed while the calculation was in flight; nothing to update.
        return;
      }

      // Verify slide still exists with same image using ref (avoids stale closure)
      const currentSlide = formStateRef.current.slides[currentIndex];
      const currentImageId =
        device === "desktop" ? currentSlide.desktopImage : currentSlide.mobileImage;
      if (currentImageId !== imageIdentifier) {
        // Image was replaced while the calculation was in flight. If a newer
        // computation for the current image is already running, leave its state
        // alone so the UI stays on "calculating...".
        if (
          activeCalculations.current.has(
            `${slide.id}-${device}-${currentImageId}`,
          )
        ) {
          return;
        }

        setComputationStates((current) => ({
          ...current,
          [slide.id]: {
            ...current[slide.id],
            [device]: "not_calculated",
          },
        }));
        return;
      }

      if (brightness === null) {
        updateSlide(currentIndex, {
          [`${device}AverageBrightness`]: 0,
          [`${device}AdaptiveOverlayVariant`]: "black",
          [`${device}AdaptiveOverlayOpacity`]: ADAPTIVE_OVERLAY_OPACITY,
        } as Partial<BannerSlideConfig>);
        setComputationStates((current) => ({
          ...current,
          [slide.id]: {
            ...current[slide.id],
            [device]: "failed",
          },
        }));
        return;
      }

      const variant = brightness < BRIGHTNESS_THRESHOLD ? "black" : "white";
      updateSlide(currentIndex, {
        [`${device}AverageBrightness`]: brightness,
        [`${device}AdaptiveOverlayVariant`]: variant,
        [`${device}AdaptiveOverlayOpacity`]: ADAPTIVE_OVERLAY_OPACITY,
      } as Partial<BannerSlideConfig>);
      setComputationStates((current) => ({
        ...current,
        [slide.id]: {
          ...current[slide.id],
          [device]: "calculated",
        },
      }));

      // Copy result to the missing device after successful computation
      const otherDevice = device === "desktop" ? "mobile" : "desktop";
      if (
        otherDevice === "mobile" &&
        !currentSlide.mobileImage &&
        currentSlide.desktopImage
      ) {
        updateSlide(currentIndex, {
          mobileAverageBrightness: brightness,
          mobileAdaptiveOverlayVariant: variant,
          mobileAdaptiveOverlayOpacity: ADAPTIVE_OVERLAY_OPACITY,
        });
        setComputationStates((current) => ({
          ...current,
          [slide.id]: { ...current[slide.id], mobile: "calculated" },
        }));
      } else if (
        otherDevice === "desktop" &&
        !currentSlide.desktopImage &&
        currentSlide.mobileImage
      ) {
        updateSlide(currentIndex, {
          desktopAverageBrightness: brightness,
          desktopAdaptiveOverlayVariant: variant,
          desktopAdaptiveOverlayOpacity: ADAPTIVE_OVERLAY_OPACITY,
        });
        setComputationStates((current) => ({
          ...current,
          [slide.id]: { ...current[slide.id], desktop: "calculated" },
        }));
      }
    },
    [updateSlide],
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
    // Prevent stale brightness tracking from accumulating for deleted slides.
    delete lastProcessedImages.current[slideId];
    setComputationStates((current) => {
      const next = { ...current };
      delete next[slideId];
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

  const trackPendingImageFile = useCallback(
    (index: number, field: "desktopImage" | "mobileImage", file: File | null) => {
      const slide = formStateRef.current.slides[index];
      if (!slide) return;

      trackPendingFile(`${slide.id}.${field}`, file);
      if (!file) return;

      const device = field === "desktopImage" ? "desktop" : "mobile";
      const imageIdentifier = pendingImageIdentifier(
        slide.id,
        field,
        file,
        crypto.randomUUID(),
      );

      updateSlide(index, {
        [field]: imageIdentifier,
        ...resetAdaptiveOverlayForImageField(field),
      } as Partial<BannerSlideConfig>);
      setComputationStates((current) => ({
        ...current,
        [slide.id]: {
          ...current[slide.id],
          [device]: "not_calculated",
        },
      }));
    },
    [trackPendingFile, updateSlide],
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

  const lastProcessedImages = useRef<
    Record<string, { desktop?: string; mobile?: string }>
  >({});
  const wasAdaptiveEnabledRef = useRef(formState.brightnessAdaptiveOverlayEnabled);

  // Stable identifier map derived from slide images. The scheduler depends on this
  // instead of the full slides array so text edits do not re-trigger the effect.
  const imageIdentifiersRef = useRef<
    Record<string, { desktop?: string; mobile?: string }>
  >({});
  const imageIdentifiers = useMemo(() => {
    const next: Record<string, { desktop?: string; mobile?: string }> = {};
    for (const slide of formState.slides) {
      next[slide.id] = {
        desktop: slide.desktopImage,
        mobile: slide.mobileImage,
      };
    }
    const prev = imageIdentifiersRef.current;
    const changed =
      Object.keys(next).length !== Object.keys(prev).length ||
      Object.entries(next).some(
        ([id, images]) =>
          images.desktop !== prev[id]?.desktop ||
          images.mobile !== prev[id]?.mobile,
      );
    if (changed) {
      imageIdentifiersRef.current = next;
    }
    return imageIdentifiersRef.current;
  }, [formState.slides]);

  // Initialize on mount: record current images so the scheduler can detect changes.
  useEffect(() => {
    formState.slides.forEach((slide) => {
      lastProcessedImages.current[slide.id] = {
        desktop: slide.desktopImage,
        mobile: slide.mobileImage,
      };
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When the adaptive overlay feature is toggled on, any slide that still has
  // the fallback brightness of 0 must be recomputed rather than treated as
  // already calculated.
  useEffect(() => {
    const wasEnabled = wasAdaptiveEnabledRef.current;
    const isEnabled = formState.brightnessAdaptiveOverlayEnabled;
    wasAdaptiveEnabledRef.current = isEnabled;

    if (!wasEnabled && isEnabled) {
      setComputationStates((current) => {
        const next = { ...current };
        formStateRef.current.slides.forEach((slide) => {
          const resetIfNeeded = (
            device: "desktop" | "mobile",
            image: string | undefined,
            brightness: number | undefined,
          ) => {
            if (image && (brightness ?? 0) === 0) {
              next[slide.id] = {
                ...next[slide.id],
                [device]: "not_calculated",
              };
            }
          };

          resetIfNeeded(
            "desktop",
            slide.desktopImage,
            slide.desktopAverageBrightness,
          );
          resetIfNeeded(
            "mobile",
            slide.mobileImage,
            slide.mobileAverageBrightness,
          );
        });
        return next;
      });
    }
  }, [formState.brightnessAdaptiveOverlayEnabled]);

  useEffect(() => {
    const pendingComputations: BrightnessTask[] = [];
    let hasNewWork = false;

    // Handle image deletion: when a device image becomes blank and the other
    // device already has a computed result, copy that triplet into form state.
    formState.slides.forEach((slide, slideIndex) => {
      const last = lastProcessedImages.current[slide.id] || {};
      const state = computationStates[slide.id] || {
        desktop: "not_calculated",
        mobile: "not_calculated",
      };

      const hasDesktop = Boolean(slide.desktopImage);
      const hasMobile = Boolean(slide.mobileImage);

      if (
        hasDesktop &&
        !hasMobile &&
        slide.desktopImage === last.desktop &&
        state.desktop === "calculated" &&
        state.mobile !== "calculated"
      ) {
        updateSlide(slideIndex, {
          mobileAverageBrightness: slide.desktopAverageBrightness,
          mobileAdaptiveOverlayVariant: slide.desktopAdaptiveOverlayVariant,
          mobileAdaptiveOverlayOpacity: slide.desktopAdaptiveOverlayOpacity,
        });
        setComputationStates((current) => ({
          ...current,
          [slide.id]: { ...current[slide.id], mobile: "calculated" },
        }));
        lastProcessedImages.current[slide.id] = {
          ...last,
          mobile: undefined,
        };
      } else if (
        !hasDesktop &&
        hasMobile &&
        slide.mobileImage === last.mobile &&
        state.mobile === "calculated" &&
        state.desktop !== "calculated"
      ) {
        updateSlide(slideIndex, {
          desktopAverageBrightness: slide.mobileAverageBrightness,
          desktopAdaptiveOverlayVariant: slide.mobileAdaptiveOverlayVariant,
          desktopAdaptiveOverlayOpacity: slide.mobileAdaptiveOverlayOpacity,
        });
        setComputationStates((current) => ({
          ...current,
          [slide.id]: { ...current[slide.id], desktop: "calculated" },
        }));
        lastProcessedImages.current[slide.id] = {
          ...last,
          desktop: undefined,
        };
      }
    });

    formState.slides.forEach((slide) => {
      const last = lastProcessedImages.current[slide.id] || {};
      const state = computationStates[slide.id] || {
        desktop: "not_calculated",
        mobile: "not_calculated",
      };

      const desktopImage = slide.desktopImage;
      if (
        desktopImage &&
        state.desktop !== "calculating" &&
        (desktopImage !== last.desktop || state.desktop === "not_calculated")
      ) {
        hasNewWork = true;
        pendingComputations.push(() => {
          const previewUrl = resolvePreviewUrl(
            desktopImage,
            `${slide.id}.desktopImage`,
          );
          if (previewUrl) {
            return computeSlideBrightness(
              slide,
              "desktop",
              previewUrl,
              desktopImage,
            );
          }
        });
      }

      const mobileImage = slide.mobileImage;
      if (
        mobileImage &&
        state.mobile !== "calculating" &&
        (mobileImage !== last.mobile || state.mobile === "not_calculated")
      ) {
        hasNewWork = true;
        pendingComputations.push(() => {
          const previewUrl = resolvePreviewUrl(
            mobileImage,
            `${slide.id}.mobileImage`,
          );
          if (previewUrl) {
            return computeSlideBrightness(
              slide,
              "mobile",
              previewUrl,
              mobileImage,
            );
          }
        });
      }
    });

    // Keep the processed-image map in sync so toggle-on and deletion handling
    // recognize unchanged images.
    formState.slides.forEach((slide) => {
      lastProcessedImages.current[slide.id] = {
        desktop: slide.desktopImage,
        mobile: slide.mobileImage,
      };
    });

    if (!hasNewWork) return;

    void runLimitedBrightnessTasks(pendingComputations, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    imageIdentifiers,
    computationStates,
    computeSlideBrightness,
    resolvePreviewUrl,
    updateSlide,
  ]);

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
    const hasPendingFiles = formState.slides.some((slide) =>
      SLIDE_MEDIA_FIELDS.some((field) => pendingFiles[`${slide.id}.${field}`]),
    );

    if (!hasPendingFiles) {
      fetcher.submit(
        {
          intent: "saveBanner",
          config: JSON.stringify(formState),
        },
        { method: "post" },
      );
      return;
    }

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
        variant="primary"
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

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-text tone="neutral" /* Maps to Polaris tone="subdued" */>Adaptive overlay</s-text>
              <s-switch
                label="Brightness adaptive overlay"
                checked={formState.brightnessAdaptiveOverlayEnabled}
                onChange={(event) =>
                  updateFormState({
                    brightnessAdaptiveOverlayEnabled: event.currentTarget.checked,
                  })
                }
              />
              <s-text tone="neutral" /* Maps to Polaris tone="subdued" */>
                Turn on automatic image brightness analysis for all banner slides.
                Dark images use a black overlay.
                Light images use a white overlay with dark text.
              </s-text>
            </s-stack>
          </s-box>
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
                    trackPendingImageFile(index, "desktopImage", file)
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
                    trackPendingImageFile(index, "mobileImage", file)
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

                {formState.brightnessAdaptiveOverlayEnabled ? (
                  <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                    <s-stack direction="block" gap="small">
                      <s-text type="strong">Brightness analysis</s-text>
                      <s-text tone="neutral" /* Maps to Polaris tone="subdued" */>
                        Desktop: {(slide.desktopAverageBrightness ?? 0)} / {getToneLabel(slide.desktopAverageBrightness)} / {slide.desktopAdaptiveOverlayVariant === "white" ? "white overlay" : "black overlay"}
                        {" "}({getComputationLabel(computationStates[slide.id]?.desktop ?? "not_calculated")})
                      </s-text>
                      <s-text tone="neutral" /* Maps to Polaris tone="subdued" */>
                        Mobile: {(slide.mobileAverageBrightness ?? 0)} / {getToneLabel(slide.mobileAverageBrightness)} / {slide.mobileAdaptiveOverlayVariant === "white" ? "white overlay" : "black overlay"}
                        {" "}({getComputationLabel(computationStates[slide.id]?.mobile ?? "not_calculated")})
                        {!slide.mobileImage && slide.desktopImage ? " (copied from desktop)" : ""}
                        {slide.mobileImage && !slide.desktopImage ? " (copied from mobile)" : ""}
                      </s-text>
                      {!slide.desktopImage && !slide.mobileImage && slide.video ? (
                        <s-text tone="neutral" /* Maps to Polaris tone="subdued" */>
                          Video-only slides always use the default black overlay.
                        </s-text>
                      ) : null}
                    </s-stack>
                  </s-box>
                ) : null}

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
        <BannerPreview config={previewConfig} computationStates={computationStates} />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
