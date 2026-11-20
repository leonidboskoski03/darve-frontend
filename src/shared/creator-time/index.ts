export function creatorTime(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat('en', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
}
