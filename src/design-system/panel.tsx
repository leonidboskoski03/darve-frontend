import { useId, type ComponentProps } from 'react';

type PanelProps = Omit<ComponentProps<'section'>, 'title'> & {
  title: string;
  description?: string;
};

export function Panel({ title, description, children, className, ...props }: PanelProps) {
  const headingId = useId();
  return (
    <section
      {...props}
      className={['ds-panel', className].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
    >
      <header className="ds-panel__header">
        <h2 id={headingId}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
