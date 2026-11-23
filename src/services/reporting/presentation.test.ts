import { expect, it } from 'vitest';
import { reportingChallenge } from './fixture.test-helper';
import { publicPaymentLink } from './presentation';

it('shares only the exact public challenge address on supported origins', () => {
  const challenge = reportingChallenge();
  const path = '/contribute/' + challenge.publicId;
  challenge.allowedActions = ['view_public'];
  challenge.contributionUrl = 'https://public.example' + path;
  expect(publicPaymentLink(challenge)).toEqual({ path, shareUrl: challenge.contributionUrl });
  for (const url of [
    'https://public.example' + path + '?secret=1',
    'https://public.example' + path + '#grant=1',
    'https://public.example/obs',
    'http://public.example' + path,
  ]) {
    expect(publicPaymentLink({ ...challenge, contributionUrl: url })).toBeNull();
  }
  expect(publicPaymentLink({ ...challenge, contentAvailability: 'unavailable' })).toBeNull();
  expect(publicPaymentLink({ ...challenge, allowedActions: [] })).toBeNull();
});
