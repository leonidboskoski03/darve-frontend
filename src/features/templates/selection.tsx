import { useEffect, useRef, useState } from 'react';
import { Button } from '@/design-system/button';
import { Panel } from '@/design-system/panel';
import { catalogueTemplate, resolveOverlayTemplate } from '@/entities/overlay-template/index';
import type {
  TemplateSelectionClient,
  TemplateSelectionState,
  TemplateResources,
} from '@/services/templates/index';
type Value = Awaited<ReturnType<TemplateSelectionClient['read']>>;
function Review({
  client,
  state,
}: {
  client: TemplateSelectionClient;
  state: TemplateSelectionState;
}) {
  const [confirmed, setConfirmed] = useState(false),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const sending = state.phase === 'sending';
  return (
    <section className="template-review" aria-labelledby="template-selection-review">
      <h3 id="template-selection-review" ref={heading} tabIndex={-1}>
        Review OBS template
      </h3>
      <p>
        Use {state.attempt!.name} for your OBS displays. This changes the card’s look; the selected
        challenge, position, size and private links stay the same.
      </p>
      <label className="template-confirmation">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={sending}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>I want to use this owned template for my OBS displays.</span>
      </label>
      <div className="templates-actions">
        <Button
          disabled={!confirmed || sending}
          onClick={() => {
            void client.select(confirmed).catch(() => undefined);
          }}
        >
          {sending ? 'Saving template…' : 'Use this template'}
        </Button>
        <Button tone="quiet" disabled={sending} onClick={() => client.cancel()}>
          Cancel selection
        </Button>
      </div>
    </section>
  );
}
export function TemplateSelection({
  client,
  state,
  value,
  resources,
  fetching,
  error,
  refresh,
  redemptionHeld,
}: {
  client: TemplateSelectionClient;
  state: TemplateSelectionState;
  value: Value | undefined;
  resources: TemplateResources | undefined;
  fetching: boolean;
  error: boolean;
  refresh: () => void;
  redemptionHeld: boolean;
}) {
  const available = resources?.catalogue.data.templates.filter(
    (item) =>
      item.available &&
      resources.entitlements.data.templates.some(
        (owned) => owned.id === item.id && owned.ownershipState === 'owned',
      ) &&
      catalogueTemplate(item.id, item.assetVersion),
  );
  const current = value ? resolveOverlayTemplate(value.data) : null;
  return (
    <Panel
      title="OBS template"
      description="Use a verified owned template. Layout and challenge selection are separate."
    >
      {value && !error ? (
        <>
          <p>
            Selected:{' '}
            <strong>
              {catalogueTemplate(value.data.templateId, value.data.assetVersion)?.name ??
                value.data.templateId}
            </strong>
          </p>
          {!current && (
            <p className="templates-warning" role="status">
              The selected template is unavailable or unsupported by this build. OBS hides it.
              Select an available supported template to restore the card.
            </p>
          )}
        </>
      ) : (
        <p role={error ? 'alert' : 'status'}>
          {error
            ? 'The current template could not be verified. Refresh before selecting.'
            : 'Checking the selected OBS template…'}
        </p>
      )}
      {state.phase === 'unconfirmed' && (
        <p role="status">
          Selection result unconfirmed. Refresh the selected template before making a new decision.
          This request will not be replayed automatically.
        </p>
      )}
      {state.phase === 'checked' && (
        <p role="status">
          Current selection checked. If you still want a different template, review a new selection
          using the latest version.
        </p>
      )}
      {state.phase === 'confirmed' && <p role="status">Template selection verified.</p>}
      {state.attempt && ['review', 'sending'].includes(state.phase) && (
        <Review key={state.attempt.input.templateId + state.phase} client={client} state={state} />
      )}
      <div className="templates-actions">
        {available
          ?.filter((item) => item.id !== value?.data.templateId)
          .map((item) => (
            <Button
              key={item.id}
              tone="secondary"
              disabled={fetching || error || !value || Boolean(state.attempt) || redemptionHeld}
              onClick={() => {
                if (resources && value) client.prepare(resources, value, item.id);
              }}
            >
              Select {item.displayName}
            </Button>
          ))}
        <Button tone="quiet" disabled={fetching || state.phase === 'sending'} onClick={refresh}>
          Refresh selected template
        </Button>
      </div>
    </Panel>
  );
}
