# Delegation log

> Starter log. Claude wrote the first entries from the build session. Add your own verification notes (and fix anything that isn't accurate) before you submit, since this is your record.

| # | What I asked Claude | What it produced | How it was verified |
|---|---|---|---|
| 1 | Build the whole cabinet: 7 games with both sides playable by a human or the computer, Tetris as my game, PeerJS for Imitation, static site only | `index.html`, `css/`, `js/core.js`, `js/app.js`, one file per game in `js/games/` | Opened every game in headless Chromium in Classic, Flipped and Watch modes with simulated keys, clicks and drags (`test/smoke.js`). No page errors. Checked screenshots by eye. |
| 2 | Make every game fair on both sides | A computer player for **each** side of every game, a difficulty ramp, and fairness rules that apply to humans and the computer alike (listed in the README) | `test/simulate.js` ran each game 40–200 times computer-vs-computer. The first runs failed badly: Snake 100/0, Splat 0/100, Asteroids 0/100, Missile Command 98/3. Each was tuned until both sides win somewhere between about 40% and 60%. |
| 3 | Debug the failures found in step 2 | Splat: the flyer was aiming at a target computed from its own height, so it chased itself; fixed. Asteroids: the pilot dodged instead of shooting, and rock fragments exceeded the cap; the pilot AI was rewritten and the cap changed to total rock mass. | Traced the bird's position and target frame by frame. Logged the ship's state at each death. Re-ran the simulations after each fix. |
| 4 | Two-browser Imitation without a server, and without an obvious AI | `js/net.js` (lobby slots and private rooms over the public PeerJS broker). Matchmaking always waits a few seconds, falls back to a human-like computer player, and ends with a "human or computer?" guess. | `test/protocol.js`: two game instances over a fake link with 30–150 ms lag, 150 matches, and both sides always agreed on who won. **Still to do by hand:** test a real match between two browsers on the deployed site (the build sandbox couldn't reach the PeerJS server). |
| 5 | Netlify config and deploy instructions | `netlify.toml`, README deploy section | *(Fill in: date deployed, domain, confirmation that a push triggered a redeploy.)* |

## My own checks
- [ ] Played each game in the classic and flipped modes myself
- [ ] Two-browser Imitation match on the live site
- [ ] Custom domain loads over HTTPS; a git push redeploys
