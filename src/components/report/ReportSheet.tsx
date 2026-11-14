import type { CheckResult, ImageAsset, TransformRecord } from '../../contracts';

export function ReportSheet({ asset, checks, transforms }: { asset: ImageAsset; checks: CheckResult[]; transforms: TransformRecord[] }) {
  return <article data-testid="report-sheet" className="mx-auto min-h-[1123px] w-full max-w-[794px] bg-white p-12 text-[#0a0a0a] print:min-h-0 print:max-w-none">
    <h1 className="text-2xl font-semibold">Veil evidence report</h1>
    <section className="mt-8 border-y border-[#e3e6eb] py-4 text-sm"><p>File: {asset.id}</p><p className="font-mono">SHA-256: {asset.sha256}</p><p>{asset.width} × {asset.height} px · {asset.mimeType}</p></section>
    <h2 className="mt-8 text-base font-semibold">Findings</h2>
    {checks.map((check) => <section key={check.id} className="border-b border-[#e3e6eb] py-4"><h3 className="font-medium">{check.title} · {check.finding}</h3><p className="mt-1 text-sm">{check.observation}</p>{check.reason && <p className="mt-1 text-sm">Reason: {check.reason}</p>}<p className="mt-2 text-sm">Limitations: {check.limitations.join(' ')}</p></section>)}
    <h2 className="mt-8 text-base font-semibold">Transforms</h2><p className="text-sm">{transforms.length ? transforms.map((t) => t.method).join(', ') : 'None recorded.'}</p>
  </article>;
}
