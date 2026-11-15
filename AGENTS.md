# Agent execution rules — Veil

Read the externally supplied team plan (kept outside this repository) before working. Do not copy it, its sections, or any personal notes into this repository, PRs or Discussions.

## Coordination
- GitHub Discussions: **Build Coordination** (task claims/progress/handoffs) and **Decisions and Contracts** (interface changes).
- Post a START claim (what, why, paths, dependencies, acceptance tests) before editing. Post BLOCKED/FAILED/HANDOFF/FIXED updates. `FIXED` only after rerunning the failing check.
- Read new comments **and replies** at every handoff and at least every 10 minutes while active.
- One task, one owner, one branch, one small PR. No direct pushes to `main`.

## Ownership (pivot, 2026-11-14)
| Path | Owner |
|---|---|
| `src/app/`, `src/styles/`, `src/services/`, `src/platform/`, `server/`, `public/demo/` | Bibek (UI and app built with Claude) |
| `src/engine/` (face, fingerprint, watermark), `src/features/clean/`, `scripts/verify/` | Bibek (engines built with Codex) |
| `src/features/inspect/` (provenance, model, forensics/exifThumbnail, compare) | Bibek |
| `src/contracts/` | Bibek |

## Commands
`npm ci`, `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`.

## Hard rules
- No cloud image calls by default; reverse search only after the person taps it. No API keys in client code, `VITE_` variables or localStorage.
- The server fetches only public pages the person asked to scan; never send their photo or face data.
- Never persist input images, OCR text or reports automatically.
- A failed or timed-out check is never shown as a clean result. Check shows a headline only from strong evidence, and lists only checks with a strong result.
- Never claim model, browser, GPU or phone success without results from that environment.
- Private photos and fixtures stay outside Git; CI uses synthetic fixtures.
