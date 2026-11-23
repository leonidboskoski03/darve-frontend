import { useEffect, useMemo, useState } from 'react';
import { OverlayDisplay } from '@/features/overlay-display/index';
import { registeredTemplates } from '@/entities/overlay-template/index';
import { OverlaySnapshotV2ResponseSchema } from '@/services/contracts/index';
import type { OverlayReader } from '@/services/overlay/index';
import './showcase.css';

/*
 * Local OBS template showcase with invented data only. It feeds contract-valid
 * frames to the real OBS display, so every template renders exactly as it would
 * on stream. Query: ?template=<id>&scene=<auto|collecting|funding|funded|complete>
 * and controls=0 for a clean transparent OBS browser source.
 */
type Scene = 'collecting' | 'funding' | 'funded' | 'complete';
const scenes: Scene[] = ['collecting', 'funding', 'funded', 'complete'];
const ids = {
  display: '11223344-1234-4234-8234-112233445566',
  round: '22334455-1234-4234-8234-112233445566',
  challenge: '33445566-1234-4234-8234-112233445566',
  terms: '44556677-1234-4234-8234-112233445566',
  declaration: '55667788-1234-4234-8234-112233445566',
};
const goalMinor = 2500;
const contributionUrl = 'https://darve.example/contribute/showcase';

function frame(templateId: string, scene: Scene, eligibleMinor: number, version: number) {
  const entry = registeredTemplates().find((value) => value.id === templateId)!;
  const now = new Date();
  const iso = (seconds: number) => new Date(now.getTime() + seconds * 1000).toISOString();
  const funded = scene === 'funded' || scene === 'complete';
  const eligible = String(funded ? goalMinor : eligibleMinor);
  const challenge =
    scene === 'collecting'
      ? null
      : {
          publicId: ids.challenge,
          creator: { displayName: 'Showcase creator' },
          acceptedAt: iso(-30),
          contentAvailability: 'available',
          terms: {
            version: ids.terms,
            text: 'Win the next round using only the pistol while chat picks the map',
            goal: { amountMinor: String(goalMinor), currency: 'EUR' },
            fundingDurationSeconds: 600,
            fundingClosesAt: iso(540),
            performanceRule: 'current_stream',
            policyVersion: 'showcase',
          },
          authors: [
            { provider: 'twitch', displayName: 'pixel_rider' },
            { provider: 'twitch', displayName: 'nightowl' },
          ],
          funding: {
            version: 3,
            revision: version,
            state: funded ? 'funded' : 'pending',
            confirmedGross: eligible,
            eligibleGross: eligible,
            lateGross: '0',
            unclassifiedGross: '0',
            surplusGross: '0',
            refundedGross: '0',
            reversedGross: '0',
            adjustedGross: '0',
            remainingContributions: eligible,
            adjustmentInconsistent: false,
            goalReachedAt: funded ? iso(-5) : null,
            pendingCheckoutCount: 0,
            reconciliationStatus: 'clear',
            reviewDueAt: iso(1140),
            financialReviewRequired: false,
            timingPolicyVersion: 'funding-v1',
            checkoutAvailability: { available: false, reasonCode: 'payments_unconfigured' },
          },
          performance:
            scene === 'complete'
              ? {
                  version: 1,
                  revision: 2,
                  state: 'declared_complete',
                  startedAt: null,
                  declarationId: ids.declaration,
                  declaredAt: iso(-1),
                  verification: 'streamer_declaration',
                  streamContextStatus: 'confirmed_original_broadcast',
                }
              : {
                  version: 1,
                  revision: 1,
                  state: funded ? 'awaiting_performance' : 'awaiting_funding',
                  startedAt: null,
                  declarationId: null,
                  declaredAt: null,
                  verification: 'streamer_declaration',
                  streamContextStatus: 'unobserved',
                },
          checkoutAvailability: { available: false, reasonCode: 'payments_unconfigured' },
          availablePaymentProviders: ['stripe', 'paypal'].map((provider) => ({
            provider,
            availability: { available: false, reasonCode: 'payments_unconfigured' },
          })),
          contributionUrl,
        };
  return OverlaySnapshotV2ResponseSchema.parse({
    schemaVersion: 2,
    serverTime: now.toISOString(),
    data: {
      id: ids.display,
      version,
      bindingVersion: 1,
      presentationState: scene === 'collecting' ? 'collecting' : 'accepted',
      roundId: ids.round,
      challengeId: challenge ? ids.challenge : null,
      collectionClosesAt: scene === 'collecting' ? iso(45) : null,
      challenge,
      qrPayload: challenge ? contributionUrl : null,
      ...(scene === 'collecting' ? { reviewState: 'collecting' } : {}),
      preferences: {
        version: 1,
        styles: { position: 'bottom_left', scale: 1, opacity: 1, marginX: 32, marginY: 32 },
        template: {
          revision: 1,
          templateId: entry.id,
          assetVersion: entry.version,
          available: true,
          renderer: { key: entry.key, hash: entry.hash },
        },
      },
    },
  }).data;
}

/** In-memory reader with the same surface the real OBS display subscribes to. */
function createShowcaseReader() {
  const listeners = new Set<() => void>();
  let value = { phase: 'live', error: null, snapshot: null, presentation: null } as ReturnType<
    OverlayReader['getSnapshot']
  >;
  return {
    reader: {
      getSnapshot: () => value,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      start() {},
      dispose() {
        listeners.clear();
      },
    } as unknown as OverlayReader,
    publish(
      data: ReturnType<typeof frame>,
      seconds: { collection: number | null; funding: number | null },
    ) {
      value = {
        phase: 'live',
        error: null,
        snapshot: data,
        presentation: {
          fresh: true,
          collectionSeconds: seconds.collection,
          fundingSeconds: seconds.funding,
          qrPayload: data.qrPayload,
        },
      };
      for (const listener of listeners) listener();
    },
  };
}

export function Showcase() {
  const params = new URLSearchParams(window.location.search);
  const templates = registeredTemplates();
  const [templateId, setTemplateId] = useState(
    templates.some((value) => value.id === params.get('template'))
      ? params.get('template')!
      : 'neon_pulse',
  );
  const requested = params.get('scene');
  const [auto, setAuto] = useState(!scenes.includes(requested as Scene));
  const [scene, setScene] = useState<Scene>(
    scenes.includes(requested as Scene) ? (requested as Scene) : 'collecting',
  );
  const [tick, setTick] = useState(0);
  const controls = params.get('controls') !== '0';
  const showcase = useMemo(() => createShowcaseReader(), []);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  // Auto mode: 8 s collecting, 14 s of money arriving, 6 s funded, 6 s complete.
  const cycle = tick % 34;
  const current: Scene = auto
    ? cycle < 8
      ? 'collecting'
      : cycle < 22
        ? 'funding'
        : cycle < 28
          ? 'funded'
          : 'complete'
    : scene;
  const step = auto ? Math.min(Math.floor((cycle - 8) / 3.5), 3) : Math.floor(tick / 3) % 4;
  const eligible = [400, 900, 1500, 2100][Math.max(step, 0)]!;

  useEffect(() => {
    showcase.publish(frame(templateId, current, eligible, tick + 1), {
      collection: current === 'collecting' ? Math.max(45 - (auto ? cycle : tick % 45), 0) : null,
      funding: current === 'collecting' ? null : 540 - (tick % 540),
    });
  }, [showcase, templateId, current, eligible, tick, auto, cycle]);

  return (
    <div className={controls ? 'showcase showcase-framed' : 'showcase'}>
      {controls && (
        <header className="showcase-controls" aria-label="Template showcase controls">
          <strong>OBS template showcase · invented data</strong>
          <div role="group" aria-label="Template">
            {templates.map((value) => (
              <button
                key={value.id}
                type="button"
                aria-pressed={value.id === templateId}
                onClick={() => setTemplateId(value.id)}
              >
                {value.name}
                {value.experimental ? ' (experimental)' : ''}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Scene">
            <button type="button" aria-pressed={auto} onClick={() => setAuto(true)}>
              Auto play
            </button>
            {scenes.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={!auto && value === scene}
                onClick={() => {
                  setAuto(false);
                  setScene(value);
                }}
              >
                {value}
              </button>
            ))}
          </div>
        </header>
      )}
      <OverlayDisplay key={templateId} reader={showcase.reader} />
    </div>
  );
}
