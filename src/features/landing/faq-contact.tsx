import './faq-contact.css';

const FAQ_ITEMS = [
  {
    q: 'What is Darve?',
    a: 'Darve is an interactive platform that connects live streamers with their audiences through viewer-suggested challenges, crowdfunded donations, and real-time content creation.',
  },
  {
    q: 'Does Darve replace Streamlabs or OBS?',
    a: 'No. DARVE is designed to complement broadcasting software, with a browser-overlay experience for displaying challenges and funding progress.',
  },
  {
    q: 'Does Darve require installation?',
    a: 'DARVE is designed as a web-based experience, with an OBS-style browser overlay for displaying challenge information. Availability of integrations depends on the product rollout.',
  },
  {
    q: 'How are payments handled?',
    a: "Payment arrangements depend on the streamer's configured payment setup. At this stage, refunds are handled manually by the streamer. Automated refunds and escrow are planned for a future version.",
  },
  {
    q: 'Do I approve challenges before they go live?',
    a: 'Yes. As a Streamer, you have complete control over which challenges are presented to your audience. You can review suggestions, edit them, or decline anything that makes you uncomfortable.',
  },
  {
    q: 'Does Darve take a percentage?',
    a: 'Fees and payment processing costs depend on the applicable product and payment setup. Check the current terms before launching a funded challenge.',
  },
  {
    q: 'How does Darve increase engagement?',
    a: 'By giving viewers a direct, interactive way to influence the stream through challenges, Darve creates "must-watch" moments that keep audiences engaged longer and incentivize crowd-funded participation.',
  },
  {
    q: 'How can I get help or contact Darve?',
    a: "You can reach our support team anytime by emailing support@darve.app. We're here to help with any questions, issues, or feedback you might have!",
  },
  {
    q: 'What happens if a challenge is not funded?',
    a: 'At this stage, refunds are handled manually by the streamer. Automated refunds and escrow are planned for a future version.',
  },
] as const;

/** Concept 70 FAQ, contact, and footer — presentation only. */
export function FaqContact() {
  return (
    <>
      <section className="faq-section" id="faq" aria-labelledby="faq-title">
        <div className="faq-heading">
          <div className="faq-intro">
            <span className="landing-micro dv-reveal">FREQUENTLY ASKED QUESTIONS</span>
            <h2 id="faq-title">
              GOOD
              <br />
              <span>QUESTIONS.</span>
            </h2>
          </div>
          <p className="dv-reveal">
            Curious? We&apos;ve got answers.
            <br />
            Everything worth knowing about Darve.
          </p>
        </div>
        <div className="faq-list dv-reveal">
          {FAQ_ITEMS.map((item, index) => (
            <details className="faq-item" key={item.q}>
              <summary>
                <span className="faq-num">{String(index + 1).padStart(2, '0')}</span>
                <span className="faq-q">{item.q}</span>
                <span aria-hidden="true" className="faq-plus" />
              </summary>
              <div className="faq-answer">{item.a}</div>
            </details>
          ))}
        </div>
      </section>

      <section className="contact-section" id="contact" aria-labelledby="contact-title">
        <div className="landing-micro dv-reveal">HAVE SOMETHING IN MIND?</div>
        <div className="contact-main">
          <div>
            <h2 id="contact-title">
              LET&apos;S
              <br />
              <span>TALK.</span>
            </h2>
            <p className="dv-reveal">Questions, ideas, feedback? We&apos;re listening.</p>
          </div>
          <a className="contact-email dv-reveal" href="mailto:support@darve.app">
            <span>GET IN TOUCH</span>
            <strong>support@darve.app</strong>
            <span aria-hidden="true" className="contact-arrow">
              ↗
            </span>
          </a>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="footer-upper">
          <div className="footer-identity">
            <span>Built for streamers. Powered by the audience.</span>
          </div>
          <div aria-label="Social media" className="landing-socials">
            <a
              aria-label="Darve on X"
              href="https://x.com/darvegg"
              rel="noopener noreferrer"
              target="_blank"
            >
              <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.9 2H22l-6.8 7.8L23 22h-6.1l-4.8-7.4L5.6 22H2.4l7.3-8.5L2 2h6.3l4.3 6.7L18.9 2Zm-1.1 18h1.7L7.4 3.9H5.6L17.8 20Z" />
              </svg>
            </a>
            <a
              aria-label="Darve on YouTube"
              href="https://www.youtube.com/@darveapp"
              rel="noopener noreferrer"
              target="_blank"
            >
              <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
                <path d="M21.6 7.2a2.8 2.8 0 0 0-2-2C17.9 4.7 12 4.7 12 4.7s-5.9 0-7.6.5a2.8 2.8 0 0 0-2 2A29 29 0 0 0 2 12a29 29 0 0 0 .4 4.8 2.8 2.8 0 0 0 2 2c1.7.5 7.6.5 7.6.5s5.9 0 7.6-.5a2.8 2.8 0 0 0 2-2A29 29 0 0 0 22 12a29 29 0 0 0-.4-4.8ZM10 15.5v-7l6 3.5-6 3.5Z" />
              </svg>
            </a>
            <a
              aria-label="Darve on Instagram"
              href="https://www.instagram.com/darve.gg/"
              rel="noopener noreferrer"
              target="_blank"
            >
              <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                <rect
                  x="3"
                  y="3"
                  width="18"
                  height="18"
                  rx="5"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
                <circle cx="17.5" cy="6.5" r="1.3" fill="currentColor" />
              </svg>
            </a>
            <a
              aria-label="Darve on TikTok"
              href="https://www.tiktok.com/@darvegg"
              rel="noopener noreferrer"
              target="_blank"
            >
              <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15 2h3c.3 2.5 1.7 4 4 4.3v3.2a10 10 0 0 1-4-1.1V16a7 7 0 1 1-7-7v3.4a3.6 3.6 0 1 0 3.6 3.6V2H15Z" />
              </svg>
            </a>
          </div>
        </div>
        <div className="footer-lower">
          <span>© 2026 DARVE. ALL RIGHTS RESERVED.</span>
          <span className="landing-legal">
            <a href="/privacy">PRIVACY</a>
            <a href="/legal/terms">TERMS</a>
            <a href="/safety">SAFETY</a>
          </span>
          <span>BUILT FOR THE MOMENTS THAT MATTER.</span>
        </div>
      </footer>
    </>
  );
}
