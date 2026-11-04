import { createCreatorSession } from '@/services/creator-session/index';
import { createCoinReadClient, CoinReadError, type CoinReadClient } from '@/services/coins/index';

// Isolated production-compiled fixture; not a product route or login mechanism.
const session = createCreatorSession({ origin: 'http://127.0.0.1:3310' });
let client: CoinReadClient;
Object.assign(window, {
  coinProbe: {
    async start() {
      session.start();
      await session.inspect();
      client = createCoinReadClient(session);
      return session.getSnapshot().phase;
    },
    async read(kind: keyof CoinReadClient, query: unknown = {}) {
      try {
        const signal = new AbortController().signal;
        const value = await (kind === 'ledger'
          ? client.ledger(query, signal)
          : client[kind](signal));
        return { ok: true, value };
      } catch (error) {
        if (error instanceof CoinReadError)
          return { ok: false, code: error.failure.code, status: error.failure.status };
        throw new Error('Unexpected read failure', { cause: error });
      }
    },
    logout: () => session.logout(),
    stop: () => session.stop(),
  },
});
window.addEventListener('pagehide', () => session.stop());
