import { Button } from '@/design-system/button';

export function AmountPicker({
  amount,
  currency,
  onAmount,
}: {
  amount: string;
  currency: string;
  onAmount: (amount: string) => void;
}) {
  return (
    <fieldset className="contribution-amount">
      <legend>Contribution amount ({currency})</legend>
      <div className="contribution-quick-picks">
        {['2', '5', '10'].map((pick) => (
          <Button
            key={pick}
            tone="secondary"
            aria-pressed={amount === pick}
            onClick={() => onAmount(pick)}
          >
            {pick}
          </Button>
        ))}
      </div>
      <label className="ds-field">
        <span className="ds-field__label">Custom amount ({currency})</span>
        <input
          className="ds-input"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(event) => onAmount(event.target.value)}
        />
      </label>
    </fieldset>
  );
}
