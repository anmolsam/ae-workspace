import { SectionPanel } from '../SectionPanel';
import type { BriefDetail } from '../../types/briefy';

export function IntentSection({ brief }: { brief: BriefDetail }) {
  return (
    <SectionPanel title="Buying Intent" status={brief.sectionStatus.intent}>
      <p className="text-sm text-neutral-700">{brief.zoomInfoIntentScore || 'No score'}</p>
    </SectionPanel>
  );
}
