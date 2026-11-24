import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/design-system/button';
import { TextField } from '@/design-system/text-field';
import type {
  StaffCoinClient,
  CoinConfiguration,
  StaffCoinAccount,
  StaffCoinTemplate,
  StaffFeeAgreements,
} from '@/services/staff-coins/index';
import {
  missions,
  missionNames,
  decimalToMinor,
  feeText,
  minorText,
  percentToBasisPoints,
} from './model';
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
type FeeKind = 'percentage' | 'percentage_plus_flat' | 'none';
export function FeeForm({
  client,
  owner,
  current,
  disabled,
}: {
  client: StaffCoinClient;
  owner: string;
  current: StaffFeeAgreements['items'][number] | null;
  disabled: boolean;
}) {
  const typeId = useId();
  const currencies = current ? Object.keys(current.policy.currencies) : ['USD', 'EUR'];
  const first = current?.policy.currencies[currencies[0]!];
  const initial = first?.darveFee;
  const [kind, setKind] = useState<FeeKind>(
    initial?.type === 'none' || initial?.type === 'percentage_plus_flat'
      ? initial.type
      : 'percentage',
  );
  const [percent, setPercent] = useState(
    initial && 'basisPoints' in initial ? String(initial.basisPoints / 100) : '10',
  );
  const [fixed, setFixed] = useState(
    initial && 'amountMinor' in initial ? minorText(initial.amountMinor) : '0.50',
  );
  const [minimum, setMinimum] = useState(first ? minorText(first.minimumMinor) : '1.00');
  const [maximum, setMaximum] = useState(first ? minorText(first.maximumMinor) : '10000.00');
  const revision = current?.revision ?? 0;
  return (
    <ReviewForm
      label="Fee offer"
      disabled={disabled}
      prepare={(reason) => {
        const basisPoints = percentToBasisPoints(percent);
        const fixedMinor = decimalToMinor(fixed);
        const minimumMinor = decimalToMinor(minimum);
        const maximumMinor = decimalToMinor(maximum);
        if (
          !minimumMinor ||
          !maximumMinor ||
          BigInt(minimumMinor) > BigInt(maximumMinor) ||
          (kind !== 'none' && (basisPoints === null || basisPoints > 9999)) ||
          (kind === 'percentage_plus_flat' && !fixedMinor)
        )
          throw new Error('Invalid fee offer');
        const darveFee =
          kind === 'none'
            ? { type: 'none' as const }
            : kind === 'percentage'
              ? {
                  type: 'percentage' as const,
                  basisPoints: basisPoints!,
                  rounding: 'floor' as const,
                }
              : {
                  type: 'percentage_plus_flat' as const,
                  basisPoints: basisPoints!,
                  rounding: 'floor' as const,
                  amountMinor: fixedMinor!,
                };
        const policy = {
          version:
            'staff-' +
            new Date().toISOString().slice(0, 10).replaceAll('-', '') +
            '-r' +
            (revision + 1),
          currencies: Object.fromEntries(
            currencies.map((currency) => [currency, { minimumMinor, maximumMinor, darveFee }]),
          ),
        };
        const offer = currencies
          .map((currency) => currency + ': ' + feeText(darveFee, currency))
          .join('; ');
        client.prepare(
          'fee',
          owner,
          { expectedRevision: revision, reason, confirmation: { ownerId: owner }, policy },
          `Creator ${owner}, agreement version ${revision + 1}. New Darve fee: ${offer}. Contributions ${minorText(minimumMinor)}–${minorText(maximumMinor)} per payment. Applies to new payments only.`,
        );
      }}
    >
      <label htmlFor={typeId}>Darve fee type</label>
      <select id={typeId} value={kind} onChange={(event) => setKind(event.target.value as FeeKind)}>
        <option value="percentage">Percentage of each payment</option>
        <option value="percentage_plus_flat">Percentage plus a fixed amount per payment</option>
        <option value="none">No Darve fee (full sponsorship)</option>
      </select>
      {kind !== 'none' ? (
        <TextField
          label="Darve fee percent (0–99.99)"
          required
          inputMode="decimal"
          value={percent}
          onChange={(event) => setPercent(event.target.value)}
        />
      ) : null}
      {kind === 'percentage_plus_flat' ? (
        <TextField
          label="Fixed amount per payment"
          required
          inputMode="decimal"
          value={fixed}
          onChange={(event) => setFixed(event.target.value)}
        />
      ) : null}
      <TextField
        label="Minimum per contribution"
        required
        inputMode="decimal"
        value={minimum}
        onChange={(event) => setMinimum(event.target.value)}
      />
      <TextField
        label="Maximum per contribution"
        required
        inputMode="decimal"
        value={maximum}
        onChange={(event) => setMaximum(event.target.value)}
      />
      <p>
        Applies to {currencies.join(' and ')}. A new version replaces the current fee for new
        payments only; earlier payments keep the agreement they were made under.
      </p>
    </ReviewForm>
  );
}
