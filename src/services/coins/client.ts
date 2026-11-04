import {
  CoinCreatorAccountDataSchema,
  CoinMissionsDataSchema,
  CoinLedgerItemSchema,
  CoinHistoryQuerySchema,
  CoinCatalogueDataSchema,
  TemplateSelectionSchema,
  coinEnvelope,
  coinPage,
} from '@/services/contracts/index';
import { failure, type ApiFailure, type JsonRequest } from '@/services/api/index';
import type { CreatorSession } from '@/services/creator-session/index';

const accountSchema = coinEnvelope(CoinCreatorAccountDataSchema);
const missionsSchema = coinEnvelope(
  CoinMissionsDataSchema.refine(
    (value) =>
      new Set(value.missions.map((mission) => mission.id)).size === 6 &&
      value.missions.every((mission) =>
        mission.completed
          ? mission.earned !== null && mission.completedAt !== null
          : mission.earned === null && mission.completedAt === null,
      ),
  ),
);
const catalogueSchema = coinEnvelope(
  CoinCatalogueDataSchema.refine(
    (value) =>
      new Set(value.templates.map((template) => template.id)).size === value.templates.length,
  ),
);
const ledgerSchema = coinPage(CoinLedgerItemSchema).refine(
  ({ data }) =>
    new Set(data.items.map((item) => item.id)).size === data.items.length &&
    data.items.every(
      (item, index) => index === 0 || item.revision < data.items[index - 1]!.revision,
    ),
);
const selectionSchema = coinEnvelope(TemplateSelectionSchema);

/** A safe failure code only: response bodies and private cursors never become error text. */
export class CoinReadError extends Error {
  constructor(readonly failure: ApiFailure) {
    super('Coin information could not be verified.');
    this.name = 'CoinReadError';
  }
}

/** Read-only creator scope. Commands and staff authority have separate feature owners. */
export function createCoinReadClient(session: CreatorSession) {
  const scope = session.getSnapshot().scope;
  const active = () => {
    const current = session.getSnapshot();
    if (scope.signal.aborted || current.scope !== scope || current.phase !== 'authenticated')
      throw new CoinReadError(failure('authority', 'AUTHORITY_CHANGED'));
  };
  const read = async <T>(input: JsonRequest<T>): Promise<T> => {
    active();
    const result = await session.request(input);
    active();
    if (result.kind === 'data') return result.data;
    throw new CoinReadError(
      result.kind === 'error' ? result : failure('protocol', 'UNEXPECTED_COIN_RESPONSE'),
    );
  };
  return {
    account: (signal: AbortSignal) =>
      read({ path: '/api/coins/account', schema: accountSchema, success: [200], signal }),
    missions: (signal: AbortSignal) =>
      read({ path: '/api/coins/missions', schema: missionsSchema, success: [200], signal }),
    ledger: (query: unknown, signal: AbortSignal) => {
      const parsed = CoinHistoryQuerySchema.safeParse(query);
      if (!parsed.success)
        throw new CoinReadError(failure('configuration', 'INVALID_COIN_HISTORY_QUERY'));
      const cursor = parsed.data.cursor;
      return read({
        path: '/api/coins/ledger' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
        schema: ledgerSchema,
        success: [200],
        signal,
      }).then((value) => {
        if (cursor && value.data.nextCursor === cursor)
          throw new CoinReadError(failure('protocol', 'REPEATED_COIN_CURSOR'));
        return value;
      });
    },
    catalogue: (signal: AbortSignal) =>
      read({ path: '/api/templates', schema: catalogueSchema, success: [200], signal }),
    entitlements: (signal: AbortSignal) =>
      read({ path: '/api/template-entitlements', schema: catalogueSchema, success: [200], signal }),
    selection: (signal: AbortSignal) =>
      read({ path: '/api/template-preferences', schema: selectionSchema, success: [200], signal }),
  };
}
export type CoinReadClient = ReturnType<typeof createCoinReadClient>;
export type CoinAccountResponse = Awaited<ReturnType<CoinReadClient['account']>>;
export type CoinMissionsResponse = Awaited<ReturnType<CoinReadClient['missions']>>;
export type CoinLedgerResponse = Awaited<ReturnType<CoinReadClient['ledger']>>;
