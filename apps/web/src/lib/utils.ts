export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function titleGradient(title: string): string {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const gradients = [
    'linear-gradient(145deg, #a9d85e, #174d4a)',
    'linear-gradient(145deg, #ff8a55, #592b50)',
    'linear-gradient(145deg, #6cb9f5, #24336f)',
    'linear-gradient(145deg, #d892ff, #3b2674)',
    'linear-gradient(145deg, #f7d477, #a44f3f)'
  ];
  return gradients[hash % gradients.length] ?? gradients[0];
}

export function titleAccent(title: string): string {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const accents = ['#c4f45c', '#ff684f', '#68bcff', '#db8bff', '#f5ce6b'];
  return accents[hash % accents.length] ?? accents[0];
}

export function readableCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}
