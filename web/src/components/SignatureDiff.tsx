import { wordDiff } from '../lib/wordDiff';

interface SignatureDiffProps {
  signature: string;
  oldSignature?: string;
  /** Satır içi (tek satır) ya da alt alta. */
  stacked?: boolean;
}

/** İmza: eski → yeni, değişen kelimeler vurgulu. Eski imza yoksa yalnız yeni. */
export function SignatureDiff({ signature, oldSignature, stacked = false }: SignatureDiffProps) {
  if (!oldSignature || oldSignature === signature) {
    return <code className="sig">{signature}</code>;
  }
  const wd = wordDiff(oldSignature, signature);
  return (
    <span className={`sigdiff${stacked ? ' sigdiff--stacked' : ''}`}>
      <code className="sig sig--old" aria-label={`Eski imza: ${oldSignature}`}>
        {wd.old.map((s, i) => (s.changed ? <del key={i}>{s.text}</del> : <span key={i}>{s.text}</span>))}
      </code>
      <span className="sigdiff__arrow" aria-hidden="true">
        →
      </span>
      <code className="sig sig--new" aria-label={`Yeni imza: ${signature}`}>
        {wd.new.map((s, i) => (s.changed ? <ins key={i}>{s.text}</ins> : <span key={i}>{s.text}</span>))}
      </code>
    </span>
  );
}
