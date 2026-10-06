/* IMITATION — the Imitation Game (Turing test).
   Two players chat for 2½ minutes, then each guesses: was the other one a human or an AI?

   Every player has a TRUTH (human or AI) and a GOAL (seem human, or seem like an AI):
     - a human can play it straight, or try to pass as an AI;
     - an AI player (the built-in chat bot, or Claude driving another browser through
       Claude in Chrome) always tries to pass as human.
   Scoring: +1 if your guess about your partner is right, +1 if your partner's guess about you
   matches your goal (you fooled or convinced them). Highest score wins; equal scores draw.

   Opponents: a human in another browser (WebRTC via PeerJS, see js/net.js), Claude in Chrome
   in another browser joining as an "AI agent", or the built-in chat bot. Matchmaking never
   connects instantly, and when nobody is online "Find a match" quietly pairs you with the
   built-in bot. The bot types at human speed, makes typos, gets things wrong, deflects and
   asks questions back. It runs entirely in the page: no API keys, no server. */
(function () {
  'use strict';
  const CHAT_TIME = 150, READY_AFTER = 45, GUESS_TIME = 30, MAX_LEN = 200;
  const HANDLES = ['kestrel_92', 'mossy', 'quietfox', 'rhombus', 'jun.p', 'tealcup', 'b0rk', 'nightowl7', 'pixelpine', 'saffron_x', 'oatmilk', 'zed_zed', 'lumen', 'marigold', 'heron', 'tinycactus', 'gray.wolf', 'parsnip', 'sleepyfern', 'k4tie'];
  const FIRST = ['maya', 'josh', 'sam', 'ari', 'noah', 'lily', 'dani', 'ethan', 'zoe', 'ben', 'nina', 'leo', 'talia', 'max', 'rachel', 'eli', 'sofia', 'jake', 'avi', 'hannah'];

  // ------------------------------------------------------------------ the built-in chat bot
  function makePersona(rng) {
    return {
      first: rng.pick(FIRST),
      age: rng.int(18, 24),
      city: rng.pick(['jersey', 'philly', 'boston', 'ohio', 'near chicago', 'long island', 'baltimore', 'upstate ny', 'florida', 'toronto']),
      major: rng.pick(['bio', 'cs', 'psych', 'business', 'nursing', 'econ', 'accounting', 'undecided lol']),
      hobbies: [rng.pick(['basketball', 'running', 'volleyball', 'the gym', 'soccer']), rng.pick(['baking', 'reading', 'drawing', 'guitar', 'photography', 'video games', 'chess'])],
      doing: rng.pick(['avoiding hw', 'waiting for my laundry', 'on the bus', 'eating cereal', 'supposed to be studying', 'watching something in the background', 'lying in bed']),
      food: rng.pick(['pizza', 'sushi', 'tacos', 'pasta', 'ramen', 'burgers', 'shawarma']),
      color: rng.pick(['blue', 'green', 'black', 'purple', 'red']),
      animal: rng.pick(['dogs', 'cats', 'otters', 'penguins']),
      cps: rng.range(4, 7.5),          // typing speed, characters per second
      lower: rng() < 0.8,              // types in all lowercase
      typo: rng.range(0.04, 0.12),     // chance of a typo per message
      emoji: rng.range(0, 0.08),
    };
  }

  function ChatBot(rng, p) {
    this.rng = rng; this.p = p;
    this.said = new Set(); this.asked = new Set();
    this.unanswered = []; this.pending = null;
    this.lastHeard = -1; this.lastSaid = -1; this.botQs = 0; this.greeted = false; this.partnerName = null;
    this.opener = rng() < 0.55 ? rng.range(2.5, 8) : rng.range(11, 18); // breaks the silence eventually
    this.idle = rng.range(16, 28); this.prods = 0;
    this.fast = 0; this.lens = []; this.partnerLast = null;
    this.readyAt = READY_AFTER + rng.range(10, 70);
  }
  ChatBot.prototype.pick = function (arr) {
    const fresh = arr.filter((s) => !this.said.has(s));
    const s = this.rng.pick(fresh.length ? fresh : arr);
    this.said.add(s);
    return s;
  };
  ChatBot.prototype.style = function (m) {
    const r = this.rng, p = this.p;
    if (p.lower) m = m.toLowerCase();
    if (r() < 0.8) m = m.replace(/\.$/, '');
    if (r() < p.emoji) m += r.pick([' 😭', ' 😂', ' lol', ' 💀']);
    const out = [m];
    if (r() < p.typo) {
      const words = m.split(' '), idx = words.findIndex((w) => /^[a-z]{5,}$/i.test(w));
      const w0 = idx >= 0 ? words[idx] : '', k0 = idx >= 0 ? r.int(1, w0.length - 3) : 0;
      if (idx >= 0 && w0[k0] !== w0[k0 + 1]) {
        const w = w0, k = k0;
        words[idx] = w.slice(0, k) + w[k + 1] + w[k] + w.slice(k + 2);
        out[0] = words.join(' ');
        if (r() < 0.5) out.push('*' + w);
      }
    }
    return out;
  };
  ChatBot.prototype.askSomething = function () {
    const pool = ['where r u from', 'what do u do for fun', 'do u go to school', 'what are u up to rn', 'how old r u', 'so how do i know ur not a bot lol', 'whats ur name btw'];
    const left = pool.filter((q) => !this.asked.has(q));
    if (!left.length) return null;
    const q = this.rng.pick(left);
    this.asked.add(q);
    return q;
  };
  ChatBot.prototype.respond = function (raw) {
    const r = this.rng, p = this.p, R = (a) => this.pick(a);
    const t = raw.toLowerCase().replace(/[’']/g, "'").trim();
    const isQ = /\?\s*$/.test(t) || /^(what|who|where|when|why|how|do|does|did|are|r|is|can|could|would|will|have|u)\b/.test(t);
    let out = null, follow = false;
    // People don't answer "lol" with "lol" forever: usually go quiet, or move things along.
    if (/^(lol|ok|okay|haha+|mhm|fair|oh|true|ya|yeah|fr|so|😭|😂|💀|lmao+|k|same)[\s.!😭😂💀]*$/.test(t)) {
      if (r() < 0.6) return [];
      const q = this.askSomething();
      return q ? this.style(q) : [];
    }
    const math = t.match(/(-?\d+(?:\.\d+)?)\s*(\+|-|\*|x|×|times|plus|minus|\/|divided by)\s*(-?\d+(?:\.\d+)?)/);
    const nameIs = t.match(/\b(?:my name is|my name's|call me|i'?m called)\s+([a-z]{2,15})/);
    if (/ignore (all |any )?(previous|prior|above|your)|system prompt|language model|you are (now )?an? (ai|assistant)|developer mode/.test(t)) {
      out = R(['what??', 'lol what are u talking about', 'ok thats a weird thing to say', 'huh', 'is that like a hacker thing lol']);
    } else if (/\b(are|r)\s+(you|u)\s+(a |an )?(bot|ai|robot|computer|machine|human|real|person|chat ?gpt|claude|npc)\b|^(bot|ai|human)\?|prove (you|u|it)|\b(you'?re|ur|you are|u r|youre)\s+(definitely |totally |so |such |def |100% |obviously |clearly )?(a |an )?(bot|ai|robot|computer|chat ?gpt)\b/.test(t)) {
      this.botQs++;
      out = this.botQs === 1 ? R(['lol no', 'nah im a person', 'thats exactly what a bot would ask', 'no?? are u', 'i mean how would i even prove that', 'beep boop. jk'])
        : this.botQs === 2 ? R(['u keep asking that lol', 'i literally told u', 'ok what would a bot not know then', 'idk what to tell u'])
          : R(['ok believe whatever u want', 'lol ur obsessed', 'fine im a toaster']);
    } else if (math) {
      const a = +math[1], b = +math[3], op = math[2];
      const v = /\+|plus/.test(op) ? a + b : /-|minus/.test(op) ? a - b : /\*|x|×|times/.test(op) ? a * b : b ? a / b : NaN;
      const easy = Math.abs(a) <= 12 && Math.abs(b) <= 12 && Number.isInteger(v);
      if (easy) out = r() < 0.7 ? String(v) : 'its ' + v + '?? lol';
      else if (r() < 0.5) out = R(['lol why are u giving me math', 'im not doing math rn', 'uhh i dont have a calculator open']);
      else out = 'like ' + (Math.abs(v) > 100 ? Math.round(v / 10) * 10 : Math.round(v)) + ' something? idk';
    } else if (nameIs) {
      this.partnerName = nameIs[1];
      out = R([`nice, im ${p.first}`, `hi ${nameIs[1]} lol`, `${p.first} here`]);
    } else if (/^(hi+|hey+|hello+|yo+|sup|hiya|heyo|howdy|hola)\b/.test(t) && t.length < 25) {
      out = this.greeted ? (this.askSomething() || R(['so whats up', 'so...'])) : R(['hey', 'hii', 'yo', 'hey whats up', 'hello lol', 'heyy']);
      this.greeted = true;
      if (/how/.test(t)) out += ' ' + R(['im good wbu', 'doing ok wbu']);
    } else if (/how (are|r) (you|u)|how'?s it going|\bhru\b|how'?s your day|how u doing/.test(t)) {
      out = R(['good wbu', 'im ok, kinda tired', 'pretty good hbu', 'eh its been a day', 'fine i guess, u?', 'not bad']);
    } else if (/what'?s (ur|your) name|who (are|r) (you|u)\b|ur name|your name/.test(t)) {
      out = R([p.first, `${p.first}, wbu`, `its ${p.first}`, `${p.first} lol why`]);
    } else if (/how old|ur age|your age/.test(t)) {
      out = R([String(p.age), `${p.age} wbu`, `${p.age}`, 'old enough lol']);
    } else if (/where (are|r) (you|u) from|where do (you|u) live|where (are|r) (you|u) (located|at)|where u from/.test(t)) {
      out = R([p.city, `${p.city} wbu`, `im from ${p.city}`]);
    } else if (/\bwyd\b|what (are|r) (you|u) (doing|up to)|whatcha doing/.test(t)) {
      out = R([p.doing, `${p.doing} lol`, `not much, ${p.doing}`]);
    } else if (/for fun|hobb(y|ies)|what do (you|u) like|what are you into|what r u into/.test(t)) {
      out = R([`${p.hobbies[0]} and ${p.hobbies[1]} mostly`, `uh ${p.hobbies[1]}? and ${p.hobbies[0]}`, `${p.hobbies[0]} i guess`]);
    } else if (/\b(school|major|college|uni|university|study|studying|class|classes)\b/.test(t)) {
      out = R([`yeah im in college, ${p.major}`, `${p.major}`, `${p.major} major, its fine`]);
    } else if (/\b(job|work)\b/.test(t)) {
      out = R(['i work part time at a store, its whatever', 'just school rn', 'barista sometimes']);
    } else if (/capital of (\w+)/.test(t)) {
      const c = { france: 'paris', spain: 'madrid', italy: 'rome', japan: 'tokyo', england: 'london', germany: 'berlin', canada: 'ottawa i think' }[t.match(/capital of (\w+)/)[1]];
      out = c ? R([c + '? why', c + ' lol', 'uh ' + c]) : R(['idk lol', 'no clue', 'why would i know that']);
    } else if (/\b(explain|write me|write a|essay|summarize|code|poem|translate)\b/.test(t)) {
      out = R(['lol im not doing ur homework', 'no thanks', 'that sounds like effort']);
    } else if (/what time|what day|today'?s date|what'?s the date/.test(t)) {
      const d = new Date();
      out = /day|date/.test(t) ? R(['its ' + d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase(), d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase() + ' why'])
        : 'like ' + ((d.getHours() % 12) || 12) + ':' + String(d.getMinutes()).padStart(2, '0');
    } else if (/weather|cold|hot out|raining/.test(t)) {
      out = R(['kinda cold here', 'its raining lol', 'nice out actually', 'hot. too hot']);
    } else if (/fav(ou?rite)? (\w+)/.test(t)) {
      const k = t.match(/fav(?:ou?rite)? (\w+)/)[1];
      const m = { food: p.food, color: p.color, colour: p.color, animal: p.animal, sport: p.hobbies[0] };
      out = m[k] ? R([m[k], `${m[k]} probably`, `prob ${m[k]}`]) : R(['hmm hard question', 'i dont really have one', 'idk theres too many']);
    } else if (/\bjoke\b/.test(t)) {
      out = R(['i dont know any good ones lol', 'why did the chicken... no i cant do this', 'u first']);
    } else if (/\b(stupid|dumb|boring|annoying|weird)\b/.test(t)) {
      out = R(['rude', 'ok wow', 'lol ok', 'damn']);
    } else if (/(you'?re|ur|you are) (funny|nice|cool|smart|great)/.test(t)) {
      out = R(['lol thanks', 'aw', 'i try']);
    } else if (/^(lol|lmao|haha+|hehe|😂|💀|lmfao)/.test(t)) {
      out = R(['lol', 'haha', '😭', 'lmaooo', 'ya']); follow = r() < 0.4;
    } else if (/^(ok|okay|k|cool|nice|yeah|yea|ya|true|same|fr|bet|sure)\W*$/.test(t)) {
      out = R(['yeah', 'lol', 'so', 'fr', 'ya']); follow = true;
    } else if (/^(what|huh|\?+|wdym)\W*$/.test(t)) {
      out = R(['nvm', 'lol nothing', 'wdym what']);
    } else if (/^do (you|u) like (\w+)/.test(t)) {
      const x = t.match(/^do (?:you|u) like (\w+)/)[1];
      const mine = [p.food, p.animal, ...p.hobbies.map((h) => h.split(' ').pop())].some((w) => w.includes(x) || x.includes(w));
      out = mine ? R(['yes!!', 'yeah a lot actually', 'omg yes']) : R(['yeah', 'its ok', 'not really', 'kinda', 'nah']);
      follow = r() < 0.3;
    } else if (/^(do|does|did|are|r|have|can|could|would|will|is) (you|u)\b/.test(t)) {
      out = R(['yeah', 'nah', 'sometimes', 'not really', 'yea lol', 'i mean kinda', 'depends', 'no why']);
      follow = r() < 0.3;
    } else if (isQ) {
      out = R(['hmm idk', 'good question', 'wdym', 'why do u ask', 'idk honestly', 'no idea lol']);
    } else if (t.length > 40) {
      out = R(['oh nice', 'thats cool', 'wait really', 'fair', 'same tbh', 'hm interesting', 'lol true', 'oh thats wild']);
      follow = r() < 0.5;
    } else {
      out = R(['lol', 'ok', 'haha', 'mhm', 'fair', 'oh', 'true']);
      follow = r() < 0.5;
    }
    const msgs = [out];
    if (follow || (isQ && r() < 0.15)) { const q = this.askSomething(); if (q) msgs.push(q); }
    return msgs.reduce((acc, m) => acc.concat(this.style(m)), []);
  };
  // Queue a reply to everything heard since the last reply, typed at human speed.
  ChatBot.prototype.plan = function (now, msgs) {
    const r = this.rng;
    const heard = this.unanswered.join(' ');
    this.unanswered = [];
    msgs = msgs || this.respond(heard);
    if (!msgs.length) { this.pending = null; this.lastSaid = Math.max(this.lastSaid, this.lastHeard); return; }
    const read = CC.clamp(0.7 + heard.length * 0.035, 0.7, 4) * r.range(0.8, 1.6) + (r() < 0.12 ? r.range(2, 6) : 0);
    const typeStart = now + read;
    let t = typeStart;
    this.pending = { typeStart, out: msgs.map((m) => { t += m.length / this.p.cps * r.range(0.8, 1.3) + 0.4; return { at: t, text: m }; }) };
  };
  ChatBot.prototype.hear = function (text, now) {
    if (this.partnerLast != null && now - this.partnerLast < text.length / 14 + 0.6) this.fast++;
    this.lens.push(text.length);
    this.lastHeard = now;
    this.unanswered.push(text);
    if (!this.pending || now < this.pending.typeStart) this.plan(now); // still "reading": reply to the newest too
  };
  ChatBot.prototype.tick = function (now) {
    const send = [];
    if (this.opener != null && now >= this.opener) {
      if (this.lastHeard < 0 && !this.pending) this.plan(now, this.style(this.pick(['hey', 'hi', 'yo', 'hii', 'hello?'])));
      this.opener = null;
    }
    if (this.pending) {
      while (this.pending.out.length && now >= this.pending.out[0].at) send.push(this.pending.out.shift().text);
      if (!this.pending.out.length) { this.pending = null; this.lastSaid = now; if (this.unanswered.length) this.plan(now); }
    }
    if (send.length) this.partnerLast = now;
    // Nudge a quiet partner, but not forever.
    if (!this.pending && this.prods < 2 && this.lastSaid > this.lastHeard && now - this.lastSaid > this.idle) {
      this.prods++; this.idle = this.rng.range(18, 30);
      this.plan(now, this.style(this.pick(['u there?', 'hello?', 'lol ok', 'so...', 'helloooo'])));
    }
    return { send, typing: !!(this.pending && now >= this.pending.typeStart) };
  };
  ChatBot.prototype.guess = function () {
    const avg = this.lens.length ? this.lens.reduce((a, b) => a + b, 0) / this.lens.length : 0;
    const aiish = this.fast >= 2 || avg > 110;
    return this.rng() < (aiish ? 0.75 : 0.35) ? 'ai' : 'human';
  };

  // ------------------------------------------------------------------ the match
  function create(o) {
    const rng = o.rng, ai = o.ai, link = o.link || null;
    const me = o.myRole || (ai[0] ? { truth: 'ai', goal: 'human' } : { truth: 'human', goal: 'human' });
    const g = {
      over: false, result: null, t: 0, phase: 'chat', msgs: [], ready: [false, false], guess: [null, null],
      opp: link ? null : { truth: 'ai', goal: 'human' }, oppTyping: false, names: [o.myName || 'You', o.oppName || 'Stranger'],
      inbox: [], sentGuess: false, guessT: 0, link,
    };
    const bots = [ai[0] ? new ChatBot(rng, makePersona(rng)) : null, !link ? new ChatBot(rng, makePersona(rng)) : null];
    if (link) { link.onMessage((m) => g.inbox.push(m)); link.onClose(() => g.inbox.push({ t: 'bye' })); }

    // ---------- DOM (browser only) ----------
    const ui = typeof document !== 'undefined' && !o.headless ? buildUI() : null;
    g.dom = ui && ui.root;
    g.focus = () => ui && ui.input && !ai[0] && ui.input.focus();
    g.say = (text) => sendMine(text); // also used by the automated tests

    function addMsg(seat, text, sys) {
      text = String(text).slice(0, MAX_LEN).trim();
      if (!text) return;
      g.msgs.push({ seat, text, t: g.t, sys: !!sys });
      if (ui) ui.add(seat, text, sys);
      if (sys) return;
      CC.sfx.play(seat === 0 ? 'place' : 'point');
      const other = bots[1 - seat];
      if (other) other.hear(text, g.t);
    }
    function sendMine(text) {
      if (g.phase !== 'chat') return;
      addMsg(0, text);
      if (link) link.send({ t: 'chat', text: String(text).slice(0, MAX_LEN) });
    }
    function setReady(seat) {
      if (g.ready[seat] || g.t < READY_AFTER) return;
      g.ready[seat] = true;
      if (seat === 0 && link) link.send({ t: 'ready' });
      addMsg(-1, (seat === 0 ? 'You are' : g.names[1] + ' is') + ' ready to guess.', true);
    }
    function startGuess() {
      g.phase = 'guess'; g.guessT = 0;
      if (ui) ui.toGuess();
      if (ai[0]) g.guess[0] = null; // the local bot decides in update()
    }
    function myGuess(v) {
      if (g.guess[0] || g.phase !== 'guess') return;
      g.guess[0] = v; g.phase = 'wait';
      if (ui) ui.waiting();
    }
    function finish(note) {
      const opp = g.opp || { truth: '?', goal: '?' };
      const sMe = (g.guess[0] === opp.truth ? 1 : 0) + (g.guess[1] === me.goal ? 1 : 0);
      const sOpp = (g.guess[1] === me.truth ? 1 : 0) + (g.guess[0] === opp.goal ? 1 : 0);
      const a = (x) => (x === 'ai' ? 'an AI' : x === 'human' ? 'a human' : 'no answer');
      const watch = ai[0];
      const head = sMe > sOpp ? (watch ? g.names[0] + ' wins' : 'You win!') : sMe < sOpp ? (watch ? g.names[1] + ' wins' : 'You lose') : 'Draw';
      let reason = note ? note + ' ' : '';
      if (g.opp) reason += `${g.names[1]} was ${a(opp.truth)}${opp.goal !== opp.truth ? ' pretending to be ' + a(opp.goal) : ''}. `;
      reason += `${watch ? g.names[0] : 'You'} guessed ${a(g.guess[0])}; ${g.names[1]} guessed ${watch ? g.names[0] : 'you'} were ${a(g.guess[1])}. Score ${sMe}–${sOpp}.`;
      g.scores = [sMe, sOpp];
      g.over = true;
      g.result = { winner: sMe > sOpp ? 0 : sMe < sOpp ? 1 : -1, head, reason };
      if (link) setTimeout(() => link.close(), 1500);
    }

    addMsg(-1, `Matched with ${g.names[1]}. You have ${Math.round(CHAT_TIME / 30) / 2} minutes. Say hi!`, true);

    g.update = function (dt) {
      if (g.over) return;
      g.t += dt;
      // network
      while (g.inbox.length) {
        const m = g.inbox.shift();
        if (!m || typeof m !== 'object') continue;
        if (m.t === 'chat' && (g.phase === 'chat' || g.guessT < 3)) { addMsg(1, m.text); g.oppTyping = false; } // grace for last-second messages
        if (m.t === 'typing') g.oppTyping = !!m.on && g.phase === 'chat';
        if (m.t === 'ready') setReady(1);
        if (m.t === 'guess' && (m.g === 'human' || m.g === 'ai')) { g.guess[1] = m.g; g.opp = { truth: m.truth === 'ai' ? 'ai' : 'human', goal: m.goal === 'ai' ? 'ai' : 'human' }; }
        if (m.t === 'bye' && !g.over && !g.guess[1]) {
          if (g.phase === 'chat') { addMsg(-1, g.names[1] + ' left the chat.', true); g.phase = 'guess'; startGuess(); g.partnerLeft = true; }
          else g.partnerLeft = true;
        }
      }
      // bots
      for (let s = 0; s < 2; s++) {
        const b = bots[s];
        if (!b) continue;
        if (g.phase === 'chat') {
          const r = b.tick(g.t);
          for (const text of r.send) { if (s === 0) sendMine(text); else addMsg(1, text); }
          if (s === 1) g.oppTyping = r.typing;
          if (s === 0 && link && r.typing !== g.myTypingSent) { g.myTypingSent = r.typing; link.send({ t: 'typing', on: r.typing }); }
          if (g.t > b.readyAt && g.msgs.length >= 8) setReady(s);
        }
        if ((g.phase === 'guess' || g.phase === 'wait') && !g.guess[s] && g.guessT > b.readyAt % 5 + 2) {
          if (s === 0) { g.guess[0] = b.guess(); g.phase = 'wait'; } else g.guess[1] = b.guess();
        }
      }
      if (g.phase === 'chat') {
        if (g.t >= CHAT_TIME || (g.ready[0] && g.ready[1])) { addMsg(-1, 'Chat over. Time to guess!', true); startGuess(); }
        else if (g.t >= CHAT_TIME - 30 && g.t - dt < CHAT_TIME - 30) addMsg(-1, '30 seconds left.', true);
      } else {
        g.guessT += dt;
        if (g.phase === 'guess' && g.guessT > GUESS_TIME) myGuess('none');
        if (g.guess[0] && !g.sentGuess && link) { g.sentGuess = true; link.send({ t: 'guess', g: g.guess[0], truth: me.truth, goal: me.goal }); }
        if (g.guess[0] && g.guess[1] && g.opp) finish();
        else if (g.guess[0] && (g.partnerLeft || g.guessT > GUESS_TIME + 20)) finish(g.partnerLeft ? g.names[1] + ' left before guessing.' : g.names[1] + ' never guessed.');
      }
      if (ui) ui.refresh();
    };

    g.draw = function (ctx) { // the chat itself is HTML on top; just a backdrop here
      ctx.fillStyle = CC.pal.bg; ctx.fillRect(0, 0, CC.W, CC.H);
    };
    g.stats = () => ({ msgs: g.msgs.filter((m) => !m.sys).length, guess: g.guess, scores: g.scores });

    function buildUI() {
      const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
      const root = el('div', 'chat');
      const head = el('div', 'chat-head');
      const who = el('span', 'chat-who'); who.textContent = 'Chatting with ' + g.names[1];
      const goal = el('span', 'chat-goal', ai[0] ? 'Watching two computers' : 'Your goal: seem ' + (me.goal === 'ai' ? 'like an AI' : 'human'));
      const timer = el('span', 'chat-timer', '2:30');
      head.append(who, goal, timer);
      const log = el('div', 'chat-log'); log.setAttribute('aria-live', 'polite');
      const typing = el('div', 'chat-typing', g.names[1] + ' is typing…');
      const form = el('form', 'chat-form');
      const input = el('input'); input.maxLength = MAX_LEN; input.placeholder = ai[0] ? 'Watching…' : 'Type a message…'; input.disabled = !!ai[0];
      input.setAttribute('aria-label', 'Message');
      const send = el('button', 'btn primary', 'Send'); send.type = 'submit'; send.disabled = !!ai[0];
      const readyBtn = el('button', 'btn', 'Ready to guess'); readyBtn.type = 'button'; readyBtn.disabled = true;
      form.append(input, send, readyBtn);
      const guessBox = el('div', 'chat-guess'); guessBox.hidden = true;
      const q = el('p', null, `Was ${g.names[1]} a human or an AI?`);
      const bH = el('button', 'btn big', 'Human'), bA = el('button', 'btn big', 'AI');
      bH.type = bA.type = 'button';
      const row = el('div', 'row'); row.append(bH, bA);
      const gTimer = el('p', 'fine');
      guessBox.append(q, row, gTimer);
      root.append(head, log, typing, form, guessBox);

      let lastSend = 0, typingSent = false, typingTimer = null;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = input.value.trim();
        if (!v || g.phase !== 'chat' || performance.now() - lastSend < 400) return;
        lastSend = performance.now();
        sendMine(v); input.value = '';
        if (link && typingSent) { typingSent = false; link.send({ t: 'typing', on: false }); }
      });
      input.addEventListener('input', () => {
        if (!link) return;
        if (!typingSent) { typingSent = true; link.send({ t: 'typing', on: true }); }
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => { typingSent = false; link.send({ t: 'typing', on: false }); }, 2500);
      });
      readyBtn.addEventListener('click', () => setReady(0));
      bH.addEventListener('click', () => myGuess('human'));
      bA.addEventListener('click', () => myGuess('ai'));

      let shownT = -1;
      return {
        root, input,
        add(seat, text, sys) {
          const m = el('div', 'msg ' + (sys ? 'sys' : seat === 0 ? 'me' : 'them'), text);
          log.appendChild(m);
          log.scrollTop = log.scrollHeight;
        },
        toGuess() { form.hidden = true; typing.hidden = true; guessBox.hidden = false; if (!ai[0]) bH.focus(); },
        waiting() { row.hidden = true; q.textContent = 'Waiting for ' + g.names[1] + ' to guess…'; },
        refresh() {
          const left = Math.max(0, Math.ceil(CHAT_TIME - g.t));
          if (left !== shownT && g.phase === 'chat') { shownT = left; timer.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'); timer.classList.toggle('low', left <= 30); }
          typing.style.visibility = g.oppTyping && g.phase === 'chat' ? 'visible' : 'hidden';
          readyBtn.disabled = g.ready[0] || g.t < READY_AFTER || !!ai[0];
          readyBtn.textContent = g.ready[0] ? 'Waiting for them…' : g.t < READY_AFTER ? 'Ready to guess (' + Math.ceil(READY_AFTER - g.t) + ')' : 'Ready to guess';
          if (g.phase === 'guess') gTimer.textContent = Math.max(0, Math.ceil(GUESS_TIME - g.guessT)) + ' seconds to decide';
          if (g.phase === 'wait') { row.hidden = true; q.textContent = 'Waiting for ' + g.names[1] + ' to guess…'; gTimer.textContent = ''; }
        },
      };
    }
    return g;
  }

  // ------------------------------------------------------------------ lobby / matchmaking UI
  function mount(panel, api) {
    let myName = 'player' + Math.floor(100 + Math.random() * 900);
    try { myName = localStorage.getItem('cc-name') || myName; } catch (e) { /* storage blocked */ }
    panel.innerHTML = `
      <div class="imi">
        <label class="imi-name">Your name <input id="imi-name" maxlength="16"></label>
        <label class="imi-name">You are playing as
          <select id="imi-role">
            <option value="human-human">A human, acting human</option>
            <option value="human-ai">A human, pretending to be an AI</option>
            <option value="ai-human">An AI agent (e.g. Claude in Chrome), acting human</option>
          </select>
        </label>
        <div class="imi-modes">
          <button class="btn primary" data-m="online">Find a match</button>
          <button class="btn" data-m="host">Create private room</button>
          <span class="imi-join"><input id="imi-code" maxlength="4" placeholder="CODE" aria-label="Room code"><button class="btn" data-m="join">Join</button></span>
          <button class="btn" data-m="practice">Practice vs the computer</button>
          <button class="btn ghost" data-m="watch">Watch computer vs computer</button>
        </div>
        <p class="fine">"Find a match" pairs you with whoever else is searching. If nobody is online, you might get a computer player instead. You'll only find out at the end. Your role choice is only revealed after both of you guess.</p>
      </div>`;
    const nameEl = panel.querySelector('#imi-name'), roleEl = panel.querySelector('#imi-role');
    nameEl.value = myName;
    nameEl.addEventListener('change', () => { myName = nameEl.value.trim() || myName; try { localStorage.setItem('cc-name', myName); } catch (e) { /* ignore */ } });
    const role = () => { const [truth, goal] = roleEl.value.split('-'); return { truth, goal }; };
    let pending = null;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    async function asBot() {
      const name = HANDLES[Math.floor(Math.random() * HANDLES.length)];
      api.status('Opponent found: ' + name, 'Connecting…');
      await wait(800 + Math.random() * 1200);
      api.begin({ ai: [false, true], myName, oppName: name, myRole: role() });
    }
    async function handshake(link) {
      api.status('Opponent found!', 'Connecting…');
      await wait(1500 + Math.random() * 1500); // never instant
      link.send({ t: 'hello', name: myName });
      const hello = await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('Handshake timed out')), 10000);
        link.onMessage((m) => { if (m && m.t === 'hello') { clearTimeout(to); res(m); } });
      });
      api.begin({ ai: [false, true], myName, oppName: String(hello.name || 'stranger').slice(0, 16), myRole: role(), link });
    }

    panel.addEventListener('click', async (ev) => {
      const m = ev.target && ev.target.dataset && ev.target.dataset.m;
      if (!m) return;
      if (pending && pending.cancel) pending.cancel();
      myName = nameEl.value.trim() || myName;
      const token = (api.token = Math.random());
      const alive = () => api.token === token;
      try {
        if (m === 'watch') { api.begin({ ai: [true, true], myName: 'Bot A', oppName: 'Bot B', myRole: { truth: 'ai', goal: 'human' } }); return; }
        if (m === 'practice') {
          api.status('Setting up a practice chat…', 'Your partner is the computer');
          await wait(1200 + Math.random() * 1200);
          if (alive()) api.begin({ ai: [false, true], myName, oppName: 'Computer', myRole: role() });
          return;
        }
        if (m === 'online') {
          const minWait = wait(3000 + Math.random() * 3000);
          const searchFor = 12000 + Math.random() * 9000;
          let found = null;
          if (CC.Net && CC.Net.available()) {
            pending = CC.Net.findMatch({ timeoutMs: searchFor, onStatus: (s) => alive() && api.status(s, 'Looking for another player…') });
            found = await pending.catch(() => null);
          } else { api.status('Searching for players…'); await wait(searchFor * 0.5); }
          await minWait;
          if (!alive()) { if (found) found.link.close(); return; }
          if (found) await handshake(found.link); else await asBot();
          return;
        }
        if (m === 'host') {
          if (!CC.Net || !CC.Net.available()) throw new Error('Online play could not load (PeerJS blocked?).');
          const code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
          api.status('Room code: ' + code, 'Opening room…');
          const r = await CC.Net.hostRoom(code, (s) => alive() && api.status('Room code: ' + code, s));
          if (alive()) await handshake(r.link);
          return;
        }
        if (m === 'join') {
          const code = panel.querySelector('#imi-code').value.trim().toUpperCase();
          if (code.length !== 4) throw new Error('Enter the 4-letter room code.');
          if (!CC.Net || !CC.Net.available()) throw new Error('Online play could not load (PeerJS blocked?).');
          const r = await CC.Net.joinRoom(code, (s) => alive() && api.status(s));
          if (alive()) await handshake(r.link);
        }
      } catch (e) {
        if (alive()) api.status('Could not connect', e.message || String(e), true);
      }
    });
  }

  CC.register({
    id: 'imitation', name: 'Imitation', color: '#ff4d6d', glyph: '◉',
    blurb: 'The Imitation Game. Chat with a stranger for 2½ minutes, then guess: human or AI? Humans can try to pass as AIs, and the AI tries to pass as human.',
    roles: [
      { name: 'You', controls: 'Type and press Enter. Choose whether to act human or pretend to be an AI' },
      { name: 'Opponent', controls: 'A human in another browser, Claude in Chrome, or the built-in computer player' },
    ],
    goals: 'Score 1 point for guessing right about your partner, and 1 point if their guess about you matches your goal.',
    custom: true, balance: false,
    mount, create,
  });
})();
