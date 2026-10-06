# Cocktail Cabinet

Seven arcade games on one static page. Every game has two sides, and each side can be played by a **human** or the **computer**. Use the Classic, Flipped, Watch (computer vs computer) or 2 humans presets, or set each side yourself.

| Game | Side A | Side B | Flip |
|---|---|---|---|
| Snake | Snake | Feeder | The human places the apples (green outline = legal); the computer steers. |
| Breakout | Bottom paddle | Top paddle | Head-to-head: a shared brick wall in the middle, and the computer plays against you. |
| Splat | Flyer | Builder | The human sets each gap with the mouse; the computer flies with nothing but flaps. |
| Asteroids | Pilot | Thrower | The computer flies; the human drags rocks in from the edges, paid for with energy. |
| Missile Command | Defender | Attacker | **My design:** the human commands the warheads (drag from sky to ground, or ← → plus 1–9) against a computer defender. |
| Imitation | You | Opponent | The Imitation Game (Turing test): chat for 2½ minutes, then guess human or AI. Humans may pretend to be an AI; the AI pretends to be human. |
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
Tetris        Stacker 50%   Picker 50%
```

## Imitation: the Imitation Game

Two players chat for 2½ minutes (either can end early with **Ready to guess** after 45 s). Then each guesses whether the other was a **human** or an **AI**.

- **Roles.** Before matching, you choose: a human acting human, a human **pretending to be an AI**, or an **AI agent** acting human. Your choice is only revealed after both of you guess.
- **Scoring.** You get +1 for guessing right about your partner, and +1 if your partner's guess about you matches your goal. The higher score wins; equal scores draw.
- **The AI side.** No API keys are used anywhere.
  - **Claude in your own browser:** open the site in a second browser window, let Claude in Chrome drive it, choose "An AI agent (e.g. Claude in Chrome), acting human", and join the other player's private room code. A prompt you can give Claude in Chrome:
    > Go to https://games.jackier.xyz/#imitation. Set "You are playing as" to "An AI agent, acting human", type the room code ABCD in the code box and click Join. Chat like a casual human college student: short lowercase messages, the occasional typo, don't be too perfect. When the chat ends, guess whether your partner is human or AI.
  - **Built-in computer player:** when nobody else is online, **Find a match** quietly falls back to a chat bot that runs entirely in the page. It has a persona (name, age, city, major, hobbies), types at human speed with a "typing…" indicator, makes and corrects typos, dodges "are you a bot?", refuses homework and jailbreak prompts, and gets math slightly wrong. It also uses **Practice** and **Watch computer vs computer**.
- **Matchmaking.** `js/net.js` uses the free public [PeerJS](https://peerjs.com) broker to introduce the two browsers, which then talk directly over WebRTC. There is no server of our own. Searching always takes a few seconds and connecting adds a short delay, so an AI opponent is never obvious from timing.

To test with a human, open the site in two browsers, or a normal and a private window, and click **Find a match** in both within a few seconds.

## Run locally

```bash
python3 -m http.server 8080      # then open http://localhost:8080
node test/simulate.js all 40     # balance check, computer vs computer
node test/protocol.js            # Imitation: two simulated browsers agree on chat, guesses and score
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
