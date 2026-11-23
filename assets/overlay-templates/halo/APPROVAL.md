# Halo v1 — experimental showcase

**Status: experimental, NOT founder-approved.** Requested by the Darve owner on 2026-11-23 to compare minimal, low-distraction OBS cards. Calm: one thin arc framing the left edge that fills with funding and breathes slowly. It must not be priced, offered to creators or activated until a founder approval record replaces this file.

Original project-authored GLSL, CSS and TypeScript in this repository. No external artwork, third-party template, remote font or downloaded script is included. three.js and GSAP are existing pinned npm dependencies under their own licences; Inter keeps its bundled font licence; the Darve logo is Darve's own asset. Platform variants use colours only and no platform logos or trademarks.

Review: calm motion (slow loops, small movement, no flashing, 30 fps cap for calm templates). The WebGL canvas only decorates; challenge text, credits, verified funding, declared completion and the conditional QR stay in the unchanged safe card DOM, and the QR stays black on white. Reduced motion renders a still frame, missing WebGL leaves the CSS backdrop, hidden documents stop rendering. Exact id/version/renderer/hash must match the local registry.
