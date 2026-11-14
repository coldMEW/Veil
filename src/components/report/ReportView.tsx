import { useId, type ReactNode } from 'react';
import { displayedFinding, type Finding, type ModelManifest } from '../../contracts';
import { canonicalJson } from '../../features/report/report';
import { prepareReport, reportFilename, serializeReport, type EvidenceReport } from './reportExport';
import '../../styles/print.css';

export interface ReportViewProps {
  report: EvidenceReport;
  /** Manifests for this run, supplied by the caller; not a claim of device execution. */
  modelManifests?: readonly ModelManifest[];
}

const findings: Record<Finding, string> = {
  consistent: 'Fits this check',
  inconsistent: 'Does not fit this check',
  inconclusive: 'Inconclusive',
  not_applicable: 'Not applicable',
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="report-field"><dt>{label}</dt><dd>{children}</dd></div>;
}

function List({ items }: { items: readonly string[] }) {
  return items.length ? <ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul> : <>None stated.</>;
}

function Hash({ value }: { value: string | null | undefined }) {
  return value ? <code className="report-hash">{value}</code> : <>Not recorded.</>;
}

function Json({ value }: { value: unknown }) {
  return <pre className="report-json">{canonicalJson(value)}</pre>;
}

function download(report: EvidenceReport, manifests: readonly ModelManifest[]) {
  const url = URL.createObjectURL(new Blob([serializeReport(report, manifests)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = reportFilename(report);
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Give the browser time to start the download before releasing its URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Explicit exports only: rendering never persists the report or any input image. */
export function ReportView({ report, modelManifests = [] }: ReportViewProps) {
  const headingId = useId();
  const prepared = prepareReport(report, modelManifests);
  return (
    <article className="veil-report" aria-labelledby={headingId}>
      <header className="report-intro">
        <h1 id={headingId}>Evidence report</h1>
        <p>Observations and their limits are listed for each check.</p>
        <dl>
          <Field label="Schema">{report.schema}</Field>
          <Field label="Generated at">{report.generatedAt}</Field>
          {report.app.version && <Field label="App version">{report.app.version}</Field>}
          {report.app.commit && <Field label="Commit"><code className="report-hash">{report.app.commit}</code></Field>}
        </dl>
        <div className="report-actions">
          <button type="button" onClick={() => download(report, modelManifests)}>Download JSON</button>
          <button type="button" onClick={() => window.print()}>Print / Save as PDF</button>
        </div>
      </header>

      <section className="report-section">
        <h2>Input and output</h2>
        <p>{report.hashNote}</p>
        <dl>
          <Field label="Input SHA-256"><Hash value={report.original.sha256} /></Field>
          <Field label="Input file">{report.original.mimeType}, {report.original.byteLength} bytes</Field>
          <Field label="Input dimensions (encoded)">{report.original.encodedWidth} × {report.original.encodedHeight}</Field>
          <Field label="Input dimensions (orientation corrected)">{report.original.width} × {report.original.height}</Field>
          <Field label="Input parent SHA-256"><Hash value={report.original.parentId} /></Field>
          <Field label="Output SHA-256">{report.exported ? <Hash value={report.exported.sha256} /> : 'No exported image recorded.'}</Field>
          {report.exported && <>
            <Field label="Output file">{report.exported.mimeType}, {report.exported.byteLength} bytes</Field>
            <Field label="Output dimensions (encoded)">{report.exported.encodedWidth} × {report.exported.encodedHeight}</Field>
            <Field label="Output dimensions (orientation corrected)">{report.exported.width} × {report.exported.height}</Field>
            <Field label="Output parent SHA-256"><Hash value={report.exported.parentId} /></Field>
          </>}
        </dl>
      </section>

      <section className="report-section">
        <h2>Inspection checks</h2>
        {!prepared.inspect.checks.length && <p>No checks recorded.</p>}
        {prepared.inspect.checks.map((check, index) => (
          <section className="report-record" key={`${check.id}-${index}`}>
            <h3>{check.title}</h3>
            {check.source === 'recorded_fixture' && <p className="report-fixture"><strong>Recorded fixture (recorded_fixture).</strong> This result is recorded evidence, not a live run on this device.</p>}
            <dl>
              <Field label="Check ID">{check.id}</Field>
              <Field label="Asset SHA-256"><Hash value={check.assetId} /></Field>
              <Field label="Evidence kind">{check.kind}</Field>
              <Field label="Source">{check.source === 'live' ? 'Live result' : 'Recorded fixture'}</Field>
              <Field label="Execution">{check.execution}</Field>
              <Field label="Finding">{findings[displayedFinding(check)]}</Field>
              {check.reason && <Field label="Reason">{check.reason}</Field>}
              <Field label="Observation">{check.observation || 'No observation recorded.'}</Field>
              <Field label="Method">{check.method}</Field>
              <Field label="Assumptions"><List items={check.assumptions} /></Field>
              <Field label="What stays unknown"><List items={check.limitations} /></Field>
              <Field label="Evidence details"><Json value={check.evidence} /></Field>
              <Field label="Recorded overlays">{check.overlayCount} (geometry is not included by the report builder)</Field>
            </dl>
          </section>
        ))}
      </section>

      <section className="report-section">
        <h2>Transformations and privacy verification</h2>
        <p>{report.clean.privacyStatement}</p>
        {report.clean.syntheticContentNote && <p>{report.clean.syntheticContentNote}</p>}
        <dl>
          <Field label="Selected regions">{report.clean.selectedRegions}</Field>
          <Field label="Selected by category"><Json value={report.clean.selectedByCategory} /></Field>
          <Field label="Detection methods"><List items={report.clean.detectionSources} /></Field>
        </dl>
        {!report.clean.transforms.length && <p>No transformations recorded.</p>}
        {report.clean.transforms.map((transform, index) => (
          <section className="report-record" key={index}>
            <h3>Transform {index + 1}: {transform.method}</h3>
            <dl>
              <Field label="Synthetic content">{transform.synthetic ? 'Yes — model-generated background' : 'No'}</Field>
              <Field label="Input SHA-256"><Hash value={transform.inputSha256} /></Field>
              <Field label="Output SHA-256"><Hash value={transform.outputSha256} /></Field>
              <Field label="Mask SHA-256"><Hash value={transform.maskSha256} /></Field>
              <Field label="Model SHA-256"><Hash value={transform.modelSha256} /></Field>
              <Field label="Mask expansion (pixels)">{transform.maskExpansionPx ?? 'Not recorded.'}</Field>
              <Field label="Seed">{transform.seed ?? 'Not recorded.'}</Field>
              <Field label="Parameters"><Json value={transform.parameters} /></Field>
              <Field label="Output format and dimensions">{transform.output}</Field>
            </dl>
          </section>
        ))}
        <h3>Export verification</h3>
        {report.clean.verification ? <dl>
          <Field label="Metadata blocks found"><List items={report.clean.verification.exportMetadataBlocks} /></Field>
          <Field label="Round-trip pixel mismatches">{report.clean.verification.roundTripMismatches}</Field>
          <Field label="Re-scan">{report.clean.verification.rescan === 'not_run' ? 'Not run.' : <Json value={report.clean.verification.rescan} />}</Field>
        </dl> : <p>Export verification was not recorded.</p>}
      </section>

      <section className="report-section">
        <h2>Protection experiment</h2>
        <dl>
          <Field label="Status">{report.protect.status}</Field>
          <Field label="Observation and limitations">{report.protect.note}</Field>
        </dl>
      </section>

      <section className="report-section">
        <h2>Model manifests</h2>
        <p>Tested backends describe the supplied manifest, not execution of this report on this device. Runtime details, when recorded, appear in each check’s evidence.</p>
        {!modelManifests.length && <p>No model manifests supplied for this report.</p>}
        {modelManifests.map((manifest, index) => (
          <section className="report-record" key={`${manifest.id}-${index}`}>
            <h3>{manifest.id}</h3>
            <dl>
              <Field label="Upstream URL">{manifest.upstreamUrl}</Field>
              <Field label="Revision"><code className="report-hash">{manifest.revision}</code></Field>
              <Field label="Artifact SHA-256"><Hash value={manifest.sha256} /></Field>
              <Field label="License">{manifest.license}</Field>
              <Field label="Artifact bytes">{manifest.bytes}</Field>
              <Field label="Inputs"><Json value={manifest.io.inputs} /></Field>
              <Field label="Outputs"><Json value={manifest.io.outputs} /></Field>
              <Field label="Tested backends in manifest"><List items={manifest.testedBackends} /></Field>
            </dl>
          </section>
        ))}
      </section>
    </article>
  );
}
