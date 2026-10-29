import type { Provider } from '@/services/creator-access/index';
export const providers: readonly { id: Provider; label: string }[] = [
  { id: 'twitch', label: 'Twitch' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'kick', label: 'Kick' },
];
