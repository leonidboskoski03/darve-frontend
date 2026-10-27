export function LoadingState({ label }: { label: string }) {
  return (
    <div className="ds-loading" role="status">
      <span className="ds-loading__label">{label}</span>
      <div className="ds-loading__skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
