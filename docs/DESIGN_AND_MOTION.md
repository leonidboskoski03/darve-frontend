# Design and motion systems

## Visual direction

Preserve the selected F dashboard, M/R OBS and A contribution designs. The historical deployed landing is dark with a magenta accent and restrained starfield. Rebuilding code does not authorize replacing the design with a new template. F00 uses preliminary dark/magenta tokens, a text brand mark and system font only as a clearly labelled engineering shell. It does not establish logo fidelity, final typography, full landing reproduction or visual acceptance.

F01 inventories every selected screen and asset, traces its source and records a component/state map. Confirm real brand assets/font rights, density, responsive behavior and missing staff/coin/template references. Do not silently use the blue React reference as the deployed landing. Implement semantic tokens before individual screens: canvas/surface/text/muted/accent/focus/danger/success, spacing scale, typography roles, borders/radii, elevations and layering. Keep exact money/currencies readable at every breakpoint.

## Component contract

Accessible primitives must define normal, hover, focus-visible, active, disabled, busy and error states as applicable. A button is a button and navigation is a link. Dialogs manage focus, escape and return focus; forms have labels and linked errors. Never convey paid/late/review/unavailable solely through color or animation. Skeletons/empty/error states must not look like successful data. OBS layout must support transparency, readable contrast on real scenes and the exact QR destination without exposing private owner data.

Use Tailwind utilities with CSS variables/semantic tokens. Keep complex component styles close to their owner; shared primitives live in design-system, not features or shared utilities. Avoid per-screen colors, arbitrary spacing, duplicate modal implementations and runtime external font/CDN dependencies without a concrete approved need. Test responsive layouts, 200% zoom, long names/challenges, large amounts, translated-length text and keyboard/touch interaction.

## Motion ownership

| Tool                 | Responsibility                                               | Example                                                 |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| CSS                  | Simple visual state transitions                              | Focus/hover color, no business timing                   |
| Framer Motion        | React presence, layout and small state transitions           | Dialog/panel entrance and removal, list rearrangement   |
| GSAP + `@gsap/react` | Coordinated sequences and controlled multi-element timelines | Landing entrance sequence or deliberate marketing scene |

Both engines are installed because the founder requested them. Only `motion/` imports engine packages. Features use adapters instead of scattering engine calls. The shell lazily loads Framer Motion features; GSAP enters the lazy landing chunk rather than app bootstrap. Future OBS and staff routes must not inherit unnecessary marketing animation code.

One engine owns each property on each node; separate wrappers if a coordinated sequence and a presence transition must coexist. Prefer transforms/opacity. Avoid layout-reading animation loops, permanent `will-change`, scroll hijacking, endless particle loops in the operational dashboard and heavy animation competing with realtime streams.

Durations begin with shared 120ms/220ms UI and 550ms entrance tokens. These are presentation defaults, not API timers. `MotionConfig reducedMotion="user"` plus adapters' explicit reduced-motion behavior keep content visible. GSAP uses scoped refs, `useGSAP`, media-query cleanup and context-safe later callbacks when needed. Cleanup on navigation/unmount and React StrictMode must not leak timelines/listeners. Never rely on animation completion for submitting payments, closing a collection round, setting coin balances or announcing backend success.

## Acceptance

F00 proves both adapters render and reduced motion keeps content visible in browser smoke tests. F01 must add actual component presence/layout/focus tests as components are built. Visual acceptance needs reference comparison at desktop/mobile sizes and actual OBS testing later. Disabled animations and interrupted/unmounted sequences must leave meaningful final content, no stuck hidden state and no side effects. Add richer GSAP plugins only for a concrete approved interaction.

Implementation guidance: [GSAP React lifecycle](https://gsap.com/resources/React/), [Motion reduced motion](https://motion.dev/docs/react-use-reduced-motion), [Motion configuration](https://motion.dev/docs/react-motion-config).
