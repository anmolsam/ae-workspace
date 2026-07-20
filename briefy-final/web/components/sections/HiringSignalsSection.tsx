import { SectionPanel } from '../SectionPanel';
import type { BriefDetail } from '../../types/briefy';

export function HiringSignalsSection({ brief }: { brief: BriefDetail }) {
  return (
    <SectionPanel title="Hiring Signals" status={brief.sectionStatus.hiringSignals}>
      {brief.openRoles.length === 0 ? (
        <p className="text-sm text-neutral-400">No open roles found.</p>
      ) : (
        <ul className="space-y-1 text-sm text-neutral-700">
          {brief.openRoles.map((r, i) => (
            <li key={i}>
              <a href={r.link} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                {r.title}
              </a>{' '}
              <span className="text-xs text-neutral-400">({r.source})</span>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}
