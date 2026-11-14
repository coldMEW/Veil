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

## Component Reference

### Top bar

**Anatomy:** wordmark, current file name, status pill, local-processing statement, secondary open action and primary export action. Height is 44px desktop and 48px phone. It has no decorative divider.

**States:** idle shows the file and last completed check count; loading shows a 2px determinate progress rule and an always-visible cancel action; disabled export is muted but remains labelled; error names the failed check and recovery. Hover changes tone only. Focus is a 2px signal outline offset by 2px. Press scales the button to .98 for 90ms.

### Tools rail

**Anatomy:** a 232px white panel, grouped labels and 40px plain-text tool rows. There are no icon tiles. The selected row uses the raised neutral pill.

**States:** inactive is plain text; hover uses raised surface; active has raised background; focus has signal outline; unavailable remains readable and explains why in its adjacent evidence row. On phone, the same actions become horizontal text chips.

### Canvas well and overlays

**Anatomy:** 16px inset, square-corner photo fit inside a #e9ecf1 well. Controls sit in the corners as white controls. The overlay layer shares the exact displayed-image rectangle; it never uses document coordinates alone.

**States:** overlays are transparent at rest, use a 1px neutral stroke on hover and a 2px signal outline when selected. Keyboard focus follows the selected outline. Raster overlays use the evidence colour map and a hatched mask outside the analysed rect. Clicks select the matching evidence row; selecting a row selects its overlay.

### Evidence row and details

**Anatomy:** 44px minimum row with 14px/500 title, semantic pill, one-line observation and chevron. Expanded content uses four named sections: Method, Assumptions, Limitations and Evidence. Evidence values use Geist Mono/tabular numerals on 32px pitch.

**States:** neutral pills are used for inconclusive and not-applicable; green only means compatible with that check; red only means a reported inconsistency. Expansion is 180ms with the standard ease. Reduced motion opens instantly. Hover is tonal only; focus is signal outlined.

### Evidence sheet

**Anatomy:** under 1024px the desktop rail is replaced by a fixed bottom sheet. It shows a 35vh peek containing the finding count and rows, a visible drag handle, and scrollable details.

**States:** pointer drag snaps to peek, half and 90vh/full. Scroll locks while the handle has pointer capture. The sheet has a soft menu-only shadow and never causes horizontal page overflow. Keyboard users receive the same rows in document order.

### Buttons and inputs

**Anatomy:** 36px control height on desktop; touch targets expand to 44px. Primary is near-black on white, secondary is #e5e5e5, and destructive controls use semantic red only when destructive.

**States:** hover changes tone in 120ms; pressed scales .98 in 90ms; focus is signal; disabled is lower contrast with an explanatory label; loading preserves button dimensions and supplies status text; error is adjacent plain language, never colour alone.

### Progress

Long OCR, inpainting and model work uses a determinate two-pixel ink rule in the top bar. A spinner may supplement but never replace progress and cancel. Progress is announced with a live status region.

### Report sheet

**Anatomy:** white A4 proportion (794 × 1123 CSS px before responsive scale), title/file facts, SHA-256 in Geist Mono, each check's finding/reason/limitations, transforms and verification. It is centred on ground with no coloured decoration except finding pills.

**States:** screen view scales to fit; print view removes workspace chrome, keeps the full sheet, has black text and preserves evidence headings. Missing data is explicitly marked unavailable.

## Spacing and type scale

| Token | Value | Use |
|---|---:|---|
| `space-1` | 4px | icon/text correction |
| `space-2` | 8px | compact pairs |
| `gap` | 12px | default related controls |
| `space-4` | 16px | canvas inset / section start |
| `pad` | 24px | panel interior |
| `space-8` | 32px | major separation |
| `figure` | 30px | empty workspace instruction |
| `title` | 24px | report and panel title |
| `section` | 16px | panel heading |
| `body` | 14px | default reading text |
| `small` | 12px | metadata and pills |

## Motion reference

| Interaction | Duration | Ease | Reduced motion |
|---|---:|---|---|
| panel/row entrance | 180ms | cubic-bezier(.2,.8,.2,1) | opacity only |
| sibling entrance | 40ms stagger | standard | no stagger |
| evidence expansion | 180ms | standard | immediate |
| overlay toggle | 150ms | standard | immediate |
| button press | 90ms | ease-out | tone only |
| sheet snap | spring | stiff/damped | immediate snap |
| progress | 120ms updates | linear | unchanged |

## Accessibility requirements

- Every operation is a native button or labelled form control; no clickable divs.
- Focus order follows tool rail, canvas controls and evidence rail; no positive tabindex.
- Focus contrast meets 3:1 and body text meets 4.5:1.
- Pills duplicate their colour with textual finding labels.
- Drag interactions have a click/keyboard equivalent and use pointer capture with cancel handling.
- `prefers-reduced-motion` removes distance and spring movement but does not hide content or state.
- Canvas overlays expose an accessible label naming the associated check and selected state.
