---
name: Veil
description: Warm everyday app for checking, cleaning and protecting a photo on the device
colors:
  ground: "#f5f1eb"
  card: "#ffffff"
  tonal: "#efe9e1"
  well: "#1f2340"
  line: "#e8e1d6"
  ink: "#1f1c17"
  muted: "#5e574c"
  faint: "#6f685c"
  action: "#2b44d6"
  action-soft: "#e7eafc"
  tool-inspect: "#2b44d6"
  tool-clean: "#0b8a77"
  tool-protect: "#7a3fe0"
  clear: { bg: "#e2f1e5", ink: "#1d5a31" }
  notice: { bg: "#fcefd2", ink: "#7a4705" }
  alert: { bg: "#fde5e0", ink: "#9a2516" }
  idle: { bg: "#efe9e1", ink: "#5e574c" }
typography:
  family: "Figtree Variable (self-hosted), system-ui fallback"
  display: { size: "2.25rem phone / 3.25rem desktop", weight: 700, tracking: "-0.03em", lineHeight: 1.05 }
  title: { size: "1.25rem", weight: 600, tracking: "-0.015em" }
  body: { size: "0.9375rem", weight: 400, lineHeight: 1.55 }
  label: { size: "0.75rem", weight: 600 }
  mono: "system monospace, hashes only"
rounded: { card: "16px", control: "12px", sheet: "24px", dock: "24px", nav-button: "18px", pill: "999px" }
spacing: { gutter-phone: "12-16px", gutter-desktop: "12px between regions", card-padding: "16-20px" }
motion: { library: "Anime.js 4", ease: "outExpo", expand: "260ms", collapse: "200ms", sheet-snap: "320ms", entrance: "520ms, 70ms stagger" }
---

# Veil design system

## Idea

Veil is a friendly tool for everyday people who are about to share a photo. It looks like a warm consumer app, not a forensic console. Each card holds one idea. Labels are plain sentences. The bright colours sit only on things you can press or on the tool you are in. Results are evidence with their method and limits, never a verdict.

## Colour

- **Ground** is a warm tint (`#f5f1eb`). **Cards** are white with one soft shadow (`--shadow-card`). Elevation is declared once: shadow or border, never both.
- **Photo well** is deep ink-blue (`#1f2340`) so photos read true and overlays stay visible.
- **Action** (`#2b44d6`) appears only on pressable things: primary buttons, the active tab, focus rings, overlay outlines.
- **Tool colours**: Inspect blue, Clean teal, Protect violet. They fill the active nav button, the sheet's title dot and the empty-screen feature icons.
- **Finding pills** use tinted backgrounds with dark ink: clear green, notice amber, alert red, idle neutral. "Checking" shows a pulsing dot. A finished check that found nothing says "Nothing found"; a failed check says "Didn't finish". Nothing that did not run may look like a result.

## Type

Figtree throughout, self-hosted. Sizes are rem so text follows the Android and browser font-size setting. Sentence case. Tabular numerals for sizes and measurements. Monospace only for hashes.

## Layout

- **Desktop (≥1024px)**: a 64px top bar (logo, file name, "On this device", Report, Open another), an 88px tools rail of glass buttons, the photo well (rounded 16px), and a 400px results column.
- **Phone**: a 56px top app bar (close, file name, report), the photo well, a bottom sheet (peek about 176px, half, full; drag with velocity snap; tap or arrow keys on the handle), and a floating glass dock with Inspect, Clean and Protect. Edge-to-edge with `env(safe-area-inset-*)`. Touch targets are at least 48px.
- **Empty screen**: headline, one sentence, a dashed drop card with one primary button, three tool lines with tinted icons, and the 3D hero (desktop: right column; phone: on top).

## Components

- **EvidenceRow**: number badge, title, finding pill, one-line headline, chevron. It expands in place (Anime.js height and opacity) to show Method, Assumptions, Limitations, measured numbers, and where it is outlined on the photo. An optional eye button toggles the check's map.
- **OverlayLayer**: one outlined, numbered, focusable button per check, covering the area that check looked at (whole file, classifier crop, marked face, marked points). Selecting an outline opens its row and selecting a row highlights its outline; the others dim to 35%.
- **EvidenceSheet**: phone results surface with its tool colour dot. The same panel content renders in the desktop column.
- **ReportSheet**: a modal A4 paper over a dimmed ink-blue backdrop. Escape and Close dismiss it, focus returns to where it was, and Print or save PDF is offered. Printing shows only the paper.
- **Buttons**: `.btn-primary` (filled action), `.btn-tonal` (secondary), `.btn-text`, `.icon-btn` (48px). Press scale 0.97, 160ms.
- **Glass**: `.glass-dock` (translucent white, 22px blur, inner highlight) and `.glass-btn` (raised white glass; the active one fills with its tool colour, with an inner highlight and a coloured shadow). Glass is used for navigation only.
- **HeroStage**: public-domain photos floating in perspective on an action-blue field with three soft colour lights. Each photo carries a Veil mark that is true of it (both faces are StyleGAN images). Gentle Anime.js float, pointer parallax on fine pointers, static under reduced motion. Credits are in `public/hero/credits.json` and shown in the corner.

## Motion

One entrance on the empty screen (rise and fade, 520ms outExpo, 70ms stagger). The row expands, the sheet snaps, and outlines pulse on selection. Reduced motion removes movement and keeps every state change. Content is visible by default; motion never gates it.

## Do and don't

- Do: say what each check can't tell you; keep one obvious next step; use a tool's colour for the tool you are in.
- Don't: show a single real or fake verdict; blur or pixelate people; use the action colour on something that can't be pressed; put glass on content cards; say "AI detector".
