type StripeCheckoutPage = {
  mount(element: HTMLElement): void;
  destroy(): void;
};
type StripeFactory = (
  publishableKey: string,
  options: { stripeAccount: string },
) => {
  createEmbeddedCheckoutPage(options: {
    fetchClientSecret(): Promise<string>;
    onComplete(): void;
  }): Promise<StripeCheckoutPage>;
};

let loading: Promise<StripeFactory> | undefined;

export function loadStripeSdk() {
  if (loading) return loading;
  loading = new Promise<StripeFactory>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/endive/stripe.js';
    script.async = true;
    const fail = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error('Stripe could not be loaded'));
    };
    const timeout = window.setTimeout(fail, 10000);
    script.addEventListener('error', fail, { once: true });
    script.addEventListener(
      'load',
      () => {
        window.clearTimeout(timeout);
        const stripe = (window as Window & { Stripe?: StripeFactory }).Stripe;
        if (typeof stripe === 'function') resolve(stripe);
        else fail();
      },
      { once: true },
    );
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
