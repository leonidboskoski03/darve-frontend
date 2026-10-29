import { describe, expect, it } from 'vitest';
import { sanitizeOAuthReturn, oauthReturnNotice } from './oauth-return';

describe('safe OAuth return handling', () => {
  it('removes callback secrets/unknown data and retains only reviewed return hints', () => {
    expect(
      sanitizeOAuthReturn(
        'https://frontend.test/integrations?oauth_result=success&oauth_provider=twitch&code=private&state=private&next=https://evil.test#access_token=private',
      ),
    ).toBe('/integrations?oauth_result=success&oauth_provider=twitch');
  });
  it('normalizes arbitrary result/provider payloads without rendering them', () => {
    const clean = sanitizeOAuthReturn(
      'https://frontend.test/authorize?oauth_result=private-marker&oauth_provider=private-marker',
    );
    expect(clean).toBe('/authorize?oauth_result=unconfirmed');
    expect(oauthReturnNotice('?oauth_result=private-marker', false)).not.toContain(
      'private-marker',
    );
  });
  it('does not treat an asserted success as a signed-in session', () => {
    expect(oauthReturnNotice('?oauth_result=success', false)).toContain('No signed-in session');
    expect(oauthReturnNotice('?oauth_result=success', true)).toContain('refreshed');
    expect(oauthReturnNotice('?oauth_result=cancelled', false)).toContain('cancelled');
  });
  it('preserves ordinary anchors and leaves independent future reader grants to their own entry', () => {
    expect(sanitizeOAuthReturn('https://frontend.test/#how-it-works')).toBeNull();
    expect(sanitizeOAuthReturn('https://frontend.test/overlays/example#grant=private')).toBeNull();
    expect(sanitizeOAuthReturn('https://frontend.test/')).toBeNull();
  });
});
