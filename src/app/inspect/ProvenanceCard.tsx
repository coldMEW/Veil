import { motion } from 'motion/react';
import { SealCheck, SealWarning, Seal } from '@phosphor-icons/react';
import { ResultCard, rowReveal } from '../../components/ResultCard';
import { AI_SOURCE_TYPES } from '../../features/inspect/provenance/contentCredentials';
import type { ProvenanceState } from './useProvenance';

const AI_TYPES = new Set(['trainedAlgorithmicMedia', 'compositeWithTrainedAlgorithmicMedia', 'algorithmicMedia', 'compositeSynthetic']);

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <dt className="w-28 shrink-0 text-faint">{label}</dt>
      <dd className="min-w-0 break-words text-ink/90">{value}</dd>
    </div>
  );
}

/** Content Credentials: the strongest evidence when present, explicitly weak when absent. */
export function ProvenanceCard({ state }: { state: ProvenanceState }) {
  if (state.status !== 'done') {
    return (
      <motion.article variants={rowReveal} className="py-4">
        <div className="flex gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-muted">
            <Seal size={18} aria-hidden />
          </span>
          <div>
            <h3 className="font-semibold leading-snug">Content credentials</h3>
            <p className="mt-0.5 text-sm text-faint" role="status">
              {state.status === 'reading' ? 'Reading the original file…' : 'Open a photo to read its credentials.'}
            </p>
          </div>
        </div>
      </motion.article>
    );
  }
  const { credentials: c, hints } = state.result;
  const aiTypes = [...new Set([...c.sourceTypes, ...hints.sourceTypes])].filter((t) => AI_TYPES.has(t));
  const banner = c.contentChanged
    ? { tone: 'border-misfit/50 bg-misfit/10 text-misfit', icon: SealWarning, text: 'Changed after its Content Credentials were signed' }
    : aiTypes.length
      ? { tone: 'border-[#e5383b]/50 bg-[#e5383b]/10 text-[#b91c1c]', icon: SealWarning, text: `${AI_SOURCE_TYPES[aiTypes[0]!] ?? 'AI-generated'}, according to its ${c.present ? 'Content Credentials' : 'metadata'}` }
      : c.present
        ? { tone: 'border-fit/40 bg-fit/10 text-fit', icon: SealCheck, text: 'Content Credentials attached' }
        : null;
  const Icon = banner?.icon;
  return (
    <motion.div variants={rowReveal} initial="hidden" animate="show">
      {banner && Icon && (
        <div className={`mt-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold ${banner.tone}`} role="status">
          <Icon size={18} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
          <span>{banner.text}</span>
        </div>
      )}
      <ResultCard
        result={state.checkResult}
        badge={
          c.contentChanged
            ? { label: 'Changed after signing', tone: 'text-misfit' }
            : aiTypes.length
              ? { label: 'AI-made (declared)', tone: 'text-[#b91c1c]' }
              : c.present
                ? { label: 'Credentials found', tone: 'text-fit' }
                : { label: 'None found', tone: 'text-muted' }
        }
      />
      {(c.present || hints.toolNames.length > 0) && (
        <dl className="-mt-1 mb-4 ml-12 divide-y divide-line rounded-xl bg-raised px-3 py-1">
          {c.generator && <Row label="Made with" value={c.generator} />}
          {c.signer && <Row label="Signed by" value={c.signer} />}
          {c.signedAt && <Row label="Signed at" value={new Date(c.signedAt).toLocaleString()} />}
          {aiTypes.length > 0 && <Row label="Source type" value={aiTypes.join(', ')} />}
          {c.actions.length > 0 && <Row label="Actions" value={c.actions.map((a) => a.replace(/^c2pa\./, '')).join(', ')} />}
          {hints.toolNames.length > 0 && <Row label="Metadata names" value={hints.toolNames.join(', ')} />}
          {c.present && (
            <Row
              label="Signature"
              value={
                c.contentChanged
                  ? 'Does not match the image (changed after signing)'
                  : c.credentialProblem
                    ? 'Matches the image; signer not on a trust list here'
                    : 'Matches the image'
              }
            />
          )}
        </dl>
      )}
    </motion.div>
  );
}
