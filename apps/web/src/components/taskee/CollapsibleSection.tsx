import type { ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  count: number;
  defaultOpen?: boolean;
  danger?: boolean;
  children: ReactNode;
}

/**
 * A native <details> dropdown — zero JS, accessible, keyboard-friendly. Used for
 * the non-Today buckets (Overdue / Tomorrow / This Week) so the one-page Taskee
 * stays glanceable: Today is always shown; the rest fold away.
 */
export function CollapsibleSection({ title, count, defaultOpen, danger, children }: CollapsibleSectionProps) {
  return (
    <details open={defaultOpen} className="group rounded-card border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 select-none">
        <span className="flex items-center gap-2">
          <span className={`text-xs font-semibold uppercase tracking-wide ${danger && count > 0 ? 'text-danger' : 'text-ink-subtle'}`}>
            {title}
          </span>
          <span className={`rounded-full px-1.5 text-xs font-medium tabular-nums ${danger && count > 0 ? 'bg-danger-soft text-danger' : 'bg-canvas text-ink-subtle'}`}>
            {count}
          </span>
        </span>
        <svg
          width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
          className="flex-none text-ink-subtle transition-transform duration-200 group-open:rotate-180"
        >
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="space-y-1.5 border-t border-line px-2 pb-2 pt-2">{children}</div>
    </details>
  );
}
