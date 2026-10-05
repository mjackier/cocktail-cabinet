/* Peer-to-peer matchmaking for Imitation, using the free public PeerJS broker
   (https://peerjs.com). No server of our own and no API keys: the broker only introduces the
   two browsers, then they talk directly over WebRTC.

   Lobby: up to 4 "slot" peer ids. A searcher first tries to join an existing slot host. If
   none answers, it claims a free slot and waits. While waiting it re-checks lower slots, so
   two people who arrive at the same moment still find each other. */
(function () {
  'use strict';
  const CC = window.CC;
  const SLOTS = 4;
  const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };
  const PREFIX = 'cocktailcab-' + hash(location.hostname || 'local') + '-v1-';

  function wrap(conn, peer) {
    const handlers = { msg: [], close: [] };
    let closed = false;
    conn.on('data', (d) => handlers.msg.forEach((f) => f(d)));
    const onClose = () => { if (closed) return; closed = true; handlers.close.forEach((f) => f()); };
    conn.on('close', onClose);
    conn.on('error', onClose);
    peer.on('disconnected', () => { /* broker gone: the direct link can still work */ });
    return {
      kind: 'net',
      send: (o) => { try { if (conn.open) conn.send(o); } catch (e) { /* ignore */ } },
      onMessage: (f) => handlers.msg.push(f),
      onClose: (f) => handlers.close.push(f),
      close: () => { try { conn.send({ t: 'bye' }); } catch (e) { /* ignore */ } setTimeout(() => { try { conn.close(); peer.destroy(); } catch (e) { /* ignore */ } }, 200); },
    };
  }

  function newPeer(id) {
    return new Promise((resolve, reject) => {
      const p = id ? new window.Peer(id, { debug: 0 }) : new window.Peer({ debug: 0 });
      const fail = (err) => { p.off('open'); try { p.destroy(); } catch (e) { /* ignore */ } reject(err); };
      p.once('open', () => { p.off('error', fail); resolve(p); });
      p.once('error', fail);
    });
  }

  // Try to open a data connection to `id` as a guest. Resolves with the conn or null.
  function tryJoin(peer, id, ms) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; peer.off('error', onErr); resolve(v); };
      const onErr = (e) => { if (e && e.type === 'peer-unavailable' && String(e.message).includes(id)) { finish(null); } };
      peer.on('error', onErr);
      const conn = peer.connect(id, { reliable: true });
      const timer = setTimeout(() => { try { conn.close(); } catch (e) { /* ignore */ } finish(null); }, ms);
      conn.on('open', () => {
        conn.send({ t: 'join' });
        conn.on('data', (d) => {
          if (d && d.t === 'accept') { clearTimeout(timer); finish(conn); }
          if (d && d.t === 'busy') { clearTimeout(timer); conn.close(); finish(null); }
        });
      });
    });
  }

  const Net = {
    available: () => typeof window.Peer === 'function',

    // Resolves {link} when matched with a human; rejects with 'timeout' or an error.
    findMatch(opts) {
      const status = opts.onStatus || (() => {});
      let cancelled = false, peer = null, scanTimer = null;
      const cleanup = () => { clearInterval(scanTimer); };
      const promise = new Promise(async (resolve, reject) => {
        const deadline = setTimeout(() => { cancelled = true; cleanup(); try { peer && peer.destroy(); } catch (e) { /* ignore */ } reject(new Error('timeout')); }, opts.timeoutMs);
        const win = (conn, p) => { if (cancelled) return; cancelled = true; clearTimeout(deadline); cleanup(); resolve({ link: wrap(conn, p) }); };
        try {
          status('Contacting matchmaking server…');
          peer = await newPeer();
          if (cancelled) return peer.destroy();
          status('Searching for players…');
          for (let s = 0; s < SLOTS && !cancelled; s++) {
            const c = await tryJoin(peer, PREFIX + 'lobby-' + s, 3500);
            if (c) return win(c, peer);
          }
          peer.destroy();
          // Nobody hosting: claim a slot and wait.
          for (let s = 0; s < SLOTS && !cancelled; s++) {
            try { peer = await newPeer(PREFIX + 'lobby-' + s); } catch (e) { if (e && e.type === 'unavailable-id') continue; throw e; }
            if (cancelled) return peer.destroy();
            status('Waiting in the lobby…');
            const hostPeer = peer;
            let taken = false;
            hostPeer.on('connection', (conn) => {
              conn.on('data', (d) => {
                if (!d || d.t !== 'join') return;
                if (taken || cancelled) { conn.send({ t: 'busy' }); setTimeout(() => conn.close(), 100); return; }
                taken = true; conn.send({ t: 'accept' });
                win(conn, hostPeer);
              });
            });
            // Look for a host in a lower slot now and then (simultaneous arrivals).
            if (s > 0) {
              scanTimer = setInterval(async () => {
                if (taken || cancelled) return;
                const guest = await newPeer().catch(() => null);
                if (!guest) return;
                for (let k = 0; k < s && !taken && !cancelled; k++) {
                  const c = await tryJoin(guest, PREFIX + 'lobby-' + k, 3000);
                  if (c) { taken = true; try { hostPeer.destroy(); } catch (e) { /* ignore */ } return win(c, guest); }
                }
                guest.destroy();
              }, 4000 + Math.random() * 2000);
            }
            return;
          }
          throw new Error('lobby full');
        } catch (e) {
          if (!cancelled) { cancelled = true; clearTimeout(deadline); cleanup(); reject(e); }
        }
      });
      promise.cancel = () => { cancelled = true; cleanup(); try { peer && peer.destroy(); } catch (e) { /* ignore */ } };
      return promise;
    },

    hostRoom(code, onStatus) {
      return newPeer(PREFIX + 'room-' + code).then((peer) => new Promise((resolve) => {
        onStatus && onStatus('Room ' + code + ' is open. Share the code and wait for your friend…');
        peer.on('connection', (conn) => {
          conn.on('data', (d) => { if (d && d.t === 'join') { conn.send({ t: 'accept' }); resolve({ link: wrap(conn, peer) }); } });
        });
      }));
    },

    joinRoom(code, onStatus) {
      onStatus && onStatus('Joining room ' + code + '…');
      return newPeer().then((peer) => tryJoin(peer, PREFIX + 'room-' + code, 8000).then((conn) => {
        if (!conn) { peer.destroy(); throw new Error('No room with code ' + code + ' is open.'); }
        return { link: wrap(conn, peer) };
      }));
    },
  };
  CC.Net = Net;
})();
