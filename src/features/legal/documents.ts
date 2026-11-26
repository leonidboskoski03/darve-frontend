import { markdown as privacyMarkdown } from './content/privacy';
import { markdown as safetyMarkdown } from './content/safety';
import { markdown as termsMarkdown } from './content/terms';

export type LegalDocumentId = 'privacy' | 'terms' | 'safety';

export type LegalDocument = {
  id: LegalDocumentId;
  path: string;
  tabLabel: string;
  title: string;
  tagline: string;
  effective: string;
  updated: string;
  docLabel: string;
  docHeading: string;
  originalHref: string;
  markdown: string;
};

/** Public legal documents — presentation copy from darve.gg. Not account-acceptance terms. */
export const LEGAL_DOCUMENTS: Record<LegalDocumentId, LegalDocument> = {
  privacy: {
    id: 'privacy',
    path: '/privacy',
    tabLabel: 'Privacy',
    title: 'PRIVACY POLICY',
    tagline: 'Your information. Your rights.',
    effective: 'MARCH 24, 2026',
    updated: 'MARCH 24, 2026',
    docLabel: 'Privacy Policy — original document',
    docHeading: 'Darve — Privacy Policy',
    originalHref: 'https://darve.gg/privacy',
    markdown: privacyMarkdown,
  },
  terms: {
    id: 'terms',
    path: '/legal/terms',
    tabLabel: 'Terms',
    title: 'TERMS OF SERVICE',
    tagline: 'The rules of the experience.',
    effective: 'MARCH 24, 2026',
    updated: 'MARCH 24, 2026',
    docLabel: 'Terms of Service — original document',
    docHeading: 'Darve — Terms of Service',
    originalHref: 'https://darve.gg/terms',
    markdown: termsMarkdown,
  },
  safety: {
    id: 'safety',
    path: '/safety',
    tabLabel: 'Safety',
    title: 'COMMUNITY & SAFETY',
    tagline: 'Good moments. Safe boundaries.',
    effective: 'MARCH 24, 2026',
    updated: 'MARCH 24, 2026',
    docLabel: 'Community Safety Guidelines — original document',
    docHeading: 'Darve — Community & Safety Guidelines',
    originalHref: 'https://darve.gg/safety',
    markdown: safetyMarkdown,
  },
};

export const LEGAL_TABS = [
  LEGAL_DOCUMENTS.privacy,
  LEGAL_DOCUMENTS.terms,
  LEGAL_DOCUMENTS.safety,
] as const;

export function legalDocumentFromPath(pathname: string): LegalDocument | null {
  const match = LEGAL_TABS.find((doc) => doc.path === pathname);
  return match ?? null;
}
