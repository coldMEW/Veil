import { formatBytes, formatSeconds, formatTimestamp, inspectVideoContainer } from './lib/videoFacts.js';
import { ANALYSIS_ENGINE, analyzeVideoFile } from './lib/videoAnalysis.js';
import { combineFindings } from './lib/reviewFindings.js';

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const app = document.querySelector('#app');

function showStartupError(error) {
  const message = error instanceof Error ? error.message : String(error || 'An unknown startup error occurred.');
  app.innerHTML = `
    <section class="startup-fallback startup-error" role="alert">
      <p class="eyebrow">VEIL COULD NOT START</p>
      <h1>The local evidence workspace needs attention.</h1>
      <p>Run <code>npm run dev</code> from the project folder and open <code>http://localhost:5173</code>. If the problem persists, include this browser message when reporting it:</p>
      <pre>${String(message).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>
    </section>`;
}

window.addEventListener('error', (event) => {
  if (event.error) showStartupError(event.error);
});

function newCaseId() {
  return globalThis.crypto?.randomUUID?.() ?? `veil-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function initialState() {
  return {
    caseId: newCaseId(),
    createdAt: new Date().toISOString(),
    status: 'empty',
    file: null,
    bytes: null,
    sha256: null,
    assetUrl: null,
    facts: null,
    media: { duration: null, width: null, height: null },
    playbackTime: 0,
    observations: [],
    custody: [],
    workflow: 'insurance',
    sourceUrl: '',
    vault: { status: 'idle', receipt: null, verification: null, error: null, syncError: null },
    analysis: { status: 'idle', result: null, error: null, progress: null, persisted: false, syncPromise: null },
    cloud: { config: null, running: false, error: null, result: null },
    error: null,
  };
}

let state = initialState();
let scanGeneration = 0;

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString();
}

function addCustodyEvent(type, detail) {
  state.custody.push({ id: newCaseId(), at: new Date().toISOString(), type, detail });
}

function shortHash(hash) {
  return hash ? `${hash.slice(0, 12)}…${hash.slice(-8)}` : 'Calculating…';
}

function receiptPayload() {
  return state.vault.receipt?.payload ?? null;
}

function inspection() {
  return receiptPayload()?.originalAsset?.inspection ?? state.facts;
}

function known(value, fallback = 'Not recorded') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function formatBitrate(value) {
  if (!Number.isFinite(value) || value <= 0) return 'Not available';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mb/s`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} kb/s`;
  return `${Math.round(value)} b/s`;
}

function yesNoUnknown(value, yes = 'Yes', no = 'No') {
  return value === null || value === undefined ? 'Not determinable' : value ? yes : no;
}

function hashStatus() {
  if (!state.sha256) return { label: 'Hash pending', tone: 'pending', detail: 'The original file is being fingerprinted.' };
  const serverHash = receiptPayload()?.originalAsset?.serverSha256;
  if (state.vault.status === 'sealing') return { label: 'Sealing local receipt', tone: 'review', detail: 'The local evidence vault is independently hashing and storing the original bytes.' };
  if (state.vault.status === 'error') return { label: 'Vault receipt unavailable', tone: 'danger', detail: state.vault.error || 'The browser hash completed, but the local vault did not seal this case.' };
  if (serverHash && serverHash !== state.sha256) return { label: 'Hash mismatch requires review', tone: 'danger', detail: 'The browser and local vault calculated different hashes for what should be the same original file.' };
  if (serverHash) return { label: 'Browser and vault hashes match', tone: 'verified', detail: 'Two independent SHA-256 calculations identify the same original video bytes.' };
  return { label: 'Original bytes hashed', tone: 'verified', detail: 'SHA-256 identifies the exact video received by this browser.' };
}

function provenanceStatus() {
  const facts = inspection();
  if (!facts) return { label: 'Container not read', tone: 'pending', detail: 'Waiting for a readable original file.' };
  if (facts.c2paManifestCandidate) {
    return {
      label: 'Credential container found',
      tone: 'review',
      detail: 'A C2PA container marker was found. This MVP records the signal but does not validate the signature or trust chain.',
    };
  }
  return {
    label: 'No credential container found',
    tone: 'unknown',
    detail: 'Absence of a credential does not establish that a video is real or AI-generated.',
  };
}

function vaultStatus() {
  const receipt = receiptPayload();
  if (state.vault.status === 'sealing') return { label: 'Preserving original', tone: 'review', detail: 'Creating a locally signed evidence receipt and storing the original bytes once.' };
  if (state.vault.status === 'error') return { label: 'Local vault unavailable', tone: 'danger', detail: state.vault.error || 'Original remains open in the browser but was not sealed by the local vault.' };
  if (state.vault.syncError) return { label: 'Review sync requires attention', tone: 'danger', detail: state.vault.syncError };
  if (receipt) return { label: 'Locally signed receipt', tone: 'verified', detail: `Stored at ${formatDate(receipt.case?.receivedAt)} with an Ed25519 receipt signature.` };
  return { label: 'No vault receipt', tone: 'unknown', detail: 'The original is currently held only in the browser session.' };
}

function typeIcon(type) {
  const icons = {
    custody: '⌁',
    provenance: '◈',
    visual: '◌',
    audio: '∿',
    context: '↗',
  };
  return icons[type] ?? '•';
}

function frameHeader() {
  return `
    <header class="topbar">
      <a class="brand" href="#top" aria-label="Veil Evidence Passport home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>veil<span class="brand-muted">/evidence</span></span>
      </a>
      <div class="topbar-status"><span class="pulse"></span> Local evidence vault</div>
    </header>`;
}

function emptyScreen() {
  return `
    <section class="hero" id="top">
      <div class="eyebrow">VIDEO EVIDENCE PASSPORT / 0.5</div>
      <h1>Preserve the record.<br /><em>Separate fact from suspicion.</em></h1>
      <p class="hero-copy">Veil helps claims teams and people document what is known about a video—its exact bytes, provenance signals, technical facts, and timestamped review notes—without claiming to decide whether a video is true.</p>
      <div class="principles" aria-label="Core principles">
        <span><b>01</b> Original bytes first</span>
        <span><b>02</b> Claims stay traceable</span>
        <span><b>03</b> Uncertainty stays visible</span>
      </div>
      ${uploadPanel()}
      <p class="privacy-note">The original is sent only to Veil’s local evidence vault running on this computer. It receives an independent hash and a locally signed receipt; this is not yet an external custody service.</p>
    </section>
    ${footer()}`;
}

function uploadPanel() {
  const busy = state.status === 'processing';
  return `
    <section class="upload-card ${busy ? 'is-busy' : ''}" data-dropzone tabindex="0" aria-label="Choose an MP4 or MOV video">
      <input id="video-file" data-video-input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" ${busy ? 'disabled' : ''} />
      <div class="upload-glyph" aria-hidden="true">↥</div>
      <div>
        <strong>${busy ? 'Preserving original bytes…' : 'Open original video'}</strong>
        <span>${busy ? 'Reading container facts and computing SHA-256.' : 'MP4 or MOV · up to 500 MiB · drag and drop works too'}</span>
      </div>
      <label class="button primary" for="video-file">${busy ? 'Processing' : 'Choose video'}</label>
    </section>
    ${state.error ? `<div class="notice danger" role="alert"><strong>Could not open this file.</strong> ${escapeHtml(state.error)}</div>` : ''}`;
}

function fact(label, value, extra = '') {
  return `<div class="fact"><dt>${escapeHtml(label)}</dt><dd>${value}${extra}</dd></div>`;
}

function statusCard(index, status, detail) {
  return `
    <article class="verification-card ${status.tone}">
      <div class="verification-number">0${index}</div>
      <div><h3>${escapeHtml(status.label)}</h3><p>${escapeHtml(detail ?? status.detail)}</p></div>
    </article>`;
}

function trackRows(tracks) {
  if (!tracks?.length) {
    return `<tr><td colspan="5" class="table-empty">No readable media tracks were declared in the container.</td></tr>`;
  }
  return tracks
    .map((track, index) => {
      const dimensions = track.dimensions ? `${track.dimensions.width} × ${track.dimensions.height}` : 'Not declared';
      const audio = track.audio ? `${known(track.audio.channels, '?')} ch · ${track.audio.sampleRate ? `${track.audio.sampleRate.toLocaleString()} Hz` : 'rate not declared'}` : '—';
      return `<tr>
        <td><span class="track-number">${String(index + 1).padStart(2, '0')}</span> ${escapeHtml(known(track.kind, 'unknown'))}</td>
        <td><code>${escapeHtml(known(track.codec, 'not declared'))}</code></td>
        <td>${escapeHtml(dimensions)}</td>
        <td>${escapeHtml(audio)}</td>
        <td>${escapeHtml(formatSeconds(track.durationSeconds))}</td>
      </tr>`;
    })
    .join('');
}

function technicalDetails(facts) {
  const structure = facts?.structure ?? {};
  const c2pa = facts?.c2paManifestCandidateCount ? `${facts.c2paManifestCandidateCount} candidate marker${facts.c2paManifestCandidateCount === 1 ? '' : 's'}` : 'No candidate marker';
  return `
    <section class="technical-section">
      <div class="section-heading"><div><span class="eyebrow">CONTAINER ANALYSIS</span><h2>Original-file details</h2></div><p>Read directly from the stored MP4/MOV container. Missing properties remain explicit.</p></div>
      <div class="technical-summary">
        <div><span>Container</span><strong>${escapeHtml(known(facts?.container, 'Unreadable'))}</strong></div>
        <div><span>Tracks</span><strong>${escapeHtml(known(facts?.trackCount, '0'))}</strong></div>
        <div><span>Average data rate</span><strong>${escapeHtml(formatBitrate(structure.averageBitrate))}</strong></div>
        <div><span>Layout</span><strong>${escapeHtml(yesNoUnknown(structure.fastStart, 'Fast-start optimized', 'Media precedes index'))}</strong></div>
      </div>
      <div class="technical-columns">
        <dl class="technical-list">
          ${fact('Original byte length', escapeHtml(formatBytes(receiptPayload()?.originalAsset?.byteLength ?? state.file?.size ?? 0)))}
          ${fact('Container duration', escapeHtml(formatSeconds(facts?.durationFromContainer)))}
          ${fact('Movie header', escapeHtml(yesNoUnknown(structure.movieHeaderPresent, 'Present', 'Not found')))}
          ${fact('Fragmented video', escapeHtml(yesNoUnknown(structure.fragmented)))}
          ${fact('Media payload', escapeHtml(formatBytes(structure.mediaDataBytes ?? 0)))}
          ${fact('Metadata boxes', escapeHtml(structure.metadataBoxes?.length ? structure.metadataBoxes.join(' · ') : 'None found'))}
          ${fact('C2PA scan', escapeHtml(c2pa))}
        </dl>
        <div class="box-map"><span>TOP-LEVEL BOX MAP</span><div>${(facts?.topLevelBoxes?.length ? facts.topLevelBoxes : ['No readable boxes']).map((box) => `<code>${escapeHtml(box)}</code>`).join('')}</div><p>The box map is a container structure record, not proof of content authenticity.</p></div>
      </div>
      <div class="track-table-wrap">
        <table class="track-table">
          <thead><tr><th>Track</th><th>Codec</th><th>Dimensions</th><th>Audio details</th><th>Duration</th></tr></thead>
          <tbody>${trackRows(facts?.tracks)}</tbody>
        </table>
      </div>
    </section>`;
}

function analysisStatus() {
  if (state.analysis.status === 'running') {
    return { label: 'Checking your video', tone: 'unknown', detail: 'Looking through sampled moments.' };
  }
  if (state.analysis.status === 'failed') return { label: 'Scan did not complete', tone: 'danger', detail: state.analysis.error || 'The browser could not complete the scan.' };
  if (state.analysis.status === 'complete') {
    const groups = findingsForReview();
    if (groups.length) {
      return { label: `${groups.length} ${groups.length === 1 ? 'moment' : 'moments'} to review`, tone: 'review', detail: 'Choose a timestamp below to jump to that point in the video.' };
    }
    if (state.analysis.result.syntheticMedia.status !== 'complete' || state.cloud.result?.checks.some(({ status }) => status !== 'complete')) {
      return { label: 'Some checks couldn’t finish', tone: 'unknown', detail: 'The checks that finished found no moments to flag. See check details for coverage.' };
    }
    return { label: 'We couldn’t determine how this video was made', tone: 'unknown', detail: 'The checks that ran found no moments to flag.' };
  }
  return { label: 'Ready to check your video', tone: 'unknown', detail: 'Veil will check samples from across the clip.' };
}

function findingsForReview() {
  const local = state.analysis.result?.syntheticMedia.signals ?? [];
  const cloud = state.cloud.result?.checks.flatMap(({ findings }) => findings) ?? [];
  return combineFindings(local, cloud);
}

function cloudSection() {
  const { config, error, running, result } = state.cloud;
  if (!config?.providers.length) return '<p class="source-check">Cloud checks are unavailable on this setup.</p>';
  const tooLarge = state.file.size > config.maxBytes || (state.facts?.durationFromContainer ?? state.media.duration) > config.maxSeconds;
  const ready = state.analysis.status === 'complete' && !tooLarge && !running && !result;
  const recipients = config.providers.map(({ name, input }) => `${name} (${input})`).join(', ');
  const message = tooLarge ? 'Cloud checks support MP4 or MOV clips up to 14 MB and 90 seconds.'
    : `Starting cloud checks sends media to ${recipients}. Each provider applies its own data policy.`;
  return `<div class="source-check no-print">
    <p>${escapeHtml(message)}</p>
    ${result ? '<p>Cloud review finished. See Check details for which providers completed.</p>' : `<button class="button quiet" data-action="cloud-review" ${ready ? '' : 'disabled'}>${running ? 'Checking with cloud providers…' : 'Send media for cloud checks'}</button>`}
    ${error ? `<p role="alert">${escapeHtml(error)}</p>` : ''}
  </div>`;
}

function findingCards() {
  return findingsForReview().map(({ timeStart, label, findings }) => `
    <article class="scan-lead review review-passage">
      <button type="button" class="button quiet" data-action="seek" data-time="${timeStart}">Review ${escapeHtml(label)}</button>
      <ul>${findings.map(({ title, observation }) => `<li><strong>${escapeHtml(title)}</strong><p>${escapeHtml(observation)}</p></li>`).join('')}</ul>
    </article>`).join('');
}

function scanSection() {
  const scan = state.analysis;
  const result = scan.result;
  const visual = result?.syntheticMedia;
  const status = analysisStatus();
  return `
    <section class="scan-section">
      <div class="section-heading"><h2>Video review</h2></div>
        <div class="scan-lead ${status.tone}">
          <div><h3>${escapeHtml(status.label)}</h3><p data-scan-progress>${escapeHtml(status.detail)}</p>
          </div>
          <button class="button primary no-print" data-action="run-scan" ${scan.status === 'running' ? 'disabled' : ''}>${scan.status === 'complete' ? 'Check again' : scan.status === 'running' ? 'Checking video…' : 'Check video'}</button>
        </div>
      ${cloudSection()}
      ${findingCards()}
      ${result ? `<details class="unavailable-details"><summary>Check details</summary><ul>
        ${visual.detectors.map(({ engine, metrics, reason }) => `<li><b>${escapeHtml(engine.id)}</b> · ${metrics ? `${metrics.sampledFrames} of ${metrics.requestedFrames} frames checked, ${metrics.flaggedFrames} flagged` : 'Could not check frames'}${reason ? `. ${escapeHtml(reason)}` : ''}</li>`).join('')}
        <li>${result.temporal.metrics.sampledFrames} frames checked for sudden picture changes.</li>
        <li>Sound changes ${result.audio.status === 'complete' ? 'checked' : 'could not be checked'}.</li>
        ${(state.cloud.result?.checks ?? []).map(({ name, status, coverage, reason }) => `<li>${escapeHtml(name)} · ${status === 'complete' ? 'Finished' : status === 'partial' ? 'Partially finished' : 'Could not finish'}${Number.isFinite(coverage) ? ` · ${coverage} samples checked` : ''}${reason ? ` · ${escapeHtml(reason)}` : ''}</li>`).join('')}
        <li><a href="https://deepmind.google/models/synthid/" target="_blank" rel="noopener noreferrer">Google’s official SynthID video check</a> is available separately. Veil’s Gemini review examines the content of the clip.</li>
      </ul></details>` : ''}
    </section>`;
}

function evidenceScreen() {
  const hash = hashStatus();
  const provenance = provenanceStatus();
  const vault = vaultStatus();
  const facts = inspection();
  const receipt = receiptPayload();
  const structure = facts?.structure ?? {};
  const mediaFacts = [
    fact('Vault status', escapeHtml(vault.label)),
    fact('Evidence hash', escapeHtml(shortHash(receipt?.originalAsset?.serverSha256 ?? state.sha256))),
    fact('Format', escapeHtml(known(facts?.container, 'Unreadable'))),
    fact('Brand', escapeHtml(known(facts?.majorBrand, 'Not declared'))),
    fact('File size', escapeHtml(formatBytes(receipt?.originalAsset?.byteLength ?? state.file?.size ?? 0))),
    fact('Video', state.media.width && state.media.height ? `${state.media.width} × ${state.media.height}` : 'Browser did not decode dimensions'),
    fact('Tracks', escapeHtml(known(facts?.trackCount, '0'))),
    fact('Data rate', escapeHtml(formatBitrate(structure.averageBitrate))),
    fact('Received', escapeHtml(formatDate(receipt?.case?.receivedAt ?? state.createdAt))),
  ].join('');
  const brands = facts?.compatibleBrands?.length ? facts.compatibleBrands.join(' · ') : 'Not declared';

  return `
    <div id="top">
      ${frameHeader()}
      <section class="case-head">
        <div>
          <div class="eyebrow">EVIDENCE CASE</div>
          <h1>${escapeHtml(state.file?.name || 'Untitled video')}</h1>
          <p class="case-id">Case ${escapeHtml(state.caseId)}</p>
        </div>
        <div class="case-actions no-print">
          <button class="button quiet" data-action="reset">New case</button>
          <button class="button primary" data-action="export-report">Export evidence</button>
        </div>
      </section>

      <section class="case-layout">
        <div class="main-column">
          <article class="video-stage">
            <video data-evidence-video controls preload="metadata" src="${escapeHtml(state.assetUrl)}"></video>
            <div class="video-caption"><span>Original local file</span><span data-current-time>00:00.0</span></div>
          </article>

          ${scanSection()}
          <section class="analysis-section">
            <div class="section-heading"><h2>Review timeline</h2></div>
            ${state.observations.length ? observationsList(timelineItems().filter(({ source }) => source === 'reviewer')) : '<p>Add a note to the timeline while reviewing the video.</p>'}
            ${observationForm()}
            ${timelineItems().some(({ source, check }) => source === 'automated' && check !== 'synthetic_media_model')
              ? `<details class="unavailable-details"><summary>Picture and sound changes</summary>${observationsList(timelineItems().filter(({ source, check }) => source === 'automated' && check !== 'synthetic_media_model'))}</details>` : ''}
          </section>
          <details class="unavailable-details">
            <summary>File history and verification</summary>
          <section class="verification-section">
            <div class="section-heading"><div><span class="eyebrow">VERIFICATION POSTURE</span><h2>What this case can support</h2></div><p>Evidence facts are kept separate from model or reviewer observations.</p></div>
            <div class="verification-grid">
              ${statusCard(1, hash)}
              ${statusCard(2, vault)}
              ${statusCard(3, provenance)}
              ${statusCard(4, { label: state.vault.verification?.valid ? 'Receipt signature verified' : receipt?.signature?.algorithm ? `${receipt.signature.algorithm} receipt signature` : 'Receipt signature pending', tone: state.vault.verification?.valid ? 'verified' : receipt?.signature?.algorithm ? 'review' : 'review', detail: receipt?.signature?.publicKeyFingerprintSha256 ? `Public-key fingerprint: ${shortHash(receipt.signature.publicKeyFingerprintSha256)}` : 'The receipt signature will appear after the vault seals the original.' })}
            </div>
          </section>
          ${technicalDetails(facts)}
          </details>
        </div>

        <aside class="sidebar">
          <details class="passport-card">
            <summary>File and evidence details</summary>
            <dl class="facts">${mediaFacts}</dl>
            <div class="brand-block"><span>Compatible brands</span><p>${escapeHtml(brands)}</p></div>
          </details>
          <section class="workflow-card no-print">
            <span class="eyebrow">REPORT ROUTE</span>
            <label for="workflow">Case type</label>
            <select id="workflow" data-workflow>
              <option value="insurance" ${state.workflow === 'insurance' ? 'selected' : ''}>Insurance evidence review</option>
              <option value="personal" ${state.workflow === 'personal' ? 'selected' : ''}>Personal deepfake incident</option>
            </select>
            <label for="source-url">Source link <span>(optional)</span></label>
            <input id="source-url" data-source-url type="url" placeholder="https://…" value="${escapeHtml(state.sourceUrl)}" />
            <p>${state.workflow === 'personal' ? 'The export contains a consented incident package that another reporting tool can consume.' : 'The export separates integrity facts, review notes, and unresolved questions for an adjuster.'}</p>
          </section>
        </aside>
      </section>

      ${reportPreview()}
      ${footer()}
    </div>`;
}

function observationForm() {
  return `
    <form class="observation-form no-print" data-observation-form>
      <div class="time-lock"><span>Marking</span><output data-form-time>00:00.0</output></div>
      <label><span>Evidence category</span>
        <select name="category">
          <option value="visual">Visual consistency</option>
          <option value="audio">Audio / lip sync</option>
          <option value="provenance">Provenance / metadata</option>
          <option value="custody">Chain of custody</option>
          <option value="context">Claim context</option>
        </select>
      </label>
      <label class="observation-text"><span>Observation</span><input name="observation" required maxlength="500" placeholder="Describe what needs review—not a conclusion." /></label>
      <button class="button primary" type="submit">Add to timeline</button>
    </form>`;
}

function timelineItems() {
  const plainNotes = {
    temporal_edit: 'The picture changes suddenly. Check whether this is a normal cut.',
    lighting_transition: 'The picture gets noticeably brighter or darker. Check for a change in lighting or camera exposure.',
    repeated_frame_pattern: 'The picture briefly stops changing. Check for a pause, a freeze, or an edit.',
    audio_transition: 'The sound changes suddenly. Listen just before and after this timestamp.',
    face_track_discontinuity: 'The face moves suddenly or drops out of view. Check for camera movement or something blocking it.',
  };
  const automated = (state.analysis.result?.signals ?? []).map((entry) => ({
    ...entry,
    time: Number.isFinite(Number(entry.timeStart)) ? Number(entry.timeStart) : 0,
    category: entry.check,
    text: plainNotes[entry.check] ?? entry.observation,
    createdAt: entry.timeStart,
    source: 'automated',
  }));
  const reviewer = state.observations.map((entry) => ({ ...entry, time: Number.isFinite(Number(entry.time)) ? Number(entry.time) : 0, source: 'reviewer', title: 'Reviewer observation', thumbnail: null }));
  return [...automated, ...reviewer].sort((a, b) => a.time - b.time);
}

function observationsList(items) {
  if (!items.length) {
    return `<div class="empty-observations"><p>No flagged moments or notes to show. You can add a note at any point in the video.</p></div>`;
  }
  return `<ol class="observations">${items
    .map(
      (item, index) => `
        <li class="${item.source === 'automated' ? 'automated-observation' : ''}">
          <div class="timeline-marker"><span>${typeIcon(item.category)}</span></div>
          <button class="observation-time" type="button" data-action="seek" data-time="${escapeHtml(item.time.toFixed(3))}" aria-label="Jump to ${escapeHtml(formatTimestamp(item.time))}">${escapeHtml(formatTimestamp(item.time))}</button>
          <div class="observation-body">${item.thumbnail ? `<img class="timeline-thumbnail" src="${escapeHtml(item.thumbnail)}" alt="Sampled frame at ${escapeHtml(formatTimestamp(item.time))}" />` : ''}<span class="tag">${item.source === 'reviewer' ? 'Your note' : item.check === 'synthetic_media_model' ? 'AI detector' : 'Picture or sound change'}</span><h3>${escapeHtml(item.title || 'Reviewer note')}</h3><p>${escapeHtml(item.text)}</p></div>
          ${item.source === 'automated' ? '<span class="observation-sealed">signal</span>' : receiptPayload() ? '<span class="observation-sealed" title="This observation is retained in the local evidence record">sealed</span>' : `<button class="icon-button no-print" data-action="remove-observation" data-id="${escapeHtml(item.id)}" aria-label="Remove observation ${index + 1}">×</button>`}
        </li>`,
    )
    .join('')}</ol>`;
}

function reportPreview() {
  const reportTitle = state.workflow === 'personal' ? 'Personal deepfake incident package' : 'Insurance video evidence package';
  const receipt = receiptPayload();
  const review = analysisStatus();
  return `
    <section class="report-preview print-only-content">
      <div class="report-heading"><div><span class="eyebrow">EXPORT PREVIEW</span><h2>${reportTitle}</h2></div><div class="report-signature">VEIL / ${escapeHtml(state.caseId.slice(0, 8).toUpperCase())}</div></div>
      <div class="report-grid">
        <div><h3>Preservation record</h3><p><b>Original file:</b> ${escapeHtml(state.file?.name || '')}<br /><b>Vault SHA-256:</b> <code>${escapeHtml(receipt?.originalAsset?.serverSha256 || state.sha256 || 'Not completed')}</code><br /><b>Received:</b> ${escapeHtml(formatDate(receipt?.case?.receivedAt ?? state.createdAt))}</p></div>
        <div><h3>Provenance posture</h3><p>${escapeHtml(provenanceStatus().detail)}</p></div>
        <div><h3>What Veil found</h3><p><b>${escapeHtml(review.label)}</b><br />${escapeHtml(review.detail)}</p></div>
      </div>
      <p class="report-disclaimer">This package records technical facts and observations. It does not determine whether the depicted event happened, whether a claim is valid, or whether a video is AI-generated.</p>
      <div class="report-buttons no-print"><button class="button quiet" data-action="print-report">Print / save PDF</button><button class="button primary" data-action="export-report">Download JSON package</button></div>
    </section>`;
}

function footer() {
  return `<footer><span>VEIL / EVIDENCE PASSPORT</span><span>Local-first prototype · no automatic verdicts</span></footer>`;
}

function render() {
  app.innerHTML = state.status === 'empty' || state.status === 'processing' || state.status === 'error' ? `${frameHeader()}${emptyScreen()}` : evidenceScreen();
  if (state.status === 'ready') wireVideo();
}

function currentVideo() {
  return app.querySelector('[data-evidence-video]');
}

function updateTimeDisplays(time) {
  const value = formatTimestamp(time);
  app.querySelectorAll('[data-current-time], [data-form-time]').forEach((element) => {
    element.textContent = value;
  });
}

function wireVideo() {
  const video = currentVideo();
  if (!video) return;
  video.addEventListener('loadedmetadata', () => {
    if (state.playbackTime > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(state.playbackTime, video.duration);
    updateTimeDisplays(video.currentTime);
  });
  video.addEventListener('timeupdate', () => {
    state.playbackTime = video.currentTime;
    updateTimeDisplays(video.currentTime);
  });
  video.addEventListener('seeked', () => {
    state.playbackTime = video.currentTime;
    updateTimeDisplays(video.currentTime);
  });
}

function preservePlaybackPosition() {
  const video = currentVideo();
  if (video && Number.isFinite(video.currentTime)) state.playbackTime = video.currentTime;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function loadVideoMetadata(url) {
  return new Promise((resolve) => {
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = url;
    const finish = (metadata) => {
      probe.removeAttribute('src');
      probe.load();
      resolve(metadata);
    };
    probe.addEventListener('loadedmetadata', () => finish({ duration: probe.duration, width: probe.videoWidth, height: probe.videoHeight }), { once: true });
    probe.addEventListener('error', () => finish({ duration: null, width: null, height: null }), { once: true });
  });
}

async function responseJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: `The local vault returned an unreadable response (${response.status}).` };
  }
}

async function sealWithVault(file, clientSha256) {
  state.vault = { status: 'sealing', receipt: null, verification: null, error: null, syncError: null };
  const response = await fetch('/api/evidence/cases', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Veil-Case-Id': state.caseId,
      'X-Veil-File-Name': encodeURIComponent(file.name || 'original-video'),
      'X-Veil-Client-Sha256': clientSha256,
    },
    body: file,
  });
  const receipt = await responseJson(response);
  if (!response.ok) throw new Error(receipt.error || `The local vault rejected this file (${response.status}).`);
  const verificationResponse = await fetch(`/api/evidence/cases/${encodeURIComponent(state.caseId)}/verify`);
  const verification = await responseJson(verificationResponse);
  if (!verificationResponse.ok || verification.valid !== true) throw new Error(verification.error || 'The local vault could not verify its receipt signature.');
  state.vault = { status: 'sealed', receipt, verification, error: null, syncError: null };
  const serverHash = receipt.payload?.originalAsset?.serverSha256;
  addCustodyEvent('local_vault_receipt_created', serverHash ? `Local vault sealed original bytes as ${shortHash(serverHash)}.` : 'Local vault sealed the original bytes.');
}

async function syncObservationsWithVault() {
  const receipt = receiptPayload();
  if (!receipt || !state.observations.length) return;
  const recorded = new Set((receipt.observations || []).map((observation) => observation.id));
  const unsynced = state.observations.filter((observation) => !recorded.has(observation.id));
  if (!unsynced.length) return;
  try {
    const response = await fetch(`/api/evidence/cases/${encodeURIComponent(state.caseId)}/observations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ observations: unsynced }),
    });
    const receiptAfterSave = await responseJson(response);
    if (!response.ok) throw new Error(receiptAfterSave.error || `The local vault could not save observations (${response.status}).`);
    state.vault.receipt = receiptAfterSave;
    state.vault.syncError = null;
  } catch (error) {
    state.vault.syncError = error instanceof Error ? error.message : 'The local vault could not save reviewer observations.';
  }
}

function updateScanProgress(progress) {
  state.analysis.progress = progress;
  const status = app.querySelector('[data-scan-progress]');
  if (!status) return;
  if (progress.phase === 'model') {
    const check = progress.detector ? `AI check ${progress.detector} of ${progress.detectorCount}` : 'AI checks';
    if (progress.stage === 'frames') {
      status.textContent = `${check} · ${progress.completed} of ${progress.total} frames`;
      return;
    }
    const percent = Math.round(progress.completed / progress.total * 100);
    status.textContent = progress.stage === 'download' ? `${check} · Downloading detector (${percent}%)` : `${check} · Getting ready…`;
    return;
  }
  const phase = progress.phase === 'frames' ? 'Sampling frames' : 'Reviewing audio';
  status.textContent = `${phase} · ${progress.completed}/${progress.total}`;
}

function analysisForVault(result) {
  const receipt = receiptPayload();
  const cloud = state.cloud.result;
  return {
    sourceSha256: receipt?.originalAsset?.serverSha256 ?? state.sha256,
    engine: result.engine,
    status: result.status,
    inspectedAt: result.inspectedAt,
    sampledFrames: result.sampledFrames,
    frameIntervalEstimate: result.frameIntervalEstimate,
    syntheticMedia: result.syntheticMedia
      ? {
          status: result.syntheticMedia.status,
          requestedFrames: result.syntheticMedia.requestedFrames,
          scoredFrames: result.syntheticMedia.scoredFrames,
          flaggedFrames: result.syntheticMedia.flaggedFrames,
          agreementFrames: result.syntheticMedia.agreementFrames,
          detectors: result.syntheticMedia.detectors,
          signalCount: result.syntheticMedia.signals?.length ?? 0,
        }
      : null,
    temporal: result.temporal
      ? {
          metrics: result.temporal.metrics,
          signalCount: result.temporal.signals?.length ?? 0,
        }
      : null,
    face: result.face
      ? {
          status: result.face.status,
          reason: result.face.reason,
          metrics: result.face.metrics,
          signalCount: result.face.signals?.length ?? 0,
        }
      : null,
    audio: result.audio
      ? {
          status: result.audio.status,
          reason: result.audio.reason,
          metrics: result.audio.metrics,
          signalCount: result.audio.signals?.length ?? 0,
        }
      : null,
    unavailableChecks: result.unavailableChecks,
    cloudReview: cloud ? { ...cloud, checks: cloud.checks.map(({ findings, ...check }) => check) } : null,
    signals: [...(cloud?.checks.flatMap(({ findings }) => findings) ?? []), ...result.signals]
      .map(({ thumbnail, ...signalWithoutThumbnail }) => signalWithoutThumbnail),
    limitations: result.limitations,
  };
}

async function loadCloudConfig() {
  try {
    const response = await fetch('/api/review/providers');
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function videoAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',', 2)[1]);
    reader.onerror = () => reject(new Error('Veil couldn’t read the video for upload.'));
    reader.readAsDataURL(file);
  });
}

async function runCloudChecks() {
  const current = state;
  const { config, running, result } = current.cloud;
  const local = current.analysis.result;
  const duration = current.facts?.durationFromContainer ?? current.media.duration;
  if (!config?.providers.length || running || result || !local || current.file.size > config.maxBytes || duration > config.maxSeconds) return;
  preservePlaybackPosition();
  current.cloud.running = true;
  current.cloud.error = null;
  render();
  try {
    const video = await videoAsBase64(current.file);
    if (state !== current) return;
    const response = await fetch('/api/review/cloud', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veil-Cloud-Consent': 'yes' },
      body: JSON.stringify({
        video,
        sourceSha256: current.sha256,
        providers: config.providers.map(({ id }) => id),
        frames: config.providers.some(({ id }) => id === 'openai') ? local.cloudFrames : [],
      }),
    });
    const report = await responseJson(response);
    if (!response.ok) throw new Error(report.error || 'Cloud checks could not finish.');
    if (report.sourceSha256 !== current.sha256) throw new Error('The returned report could not be matched to this video.');
    if (state !== current) return;
    await syncAnalysisWithVault();
    if (state !== current) return;
    current.cloud.result = report;
    current.analysis.persisted = false;
    void syncAnalysisWithVault();
  } catch (error) {
    current.cloud.error = error.message || 'Cloud checks could not finish.';
  } finally {
    current.cloud.running = false;
    if (state === current) {
      preservePlaybackPosition();
      render();
    }
  }
}

async function syncAnalysisWithVault() {
  const receipt = receiptPayload();
  const result = state.analysis.result;
  if (!receipt || !result || state.analysis.persisted) return;
  if (state.analysis.syncPromise) return state.analysis.syncPromise;

  const caseId = state.caseId;
  const scanResult = result;
  const task = (async () => {
    try {
      const response = await fetch(`/api/evidence/cases/${encodeURIComponent(caseId)}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis: analysisForVault(scanResult) }),
      });
      const updatedReceipt = await responseJson(response);
      if (!response.ok) throw new Error(updatedReceipt.error || `The local vault could not save scan results (${response.status}).`);
      if (state.caseId === caseId && state.analysis.result === scanResult) {
        state.vault.receipt = updatedReceipt;
        state.analysis.persisted = true;
        state.vault.syncError = null;
      }
    } catch (error) {
      if (state.caseId === caseId && state.analysis.result === scanResult) {
        state.vault.syncError = error instanceof Error ? error.message : 'The local vault could not save the scan results.';
      }
    }
  })();
  state.analysis.syncPromise = task;
  try {
    await task;
  } finally {
    if (state.caseId === caseId && state.analysis.result === scanResult && state.analysis.syncPromise === task) state.analysis.syncPromise = null;
  }
}

async function runEvidenceScan() {
  if (!state.file || state.analysis.status === 'running') return;
  const run = ++scanGeneration;
  preservePlaybackPosition();
  state.analysis = { status: 'running', result: null, error: null, progress: { phase: 'frames', completed: 0, total: 1 }, persisted: false, syncPromise: null };
  render();
  try {
    const result = await analyzeVideoFile(state.file, (progress) => {
      if (run === scanGeneration) updateScanProgress(progress);
    });
    if (run !== scanGeneration) return;
    state.analysis = { status: 'complete', result, error: null, progress: null, persisted: false, syncPromise: null };
    addCustodyEvent('automated_evidence_scan_completed', `Completed ${ANALYSIS_ENGINE.id} with ${result.signals.length} timestamped review signal${result.signals.length === 1 ? '' : 's'}.`);
    render();
    void syncAnalysisWithVault();
  } catch (error) {
    if (run !== scanGeneration) return;
    state.analysis = { status: 'failed', result: null, error: error instanceof Error ? error.message : 'The browser could not complete the evidence scan.', progress: null, persisted: false, syncPromise: null };
    addCustodyEvent('automated_evidence_scan_failed', state.analysis.error);
    render();
  }
}

async function openVideo(file) {
  if (!file) return;
  if (file.size > MAX_VIDEO_BYTES) {
    state.status = 'error';
    state.error = `This file is ${formatBytes(file.size)}. The browser-local MVP accepts videos up to ${formatBytes(MAX_VIDEO_BYTES)}.`;
    render();
    return;
  }

  if (state.assetUrl) URL.revokeObjectURL(state.assetUrl);
  scanGeneration += 1;
  state = initialState();
  state.status = 'processing';
  state.file = file;
  addCustodyEvent('file_received_locally', `Opened ${file.name || 'untitled video'} in this browser.`);
  render();

  let shouldAutoScan = false;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const facts = inspectVideoContainer(bytes);
    if (!facts.supported) throw new Error(facts.reason);
    const assetUrl = URL.createObjectURL(new Blob([bytes], { type: file.type || 'video/mp4' }));
    const [sha256, media, cloudConfig] = await Promise.all([sha256Hex(bytes), loadVideoMetadata(assetUrl), loadCloudConfig()]);

    state.bytes = bytes;
    state.facts = facts;
    state.sha256 = sha256;
    state.assetUrl = assetUrl;
    state.media = media;
    state.cloud.config = cloudConfig;
    addCustodyEvent('sha256_computed_locally', `Computed SHA-256 for ${bytes.length.toLocaleString()} original bytes.`);
    addCustodyEvent('container_inspected_locally', `Read ${facts.container}; top-level boxes: ${facts.topLevelBoxes.join(', ') || 'none'}.`);
    if (facts.c2paManifestCandidate) addCustodyEvent('c2pa_container_candidate', 'Found a C2PA UUID container marker. Full signature validation is not included in this MVP.');
    try {
      await sealWithVault(file, sha256);
    } catch (vaultError) {
      state.vault = {
        status: 'error',
        receipt: null,
        verification: null,
        error: vaultError instanceof Error ? vaultError.message : 'The local vault could not seal the original video.',
        syncError: null,
      };
      addCustodyEvent('local_vault_seal_failed', state.vault.error);
    }
    state.status = 'ready';
    shouldAutoScan = true;
  } catch (error) {
    state.status = 'error';
    state.error = error instanceof Error ? error.message : 'The file could not be read.';
  }
  render();
  if (shouldAutoScan) void runEvidenceScan();
}

function buildEvidencePackage() {
  const provenance = provenanceStatus();
  const receipt = receiptPayload();
  const { cloudFrames, ...localAnalysis } = state.analysis.result ?? {};
  return {
    schema: 'veil-evidence-package/v0.5',
    generatedAt: new Date().toISOString(),
    workflow: state.workflow === 'personal' ? 'personal_deepfake_incident' : 'insurance_evidence_review',
    case: {
      id: state.caseId,
      localReceiptAt: state.createdAt,
      sourceUrl: state.sourceUrl || null,
      custodyScope: receipt?.case?.custodyScope ?? 'Browser-local session only; the local evidence vault did not seal this case.',
    },
    originalAsset: {
      included: false,
      originalFileName: state.file?.name || null,
      declaredBrowserMimeType: state.file?.type || null,
      byteLength: receipt?.originalAsset?.byteLength ?? state.bytes?.length ?? null,
      browserSha256: state.sha256,
      serverSha256: receipt?.originalAsset?.serverSha256 ?? null,
      clientServerHashMatch: receipt?.originalAsset?.clientSha256?.matchesServer ?? null,
      container: inspection(),
      decodedMedia: state.media,
    },
    localVaultReceipt: state.vault.receipt,
    localVaultVerification: state.vault.verification,
    provenance: {
      status: provenance.label,
      detail: provenance.detail,
      validationPerformed: false,
      limitation: 'This MVP only scans an ISO BMFF container for a C2PA UUID marker. It does not validate a C2PA manifest, signature, signer trust, or timestamp trust.',
    },
    automatedAnalysis: state.analysis.result ? localAnalysis : null,
    cloudReview: state.cloud.result,
    reviewPassages: findingsForReview(),
    custodyEvents: receipt?.custodyEvents ?? state.custody,
    observations: state.observations,
    limitations: [
      'A file hash identifies exact bytes but does not establish who recorded the video or whether the depicted event occurred.',
      'Credential absence is not evidence of AI generation or manipulation.',
      'Reviewer observations are hypotheses requiring independent corroboration.',
      'The AI detectors assess sampled frame crops. The origin and context of the video require independent verification.',
    ],
    software: { product: 'Veil Evidence Passport', version: '0.5.0', mode: receipt ? 'local evidence vault' : 'browser-local fallback' },
  };
}

async function downloadJson() {
  await syncObservationsWithVault();
  await syncAnalysisWithVault();
  const contents = `${JSON.stringify(buildEvidencePackage(), null, 2)}\n`;
  const blob = new Blob([contents], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `veil-evidence-${state.caseId}.json`;
  link.click();
  URL.revokeObjectURL(href);
  addCustodyEvent('evidence_package_exported_locally', 'Downloaded a JSON evidence package from this browser.');
}

function resetCase() {
  scanGeneration += 1;
  if (state.assetUrl) URL.revokeObjectURL(state.assetUrl);
  state = initialState();
  render();
}

app.addEventListener('change', (event) => {
  const target = event.target;
  if (target.matches('[data-video-input]')) void openVideo(target.files?.[0]);
  if (target.matches('[data-workflow]')) {
    state.workflow = target.value;
    render();
  }
  if (target.matches('[data-source-url]')) state.sourceUrl = target.value.trim();
});

app.addEventListener('input', (event) => {
  const target = event.target;
  if (target.matches('[data-source-url]')) state.sourceUrl = target.value.trim();
});

app.addEventListener('submit', (event) => {
  if (!event.target.matches('[data-observation-form]')) return;
  event.preventDefault();
  const form = new FormData(event.target);
  const text = String(form.get('observation') || '').trim();
  if (!text) return;
  const video = currentVideo();
  const time = Number.isFinite(video?.currentTime) ? video.currentTime : 0;
  preservePlaybackPosition();
  state.observations.push({
    id: newCaseId(),
    time,
    category: String(form.get('category') || 'visual'),
    text,
    createdAt: new Date().toISOString(),
  });
  addCustodyEvent('review_observation_added', `Added a ${String(form.get('category') || 'visual')} observation at ${formatTimestamp(time)}.`);
  render();
  void syncObservationsWithVault();
});

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'export-report') void downloadJson();
  if (action === 'print-report') window.print();
  if (action === 'run-scan') void runEvidenceScan();
  if (action === 'cloud-review') void runCloudChecks();
  if (action === 'reset') resetCase();
  if (action === 'seek') {
    const time = Number(button.dataset.time);
    const video = currentVideo();
    if (video && Number.isFinite(time) && time >= 0) {
      const maximum = Number.isFinite(video.duration) ? video.duration : time;
      video.currentTime = Math.min(time, maximum);
      state.playbackTime = video.currentTime;
      updateTimeDisplays(video.currentTime);
      video.focus();
    }
  }
  if (action === 'remove-observation') {
    preservePlaybackPosition();
    state.observations = state.observations.filter((item) => item.id !== button.dataset.id);
    addCustodyEvent('review_observation_removed', 'Removed a reviewer observation before export.');
    render();
  }
});

app.addEventListener('dragover', (event) => {
  if (!event.target.closest('[data-dropzone]')) return;
  event.preventDefault();
  event.currentTarget.querySelector('[data-dropzone]')?.classList.add('is-over');
});

app.addEventListener('dragleave', (event) => {
  if (!event.target.closest('[data-dropzone]')) return;
  event.currentTarget.querySelector('[data-dropzone]')?.classList.remove('is-over');
});

app.addEventListener('drop', (event) => {
  const dropzone = event.target.closest('[data-dropzone]');
  if (!dropzone) return;
  event.preventDefault();
  dropzone.classList.remove('is-over');
  void openVideo(event.dataTransfer?.files?.[0]);
});

try {
  render();
} catch (error) {
  showStartupError(error);
}
