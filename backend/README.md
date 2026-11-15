# Local Python service

Python 3.11. Install `backend/requirements.txt` in a virtual environment outside the repository,
then run `python -m backend` from the repository root. It binds **127.0.0.1:8787**, serves the
existing `dist/` build, and starts one in-process ticket scheduler (15-minute interval).
Set `VEIL_DB` to select a SQLite file outside git; the default is the local user's Veil data folder.
Run tests with `python -m pytest backend/tests -q`.

The page/image/status/host APIs have the TypeScript endpoint shapes. Hunt accepts a raw
JPEG/PNG/WebP body (8 MiB maximum), sends only an explicitly submitted search image to the
selected providers, resizes to 1024, and never persists image bytes. Requests to public pages
have DNS-pinned connections, revalidated redirects, no environment proxy, and bounded reads.
Provider uploads require HTTPS/443 on the original provider hostname at every redirect.
An HTTP 200 generic Bing landing page is a parse error, not a successful match.

`GET /api/tickets` returns an array; optional `ids=a,b` filters it. Mutations return the complete
record, including `status` and `events: [{at,type,detail}]`. `createdAt`/`at` accept ISO timestamps
or epoch milliseconds. Extra properties (including images, face data or thumbnails) are rejected.
The browser's existing localStorage tickets are not automatically migrated or synchronized:
the frontend must call these endpoints explicitly, sending the documented metadata fields only.

## Optional services

- `SERPAPI_KEY` enables Lens; its `imageUrl` must already be a public HTTPS image URL. Veil does
  not silently upload a local image to a hosting service for Lens.
- `SMTP_HOST`, `SMTP_FROM`, optional `SMTP_PORT` (587 default), `SMTP_USER`/`SMTP_PASS` enable
  actual SMTP sending. Port465 uses TLS immediately; other ports require STARTTLS. No success
  event is written unless the SMTP server accepts all recipients. Server acceptance does not
  establish inbox delivery; partial refusal returns an error and may require manual reconciliation.
- `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS`, optional `IMAP_PORT`/`IMAP_FOLDER` enable real read-only
  polling on scheduler ticks. The last100 messages are considered and account/folder/UID keys
  prevent repeated ingestion. Only known recipient senders with `[Veil:TICKET_ID]` in the subject
  are recorded. A From address is not cryptographic authentication: an IMAP removal claim is
  recorded in evidence but does not automatically close a ticket. Recheck confirms availability.

SMTP/IMAP defaults are off. No credentials are sent to the browser. An unconfigured send returns
503, not a simulated send. Manual `/sent` and `/reply` endpoints record the user's declarations;
they are not evidence of actual SMTP or IMAP execution.

## Limits and deployment

The local service has no multi-user authentication. Keep the loopback binding. Host validation
and same-origin write checks reduce browser cross-site attacks but do not replace authentication.
If using an authenticated reverse proxy, explicitly set `VEIL_ALLOWED_HOSTS` for its hostnames.
Do not expose an unauthenticated service to a LAN or public network. No wildcard CORS is enabled.

RDAP registrable-domain selection follows the existing two/three-label heuristic, not a complete
public-suffix list. Hosting/registrar data may be absent. Provider DOM/protocols can change, return
CAPTCHA, or rate-limit. No result establishes identity or an exact copy without further checks.

Recheck treats only404/410/451 or a200 HTML page whose exposed image list no longer contains the
image as removal. Challenges, login pages, pages without image listings, errors, DNS failures and
timeouts become unknown events. All lazy/srcset candidates are checked without the scan80-image
cap. JavaScript-only/conditional content and unexpected page templates remain an inherent limit;
server-side HTML absence does not prove worldwide removal. Reply classification is a conservative
rule table, not a language model or legal determination. Scheduler timing requires the process to
remain running; use one worker, and do not launch multiple schedulers against the same database.
