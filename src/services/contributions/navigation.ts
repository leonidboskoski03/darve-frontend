import { CheckoutParamsSchema } from '@/services/contracts/index';

export const validReceiptId = (value: string) =>
  CheckoutParamsSchema.safeParse({ id: value }).success;
export function sanitizePaymentReturn(href: string): string | null {
  const url = new URL(href);
  if (url.pathname !== '/payments/return') return null;
  const ids = url.searchParams.getAll('checkout');
  return ids.length === 1 && validReceiptId(ids[0]!) ? '/receipts/' + ids[0]! : '/receipts';
}
