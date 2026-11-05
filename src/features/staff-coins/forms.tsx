import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/design-system/button';
import { TextField } from '@/design-system/text-field';
import type {
  StaffCoinClient,
  CoinConfiguration,
  StaffCoinAccount,
  StaffCoinTemplate,
} from '@/services/staff-coins/index';
import { missions, missionNames } from './model';
function ReviewForm({
  label,
  children,
  prepare,
  disabled,
}: {
  label: string;
  children: ReactNode;
  prepare: (reason: string) => void;
  disabled: boolean;
}) {
  const [reason, setReason] = useState(''),
    [error, setError] = useState(false);
  return (
    <form
      className="staff-coins-form"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          prepare(reason);
          setError(false);
        } catch {
          setError(true);
        }
      }}
    >
      <fieldset disabled={disabled}>
        <legend>{label}</legend>
        {children}
        <TextField
          label={label + ' reason'}
          required
          maxLength={2000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {error ? (
          <p role="alert">Check the exact values and target before reviewing this change.</p>
        ) : null}
        <Button type="submit" tone="secondary" disabled={disabled || !reason.trim()}>
          Review {label.toLowerCase()}
        </Button>
      </fieldset>
    </form>
  );
}
export function ConfigurationForm({
  client,
  current,
  disabled,
}: {
  client: StaffCoinClient;
  current: CoinConfiguration;
  disabled: boolean;
}) {
  const latest = current.configurations[0];
  const [active, setActive] = useState(latest?.active ?? false),
    [rewards, setRewards] = useState(() =>
      Object.fromEntries(missions.map((id) => [id, latest?.rewards[id] ?? ''])),
    );
  return (
    <ReviewForm
      label="Reward configuration"
      disabled={disabled}
      prepare={(reason) =>
        client.prepare(
          'configure',
          current.programId,
          {
            expectedRevision: current.revision,
            active,
            rewards,
            reason,
            confirmation: { programId: current.programId },
          },
          `Program ${current.programId}. Future earning ${active ? 'enabled' : 'disabled'}. ` +
            missions.map((id) => `${missionNames[id]}: ${rewards[id]} coins`).join('; '),
        )
      }
    >
      <label className="staff-coins-check">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        Enable future coin earning
      </label>
      <p>Rewards apply to future qualifying activity. Existing recorded rewards are retained.</p>
      <div className="staff-coins-rewards">
        {missions.map((id) => (
          <TextField
            key={id}
            label={missionNames[id] + ' reward'}
            required
            inputMode="numeric"
            pattern="0|[1-9][0-9]{0,18}"
            value={rewards[id]}
            onChange={(event) => setRewards((value) => ({ ...value, [id]: event.target.value }))}
          />
        ))}
      </div>
    </ReviewForm>
  );
}
export function AdjustmentForm({
  client,
  current,
  disabled,
}: {
  client: StaffCoinClient;
  current: StaffCoinAccount;
  disabled: boolean;
}) {
  const id = useId(),
    [direction, setDirection] = useState<'credit' | 'debit'>('credit'),
    [amount, setAmount] = useState('');
  return (
    <ReviewForm
      label="Balance adjustment"
      disabled={disabled || current.state !== 'synchronized'}
      prepare={(reason) =>
        client.prepare(
          'adjust',
          current.ownerId,
          {
            expectedRevision: current.revision,
            direction,
            amount,
            reason,
            confirmation: { ownerId: current.ownerId, balance: current.balance },
          },
          `${direction === 'credit' ? 'Credit' : 'Debit'} ${amount} coins for creator ${current.ownerId}. Reviewed balance: ${current.balance} coins.`,
        )
      }
    >
      <label htmlFor={id}>Adjustment direction</label>
      <select
        id={id}
        value={direction}
        onChange={(event) => setDirection(event.target.value === 'debit' ? 'debit' : 'credit')}
      >
        <option value="credit">Credit coins</option>
        <option value="debit">Debit coins</option>
      </select>
      <TextField
        label="Adjustment coins"
        required
        inputMode="numeric"
        pattern="[1-9][0-9]{0,18}"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      {current.state !== 'synchronized' ? (
        <p>A current synchronized account is required before reviewing an adjustment.</p>
      ) : null}
    </ReviewForm>
  );
}
export function PriceForm({
  client,
  item,
  disabled,
}: {
  client: StaffCoinClient;
  item: StaffCoinTemplate;
  disabled: boolean;
}) {
  const [amount, setAmount] = useState(item.amount ?? '');
  return (
    <ReviewForm
      label="Template price"
      disabled={disabled || !item.available}
      prepare={(reason) =>
        client.prepare(
          'price',
          item.id,
          {
            expectedRevision: item.priceRevision ?? 0,
            amount,
            reason,
            confirmation: { templateId: item.id },
          },
          `Template ${item.id} (${item.displayName}), version ${item.assetVersion}. New price: ${amount} coins. Current price: ${item.amount ?? 'not set'}.`,
        )
      }
    >
      <TextField
        label="New template price in coins"
        required
        inputMode="numeric"
        pattern="0|[1-9][0-9]{0,18}"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <p>Zero is an explicit free price. Price changes do not remove existing ownership.</p>
    </ReviewForm>
  );
}
