# Review: App Embed Target Migration Design

Reviewed document: `docs/superpowers/specs/2026-06-24-app-embed-target-design.md`

## Findings

### High: Banner likely renders at the bottom of the homepage, not below navigation

The design assumes `target: "body"` plus normal-flow banner markup will produce "Navigation first, then Banner" visually. In Shopify app embeds, body-target embeds are injected near the end of `<body>`. The current banner CSS is normal flow (`position: relative`, full-bleed width), so after migration it will likely appear after the page's existing content, not under the header at the top of the homepage.

This affects the core goal that the Banner app embed renders as a homepage hero below navigation. The spec should define how the banner is visually placed after body-end injection, for example:

- explicitly position the banner as a top hero and reserve layout space;
- inject into a known theme location instead of body app embed;
- keep banner as a section block if top-of-page placement is required;
- document that merchants must remove/replace their theme hero and accept body-end placement, if that is actually intended.

Current text to revise: `DOM Placement And Styling`, `Merchant Setup Flow`, and `Testing`.

### High: Navigation placement depends on `fixed_navigation`; non-fixed nav may also render at body end

The design says the navigation app embed replaces the theme Header and should appear at the top. The current CSS only fixes the navbar when `fixed_navigation` is true. When that metaobject value is false, the navigation root is normal flow and, as a body app embed, can render at the end of the page.

The spec should either:

- require app-embed navigation to always use fixed or sticky positioning regardless of the existing `fixed_navigation` config;
- redefine `fixed_navigation` semantics for app embeds;
- or keep navigation in a section/header insertion path if non-fixed header behavior must remain supported.

Without this decision, the migration can pass schema validation while failing the primary visual requirement.

### High: Resource loading plan is incomplete for `gsap.min.js`

The schema examples declare only `navigation-animations.js` as the navigation block's `javascript`. The current navigation block manually loads both `gsap.min.js` and `navigation-animations.js`, and `navigation-animations.js` documents that `gsap.min.js` must load first.

Shopify theme app extension block schema supports a single `javascript` asset per block. If implementation removes all manual `<script>` tags as suggested, the GSAP-dependent hover effects can silently stop working. If implementation keeps `gsap.min.js` manually and moves only `navigation-animations.js` to schema, the spec should say so and define the expected load order.

The spec should make one explicit choice:

- bundle GSAP usage into `navigation-animations.js`;
- remove the GSAP dependency if the file is only optional hooks;
- keep a manual `gsap.min.js` script tag and only remove duplicated schema-managed assets;
- or keep all navigation scripts manual and avoid schema `javascript` for this block.

### Medium: Deleting `banner_slide.liquid` needs a migration/compatibility decision

The design says to delete `blocks/banner_slide.liquid` because it is no longer needed. The current file is a no-op compatibility stub for existing section sibling-block usage. Deleting it may be acceptable for a clean dev-store migration, but the spec also mentions stores that already added section blocks.

The spec should clarify whether this migration targets only unreleased/dev stores or must tolerate installed themes that reference the old block. If any existing merchant themes may contain `banner_slide`, the safer plan is to keep the no-op stub temporarily, hide/deprecate it through naming/instructions if possible, and remove it only in a later breaking migration.

### Medium: Embed ordering may not be controllable enough to guarantee layout

The spec says Navigation should be listed/enabled above Banner in App embeds. Merchant-controlled app embed order is not a strong technical invariant, and relying on it for DOM/layout order makes the implementation fragile.

If ordering matters, the spec should add an implementation invariant that does not depend only on merchant ordering, such as z-index/positioning rules, a combined wrapper, or a single embed that renders both modules in a deterministic order. If independent embeds are a hard requirement, testing should include reversed embed order and document expected behavior.

### Low: Locale update guidance is vague

The locale section says update locale files "if needed". Current locale files include `navigation_menu`, `banner_carousel`, and `banner_slide` names. Because the design changes visible block names from "Navigation Menu" / "Banner carousel" to "BC Design Navigation" / "BC Design Banner" and deletes or deprecates `banner_slide`, this is not optional.

The spec should list the exact expected locale keys and whether `banner_slide` should be removed or retained.

### Low: Validation commands should include theme-extension validation in the current project context

The automated testing section lists `shopify app config validate`, but this migration is specifically about theme extension block schemas and app embed behavior. The spec should include the exact validation command expected for this repo/config, especially because the dev server is run with `--config localhost`.

Suggested addition:

- `shopify app config validate --config localhost`
- a dev-store smoke test through `shopify app dev --config localhost --use-localhost`

## Open Questions

- Is top-of-page banner placement a hard requirement, or is body-end placement acceptable once the banner becomes an app embed?
- Should app-embed navigation always be fixed/sticky, even when the existing `fixed_navigation` metaobject setting is false?
- Is this migration for an unreleased dev store only, or must it preserve compatibility with themes that already added section blocks?
- Should Navigation and Banner remain two independent embeds if deterministic relative placement cannot be guaranteed?

## Summary

The design is directionally clear for changing merchant enablement from section blocks to app embeds and preserving app-admin/metaobject configuration. The main gap is that it treats `target: "body"` as only an enablement-path change, but body injection changes DOM placement. Before implementation, the spec should explicitly solve visual placement for both Navigation and Banner, script dependency loading for GSAP, and the compatibility policy for deleting `banner_slide.liquid`.

## Resolution Status (2026-06-24)

All findings addressed in `docs/superpowers/specs/2026-06-24-app-embed-target-design.md` (Design Review Resolutions section):

- **DOM placement:** `bc-design-embed-placement.js` + forced fixed nav shell
- **GSAP:** manual dual script tags retained; no schema `javascript` on navigation block
- **`banner_slide.liquid`:** delete (dev-store only)
- **Embed order:** placement script invariant + reversed-order test case
- **Locales:** explicit key list in spec
- **Validation:** localhost config validate + dev smoke test added

**Open questions — resolved in spec:**

| Question | Answer |
|----------|--------|
| Top-of-page banner required? | Yes — placement script on index |
| Nav always fixed in embed mode? | Yes — always `phaetus-nav-root--fixed` |
| Dev store only / keep `banner_slide`? | Dev only — delete stub |
| Two independent embeds if placement uncertain? | Yes — placement script coordinates them |
