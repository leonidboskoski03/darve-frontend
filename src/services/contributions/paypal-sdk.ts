type Button = {
  isEligible(): boolean;
  render(element: HTMLElement): Promise<void>;
  close(): Promise<void>;
};

export type QuickPaySdk = {
  FUNDING: { PAYPAL: string; CARD: string };
  Buttons(options: {
    fundingSource: string;
    createOrder(): Promise<string>;
    onApprove(data: { orderID: string }): Promise<void>;
    onCancel(): void;
    onError(): void;
  }): Button;
};

const loads = new Map<string, Promise<QuickPaySdk>>();
let nextNamespace = 0;

export function loadQuickPaySdk(
  clientId: string,
  merchantId: string,
  currency: string,
  attributionId: string,
) {
  const scriptUrl = new URL('https://www.sandbox.paypal.com/sdk/js');
  for (const [key, value] of Object.entries({
    'client-id': clientId,
    'merchant-id': merchantId,
    currency,
    intent: 'capture',
    commit: 'true',
    components: 'buttons',
    'enable-funding': 'card',
    'disable-funding': 'venmo,paylater,credit',
  }))
    scriptUrl.searchParams.set(key, value);
  const key = scriptUrl.href + '|' + attributionId;
  const old = loads.get(key);
  if (old) return old;
  const namespace = 'darvePayPalQuick' + ++nextNamespace;
  const loading = new Promise<QuickPaySdk>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptUrl.href;
    script.async = true;
    script.dataset.namespace = namespace;
    script.dataset.partnerAttributionId = attributionId;
    const nonce = document.querySelector<HTMLMetaElement>('meta[name="darve-csp-nonce"]')?.content;
    if (nonce) {
      script.nonce = nonce;
      script.dataset.cspNonce = nonce;
    }
    const fail = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error('PayPal buttons could not be loaded'));
    };
    const timeout = window.setTimeout(fail, 10000);
    script.addEventListener('error', fail, { once: true });
    script.addEventListener(
      'load',
      () => {
        window.clearTimeout(timeout);
        const sdk = (window as unknown as Record<string, QuickPaySdk | undefined>)[namespace];
        if (typeof sdk?.Buttons !== 'function' || !sdk.FUNDING) fail();
        else resolve(sdk);
      },
      { once: true },
    );
    document.head.append(script);
  }).catch((error: unknown) => {
    loads.delete(key);
    throw error;
  });
  loads.set(key, loading);
  return loading;
}
