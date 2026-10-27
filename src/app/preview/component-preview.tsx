import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Brand } from '@/design-system/brand';
import { Button } from '@/design-system/button';
import { ActionLink } from '@/design-system/action-link';
import { TextField } from '@/design-system/text-field';
import { Panel } from '@/design-system/panel';
import { StatusBadge } from '@/design-system/status-badge';
import { ContentState } from '@/design-system/content-state';
import { LoadingState } from '@/design-system/loading-state';
import { Dialog } from '@/design-system/dialog';

/** Isolated local fixture. Not imported by the product entry or production router. */
export function ComponentPreview() {
  const [open, setOpen] = useState(false);
  const [light, setLight] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="component-preview" data-color-scheme={light ? 'light' : 'dark'}>
      <a className="skip-link" href="#preview-main">
        Skip to components
      </a>
      <header className="preview-header">
        <Brand />
        <Button tone="secondary" onClick={() => setLight(!light)}>
          {light ? 'Use dark canvas' : 'Use light canvas'}
        </Button>
      </header>
      <main id="preview-main" tabIndex={-1} className="preview-main">
        <div className="preview-intro">
          <p>Design system · F01-02</p>
          <h1>Component reference</h1>
          <p>
            Darve’s visual foundations, taken from the standalone source. Local examples only; these
            controls do not connect accounts or send requests.
          </p>
        </div>
        <div className="preview-grid">
          <Panel
            title="Actions"
            description="Primary, secondary, quiet and destructive commands; navigation stays a link."
          >
            <div className="preview-actions">
              <Button onClick={() => setOpen(true)}>Open dialog</Button>
              <Button tone="secondary">Secondary action</Button>
              <Button tone="quiet">Quiet action</Button>
              <Button tone="danger">Destructive example</Button>
              <Button disabled>Unavailable action</Button>
              <Button busy>Pending action</Button>
              <ActionLink href="#states" tone="secondary">
                Go to content states <ArrowUpRight size={16} aria-hidden="true" />
              </ActionLink>
            </div>
          </Panel>
          <Panel
            title="Fields"
            description="Explicit labels, help and error descriptions; native input behavior."
          >
            <form
              className="preview-stack"
              onSubmit={(event) => {
                event.preventDefault();
                setError(true);
              }}
            >
              <TextField
                name="example"
                label="Example title"
                required
                hint="Preview text stays in this page."
                placeholder="Enter a title"
                error={error ? 'This example demonstrates a validation message.' : undefined}
              />
              <TextField label="Read-only value" readOnly value="Reference only" />
              <TextField label="Unavailable field" disabled placeholder="Not available" />
              <div className="preview-actions">
                <Button type="button" tone="secondary" onClick={() => setError(!error)}>
                  {error ? 'Clear example error' : 'Show example error'}
                </Button>
              </div>
            </form>
          </Panel>
          <Panel
            title="Statuses"
            description="Every state has visible wording; colour adds emphasis."
          >
            <div className="preview-actions">
              <StatusBadge>Unknown</StatusBadge>
              <StatusBadge tone="info">Preparing</StatusBadge>
              <StatusBadge tone="success">Ready</StatusBadge>
              <StatusBadge tone="warning">Needs attention</StatusBadge>
              <StatusBadge tone="danger">Unavailable</StatusBadge>
            </div>
          </Panel>
          <Panel
            title="Loading"
            description="An announced loading label with decorative, static skeletons."
          >
            <LoadingState label="Loading preview content…" />
          </Panel>
          <Panel title="Empty" id="states">
            <ContentState kind="empty" title="No items yet">
              <p>Useful guidance belongs here when a list is genuinely empty.</p>
            </ContentState>
          </Panel>
          <Panel title="Unavailable">
            <ContentState kind="unavailable" title="Availability is unknown">
              <p>Show uncertainty explicitly while the source is unavailable.</p>
            </ContentState>
          </Panel>
          <Panel title="Error">
            <ContentState
              kind="error"
              title="This view could not load"
              action={
                <Button tone="secondary" onClick={() => setOpen(true)}>
                  View recovery example
                </Button>
              }
            >
              <p>Recovery actions are chosen by the feature, including whether retry is safe.</p>
            </ContentState>
          </Panel>
          <Panel
            title="Long content"
            description="Names, amounts and translated text must wrap instead of hiding meaningful content."
          >
            <p className="preview-long">
              An unusually long challenge description with a creator name: Łukasz — Μαρία — 視聴者 —{' '}
              {`longname`.repeat(12)}
            </p>
            <p className="preview-number">1,234,567,890.12 EUR</p>
            <Button tone="secondary">
              A longer translated action label that remains readable on a narrow screen
            </Button>
          </Panel>
        </div>
        <Dialog
          open={open}
          title="Review the example"
          description="This dialog demonstrates keyboard focus, Escape and return focus. Closing it does not submit a request."
          onDismiss={() => setOpen(false)}
        >
          <div className="preview-stack">
            <TextField
              label="Example note"
              hint="The label and hint remain available to assistive technology."
            />
            <div className="preview-actions">
              <Button onClick={() => setOpen(false)}>Close example</Button>
            </div>
          </div>
        </Dialog>
      </main>
      <footer className="preview-footer">
        Local component reference · Standalone source identity · No API
      </footer>
    </div>
  );
}
