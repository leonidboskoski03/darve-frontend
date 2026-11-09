export const walkthroughAuthorization = 'https://id.twitch.tv/oauth2/authorize';
export const walkthroughCode = 'f01-controlled-code';

// Only the isolated walkthrough may inject this adapter. Darve still handles state,
// callback, cookie issuance and revocation through its production identity routes.
export const walkthroughTwitch = {
  provider: 'TWITCH',
  authorizationUrl({ state, redirectUri, authorizationPurpose }) {
    if (authorizationPurpose !== 'identity') throw Error('Unexpected walkthrough purpose.');
    const url = new URL(walkthroughAuthorization);
    url.search = new URLSearchParams({
      client_id: 'a'.repeat(20),
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    }).toString();
    return url.href;
  },
  async exchange({ code, authorizationPurpose }) {
    if (code !== walkthroughCode || authorizationPurpose !== 'identity')
      throw Error('Unexpected walkthrough exchange.');
    return {
      provider: 'TWITCH',
      issuer: 'https://synthetic.invalid',
      subject: 'f01-walkthrough-owner',
      displayName: 'Synthetic walkthrough creator',
      channels: [{ providerChannelId: '1', displayName: 'Controlled identity', avatarUrl: null }],
      grant: {
        accessToken: 'synthetic-identity',
        scopes: [],
        expiresAt: new Date(Date.now() + 600000),
      },
    };
  },
};
