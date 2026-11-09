import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import {
  createOverlayOwner,
  copyOverlayAccessLink,
  overlayMessage,
  type Preferences,
  type Selection,
} from '@/services/overlay/index';
import { createReportingClient } from '@/services/reporting/index';
import { OverlayParamsSchema } from '@/services/contracts/index';
import type { CreatorSession } from '@/services/creator-session/index';
import './settings.css';

export function OverlaySettings({
  session,
  displayId,
  onDisplay,
}: {
  session: CreatorSession;
  displayId: string | null;
  onDisplay: (id: string) => void;
}) {
  const [client] = useState(() => createOverlayOwner(session)),
    [historyClient] = useState(() => createReportingClient(session));
  const [link, setLink] = useState<string | null>(null),
    [showLink, setShowLink] = useState(false),
    [grantId, setGrantId] = useState(''),
    [knownDisplay, setKnownDisplay] = useState('');
  const [busy, setBusy] = useState(false),
    [problem, setProblem] = useState<unknown>(null),
    [notice, setNotice] = useState(''),
    [issueAttempted, setIssueAttempted] = useState(false);
  const [issueReviewed, setIssueReviewed] = useState(false),
    [revokeReviewed, setRevokeReviewed] = useState(false);
  const [pick, setPick] = useState<{
      displayId: string;
      roundId: string | null;
      challengeId: string | null;
      expectedVersion: number;
    } | null>(null),
    [selectionReviewed, setSelectionReviewed] = useState(false),
    [roundId, setRoundId] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(),
    scope = session.getSnapshot().scope;
  const selection = useQuery(
    {
      queryKey: scope.key(['overlay-selection', displayId]),
      enabled: !!displayId,
      queryFn: ({ signal }) => client.selection(displayId!, signal),
      retry: false,
    },
    scope.queryClient,
  );
  const preferences = useQuery(
    {
      queryKey: scope.key(['overlay-preferences']),
      queryFn: ({ signal }) => client.preferences(signal),
      retry: false,
    },
    scope.queryClient,
  );
  const history = useQuery(
    {
      queryKey: scope.key(['overlay-challenges', cursor]),
      queryFn: ({ signal }) => historyClient.history(false, cursor ?? null, signal),
      retry: false,
    },
    scope.queryClient,
  );
  const currentSelection = selection.isSuccess && !selection.isFetching ? selection.data : null;
  const currentPreferences =
    preferences.isSuccess && !preferences.isFetching ? preferences.data : null;
  const currentHistory = history.isSuccess && !history.isFetching ? history.data.data : null;
  const currentPick =
    pick &&
    currentSelection &&
    pick.displayId === displayId &&
    pick.expectedVersion === currentSelection.version &&
    (!pick.challengeId ||
      currentHistory?.items.some(
        (challenge) =>
          challenge.id === pick.challengeId &&
          challenge.roundId === pick.roundId &&
          challenge.contentAvailability === 'available',
      ))
      ? pick
      : null;
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setNotice('');
    try {
      await action();
    } catch (error) {
      setProblem(error);
    } finally {
      if (!scope.signal.aborted) setBusy(false);
    }
  };
  const refresh = async () => {
    setPick(null);
    setSelectionReviewed(false);
    setNotice('');
    await Promise.all([
      displayId ? selection.refetch() : undefined,
      preferences.refetch(),
      history.refetch(),
    ]);
  };
  const choose = (value: { roundId: string | null; challengeId: string | null }) => {
    if (!currentSelection || currentSelection.displayId !== displayId) return;
    setPick({
      ...value,
      displayId: currentSelection.displayId,
      expectedVersion: currentSelection.version,
    });
    setSelectionReviewed(false);
  };
  return (
    <div className="obs-settings">
      <header>
        <p className="workspace-eyebrow">Broadcast</p>
        <h1>OBS display</h1>
        <p>Choose what viewers see and manage private access to your broadcast card.</p>
      </header>
      <section className="obs-settings-section">
        <h2>Browser source access</h2>
        <p>
          Create a private link once, then paste that original link into OBS. Keep it private. A URL
          ending in grantId only works in a browser that already has its access cookie.
        </p>
        <label className="obs-check">
          <input
            type="checkbox"
            checked={issueReviewed}
            disabled={busy || issueAttempted}
            onChange={(e) => setIssueReviewed(e.target.checked)}
          />
          I understand this read-only link can display my selected challenge until revoked.
        </label>
        <Button
          disabled={!issueReviewed || issueAttempted || busy}
          aria-busy={busy}
          onClick={() =>
            void run(async () => {
              setIssueAttempted(true);
              const result = await client.issue();
              if (scope.signal.aborted) return;
              setLink(result.presentationUrl);
              setShowLink(false);
              setGrantId(result.id);
              onDisplay(result.displayId);
              setNotice(
                'Private link created. Copy it into OBS now; it is not saved in this page.',
              );
            })
          }
        >
          Create private OBS link
        </Button>
        {link && (
          <div>
            <label>
              Private browser-source URL
              <input
                aria-label="Private browser-source URL"
                type={showLink ? 'text' : 'password'}
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
              />
              <span>
                Use Copy private OBS link, then paste into the Browser Source URL field. Keep the
                complete value private.
              </span>
            </label>
            <Button
              tone="secondary"
              onClick={() =>
                void copyOverlayAccessLink(link).then((copied) => {
                  if (!scope.signal.aborted)
                    setNotice(
                      copied
                        ? 'Private OBS link copied. Paste it into the Browser Source URL field.'
                        : 'Clipboard access is unavailable. Show the private link, select its complete value and copy it manually.',
                    );
                })
              }
            >
              Copy private OBS link
            </Button>
            <Button
              tone="quiet"
              aria-pressed={showLink}
              onClick={() => setShowLink((value) => !value)}
            >
              {showLink ? 'Hide private link' : 'Show private link'}
            </Button>
          </div>
        )}
        <p>
          In OBS: add a Browser Source, use a 1920 × 1080 canvas (or 1280 × 720), and paste the
          private URL. Keep the background transparent. Hide/unload or scene-refresh must reconnect
          to the current selection.
        </p>
        <div className="obs-inline">
          <label>
            Known grant ID to revoke
            <input
              value={grantId}
              onChange={(e) => {
                setGrantId(e.target.value);
                setRevokeReviewed(false);
              }}
              disabled={busy}
            />
          </label>
          <label className="obs-check">
            <input
              type="checkbox"
              checked={revokeReviewed}
              onChange={(e) => setRevokeReviewed(e.target.checked)}
              disabled={busy}
            />
            Revoke this link's access, including its active OBS source.
          </label>
          <Button
            tone="secondary"
            disabled={
              busy || !revokeReviewed || !OverlayParamsSchema.safeParse({ id: grantId }).success
            }
            onClick={() =>
              void run(async () => {
                setLink(null);
                await client.revoke(grantId);
                setNotice('This grant is revoked. Its source can no longer read the display.');
                setRevokeReviewed(false);
              })
            }
          >
            Revoke OBS link
          </Button>
        </div>
      </section>
      <section className="obs-settings-section">
        <h2>Display selection</h2>
        <p>
          A new collection selects its preparing round on the server. Showing an accepted challenge
          is a separate choice and never moves contributions between challenges.
        </p>
        {!displayId && (
          <div className="obs-inline">
            <label>
              Existing display ID
              <input value={knownDisplay} onChange={(e) => setKnownDisplay(e.target.value)} />
            </label>
            <Button
              tone="secondary"
              disabled={!OverlayParamsSchema.safeParse({ id: knownDisplay }).success}
              onClick={() => onDisplay(knownDisplay.toLowerCase())}
            >
              Load existing display
            </Button>
            <p>
              If you have no display ID, create the private source link above. Loading does not
              create a link.
            </p>
          </div>
        )}
        {displayId && selection.isFetching && (
          <p role="status">Checking current display selection…</p>
        )}
        {displayId && selection.isError && (
          <p role="alert">
            Display selection is unavailable. Refresh before reviewing another change.
          </p>
        )}
        {currentSelection && (
          <>
            <SelectionRead selection={currentSelection} />
            <p>
              <a href={'/dashboard?displayId=' + currentSelection.displayId}>
                View this display on the dashboard
              </a>
            </p>
          </>
        )}
        <Button
          tone="secondary"
          disabled={busy || selection.isFetching || preferences.isFetching || history.isFetching}
          onClick={() => void refresh()}
        >
          Refresh display and settings
        </Button>
        {displayId && currentSelection && (
          <>
            <Button
              tone="quiet"
              disabled={busy}
              onClick={() => choose({ roundId: null, challengeId: null })}
            >
              Show idle display
            </Button>
            <div className="obs-inline">
              <label>
                Known collection round ID
                <input
                  value={roundId}
                  onChange={(e) => setRoundId(e.target.value)}
                  disabled={busy}
                />
              </label>
              <Button
                tone="secondary"
                disabled={busy || !OverlayParamsSchema.safeParse({ id: roundId }).success}
                onClick={() => choose({ roundId: roundId.toLowerCase(), challengeId: null })}
              >
                Review round selection
              </Button>
            </div>
            <h3>Accepted challenges</h3>
            {history.isFetching && <p role="status">Checking available challenges…</p>}
            {history.isError && (
              <p role="alert">Challenges are unavailable. Refresh before reviewing a challenge.</p>
            )}
            {currentHistory?.items.length === 0 && <p>No accepted challenges on this page.</p>}
            <ul className="obs-challenges">
              {currentHistory?.items.map((challenge) => (
                <li key={challenge.id}>
                  <div>
                    <strong>
                      {challenge.contentAvailability === 'available'
                        ? challenge.terms.text
                        : 'Unavailable challenge'}
                    </strong>
                    <p>
                      {challenge.terms.goal.currency} · {challenge.funding.state} ·{' '}
                      {challenge.performance.state.replaceAll('_', ' ')}
                    </p>
                  </div>
                  <Button
                    tone="secondary"
                    disabled={busy || challenge.contentAvailability !== 'available'}
                    onClick={() =>
                      choose({ roundId: challenge.roundId, challengeId: challenge.id })
                    }
                  >
                    Review for display
                  </Button>
                </li>
              ))}
            </ul>
            {currentHistory?.nextCursor && (
              <Button
                tone="secondary"
                disabled={busy}
                onClick={() => setCursor(currentHistory.nextCursor!)}
              >
                Next challenges
              </Button>
            )}
            {cursor && (
              <Button tone="quiet" onClick={() => setCursor(undefined)}>
                First challenges
              </Button>
            )}
            {currentPick && (
              <div className="obs-selection-review">
                <h3>Confirm display change</h3>
                <p>
                  {currentPick.challengeId
                    ? `Selected challenge: ${currentPick.challengeId}`
                    : currentPick.roundId
                      ? `Selected round: ${currentPick.roundId}`
                      : 'The display will be idle.'}
                </p>
                <label className="obs-check">
                  <input
                    type="checkbox"
                    checked={selectionReviewed}
                    disabled={busy}
                    onChange={(e) => setSelectionReviewed(e.target.checked)}
                  />
                  Show this selection using the current display version.
                </label>
                <Button
                  disabled={!selectionReviewed || busy}
                  onClick={() =>
                    void run(async () => {
                      setPick(null);
                      setSelectionReviewed(false);
                      try {
                        await client.select(currentPick.displayId, {
                          roundId: currentPick.roundId,
                          challengeId: currentPick.challengeId,
                          expectedVersion: currentPick.expectedVersion,
                        });
                      } finally {
                        await selection.refetch();
                      }
                      setNotice('Display selection confirmed.');
                    })
                  }
                >
                  Confirm display selection
                </Button>
              </div>
            )}
          </>
        )}
      </section>
      {preferences.isFetching && <p role="status">Checking display appearance…</p>}
      {preferences.isError && (
        <p role="alert">Display appearance is unavailable. Refresh before editing settings.</p>
      )}
      {currentPreferences && (
        <StyleForm
          key={currentPreferences.version}
          value={currentPreferences}
          busy={busy}
          save={(value) =>
            void run(async () => {
              await client.save(value);
              await preferences.refetch();
              setNotice('Display settings confirmed.');
            })
          }
        />
      )}
      {problem ? <p role="alert">{overlayMessage(problem)}</p> : null}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
function SelectionRead({ selection }: { selection: Selection }) {
  return (
    <p>
      Current display:{' '}
      {selection.challengeId
        ? `challenge ${selection.challengeId}`
        : selection.roundId
          ? `round ${selection.roundId}`
          : 'idle'}{' '}
      · version {selection.version}
    </p>
  );
}
function StyleForm({
  value,
  busy,
  save,
}: {
  value: Preferences;
  busy: boolean;
  save: (value: unknown) => void;
}) {
  const [styles, setStyles] = useState(value.styles),
    [reviewed, setReviewed] = useState(false);
  return (
    <section className="obs-settings-section">
      <h2>Position and appearance</h2>
      <p>
        Template: {value.template.templateId}
        {value.template.available ? '' : ' (unavailable)'}. Template purchases and selection belong
        to the template library.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({ expectedVersion: value.version, styles });
        }}
      >
        <div className="obs-style-grid">
          <label>
            Position
            <select
              value={styles.position}
              disabled={busy}
              onChange={(e) => {
                setReviewed(false);
                setStyles({ ...styles, position: e.target.value as typeof styles.position });
              }}
            >
              {(['bottom_left', 'bottom_right', 'top_left', 'top_right'] as const).map(
                (position) => (
                  <option key={position} value={position}>
                    {position.replaceAll('_', ' ')}
                  </option>
                ),
              )}
            </select>
          </label>
          {(['scale', 'opacity', 'marginX', 'marginY'] as const).map((name) => (
            <label key={name}>
              {
                {
                  scale: 'Scale',
                  opacity: 'Opacity',
                  marginX: 'Horizontal margin (px)',
                  marginY: 'Vertical margin (px)',
                }[name]
              }
              <input
                type="number"
                required
                value={styles[name]}
                min={name === 'scale' ? 0.25 : 0}
                max={
                  name === 'scale' ? 2 : name === 'opacity' ? 1 : name === 'marginX' ? 1920 : 1080
                }
                step={name === 'scale' || name === 'opacity' ? 0.05 : 1}
                disabled={busy}
                onChange={(e) => {
                  setReviewed(false);
                  setStyles({ ...styles, [name]: e.target.valueAsNumber });
                }}
              />
            </label>
          ))}
        </div>
        <label className="obs-check">
          <input
            type="checkbox"
            checked={reviewed}
            disabled={busy}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          Apply these settings to the current broadcast display.
        </label>
        <Button type="submit" disabled={busy || !reviewed}>
          Save display settings
        </Button>
      </form>
    </section>
  );
}
