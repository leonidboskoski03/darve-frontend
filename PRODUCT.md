# Darve product context

This is a summary of existing decisions, not a new product specification. The owning [plan](docs/PLAN.md), [design baselines](docs/SOURCE_PROJECTS_AND_DESIGN_BASELINES.md), [architecture](docs/ARCHITECTURE.md) and [design system](docs/DESIGN_AND_MOTION.md) remain authoritative.

## Register

product

## Users and purpose

Creators collect viewer ideas, review and accept challenges, select their broadcast presentation and track funding and their own completion declarations. Viewers contribute without creator login and retain a private receipt. OBS uses separate read-only grants. Staff have a separate authority boundary.

## Brand personality

Focused, direct, expressive. Preserve the selected F creator workspace, M/R broadcast card, A contribution page and standalone magenta landing. Existing tokens and locally hosted Inter define the rebuilt interface.

## Anti-references

Historical fake authentication, decorative QR patterns, simulated donations, donor tickers and clip-based completion are not product behavior. Avoid generic dashboard redesigns, noisy decoration and animations that conceal authoritative state.

## Design principles

- Keep the current task and its next action clear.
- Present backend state truthfully, including unknown, stale and unavailable states.
- Keep creator, guest, staff and broadcast authority independent.
- Preserve chosen reference hierarchy while replacing obsolete behavior.
- Keep exact currency, immutable terms and safe source attribution readable.

## Accessibility and inclusion

Follow the existing keyboard, focus, contrast, reduced-motion and responsive acceptance requirements. Broadcast content needs readable text and independently decoded QR evidence at supported stream resolutions; browser tests do not establish physical QR or actual OBS acceptance.
