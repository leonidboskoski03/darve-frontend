import { Brand } from '@/design-system/brand';

/** Decorative source-matched illustration. Bars are not loading, financial or account data. */
export function DashboardIllustration() {
  return (
    <div className="landing-preview" aria-hidden="true">
      <div className="landing-preview__window">
        <aside className="landing-preview__sidebar">
          <div className="landing-preview__identity">
            <Brand />
            <i />
          </div>
          <div className="landing-preview__selected">
            <b />
            <i />
          </div>
        </aside>
        <div className="landing-preview__body">
          <div className="landing-preview__toolbar">
            <i />
            <i />
            <b />
          </div>
          <div className="landing-preview__content">
            <div className="landing-preview__card landing-preview__card--wide">
              <div className="landing-preview__card-top">
                <i />
                <b />
              </div>
              <i className="landing-preview__line landing-preview__line--long" />
              <i className="landing-preview__line" />
              <div className="landing-preview__tags">
                <i />
                <i />
              </div>
              <div className="landing-preview__progress">
                <i />
              </div>
              <i className="landing-preview__line landing-preview__line--short" />
            </div>
            {[0, 1, 2, 3].map((item) => (
              <div className="landing-preview__card" key={item}>
                <i className="landing-preview__label" />
                <i className="landing-preview__block" />
                <i className="landing-preview__line" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
