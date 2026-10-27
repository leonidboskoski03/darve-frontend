import { useState } from 'react';
import { Button } from '@/design-system/button';
import { Panel } from '@/design-system/panel';
import { ContentState } from '@/design-system/content-state';
import { Presence } from '@/motion/presence';
import { LayoutList } from '@/motion/layout-list';
import { SequenceReveal } from '@/motion/sequence-reveal';

/** Local state exercises presentation/lifecycle only; ordering is not a backend command. */
export function MotionPreview() {
  const [visible, setVisible] = useState(true);
  const [reverse, setReverse] = useState(false);
  const [reveal, setReveal] = useState(true);
  const samples = [
    {
      id: 'alpha',
      content: (
        <Button tone="secondary" onClick={() => setReverse(!reverse)}>
          Move Alpha sample
        </Button>
      ),
    },
    {
      id: 'beta',
      content: (
        <Button tone="secondary" onClick={() => setReverse(!reverse)}>
          Move Beta sample
        </Button>
      ),
    },
  ];
  return (
    <Panel
      title="Motion patterns"
      description="Immediate content and controls; brief feedback exits and stable-ID position changes. Native dialogs remain immediate."
    >
      <div className="preview-stack">
        <Button tone="secondary" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          Toggle feedback example
        </Button>
        <Presence visible={visible}>
          <ContentState kind="unavailable" title="Feedback example">
            <p>This local message demonstrates presence without delaying an action.</p>
          </ContentState>
        </Presence>
        <Button tone="secondary" onClick={() => setReverse(!reverse)}>
          Reverse sample order
        </Button>
        <LayoutList
          label="Motion sample order"
          className="preview-motion-list"
          items={reverse ? [...samples].reverse() : samples}
        />
        <Button tone="secondary" aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
          Toggle entrance example
        </Button>
        {reveal ? (
          <SequenceReveal className="preview-sequence">
            <p>Landing entrance example. Content stays readable throughout.</p>
          </SequenceReveal>
        ) : null}
      </div>
    </Panel>
  );
}
