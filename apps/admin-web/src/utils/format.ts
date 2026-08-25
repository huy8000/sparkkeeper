export function formatTimestamp(value: string | null): string {
  if (value === null) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

export function shortId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}
