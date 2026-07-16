export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function relativeGeneratedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function overdueByLabel(overdueAt: string, now = Date.now()): string {
  const d = new Date(overdueAt);
  if (Number.isNaN(d.getTime())) return 'OVERDUE';
  const diff = now - d.getTime();
  if (diff <= 0) return 'OVERDUE';
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) {
    const mins = Math.max(1, Math.floor(diff / 60000));
    return `OVERDUE BY ${mins}m`;
  }
  if (hrs < 48) return `OVERDUE BY ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `OVERDUE BY ${days}d`;
}

export function humanizeTimeRemaining(ms: number): string {
  if (ms <= 0) return 'Now';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return remMins > 0 ? `in ${hrs}h ${remMins}m` : `in ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `in ${days}d`;
}
