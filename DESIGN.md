---
name: Allegra Soft Signal
status: active
source_of_truth:
  - apps/web/src/styles/tokens.css
  - apps/web/src/styles/tailwind.css
  - apps/web/src/styles/components.css
  - apps/web/src/styles/app.css
  - apps/web/src/components/shader/MusicFlowShader.tsx
  - apps/web/src/components/DynamicAura.tsx
  - apps/web/src/lib/palette.ts
  - apps/web/src/motion/index.ts
---

# Allegra design system

Allegra is an artwork-first music interface. It should feel like a quiet listening room made from light, glass, and album art: calm at rest, responsive when music is playing, and never generic. Every surface follows the same visual language:

- album art supplies the atmosphere;
- frosted material separates content without flattening the background;
- rounded geometry makes the interface feel touchable and continuous;
- restrained motion communicates state rather than decorating it;
- the stable action color remains legible while the ambient shader changes.

This document is the design contract for new UI and for visual refactors.

## 1. Color architecture

### Stable product colors

The stable action color is soft chartreuse, not neon lime:

- Primary action: --wave #d9e66a
- Primary action ink: --wave-ink #17180d
- Secondary warmth: --accent #ee6b5f
- Bright warmth: --accent-bright #ffaaa0
- Deep warmth: --accent-deep #783e44
- Cool support: --vibe-blue #7bafd4
- Page ink: --ink #f4f3ef
- Page base: --bg #0a0b0e

Chartreuse is used for primary buttons, selected states, progress, active controls, and focus emphasis. It is deliberately quiet enough to sit over dark artwork and bright enough to remain a clear action signal. Coral remains a supporting brand color for warmth and song-state emphasis; it is not a replacement for the primary action color.

Do not introduce a new one-off accent for a component. Add a semantic token only when the role cannot be expressed by the existing system.

### Brand mark

The Allegra mark is a transparent, rounded listening-loop symbol. The structural stroke uses coral and the crossing signal uses chartreuse so the mark stays legible on both dark shader glass and the light theme. Keep it unboxed: no square tile, background, or drop shadow. Use the same mark in the rail wordmark and favicon; it must remain recognizable at 16px.

### Artwork-aware palette

The ambient palette is separate from the stable action palette. It is extracted from the current artwork by apps/web/src/lib/palette.ts and exposed as:

- --art-primary
- --art-secondary
- --art-tertiary
- --ambient-accent

Extraction samples a small canvas, ignores transparent, near-white, near-black, and low-chroma pixels, bins colors, then vivifies the most useful hues. Monochrome artwork receives a neutral gray palette. Missing or failed artwork uses the calm blue default palette. The extracted colors may tint shaders, veils, borders, and local glows, but must not recolor core text or destroy action contrast.

## 2. Shader and ambient behavior

### Full-shell ambient

DynamicAura is the shell-level ambient layer. It is fixed behind the interface, pointer-transparent, and never owns layout or scrolling. It combines:

1. MusicFlowShader WebGL reeded-glass light columns.
2. A low-opacity flute layer using screen blending.
3. A vignette for edge depth.
4. A scrim that preserves text contrast.

The shader receives the current artwork palette, playback energy, and mood. Playing audio raises energy and uses the energy mood; paused audio settles into the chill mood. Pointer movement gently influences the field, but it must never distract from content.

Palette transitions ease toward their target instead of snapping. Energy and pointer values are smoothed independently. The shader pauses when hidden by IntersectionObserver or when the document is hidden. Adaptive quality reduces the render budget on slower devices, caps pixel ratio, and recovers when frame time improves.

The canvas is decorative and aria-hidden. It must not intercept pointer events.

### Contained shaders

MusicFlowShader may also appear as a contained layer inside a featured banner, player stage, or lyrics stage. Contained shaders inherit the same palette and reduced-motion rules, stay clipped to their rounded parent, and never become a second page background.

The taste onboarding takeover uses a contained full-viewport MusicFlowShader of its own so the first-run experience does not fall back to a flat modal background. Its field begins with the stable chartreuse/blue/coral palette and cross-fades toward the selected genre tone while the frosted selection panel remains readable above it.

AuraShader is a reusable legacy contained/full-viewport alternative. New shell work should use DynamicAura unless a contained blob wash is specifically required.

### Artwork and hero imagery

Artwork is the source of atmosphere, not a duplicated background image. Artist pages use one sharp hero image with a directional blend/mask into the page. Do not place a blurred copy of the same artist photo behind the sharp image. Use the artwork edge, a gradient, and the ambient shader to make the transition feel intentional.

## 3. Frosted material language

Every elevated surface uses a restrained glass recipe:

- translucent dark or light gradient;
- one-pixel hairline border with low contrast;
- subtle inset highlight;
- soft shadow for separation;
- backdrop blur and saturation when the surface overlays moving artwork.

Use the shared blur tokens: 8px for controls, 16px for compact glass, 24px for content panels, and 40px or more only for sheets and immersive overlays.

Material hierarchy:

| Surface | Shape | Treatment |
| --- | --- | --- |
| Site rail/header | 24px radius | Frosted gradient, 32px blur |
| Content panel | 24px radius | Frosted fill, 26px blur |
| Dialog/sheet | 28–30px radius | Dense glass, 44px blur, shadow |
| Player side panel | 22–24px radius | 34px blur, strong edge separation |
| Mini player | 20–22px radius | 30px blur, compact capsule layout |
| Lyrics stage | 24–30px radius | Quiet glass; avoid a heavy opaque card edge |
| Artwork | 16px radius by default | Keep image detail crisp |
| Small thumbnails | 8–12px radius | Do not over-round album art |

Do not stack multiple opaque cards to simulate depth. If a region needs hierarchy, use one primary glass surface plus a quieter inner well or hairline.

## 4. Geometry and curvature

Curvature is a product signature. Use the same corner family everywhere:

- Action, filter, search, and taste controls: pill shape, radius 999px.
- Panels and cards: 24px by default; 28–30px for large sheets and immersive stages.
- Compact wells and fields: 14–18px.
- Artwork: 16px unless a compact thumbnail needs 8–12px.
- Icon buttons and avatars: true circles.
- Hairlines, focus rings, and clipped shader layers follow their parent geometry.

TactileButton and raw action buttons must receive the tactile-control class so they share the pill silhouette. Do not mix sharp rectangles with pills in the same control group. Keep the curvature consistent across onboarding, player controls, auth, artist sheets, and library actions.

## 5. Component library

### Primitives

- TactileButton: primary, secondary, accent, and ghost variants. Use for every action with a text label.
- IconButton: 44px minimum touch target, circular, with an accessible label.
- Artwork: shared image treatment, fallback, radius, and loading behavior.
- FloatingField: frosted input with a rounded field well and visible focus state.
- HeartGlyph: spring-based favorite control with a restrained confirmation spark.

### Shell chrome

- Site header/rail: compact frosted navigation, active route marker, and artwork-aware accent.
- Search field: small frosted control with clear shortcut hint; it should not dominate the header.
- Mini player: persistent frosted capsule with artwork, playback controls, progress, and volume.
- Player side panel: now-playing artwork, metadata, queue, and a quiet divider system.

### Content surfaces

- Featured banner: artwork, contained shader, title, metadata, and one primary play action.
- Artist card and artist page: sharp art, readable metadata, consistent verified badge, and curved controls.
- Track row: image, title, artist, album, duration, selected/playing state, and keyboard-visible focus.
- Taste onboarding: frosted panel with pill artist choices and one primary next action.
- Keep listening and lyrics teaser: one glass panel each, with clear loading, empty, and error states.
- Library, playlist, album, and collection views: reuse the same panel, row, and artwork primitives instead of inventing new chrome.

### Overlays

- Glass sheet/AuthDialog: centered frosted sheet, rounded close control, animated entrance, and background scroll lock.
- ArtistPreviewCard: artwork-led sheet with inline verified badge, internal scrolling only, and background scroll lock.
- PlayerPanel and WordsPage: immersive surfaces that own their own scroll region and lock the document while open.
- Command palette: compact frosted dialog with keyboard navigation and focus return.

Verified status belongs beside the artist name in the metadata header, not as a detached banner. It is a small green frosted badge with an icon and short label.

## 6. Motion system

Motion is state communication. Use the shared durations, easing curves, and spring presets in apps/web/src/motion/index.ts.

- Page transitions: short opacity/transform fades.
- Sheets and dialogs: enter with a small upward movement and scale settle; exit faster and slightly smaller.
- Tabs and route changes: cross-fade and translate; do not animate layout dimensions.
- Buttons: subtle scale/opacity response on press and hover.
- Favorites: spring the heart and use a restrained spark.
- Shader: ease palette, energy, and pointer changes; never flash or jump.
- Artist hero and artwork: keep image movement slow and subordinate to the title.

Animate transform and opacity only. Avoid animating width, height, top/left, blur, or box-shadow. Every motion path must have a prefers-reduced-motion behavior: stop shader RAF loops, remove nonessential transitions, and preserve readable state changes.

## 7. Scroll, focus, and accessibility

The global scrollbar is intentionally slim (6px) with a transparent track and a rounded frosted thumb. Internal sheet and queue scrollbars use the same treatment. Use overscroll containment on internal overlays so a sheet cannot scroll the page behind it.

When an artist sheet, auth dialog, player workspace, or full-screen lyrics view is open:

- lock html and body scrolling;
- keep scrolling inside the active overlay region;
- return focus to the invoking control on close;
- keep Escape and visible close controls available.

Use 44px minimum interactive targets, semantic buttons/links, aria labels for icon-only controls, and aria-hidden decorative canvases. Preserve readable line-height for Devanagari, Tamil, and other long-script metadata. Always implement loading, empty, error, and paused states rather than leaving blank glass.

## 8. Responsive behavior

Design and verify at 360px, 768px, 1280px, and 1920px widths.

- The navigation rail becomes compact or collapses before content becomes cramped.
- The player remains reachable at the bottom without covering essential content.
- The now-playing panel becomes an overlay or lower-priority region on narrow screens.
- Artist heroes use a single-column composition below the desktop breakpoint while retaining one sharp image.
- Sheets and lyrics use an internal scroll region with safe viewport padding.
- Text truncation must preserve title identity and never clip Indic scripts.

## 9. Implementation rules

1. Update semantic tokens before adding component-specific values.
2. Keep stable action colors separate from artwork-derived shader colors.
3. Use shared primitives and the frosted material recipe for every new surface.
4. Use the established radius family; do not add sharp-corner exceptions without a documented reason.
5. Keep shaders decorative, clipped, pointer-transparent, adaptive, and reduced-motion aware.
6. Preserve keyboard focus, scroll locking, loading/empty/error states, and small-screen behavior.
7. Keep the frozen FE/BE seam in docs/api-contract.md unchanged unless the contract is intentionally revised first.
8. Validate typecheck, lint, build, and the affected browser state before calling a visual change complete.
