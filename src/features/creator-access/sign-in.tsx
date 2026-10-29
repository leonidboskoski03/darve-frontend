import { useMutation } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/design-system/button';
import { Brand } from '@/design-system/brand';
import { ProviderMark } from '@/design-system/provider-mark';
import { type CreatorAccessClient, type Provider } from '@/services/creator-access/index';
import { AccessError } from './error-message';
import { providers } from './provider-options';
export function SignIn({
  client,
  disabledReason,
}: {
  client: CreatorAccessClient | null;
  disabledReason?: string;
}) {
  const authorization = useMutation({
    mutationFn: (provider: Provider) =>
      client!.authorize(provider, {
        intent: 'sign_in',
        returnPath: '/integrations',
        connectionId: null,
      }),
    retry: false,
  });
  return (
    <section className="creator-card creator-card--narrow" aria-labelledby="connect-title">
      <Brand />
      <p className="creator-step">01 · Your account</p>
      <h1 id="connect-title">Connect your stream to Darve</h1>
      <p className="creator-description">
        Choose the account you stream with. You will continue on the provider’s website to sign in.
      </p>
      <div className="creator-providers">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            tone="secondary"
            className="creator-provider"
            disabled={!client || authorization.isPending || authorization.isSuccess}
            busy={authorization.isPending && authorization.variables === provider.id}
            aria-disabled={!client || authorization.isPending || authorization.isSuccess}
            onClick={() => {
              if (!authorization.isPending) authorization.mutate(provider.id);
            }}
          >
            <ProviderMark provider={provider.id} />
            <span>Continue with {provider.label}</span>
            <ArrowRight size={18} aria-hidden="true" />
          </Button>
        ))}
      </div>
      {disabledReason ? (
        <p className="creator-unavailable" role="status">
          {disabledReason}
        </p>
      ) : null}
      <AccessError error={authorization.error} />
      {authorization.isSuccess ? <p role="status">Opening the provider’s sign-in page…</p> : null}
      <p className="creator-note">
        Signing in does not accept account terms, enable chat reading or allow DarveBot to post.
        Each permission is handled separately.
      </p>
    </section>
  );
}
