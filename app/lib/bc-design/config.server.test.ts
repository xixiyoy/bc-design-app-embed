import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractFilename,
  loadNavigationConfig,
  saveNavigationConfig,
  loadBannerConfig,
  saveBannerConfig,
} from "./config.server";
import { adminGraphql } from "./admin-graphql.server";
import {
  loadNavigationConfig as loadLegacyNavigation,
  loadBannerConfig as loadLegacyBanner,
} from "./metaobjects.server";
import { NAVIGATION_DEFAULTS, BANNER_DEFAULTS } from "./config-types";

vi.mock("./admin-graphql.server", () => ({
  adminGraphql: vi.fn(),
}));

vi.mock("./metaobjects.server", () => ({
  loadNavigationConfig: vi.fn(),
  loadBannerConfig: vi.fn(),
}));

describe("extractFilename", () => {
  it("should extract filenames", () => {
    expect(extractFilename("https://cdn.shopify.com/files/logo.jpg?v=123")).toBe("logo.jpg");
  });
  it("should decode url encoded characters", () => {
    expect(extractFilename("https://cdn.shopify.com/files/summer%20banner.png?v=456")).toBe("summer banner.png");
  });
  it("should return empty string if no url is provided", () => {
    expect(extractFilename(null)).toBe("");
    expect(extractFilename(undefined)).toBe("");
  });
});

describe("loadNavigationConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should return configuration from metafield if migrationCompleted is true", async () => {
    vi.mocked(adminGraphql).mockResolvedValueOnce({
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
    expect(adminGraphql).toHaveBeenCalledTimes(1); // Should not call legacy load or save
  });

  it("should fallback to legacy configuration and resolve GID filenames, then save and return config", async () => {
    // 1. loadNavigationConfig reads currentAppInstallation metafield (missing)
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/1",
        navigation: null,
      },
    });

    // 2. Legacy loader returns legacy data
    vi.mocked(loadLegacyNavigation).mockResolvedValueOnce({
      fixedNavigation: false,
      logoType: "image",
      logoText: "",
      logoFile: "gid://shopify/MediaImage/100",
      navBackgroundColor: "#000",
      primaryNavTextColor: "#fff",
      secondaryNavTextColor: "#ccc",
      iconColor: "#bbb",
      menuHandle: "main-menu",
      secondLevelConfigs: [
        {
          level1Index: 0,
          level2Index: 1,
          level1Title: "Shop",
          level2Title: "Apparel",
          layoutType: "big_image",
          bigImage1: "gid://shopify/MediaImage/101",
        },
        {
          level1Index: 0,
          level2Index: 2,
          level1Title: "Shop",
          level2Title: "Shoes",
          layoutType: "product_list",
          adImage: "gid://shopify/MediaImage/102",
        }
      ]
    } as any);

    // 3. Resolving GID details
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      nodes: [
        {
          id: "gid://shopify/MediaImage/100",
          preview: { image: { url: "https://cdn.shopify.com/files/logo_file.png?v=1" } }
        },
        {
          id: "gid://shopify/MediaImage/101",
          preview: { image: { url: "https://cdn.shopify.com/files/big_img_1.png?v=2" } }
        },
        {
          id: "gid://shopify/MediaImage/102",
          preview: { image: { url: "https://cdn.shopify.com/files/ad_img.jpg?v=3" } }
        }
      ]
    });

    // 4. Getting App Installation ID for saving
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/1",
      }
    });

    // 5. SET_CONFIG_MUTATION response
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      metafieldsSet: {
        metafields: [
          { key: "navigation_config", value: "some-value" }
        ],
        userErrors: []
      }
    });

    const config = await loadNavigationConfig({} as any);
    expect(config.migrationCompleted).toBe(true);
    expect(config.logoFileFilename).toBe("logo_file.png");
    expect(config.secondLevelConfigs[0].bigImage1Filename).toBe("big_img_1.png");
    expect(config.secondLevelConfigs[1].adImageFilename).toBe("ad_img.jpg");
    expect(adminGraphql).toHaveBeenCalledTimes(4); // Query Config -> Resolve Files -> Query App ID -> Set Config
  });

  it("should return defaults and retry next time if legacy loader fails", async () => {
    // 1. loadNavigationConfig reads currentAppInstallation metafield (missing)
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/1",
        navigation: null,
      },
    });

    // 2. Legacy loader throws error
    vi.mocked(loadLegacyNavigation).mockRejectedValueOnce(new Error("Database offline"));

    const config = await loadNavigationConfig({} as any);
    expect(config.migrationCompleted).toBeUndefined();
    expect(config.logoText).toBe(NAVIGATION_DEFAULTS.logoText);
  });
});

describe("loadBannerConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should return configuration from metafield if migrationCompleted is true", async () => {
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/1",
        banner: {
          jsonValue: {
            autoplay: true,
            autoplaySpeed: 5,
            slides: [],
            migrationCompleted: true,
          },
        },
      },
    });

    const config = await loadBannerConfig({} as any);
    expect(config.migrationCompleted).toBe(true);
    expect(config.autoplay).toBe(true);
  });

  it("should progressively resolve processing video files if they become READY", async () => {
    // 1. loadBannerConfig reads metafield with migrationCompleted: true,
    // but the slides have a video file with pending/missing URLs
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/1",
        banner: {
          jsonValue: {
            autoplay: true,
            autoplaySpeed: 5,
            slides: [
              {
                id: "slide-1",
                title: "Slide 1",
                video: "gid://shopify/Video/999",
                videoUrl: "https://youtube.com/something",
                // missing videoFileUrl and videoPosterUrl
                heading: "Heading",
                subheading: "Subheading",
                primaryButtonLabel: "Click",
                primaryButtonLink: "/url"
              }
            ],
            migrationCompleted: true,
          },
        },
      },
    });

    // 2. Progressive check queries GET_FILE_DETAILS
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      nodes: [
        {
          id: "gid://shopify/Video/999",
          fileStatus: "READY",
          sources: [
            { url: "https://cdn.shopify.com/videos/999.mp4" }
          ],
          preview: {
            image: { url: "https://cdn.shopify.com/videos/999_poster.jpg" }
          }
        }
      ]
    });

    // 3. Gets owner id to save updated banner config
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/1",
      }
    });

    // 4. Mutation to update metafield
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      metafieldsSet: {
        metafields: [
          { key: "banner_config", value: "some-value" }
        ],
        userErrors: []
      }
    });

    const config = await loadBannerConfig({} as any);
    expect(config.slides[0].videoFileUrl).toBe("https://cdn.shopify.com/videos/999.mp4");
    expect(config.slides[0].videoPosterUrl).toBe("https://cdn.shopify.com/videos/999_poster.jpg");
    expect(adminGraphql).toHaveBeenCalledTimes(4);
  });

  it("should progressively resolve missing image filenames from file GIDs", async () => {
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/1",
        banner: {
          jsonValue: {
            autoplay: true,
            autoplaySpeed: 5,
            slides: [
              {
                id: "slide-1",
                desktopImage: "gid://shopify/MediaImage/100",
                heading: "Heading",
              },
            ],
            migrationCompleted: true,
          },
        },
      },
    });

    vi.mocked(adminGraphql).mockResolvedValueOnce({
      nodes: [
        {
          id: "gid://shopify/MediaImage/100",
          preview: {
            image: { url: "https://cdn.shopify.com/files/banner-hero.jpg?v=1" },
          },
        },
      ],
    });

    vi.mocked(adminGraphql).mockResolvedValueOnce({
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/1",
      },
    });

    vi.mocked(adminGraphql).mockResolvedValueOnce({
      metafieldsSet: {
        metafields: [{ key: "banner_config", value: "some-value" }],
        userErrors: [],
      },
    });

    const config = await loadBannerConfig({} as any);
    expect(config.slides[0].desktopImageFilename).toBe("banner-hero.jpg");
    expect(adminGraphql).toHaveBeenCalledTimes(4);
  });

  it("should progressively query video if videoFileUrl is present but videoPosterUrl is undefined, and skip if both are resolved", async () => {
    // 1. Mock config where slide has videoFileUrl but videoPosterUrl is undefined
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/1",
        banner: {
          jsonValue: {
            autoplay: true,
            autoplaySpeed: 5,
            slides: [
              {
                id: "slide-1",
                video: "gid://shopify/Video/999",
                videoFileUrl: "https://cdn.shopify.com/videos/999.mp4",
                videoPosterUrl: undefined,
                heading: "Heading",
              },
              {
                id: "slide-2",
                video: "gid://shopify/Video/888",
                videoFileUrl: "https://cdn.shopify.com/videos/888.mp4",
                videoPosterUrl: "", // already queried and empty
                heading: "Heading 2",
              }
            ],
            migrationCompleted: true,
          },
        },
      },
    });

    // 2. Mock GET_FILE_DETAILS for gid://shopify/Video/999 only, since gid://shopify/Video/888 should be skipped
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      nodes: [
        {
          id: "gid://shopify/Video/999",
          fileStatus: "READY",
          sources: [
            { url: "https://cdn.shopify.com/videos/999.mp4" }
          ],
          preview: {
            image: null // no poster url
          }
        }
      ]
    });

    // 3. Mock save AppInstallation ID
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/1",
      }
    });

    // 4. Mock Mutation to update metafield
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      metafieldsSet: {
        metafields: [],
        userErrors: []
      }
    });

    const config = await loadBannerConfig({} as any);
    // Verified that slide-1 videoPosterUrl gets resolved to ""
    expect(config.slides[0].videoPosterUrl).toBe("");
    
    // Check that we only queried GET_FILE_DETAILS with the pending video GID from slide-1
    const fileDetailsCalls = vi.mocked(adminGraphql).mock.calls.filter(c => c[1]?.includes("BcDesignGetFileDetails"));
    expect(fileDetailsCalls.length).toBe(1);
    expect(fileDetailsCalls[0][2]).toEqual({ ids: ["gid://shopify/Video/999"] });
  });
});

describe("saveNavigationConfig & saveBannerConfig Errors", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should throw error if metafieldsSet returns userErrors", async () => {
    // mock AppInstallation ID query
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/1",
      }
    });

    // mock mutation error
    vi.mocked(adminGraphql).mockResolvedValueOnce({
      metafieldsSet: {
        metafields: [],
        userErrors: [
          { field: ["value"], message: "Invalid JSON format" }
        ]
      }
    });

    await expect(saveNavigationConfig({} as any, NAVIGATION_DEFAULTS)).rejects.toThrow("Invalid JSON format");
  });
});
