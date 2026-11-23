# Comet · Darve v1 — experimental showcase

**Status: experimental, NOT founder-approved.** Requested by the Darve owner on 2026-11-23: an automatic glowing light trail travelling across the card (inspired by a cursor-trail effect, re-implemented here without the mouse), in Darve brand pink and magenta. Goal and completion warm it to gold; a verified contribution releases a small burst. It must not be priced, offered to creators or activated until a founder approval record replaces this file.

Original compact project-authored GLSL, CSS and TypeScript in this repository (fading trail buffer, not copied third-party code). No external artwork, template, remote font or downloaded script is included. three.js and GSAP are existing pinned npm dependencies under their own licences; Inter keeps its bundled font licence.

Review: the WebGL canvas only decorates; challenge text, credits, verified funding, declared completion and the conditional QR stay in the unchanged safe card DOM, and the QR stays black on white. Reduced motion renders one still snapshot, missing WebGL leaves the CSS backdrop, hidden documents stop rendering. Exact id/version/renderer/hash must match the local registry.
