# Darve founder design guide

## Open the preview

1. Install Git and Node.js **24.16.0**. The Node installer includes npm. Open a fresh terminal and run `node --version`. It should say `v24.16.0`.
2. Sign in to GitHub with the account that has access to the Darve frontend. In a terminal, run these commands one line at a time.

   ```sh
   git clone --branch design/founder https://github.com/leonidboskoski03/darve-frontend.git
   cd darve-frontend
   npm ci
   npm run dev:design
   ```

3. Open **http://127.0.0.1:5178** in your browser. Keep the terminal open while you work. Press **Ctrl+C** in that terminal when you want to stop.
4. Open **Design states** in the top right. Pick a screen or a situation. You can switch between a live collection, an ended round, payment receipts, and the other states without going through setup each time. Close the menu to see more of the overlay. Close the accept dialog, or press **Esc**, before using the menu again.

The preview starts as Avery Draws, a fictional streamer. Use the sign-in screen to review its layout and pick **Signed-in demo streamer** to enter the workspace. Sample checkout, receipts and payout states are for layout review. Use **Design states** again to reset the sample workflow. No backend, environment file, or payment or streaming account is needed.

## Where to make changes

- `src/design-system` holds colors, typography, spacing, and shared components such as buttons and form controls.
- `src/features` holds screens and smaller pieces of screens. Start with the folder matching the screen, such as `collection`, `suggestion-review`, `overlay-settings`, `overlay-display`, or `payout-settings`.
- Visible text usually lives near the component that displays it. Search in `src/features` for the exact wording you see in the browser. Keep links, controls, labels, and keyboard navigation usable as you edit.

Keep changes to the look, layout, interaction design, and visible wording. Leave `src/services`, `vendor/contracts`, API calls, routing, sign-in, permissions, payment processing and security logic alone. If a design needs a different payment flow or new data, show the intended UI and describe the dependency in the PR for the developer.

## What to design first

1. **Payment page and receipt (B26, B27, B32).** Use a compact Streamlabs-style layout with the challenge, streamer, progress and amount choices in view. Design one-click PayPal and Stripe card buttons and a short receipt. The developer will connect the payment behavior.
2. **Collection.** Make starting or stopping a round obvious. Give the live idea preview and time remaining room to breathe.
3. **Review ideas.** Make the top 10 easy to scan and the reasons easy to read. Review the uncertain and dismissed states and the accept dialog.
4. **OBS settings and display.** Make the preview and essential settings easy to find. Check the five overlay states with a stream-sized viewport.
5. **Payouts.** Make verified, pending and needs-attention statuses clear at a glance.
6. **Overall density (B28).** Start with the screens above, then review the workspace and history. Give each screen one clear primary action and tuck technical details behind an expandable control.

## New since 23 November

- **OBS templates.** Open **http://127.0.0.1:5178/tests/fixtures/showcase.html** while the preview runs. The top buttons switch style (Standalone, Compact, Glass, Neon, Classic, Drift, Contour, Halo, Ripple, Comet, Stardust), colour (Default, Twitch, YouTube, Kick, Darve) and scene. Every template shares one 960 × 236 card layout. Styles live in `src/features/overlay-display` (CSS) and `src/motion` (animated backgrounds). All templates except Darve Compact are experimental and need your approval; Darve Compact's new size also needs your confirmation. No template is priced or sold until you approve it.
- **Templates page** (**Design states → Templates**). Coin cost, ownership, the review before redeeming and the OBS template choice. Its review box opens above the catalogue.
- **Review ideas** now includes a "needs your call" idea that the streamer can allow or dismiss.

## Save and share your work

Open a second terminal in the same folder. Run `git status --short` first. In your editor, review your changes, then stage just the files you want to share. In the command below, replace `path/to/file` with the actual path for each file you changed.

```sh
git add -- path/to/file
git diff --cached
git commit -m "Polish collection screen"
git push origin design/founder
```

The push runs the project checks and may take a minute. When ready for review, go to the frontend repo on GitHub, choose **Pull requests → New pull request**, set **base** to `dev` and **compare** to `design/founder`. Describe what changed, include screenshots if useful, and mention any API behavior the design needs. Open the pull request for review.

## Bring in updates

Save your work in a commit first. In the frontend folder, run these commands.

```sh
git switch design/founder
git pull --ff-only origin design/founder
git fetch origin
git merge origin/dev
npm ci
npm run dev:design
```

If Git reports a conflict, pause and send the file names to the developer. Once the update is working, run `git push origin design/founder`.
