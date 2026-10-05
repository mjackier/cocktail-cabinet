# Cocktail Cabinet

Seven arcade games on one static page. Every game has two sides, and each side can be played by a **human** or the **computer**. Use the Classic, Flipped, Watch (computer vs computer) or 2 humans presets, or set each side yourself.

| Game | Side A | Side B | Flip |
|---|---|---|---|
| Snake | Snake | Feeder | The human places the apples (green outline = legal); the computer steers. |
| Breakout | Bottom paddle | Top paddle | Head-to-head: a shared brick wall in the middle, and the computer plays against you. |
| Splat | Flyer | Builder | The human sets each gap with the mouse; the computer flies with nothing but flaps. |
| Asteroids | Pilot | Thrower | The computer flies; the human drags rocks in from the edges, paid for with energy. |
| Missile Command | Defender | Attacker | **My design:** the human commands the warheads (drag from sky to ground, or ← → plus 1–9) against a computer defender. |
| Imitation | You | Opponent | A memory duel against the computer, a friend (private room code), or a stranger online. |
| Tetris *(my pick)* | Stacker | Picker | **My design:** the human picks every upcoming piece; the computer stacks. |

## Fair on both sides

- **Difficulty ramps.** Every game starts easy and gets harder (speed, gap size, energy, wave size), and the computer's skill rises with it. The computer's skill comes from reaction time, aim error and memory, not from extra powers.
- **The computer really plays.** It uses the same inputs as a human (turn, flap, thrust, fire, move, rotate, drop) at limited rates. Everything goes through the same collision code, and no outcome is scripted.
- **Rules apply to both sides.** Apples must be reachable within their timer. A gap can only move a limited distance from the last one. Rocks enter from the edge and never next to the ship. Total rock mass on screen is capped. Paddles share the same top speed. Tetris allows no piece three times in a row.
- **Balance is measured.** `test/simulate.js` plays each game computer-vs-computer and fails if either side wins more than 85% of the time. Recent results:

```
Snake         Snake 47%     Feeder 53%
Breakout      Bottom 53%    Top 48%
Splat         Flyer 42%     Builder 58%
Asteroids     Pilot 41%     Thrower 59%
Missile Cmd   Defender 49%  Attacker 51%
Imitation     44–56% either way
Tetris        Stacker 50%   Picker 50%
```

## Imitation: two browsers, no server

`js/net.js` uses the free public [PeerJS](https://peerjs.com) broker to introduce two browsers. After that they talk directly over WebRTC. There is no server of our own and no API key.

- **Find an opponent:** joins or hosts one of four lobby slots. A search always takes a few seconds, so a match is never instant. If no human appears within about 12–21 s, you are quietly paired with the computer, which has a random handle, a fake ping, human-like timing, a limited memory and the odd hesitation. At the end you guess "human or computer?" and the game tells you if you were right.
- **Private room:** one player creates a 4-letter code and the other joins with it. This always connects two humans.
- **Practice / Watch:** play the computer, labeled as such, or watch two computers play each other.

To try it yourself, open the site in two browsers (or a normal and a private window) and click **Find an opponent** in both at about the same time.

## Run locally

```bash
python3 -m http.server 8080      # then open http://localhost:8080
node test/simulate.js all 40     # balance check, computer vs computer
node test/protocol.js            # Imitation: two simulated browsers stay in sync
```

## Deploy (Netlify + your domain + continuous deployment)

1. **GitHub:** create a new repository, then from this folder run
   `git remote add origin https://github.com/<you>/cocktail-cabinet.git && git push -u origin main`.
2. **Netlify:** go to *Add new site → Import an existing project → GitHub* and pick the repo. Leave the build command empty and set the publish directory to `.` (the settings in `netlify.toml` do this for you). Every push to `main` now redeploys the site.
3. **Domain:** buy a domain (Netlify, Namecheap, Porkbun or Cloudflare all work). In Netlify, go to *Domain management → Add a domain* and enter `games.yourdomain.com`.
   - If DNS is somewhere else, add a **CNAME** record `games → <your-site>.netlify.app`.
   - Wait for verification. Netlify then issues HTTPS automatically.
4. Submit `https://games.yourdomain.com` on Canvas.

## Files

```
index.html          page shell
css/style.css       cabinet styling
js/core.js          shared helpers (seeded RNG, drawing, HUD)
js/app.js           menu, side pickers, input, game loop, sound
js/net.js           PeerJS matchmaking and private rooms
js/games/*.js       one file per game: rules, both AIs, drawing
test/               headless balance sim, protocol test, browser smoke test
DELEGATION_LOG.md   what was delegated to Claude and how it was checked
```
