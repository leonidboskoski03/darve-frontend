import { useEffect, useState } from 'react';
import { Disclosure } from '@/design-system/disclosure';
import { Link } from 'react-router-dom';
import './public-help.css';

const questions = [
  {
    id: 'connect',
    question: 'How do I connect my stream?',
    answer: (
      <>
        <Link to="/authorize">Connect your stream</Link> with Twitch, YouTube, or Kick. Sign-in
        opens on the provider’s website. After you return to Darve, review the account terms and
        follow the creator setup guide.
      </>
    ),
  },
  {
    id: 'permissions',
    question: 'Does signing in give Darve permission to read or post in chat?',
    answer:
      'Chat reading and DarveBot posting have separate permissions. Review your streaming connections in creator setup after signing in.',
  },
  {
    id: 'obs',
    question: 'How do I add Darve to OBS?',
    answer:
      'Open OBS Display in the creator workspace. Follow the setup instructions and add your private Browser Source link in OBS. Keep that link private.',
  },
  {
    id: 'receipt',
    question: 'How do I find my contribution receipt?',
    answer: (
      <>
        Return to <Link to="/receipts">Your receipts</Link> in the same browser you used to
        contribute. Access is tied to that browser.
      </>
    ),
  },
] as const;

export function Component() {
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Help — Darve';
  }, []);

  return (
    <section className="public-help" aria-labelledby="help-title">
      <h1 id="help-title">Darve help</h1>
      {questions.map(({ id, question, answer }) => (
        <Disclosure
          key={id}
          className="public-help__item"
          heading="h2"
          label={question}
          expanded={openQuestion === id}
          onExpandedChange={(open) => setOpenQuestion(open ? id : null)}
        >
          <p>{answer}</p>
        </Disclosure>
      ))}
      <p className="public-help__reference">
        See also the <Link to="/faq">FAQ for the live darve.gg site</Link>.
      </p>
    </section>
  );
}
