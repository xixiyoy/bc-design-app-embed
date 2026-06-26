# Banner Brightness Adaptive Overlay Design

## Overview

Add a global "Brightness adaptive overlay" feature to the Banner carousel. When enabled, the system automatically analyzes each slide's desktop and mobile images for brightness, then applies a black or white semi-transparent overlay (plus inverted text/button colors for light images) on the storefront — entirely via Liquid-rendered CSS classes, with no storefront JavaScript involved in brightness judgment.

**Architecture:** Admin Canvas pre-computation → per-slide Metaobject storage → Liquid CSS class output → CSS visual application.

Storefront consumes only persisted results and never recomputes image brightness.

---

## Data Model

### Banner-level field (global)

| Field (camelCase) | Metaobject field (snake_case) | Type | Default | Description |
|---|---|---|---|---|
| `brightnessAdaptiveOverlayEnabled` | `brightness_adaptive_overlay_enabled` | `boolean` | `false` | Global toggle controlling whether adaptive overlay is active for the entire Banner |

### Slide-level computed-result fields

Each slide stores independent desktop and mobile results.

| Field (camelCase) | Metaobject field (snake_case) | Type | Range | Default | Description |
|---|---|---|---|---|---|
| `desktopAverageBrightness` | `desktop_average_brightness` | `number_integer` | 0-255 | `0` | Desktop image average brightness |
| `desktopAdaptiveOverlayVariant` | `desktop_adaptive_overlay_variant` | `single_line_text_field` | `black` \| `white` | `black` | Desktop overlay type |
| `desktopAdaptiveOverlayOpacity` | `desktop_adaptive_overlay_opacity` | `number_integer` | 0-60 | `30` | Desktop overlay opacity (%) |
| `mobileAverageBrightness` | `mobile_average_brightness` | `number_integer` | 0-255 | `0` | Mobile image average brightness |
| `mobileAdaptiveOverlayVariant` | `mobile_adaptive_overlay_variant` | `single_line_text_field` | `black` \| `white` | `black` | Mobile overlay type |
| `mobileAdaptiveOverlayOpacity` | `mobile_adaptive_overlay_opacity` | `number_integer` | 0-60 | `30` | Mobile overlay opacity (%) |

**Design decisions:**

- The brightness threshold is fixed at `128` internally, not exposed to merchants, and not stored in the data model.
- Opacity defaults to `30` for V1. The per-image opacity fields are retained to allow future algorithmic adjustment (e.g., brighter images get lower opacity).
- Variant values are strictly `black` or `white`. Empty/invalid values encountered when reading old data are normalized to `black` during parse.
- When a slide has no mobile image, the mobile result triplet is copied from the desktop result at save time.
- When a slide has no desktop image but has a mobile image, the desktop result triplet is copied from the mobile result at save time.
- When a slide has neither desktop nor mobile image (or only video), both result triplets fallback to: `averageBrightness = 0`, `variant = black`, `opacity = 30`.
- When the global toggle is off, computed results are retained in the data but the storefront does not apply them.

---

## Admin-side Design

### New file: `app/lib/bc-design/image-brightness.client.ts`

A browser-only utility function:

```ts
calculateImageBrightness(imageUrl: string): Promise<number | null>
```

Behavior:

- **CORS isolation**: Appends a fixed query parameter (e.g., `&brightness-compute=1`) to the image URL before loading. This ensures the `crossOrigin="anonymous"` request is cached separately from any non-CORS `<img>` requests for the same image, preventing the browser from returning a cached non-CORS response. Because Shopify CDN URLs already include a version parameter (`?v=...`), repeated analysis of the same image will still hit browser cache as long as the image itself has not changed.
- **CORS feasibility check**: Before implementation, verify that Shopify Files CDN URLs return `Access-Control-Allow-Origin` headers. If they do not, the Canvas will be tainted and `calculateImageBrightness` will always return `null`. In that case, implement a backend proxy (download the image server-side and return pixel data) or use an Admin GraphQL file preview endpoint as a fallback.
- **Thumbnail optimization**: Requests a low-resolution thumbnail from Shopify CDN (e.g., `width=100` or `_100x100` URL parameter) instead of the full-size image. This minimizes download time, reduces bandwidth, and makes the 10-second timeout extremely unlikely.
- Creates an off-screen `Image` with `crossOrigin = "anonymous"`.
- Draws to a `100×100` canvas.
- Computes per-pixel grayscale with **alpha-channel weighting**:
  ```
  brightness = 0.299*R + 0.587*G + 0.114*B
  weight     = A / 255
  ```
  Fully transparent pixels contribute zero weight, preventing transparent PNG backgrounds from skewing the result.
- Returns a weighted-average integer `0-255`.
- Returns `null` on any failure (load error, CORS, canvas exception).
- **Failure UI**: If analysis fails, the Admin UI must show a clear indicator in the slide's Brightness analysis card (e.g., "Unable to read image brightness — default overlay applied"), rather than silently falling back.

The `.client.ts` suffix prevents accidental server-side import.

### Global toggle UI

Added to the Banner admin page (`app/routes/app.banner.tsx`) inside the **Carousel settings** section, grouped under an **Adaptive overlay** subsection, directly below the existing "Overlay opacity" field:

```
Carousel settings
  Overlay
    Overlay opacity
  Adaptive overlay
    Brightness adaptive overlay [switch]
    "Turn on automatic image brightness analysis for all banner slides.
     Dark images use a black overlay.
     Light images use a white overlay with dark text."
```

### Auto-computation triggers

When the global toggle is turned **on**:
- Batch-compute desktop and mobile results for all slides that have images.
- **Concurrency limit:** Batch computations are throttled to a maximum of **3 concurrent image analyses** at a time. This prevents saturating the browser's network queue and keeps the Admin UI responsive.

While the global toggle remains **on**:
- A slide's desktop image changes → recompute that slide's desktop triplet only.
- A slide's mobile image changes → recompute that slide's mobile triplet only.
- A slide's mobile image is deleted → copy desktop triplet to mobile triplet immediately.
- A slide's desktop image is deleted but mobile exists → copy mobile triplet to desktop triplet immediately.
- On page load, if the global toggle is on and any slide lacks computed results → auto-recompute.

When the global toggle is turned **off**:
- Do not start new computations.
- In-flight computations may complete and can be cached, but the admin preview and storefront do not apply them.

### Result normalization at save time

Before saving, every slide is normalized:

```
if no mobile image:
  mobile triplet = desktop triplet

if no desktop image but mobile image exists:
  desktop triplet = mobile triplet

if no images at all:
  desktop triplet = fallback (0, black, 30)
  mobile triplet = fallback (0, black, 30)

clamp brightness to [0, 255]
clamp opacity to [0, 60]
variant must be "black" or "white"; invalid → "black"
```

### Per-slide read-only display

Placed **directly below the Media fields** (desktop image / mobile image) inside each slide editor, visible only when the global toggle is on:

```
Brightness analysis
├─ Desktop: 142 / light / white overlay
└─ Mobile:  142 / light / white overlay (copied from desktop)
```

Status indicators (local UI state, not persisted):
- `not calculated`
- `calculating`
- `calculated`
- `failed`
- `copied from desktop` / `copied from mobile`

When the global toggle is off, the read-only card is hidden or shows:
```
Brightness analysis is disabled by the global setting.
```

### Preview transition during calculation

When a slide is in the `calculating` state (e.g., after a merchant replaces an image), the Admin preview must not leave the slide completely unmasked. Instead, it should render the **existing base overlay** (black, default opacity) as a transitional state. When the computation completes and the result is applied, the preview smoothly transitions to the computed overlay via CSS `transition`. This avoids a sudden visual jump from no overlay to white overlay + inverted text.

### Race-condition safety

Each computation is keyed by:
```
slideId + deviceType ("desktop" | "mobile") + imageIdentifier
```

The `imageIdentifier` is a transient reference (e.g., the image GID or preview URL) tracked only in Admin local state during the computation. It is **not persisted** to the Metaobject.

Before writing a result back:
1. Verify the slide still exists.
2. Verify the slide still has the same image (by comparing the current image identifier with the one used to start the computation).
3. Verify the device type still matches.

If the global toggle has been turned off since the computation started, the result may be cached but is not applied to the UI or storefront.

### Save behavior while calculations are pending

When `brightnessAdaptiveOverlayEnabled` is true and required desktop/mobile computations are still pending:
- **Do not disable the Save button.** Merchants may save at any time.
- If a computation is still `calculating` at save time, that slide is automatically saved with fallback values (`averageBrightness = 0`, `variant = black`, `opacity = 30`). The computation may continue in the background; its result will be cached for the next interaction but is not written retroactively.
- If a computation exceeds **10 seconds**, mark it as failed and use fallback values.
- If a computation fails or times out, the slide uses fallback values: `averageBrightness = 0`, `variant = black`, `opacity = 30`.
- The UI must indicate which slides used fallback.

---

## Storefront Design (Liquid + CSS)

### Core principle

The storefront does **not** run Canvas, compute brightness, or judge light vs. dark. It only reads saved results. Liquid outputs CSS classes and variables; CSS handles the visual result.

### Liquid rendering

The storefront uses a two-layer pattern: the `banner_carousel.liquid` **block** iterates over `banner_config.slides.value`, unpacks each metaobject field with `.value`, and passes primitive scalar values to the `banner_carousel_slide.liquid` **snippet**.

**Block layer** (`banner_carousel.liquid`):

```liquid
{% assign brightness_adaptive_overlay_enabled = banner_config.brightness_adaptive_overlay_enabled.value | default: false %}
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
    eager_load: 'lazy',
    brightness_adaptive_overlay_enabled: brightness_adaptive_overlay_enabled,
    desktop_adaptive_overlay_variant: slide.desktop_adaptive_overlay_variant.value,
    desktop_adaptive_overlay_opacity: slide.desktop_adaptive_overlay_opacity.value,
    mobile_adaptive_overlay_variant: slide.mobile_adaptive_overlay_variant.value,
    mobile_adaptive_overlay_opacity: slide.mobile_adaptive_overlay_opacity.value
  %}
{% endfor %}
```

**Snippet layer** (`banner_carousel_slide.liquid`) receives scalar values and normalizes with defensive fallback:

```liquid
{%- assign desktop_variant = desktop_adaptive_overlay_variant | default: 'black' -%}
{%- assign mobile_variant = mobile_adaptive_overlay_variant | default: desktop_variant -%}

{%- unless desktop_variant == 'black' or desktop_variant == 'white' -%}
  {%- assign desktop_variant = 'black' -%}
{%- endunless -%}

{%- unless mobile_variant == 'black' or mobile_variant == 'white' -%}
  {%- assign mobile_variant = desktop_variant -%}
{%- endunless -%}

{%- assign desktop_opacity_percent = desktop_adaptive_overlay_opacity | default: 30 | plus: 0 -%}
{%- assign mobile_opacity_percent = mobile_adaptive_overlay_opacity | default: desktop_opacity_percent | plus: 0 -%}

{%- assign desktop_opacity = desktop_opacity_percent | divided_by: 100.0 -%}
{%- assign mobile_opacity = mobile_opacity_percent | divided_by: 100.0 -%}
```

> **Note on `default` filter behavior:** The `default` filter only replaces `nil`, `empty`, or `false` values. A `number_integer` metaobject field that has never been initialized returns `nil`, which triggers the fallback to `30`. A deliberately saved value of `0` is not `nil`, so it is preserved. This ensures `0%` opacity can be intentionally set.

Then builds the class list:

```liquid
{%- assign slide_classes = 'bc-banner-slide' -%}
{%- assign slide_style = '' -%}

{%- if brightness_adaptive_overlay_enabled == true -%}
  {%- assign slide_classes = slide_classes | append: ' bc-banner-slide--adaptive-enabled' -%}
  {%- assign slide_classes = slide_classes | append: ' bc-banner-slide--adaptive-desktop-' | append: desktop_variant -%}
  {%- assign slide_classes = slide_classes | append: ' bc-banner-slide--adaptive-mobile-' | append: mobile_variant -%}
  {%- capture slide_style -%}
    --bc-banner-adaptive-desktop-opacity: {{ desktop_opacity }};
    --bc-banner-adaptive-mobile-opacity: {{ mobile_opacity }};
  {%- endcapture -%}
{%- endif -%}
```

The slide container renders as:

```liquid
<div
  class="{{ slide_classes }}"
  {% if slide_style != blank %}
    style="{{ slide_style | strip }}"
  {% endif %}
>
```

When the global toggle is off, no adaptive classes or variables are output.

### CSS

Use the project's existing breakpoint convention (typically `750px`). The overlay breakpoint must match the desktop/mobile image switching breakpoint exactly.

Consider exposing the breakpoint as a CSS variable (e.g., `--bc-banner-mobile-breakpoint: 750px`) so themes that override the carousel breakpoint can keep the overlay in sync.

Instead of deep nested selectors, define local CSS variables on the slide container and let child elements consume them:

```css
/* 1. Base defaults */
.bc-banner-slide {
  --bc-overlay-bg: rgba(0, 0, 0, var(--bc-banner-overlay-opacity, 0.2));
  --bc-slide-text-color: inherit;
  --bc-button-bg: #ffffff;
  --bc-button-text: #000000;
}

/* 2. Desktop adaptive overrides */
@media screen and (min-width: 750px) {
  .bc-banner-slide--adaptive-enabled.bc-banner-slide--adaptive-desktop-black {
    --bc-overlay-bg: rgba(0, 0, 0, var(--bc-banner-adaptive-desktop-opacity, 0.3));
  }

  .bc-banner-slide--adaptive-enabled.bc-banner-slide--adaptive-desktop-white {
    --bc-overlay-bg: rgba(255, 255, 255, var(--bc-banner-adaptive-desktop-opacity, 0.3));
    --bc-slide-text-color: var(--bc-banner-adaptive-dark-text-color, #121212);
    --bc-button-bg: var(--bc-banner-adaptive-dark-button-background, #121212);
    --bc-button-text: var(--bc-banner-adaptive-dark-button-text, #ffffff);
  }
}

/* 3. Mobile adaptive overrides */
@media screen and (max-width: 749px) {
  .bc-banner-slide--adaptive-enabled.bc-banner-slide--adaptive-mobile-black {
    --bc-overlay-bg: rgba(0, 0, 0, var(--bc-banner-adaptive-mobile-opacity, 0.3));
  }

  .bc-banner-slide--adaptive-enabled.bc-banner-slide--adaptive-mobile-white {
    --bc-overlay-bg: rgba(255, 255, 255, var(--bc-banner-adaptive-mobile-opacity, 0.3));
    --bc-slide-text-color: var(--bc-banner-adaptive-dark-text-color, #121212);
    --bc-button-bg: var(--bc-banner-adaptive-dark-button-background, #121212);
    --bc-button-text: var(--bc-banner-adaptive-dark-button-text, #ffffff);
  }
}

/* 4. Child elements consume variables */
.bc-banner-slide__overlay {
  background: var(--bc-overlay-bg);
  transition: background-color 0.3s ease;
}

.bc-banner-slide__content,
.bc-banner-slide__heading,
.bc-banner-slide__subheading {
  color: var(--bc-slide-text-color);
  transition: color 0.3s ease;
}

.bc-banner-slide__button--primary {
  background: var(--bc-button-bg);
  border-color: var(--bc-button-bg);
  color: var(--bc-button-text);
  transition: background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease;
}

.bc-banner-slide__button--secondary {
  border: 2px solid var(--bc-button-bg);
  background: transparent;
  color: var(--bc-slide-text-color);
  transition: background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease;
}
```

When the global toggle is off, `.bc-banner-slide__overlay` falls back to its existing default:
```css
background: rgba(0, 0, 0, var(--bc-banner-overlay-opacity, 0.2));
```

### Overlay opacity priority

- When adaptive overlay is **enabled**, each slide uses the saved desktop/mobile adaptive overlay opacity (`--bc-banner-adaptive-desktop-opacity` / `--bc-banner-adaptive-mobile-opacity`) instead of the base banner overlay opacity.
- When adaptive overlay is **disabled**, the existing base banner overlay opacity (`--bc-banner-overlay-opacity`) continues to apply.
- **Video slides**: When the global toggle is on, video-only slides still receive the adaptive CSS class (`.bc-banner-slide--adaptive-desktop-black` / `.bc-banner-slide--adaptive-mobile-black`) with the fallback opacity value (`30%`). This is consistent with image slides and uses the adaptive opacity variable, not the base overlay opacity.

### Adaptive color inversion priority & theming

- The CSS selectors for white-overlay mode (`.bc-banner-slide--adaptive-desktop-white`, etc.) apply forced dark text and button colors. This is intentional and has **higher specificity** than base slide styles, ensuring readability on light backgrounds.
- Merchants who manually override text or button colors at the slide level should be aware that adaptive inversion will take precedence when the feature is enabled.
- For future customization, the hardcoded fallback colors (`#121212`, `#ffffff`) may be wired to Shopify Theme Settings (e.g., `settings.colors_text`) or App Extension settings schema, allowing merchants to define their own "adaptive dark mode" palette.

### Storefront JavaScript

**Do not modify `banner-carousel.js`.** The Web Component does not need to be aware of brightness logic because Liquid already outputs the final classes.

---

## Deployment / Configuration

### Files to update

1. **`shopify.app.toml`** and **`shopify.app.render.toml`**:
   - Add `brightness_adaptive_overlay_enabled` to `[metaobjects.app.banner_config.fields]`
   - Add `desktop_average_brightness`, `desktop_adaptive_overlay_variant`, `desktop_adaptive_overlay_opacity` to `[metaobjects.app.banner_slide.fields]`
   - Add `mobile_average_brightness`, `mobile_adaptive_overlay_variant`, `mobile_adaptive_overlay_opacity` to `[metaobjects.app.banner_slide.fields]`

2. **TypeScript types** (`app/lib/bc-design/config-types.ts`):
   - Add 6 new optional fields to `BannerSlideConfig` (`desktopAverageBrightness?: number`, `desktopAdaptiveOverlayVariant?: string`, `desktopAdaptiveOverlayOpacity?: number`, `mobileAverageBrightness?: number`, `mobileAdaptiveOverlayVariant?: string`, `mobileAdaptiveOverlayOpacity?: number`).
   - Add `brightnessAdaptiveOverlayEnabled: boolean` to `BannerConfig`.
   - Add `brightnessAdaptiveOverlayEnabled: false` to `BANNER_DEFAULTS`.
   - Extend `clampBannerNumber` union type with `"desktopAdaptiveOverlayOpacity" | "mobileAdaptiveOverlayOpacity"` (same 0-60 range as `overlayOpacity`).

3. **Metaobject read/write** (`app/lib/bc-design/metaobjects.server.ts`):
   - `parseBannerSlide`: read 6 new fields with `numberValue` / `textValue` (fallbacks: brightness `0`, variant `"black"`, opacity `30`).
   - `buildBannerSlideFields`: always write all 6 fields (not `optionalField`) so `number_integer` fields are never left `nil`.
   - `loadBannerConfig`: read `brightness_adaptive_overlay_enabled` with `booleanValue`.
   - `saveBannerConfig`: write `brightness_adaptive_overlay_enabled`.

4. **Admin route payload parsing** (`app/routes/app.banner.tsx`):
   - `parseBannerConfigPayload`: parse `brightnessAdaptiveOverlayEnabled` with `Boolean(parsed.brightnessAdaptiveOverlayEnabled)`.
   - `parseBannerSlidePayload`: parse the 6 new fields with fallback defaults.

5. **New utility**: `app/lib/bc-design/image-brightness.client.ts`
6. **Admin UI**: `app/routes/app.banner.tsx`
7. **Admin preview**: `app/components/bc-design/BannerPreview.tsx`
8. **Theme Liquid**: `extensions/bc-design-theme/blocks/banner_carousel.liquid` and `snippets/banner_carousel_slide.liquid`
9. **Theme CSS**: `extensions/bc-design-theme/assets/banner-carousel.css`

### Post-code deployment

After updating TOML metaobject definitions, run:

```bash
shopify app deploy --config render
```

If Shopify does not sync the new app-owned metaobject fields automatically in the target store, follow the project's reinstall / migration process to refresh the definitions. Only changing code without deploying will cause field read/write errors.

---

## Acceptance Criteria

### Admin

1. A global "Brightness adaptive overlay" switch appears in Banner settings.
2. No per-slide brightness toggle exists.
3. When the global switch is turned on, all slides with images are automatically analyzed.
4. Desktop and mobile images are computed independently.
5. Desktop and mobile results are saved independently.
6. Changing a desktop image recomputes only the desktop result for that slide.
7. Changing a mobile image recomputes only the mobile result for that slide.
8. When mobile image is missing, mobile result is copied from desktop result.
9. On failure, the slide gets black overlay fallback values.
10. After save and refresh, the global switch and all slide results are correctly restored.
11. When the global switch is off, the admin preview reverts to default appearance.
12. When the global switch is turned on again, valid cached results are reused; missing results are recomputed.
13. Old banners created before this feature continue to render normally after deployment.

### Storefront

1. When the global switch is off, no adaptive classes or CSS variables are output.
2. When the global switch is on, each image slide receives adaptive classes based on saved results.
3. Desktop viewport uses the desktop overlay result.
4. Mobile viewport uses the mobile overlay result.
5. Dark images receive black overlay (to maintain contrast for light text).
6. Light images receive white overlay (to maintain contrast for dark text).
7. White overlay mode inverts text and buttons to a dark scheme (ensuring readability on bright backgrounds).
8. Black overlay mode preserves the default light text/button scheme.
9. The storefront does not run Canvas.
10. The storefront does not recompute image brightness.
11. The storefront does not rely on JS to judge light vs. dark.
12. No overlay flicker occurs before images load.
13. Video-only slides use the default black overlay. A UI note in the Admin informs merchants that video slides always use the default overlay, avoiding a visual break when adaptive white overlays are used on surrounding image slides.

### Edge cases

1. Image computation failure → black overlay fallback.
2. Video-only slide with no images → black overlay fallback. No brightness analysis. Do not attempt frame sampling.
3. Transparent PNG backgrounds → alpha-weighted brightness calculation prevents transparent pixels from skewing the result.
4. Brightness < 0 → clamped to 0.
5. Brightness > 255 → clamped to 255.
6. Opacity < 0 → clamped to 0.
7. Opacity > 60 → clamped to 60.
8. Invalid variant → fallback to `black`.
9. Old data missing new fields → safe defaults, no errors.
10. Global toggle defaults to off.
11. No per-slide toggle exists.
12. Video-only slides with no images → default black overlay. Admin UI includes a note explaining that video slides always use the default overlay to prevent visual discontinuity against adjacent adaptive white-overlay slides.

---

### Performance

- Admin brightness computation resizes images to `100×100` before analysis.
- Typical computation time should remain well below one second per image under normal network conditions.
- The Admin UI should remain responsive while computations are running; computation should be lightweight enough not to noticeably block the Admin UI.

---

## Additional Implementation Notes

1. **Image tone concept (internal):**
   - The computation pipeline derives an `imageTone` from `averageBrightness` using the threshold of `128`:
     - `averageBrightness < 128` → `imageTone = "dark"`
     - `averageBrightness >= 128` → `imageTone = "light"`
   - `imageTone` is a transient concept used only during computation to determine `overlayVariant`:
     - `dark` → `overlayVariant = "black"`
     - `light` → `overlayVariant = "white"`
   - `imageTone` is **not persisted** to the Metaobject; only `averageBrightness`, `variant`, and `opacity` are stored.

2. **Save while calculations are pending:**
   - Save is never disabled. If a computation is still `calculating` at save time, that slide is saved with fallback values (`brightness = 0`, `variant = black`, `opacity = 30`).
   - Failed or timed-out computations use fallback: `brightness = 0`, `variant = black`, `opacity = 30`.

3. **Liquid parameter passing:**
   - `banner_carousel.liquid` must pass normalized primitive values (using `.value` when reading metaobject fields) to the `banner_carousel_slide.liquid` snippet.
   - The snippet performs defensive normalization (fallback defaults); it does not assume valid upstream data.

4. **Adaptive CSS variables output rule:**
   - `--bc-banner-adaptive-desktop-opacity` and `--bc-banner-adaptive-mobile-opacity` are output **only** when `brightness_adaptive_overlay_enabled` is true.

5. **CSS variable theming:**
   - Adaptive dark text and button colors use CSS variables with fallback defaults (e.g., `var(--bc-banner-adaptive-dark-text-color, #121212)`), allowing future theme customization without modifying selectors.
