import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import * as c from '@darve/contracts';
import {
  connectionFixture,
  discoveryFixture,
  ids,
  syntheticSession,
} from '../../src/services/collection/fixture.test-helper';
import { contributionIds } from '../../src/services/contributions/fixture.test-helper';
import {
  makeEvent,
  wireEvent,
  displayId,
  grantId,
} from '../../src/services/realtime/fixtures.test-support';
import { wire } from '../../src/services/realtime/analysis-live.test-support';
import {
  analyticsFixture,
  dashboardFixture,
  reportingChallenge,
  reportingIds,
} from '../../src/services/reporting/fixture.test-helper';
import {
  acceptancePolicyFixture,
  acceptedFixture,
  challengeFixture,
  reviewIds,
} from '../../src/services/suggestions/fixture.test-helper';
import * as support from '../../src/services/support/fixture.test-helper';
import {
  analysisEvents,
  defaultOverlay,
  envelope,
  overlay,
  page,
  publicChallenge,
  receipt,
  review,
  round,
  streamer,
  time,
  titles,
} from './fixtures';
import { isDesignState, states, type DesignState } from './states';

type Schema<T = unknown> = { parse(input: unknown): T };
const stateCookie = 'darve_design_state';
const supportTicket = support.ticket();
const session = { ...syntheticSession, user: { ...syntheticSession.user, displayName: streamer } };
const signedOut = { authenticated: false, user: null, expiresAt: null, csrfToken: null };
const baseTerms = session.user.termsStatus;
const payoutSchemas = {
  stripe: c.StripeReceivingResponseSchema,
  paypal: c.PayPalReceivingResponseSchema,
};

async function readBody(request: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const part of request) {
    raw += String(part);
    if (raw.length > 16_384) throw new Error('Design request exceeds size limit.');
  }
  return JSON.parse(raw);
}

function stream(response: ServerResponse, frames: string) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  response.write(frames || ': connected\n\n');
  const timer = setInterval(() => response.write(': heartbeat\n\n'), 5_000);
  response.once('close', () => clearInterval(timer));
}

function createScenario(mode: DesignState) {
  const activeRound: 'collecting' | 'closed' | null =
    mode === 'collecting'
      ? 'collecting'
      : ['ended', 'review', 'accept'].includes(mode)
        ? 'closed'
        : null;
  return {
    mode,
    termsAccepted: mode !== 'onboarding',
    loggedOut: mode === 'signIn',
    activeRound,
    ideas: review(),
    preferences: defaultOverlay().preferences,
    selection: {
      displayId,
      version: 1,
      roundId: ids.round as string | null,
      challengeId: null as string | null,
    },
    startedReceipt: null as ReturnType<typeof c.CheckoutResponseSchema.parse>['data'] | null,
  };
}

export function designPreview(origin: string): Plugin {
  const scenarios = new Map<string, ReturnType<typeof createScenario>>();

  async function handle(request: IncomingMessage, response: ServerResponse, next: () => void) {
    const url = new URL(request.url ?? '/', origin);
    const { pathname: path } = url;
    const method = request.method ?? 'GET';
    const cookie = request.headers.cookie
      ?.split('; ')
      .find((part) => part.startsWith(stateCookie + '='));
    const browserId = cookie?.slice(stateCookie.length + 1) ?? randomUUID();
    const existing = scenarios.get(browserId);
    const preview = existing ?? createScenario('demo');
    const mode = preview.mode;
    if (!existing && request.headers.accept?.includes('text/html')) {
      scenarios.set(browserId, preview);
      response.setHeader(
        'Set-Cookie',
        stateCookie + '=' + browserId + '; Path=/; HttpOnly; SameSite=Strict',
      );
    }

    const send = (schema: Schema, data: unknown, status = 200) => {
      const wireData = schema.parse(data);
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(wireData));
    };
    const reply = (schema: Schema, data: unknown, status = 200) =>
      send(schema, envelope(data), status);
    const empty = () => {
      response.writeHead(204);
      response.end();
    };
    const failure = (code: string, status: number) =>
      send(
        c.ErrorResponseSchema,
        {
          schemaVersion: 1,
          serverTime: time(),
          error: {
            code,
            message: 'This action is unavailable in the local design preview.',
            requestId: 'design-preview',
            retryable: false,
            retryAfterSeconds: null,
            issues: [],
            refetch: null,
          },
        },
        status,
      );

    if (path === '/__design/menu' && method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return response.end(JSON.stringify({ current: mode, states }));
    }
    if (path.startsWith('/__design/state/') && method === 'POST') {
      const value = path.slice('/__design/state/'.length);
      if (!isDesignState(value) || request.headers.origin !== origin)
        return failure('NOT_FOUND', 404);
      scenarios.set(browserId, createScenario(value));
      response.setHeader(
        'Set-Cookie',
        stateCookie + '=' + browserId + '; Path=/; HttpOnly; SameSite=Strict',
      );
      return empty();
    }
    if (!path.startsWith('/api/')) return next();

    const termsStatus = preview.termsAccepted
      ? baseTerms
      : { ...baseTerms, status: 'required', acceptedVersion: null, acceptedAt: null };
    if (path === '/api/session' && method === 'GET')
      return send(
        c.SessionResponseSchema,
        preview.loggedOut ? signedOut : { ...session, user: { ...session.user, termsStatus } },
      );
    if (path === '/api/session/logout' && method === 'POST') {
      preview.loggedOut = true;
      return empty();
    }
    if (path === '/api/terms/current' && method === 'GET')
      return reply(c.TermsDocumentResponseSchema, {
        documentId: baseTerms.documentId,
        version: baseTerms.requiredVersion,
        classification: baseTerms.classification,
        contentHash: baseTerms.contentHash,
        content:
          'These sample terms show how Darve presents creator setup. This preview uses fictional accounts and payments.',
      });
    if (path === '/api/terms/acceptance' && method === 'POST') {
      c.TermsAcceptanceInputSchema.parse(await readBody(request));
      preview.termsAccepted = true;
      return reply(c.TermsAcceptanceResponseSchema, baseTerms);
    }
    if (path === '/api/connections' && method === 'GET') {
      const connection = connectionFixture();
      connection.channels[0].displayName = streamer;
      const available = { available: true, reasonCode: null };
      return reply(
        c.ConnectionsResponseSchema,
        page([
          {
            ...connection,
            capabilities: {
              ...connection.capabilities,
              chatRead: available,
              liveContext: available,
            },
          },
        ]),
      );
    }
    if (path === '/api/connections/' + ids.connection + '/broadcasts' && method === 'GET')
      return send(c.BroadcastsResponseSchema, discoveryFixture());

    const payoutMatch = /^\/api\/payment-accounts\/(stripe|paypal)(?:\/(refresh))?$/.exec(path);
    if (payoutMatch && (method === 'GET' || (method === 'POST' && payoutMatch[2]))) {
      const provider = payoutMatch[1] as keyof typeof payoutSchemas;
      const payoutState =
        mode === 'pending' ? 'pending' : mode === 'attention' ? 'restricted' : 'ready';
      const ready = payoutState === 'ready';
      return reply(payoutSchemas[provider], {
        environment: 'test',
        state: payoutState,
        version: 2,
        country: 'PL',
        currencies: ready ? ['EUR', 'USD'] : [],
        observedAt: time(),
        validUntil: time(600_000),
        ...(provider === 'paypal' ? { walletActive: ready, cardsActive: false } : {}),
      });
    }

    const roundPath = '/api/rounds/' + ids.round;
    if (['/api/rounds/current', '/api/rounds/start-result'].includes(path) && method === 'GET')
      return reply(
        c.RoundRecoveryResponseSchema,
        preview.activeRound ? { roundId: ids.round } : null,
      );
    if (path === '/api/rounds' && method === 'POST') {
      const input = c.StartRoundInputSchema.parse(await readBody(request));
      preview.activeRound = 'collecting';
      return send(
        c.RoundResponseSchema,
        round(preview.activeRound, input.collectionDurationSeconds),
        202,
      );
    }
    if (path === roundPath && method === 'GET')
      return send(c.RoundResponseSchema, round(preview.activeRound ?? 'closed'));
    if (path === roundPath + '/collection/stop' && method === 'POST') {
      c.StopRoundInputSchema.parse(await readBody(request));
      preview.activeRound = 'closed';
      return send(c.RoundResponseSchema, round(preview.activeRound, 60, true), 202);
    }
    if (path === roundPath + '/analysis/events' && method === 'GET')
      return stream(
        response,
        analysisEvents(preview.activeRound === 'collecting')
          .map((event) => wire(c.AnalysisLiveEventSchema.parse(event)))
          .join(''),
      );
    if (path === roundPath + '/chat' && method === 'GET')
      return send(c.CollectionChatResponseSchema, {
        data: { roundId: ids.round, selection: null, notices: [] },
      });
    if (path === roundPath + '/suggestions' && method === 'GET')
      return reply(c.SuggestionPageResponseSchema, preview.ideas);
    if (path === '/api/rounds/acceptance-policy' && method === 'GET')
      return reply(c.ChallengeAcceptancePolicyResponseSchema, {
        policy: acceptancePolicyFixture(),
      });
    const ideaMatch =
      path.startsWith(roundPath + '/suggestions/') &&
      preview.ideas.items.find((item) =>
        path.startsWith(roundPath + '/suggestions/' + item.id + '/'),
      );
    if (ideaMatch && path.endsWith('/disposition') && method === 'PATCH') {
      const input = c.SuggestionDispositionInputSchema.parse(await readBody(request));
      Object.assign(ideaMatch, {
        pinned: input.pinned,
        dismissed: input.dismissed,
        version: ideaMatch.version + 1,
      });
      return reply(c.SuggestionResponseSchema, ideaMatch);
    }
    if (ideaMatch && path.endsWith('/accept') && method === 'POST') {
      const input = c.AcceptSuggestionInputSchema.parse(await readBody(request));
      ideaMatch.selectedChallengeId = reviewIds.challenge;
      return reply(
        c.AcceptSuggestionResponseSchema,
        {
          ...acceptedFixture(),
          suggestionId: ideaMatch.id,
          goal: input.goal,
          fundingDurationSeconds: input.fundingDurationSeconds,
          acceptedAt: time(),
          fundingDeadlineAt: time(input.fundingDurationSeconds * 1000),
        },
        201,
      );
    }

    const history = reportingChallenge();
    history.terms.text = 'Design a postcard from a fictional city';
    history.authors = [{ provider: 'twitch', displayName: 'mossandink' }];
    const challenge = challengeFixture();
    challenge.data.terms.text = titles[0]!;
    const accepted = preview.ideas.items.some((item) => item.selectedChallengeId);
    if (path === '/api/challenges' && method === 'GET')
      return reply(
        c.ChallengePageResponseSchema,
        page([history, ...(accepted ? [challenge.data] : [])]),
      );
    if (path === '/api/challenges/current' && method === 'GET')
      return reply(c.ChallengePageResponseSchema, page(accepted ? [challenge.data] : []));
    if (path === '/api/challenges/' + reportingIds.challenge && method === 'GET')
      return reply(c.ChallengeResponseSchema, history);
    if (path === '/api/challenges/' + reviewIds.challenge && method === 'GET')
      return reply(c.ChallengeResponseSchema, challenge.data);
    if (path === '/api/rounds/' + reportingIds.round + '/analytics' && method === 'GET')
      return reply(c.RoundAnalyticsResponseSchema, analyticsFixture());
    if (path === '/api/dashboard/summary' && method === 'GET') {
      const summary = dashboardFixture();
      summary.period.timeZone = url.searchParams.get('timeZone') ?? 'UTC';
      return reply(c.DashboardResponseSchema, summary);
    }

    if (path === '/api/overlay-preferences' && ['GET', 'PATCH'].includes(method)) {
      if (method === 'PATCH') {
        const input = c.OverlayPreferencesV2InputSchema.parse(await readBody(request));
        preview.preferences = {
          ...preview.preferences,
          styles: input.styles,
          version: preview.preferences.version + 1,
        };
      }
      return send(c.OverlayPreferencesV2ResponseSchema, {
        schemaVersion: 2,
        serverTime: time(),
        data: preview.preferences,
      });
    }
    if (path === '/api/overlay-grants' && method === 'POST')
      return reply(
        c.OverlayGrantIssuedResponseSchema,
        {
          id: grantId,
          displayId,
          selection: preview.selection,
          expiresAt: null,
          presentationUrl: origin + '/overlay/' + displayId + '#grant=' + 'd'.repeat(43),
        },
        201,
      );
    if (path === '/api/overlay-grants/' + grantId && method === 'DELETE') return empty();
    const display = '/api/overlay-displays/' + displayId;
    if (path === display && method === 'GET')
      return reply(c.OverlaySelectionResponseSchema, preview.selection);
    if (path === display + '/selection' && method === 'PUT') {
      const input = c.OverlaySelectionInputSchema.parse(await readBody(request));
      preview.selection = {
        displayId,
        roundId: input.roundId,
        challengeId: input.challengeId,
        version: preview.selection.version + 1,
      };
      return reply(c.OverlaySelectionResponseSchema, preview.selection);
    }
    const overlayPath = '/api/overlays/' + displayId;
    if (path === overlayPath + '/session' && method === 'POST') {
      c.OverlayBootstrapInputSchema.parse(await readBody(request));
      return reply(c.OverlayBootstrapResponseSchema, { displayId, grantId });
    }
    const overlayMode = mode === 'obs' || mode === 'demo' ? 'overlayFunding' : mode;
    if (path === overlayPath + '/snapshot' && method === 'GET')
      return send(
        c.OverlaySnapshotV2ResponseSchema,
        overlay(origin, overlayMode, preview.preferences),
      );
    if (path === overlayPath + '/events' && method === 'GET') {
      const frame = overlay(origin, overlayMode, preview.preferences);
      const initial = c.OverlayEventV2Schema.parse(makeEvent(frame, 'resync_required'));
      return stream(response, wireEvent(initial));
    }

    const publicPath = '/api/public/challenges/' + contributionIds.public;
    if (path === publicPath && method === 'GET')
      return reply(c.PublicChallengeResponseSchema, publicChallenge(origin, 'contribution'));
    if (path === publicPath + '/checkouts' && method === 'POST') {
      const input = c.CheckoutInputSchema.parse(await readBody(request));
      preview.startedReceipt = c.CheckoutResponseSchema.parse(
        envelope(receipt(contributionIds.checkout, input)),
      ).data;
      return reply(c.CheckoutResponseSchema, preview.startedReceipt, 201);
    }
    for (const checkout of [contributionIds.checkout, contributionIds.payment]) {
      if (
        (path === '/api/checkouts/' + checkout && method === 'GET') ||
        (path === '/api/checkouts/' + checkout + '/resume' && method === 'POST')
      )
        return reply(
          c.CheckoutResponseSchema,
          checkout === contributionIds.checkout && preview.startedReceipt
            ? preview.startedReceipt
            : receipt(checkout),
        );
    }

    if (path === '/api/coins/account' && method === 'GET')
      return reply(c.coinEnvelope(c.CoinCreatorAccountDataSchema), {
        balance: '180',
        spendableBalance: '180',
        revision: 2,
        state: 'synchronized',
        redemptionAllowed: true,
      });
    if (path === '/api/coins/missions' && method === 'GET')
      return reply(c.coinEnvelope(c.CoinMissionsDataSchema), {
        progress: 11,
        progressCap: 1000,
        missions: c.CoinMissionSchema.options.map((id, index) => ({
          id,
          completed: index < 2,
          earned: index < 2 ? (index === 0 ? '60' : '120') : null,
          completedAt: index < 2 ? time(-86_400_000) : null,
          currentReward: ['60', '120', '20', '40', '100', '500'][index],
        })),
      });
    if (path === '/api/coins/ledger' && method === 'GET')
      return reply(
        c.coinPage(c.CoinLedgerItemSchema),
        page(
          [2, 1].map((revision) => ({
            id: '0000000' + revision + '-1234-4234-8234-112233445566',
            revision,
            delta: revision === 2 ? '120' : '60',
            balance: revision === 2 ? '180' : '60',
            kind: 'mission',
            createdAt: time(-revision * 30_000),
          })),
        ),
      );
    if (['/api/templates', '/api/template-entitlements'].includes(path) && method === 'GET') {
      const free = {
        id: 'standalone',
        displayName: 'Standalone',
        assetVersion: 1,
        priceRevision: 1,
        amount: '0',
        available: true,
        owned: true,
        ownershipState: 'owned',
      };
      const premium = {
        ...free,
        id: 'darve_compact',
        displayName: 'Darve Compact',
        amount: '75',
        owned: false,
        ownershipState: 'not_owned',
      };
      return reply(c.coinEnvelope(c.CoinCatalogueDataSchema), {
        templates: path.endsWith('/templates') ? [free, premium] : [free],
      });
    }
    if (path === '/api/template-preferences' && method === 'GET')
      return reply(c.coinEnvelope(c.TemplateSelectionSchema), preview.preferences.template);

    if (path === '/api/support/tickets' && method === 'GET')
      return reply(c.SupportTicketPageResponseSchema, page([supportTicket]));
    const ticketPath = '/api/support/tickets/' + supportTicket.id;
    if (path === ticketPath && method === 'GET')
      return reply(c.SupportTicketResponseSchema, supportTicket);
    if (path === ticketPath + '/events' && method === 'GET') return stream(response, '');
    if (path === ticketPath + '/messages' && method === 'GET')
      return reply(
        c.SupportMessagePageResponseSchema,
        page([
          {
            ...support.message(1),
            body: 'How can I change the corner where my challenge appears?',
          },
          {
            ...support.message(2),
            body: 'Open OBS settings and pick a position under Display appearance. You can preview it before going live.',
          },
        ]),
      );
    return failure('NOT_FOUND', 404);
  }

  return {
    name: 'darve-design-preview',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void handle(request, response, next).catch((error: unknown) => {
          const issues =
            error instanceof Error && 'issues' in error && Array.isArray(error.issues)
              ? error.issues
                  .map((issue: { path: PropertyKey[] }) => issue.path.join('.'))
                  .join(', ')
              : 'request handling';
          server.config.logger.error('Design fixture failed validation (' + issues + ').');
          if (!response.headersSent) response.writeHead(500);
          response.end();
        });
      });
    },
    transformIndexHtml(_html, context) {
      if (!['index.html', 'overlay.html'].includes(basename(context.filename))) return [];
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: '/tools/design/switcher.ts' },
          injectTo: 'body',
        },
      ];
    },
  };
}
