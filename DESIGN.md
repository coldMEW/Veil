---
name: Veil
description: Evidence-first, local photo workspace
colors:
  ground: "#f2f4f7"
  surface: "#ffffff"
  raised: "#eceff3"
  well: "#e9ecf1"
  border: "#e3e6eb"
  text: "#0a0a0a"
  muted: "#5f6670"
  accent: "#141414"
  signal: "#1d5fbf"
  positive: "#2e7d32"
  negative: "#c4242a"
typography:
  display: { fontFamily: "Geist, sans-serif", fontSize: "30px", fontWeight: 500, lineHeight: 1.1 }
  body: { fontFamily: "Geist, sans-serif", fontSize: "14px", fontWeight: 400, lineHeight: 1.5 }
rounded: { panel: "16px", card: "8px", control: "6px" }
spacing: { gap: "12px", pad: "24px", row: "44px" }
components:
  button-primary: { backgroundColor: "{colors.accent}", textColor: "{colors.surface}", rounded: "{rounded.control}", height: "36px" }
---

# Design System: Veil

## Overview

**Creative North Star: "Achromatic ledger"**

Veil is a local evidence workspace, not a dashboard or a verdict machine. Chrome is quiet and achromatic; photographs and their evidence overlays are the only visual colour.

## Colors

Use neutral surfaces for structure. `signal` is reserved for focus, selection and overlay outlines. Positive, negative and warning colours occur only in evidence pills.

**The One Hue Rule.** No decorative colour, gradients, tinted icon tiles or glass effects.

## Typography

Geist is used at 400/500/700. Geist Mono is limited to hashes, identifiers and measurements. Use sentence case and tabular numerals for figures.

## Layout

Desktop is a 44px top bar plus a 232px tools rail, canvas well and 360px evidence rail. At under 1024px the canvas is full width and evidence becomes a bottom sheet. Controls are at least 36px high; touch actions are at least 44px.

## Elevation & Depth

Surfaces are flat at rest with borders and tonal separation. Shadows are allowed only for a menu, dialog or raised bottom sheet.

## Shapes

Panels use 16px corners, cards use 8px, controls use 6px. Primary actions are near-black; secondary actions are grey.

## Components

Top bar shows file state and local-processing status. Tools are plain text rows with a grey active pill. Canvas overlays must be interactive, visible and outline selected evidence with a 2px signal border. Evidence rows show a finding pill and expand to Method, Assumptions, Limitations and Evidence. The report is an A4-proportioned white printable sheet. Buttons show hover tone, 2px signal focus and .98 press scale. Progress is a determinate 2px ink rule with cancel.

Motion uses Anime.js: 180ms `cubic-bezier(.2,.8,.2,1)` for entry and expansion, 40ms sibling stagger, opacity/transform only. Reduced motion removes spatial movement while retaining state changes.

## Do's and Don'ts

### Do:
- **Do** make observations, limits and evidence visible before actions.
- **Do** keep model and WASM downloads tool-triggered.
- **Do** provide visible keyboard focus and reduced-motion behavior.

### Don't:
- **Don't** use authenticity verdicts, overall scores, gradients, glass or decorative shadows.
- **Don't** hide an overlay or bottom sheet behind a test hook.
- **Don't** use coloured chrome outside semantic evidence states.
