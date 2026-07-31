/**
 * WebSocket client for the Dobius+ mobile bridge.
 *
 * Handles auth, reconnect with backoff, and a wake() hook so the app can
 * force an immediate reconnect when the PWA returns to the foreground (iOS
 * kills WebSockets while a PWA is backgrounded).
 */
export class Connection {
  constructor(token) {
    this.token = token;
    this.ws = null;
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.status = 'disconnected'; // disconnected | connecting | connected | authed
    this.reconnectDelay = 1000;
    this.shouldReconnect = true;
    this._reconnectTimer = null;
    this._pingTimer = null;
    // Outbound queue (v1.0.43 resilience): user actions typed during a
    // reconnect blip are buffered and flushed once re-authed, so a command
    // typed while the link drops is delivered, not silently lost. Only
    // deliberate, id-addressed actions queue; ephemeral/re-sent messages
    // (auth, ping, listTerminals, attach, ...) are not.
    this._queue = [];
  }

  onMessage(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  onStatus(cb) { this.statusListeners.add(cb); return () => this.statusListeners.delete(cb); }

  _setStatus(s) {
    this.status = s;
    for (const cb of this.statusListeners) { try { cb(s); } catch { /* noop */ } }
  }

  _emit(msg) {
    for (const cb of this.listeners) { try { cb(msg); } catch { /* noop */ } }
  }

  connect() {
    this.shouldReconnect = true;
    this._open();
  }

  _open() {
    clearTimeout(this._reconnectTimer);
    this._stopPing();
    this._setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch {
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return; // superseded by a newer socket
      this._setStatus('connected');
      this.send({ type: 'auth', token: this.token });
    };

    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      let justAuthed = false;
      if (msg.type === 'authed') {
        this.reconnectDelay = 1000;
        this._setStatus('authed');
        this._startPing();
        justAuthed = true;
      }
      // Emit FIRST so screens re-attach their terminal on `authed`, THEN flush
      // queued input, so the server has the subscription back before the queued
      // keystrokes replay (else the input would run unseen on the Mac). The
      // XtermView attach handler runs synchronously during _emit, ahead of the
      // flush. Codex v1.0.43 Phase 3c P2.
      this._emit(msg);
      if (justAuthed) this._flushQueue();
    };

    ws.onclose = (e) => {
      // Ignore a close from a socket we already replaced (wake() race).
      if (this.ws !== ws) return;
      this._stopPing();
      this._setStatus('disconnected');
      if (e.code === 4003) {
        // Token rejected: stop retrying, let the app re-pair.
        this.shouldReconnect = false;
        this._emit({ type: 'authFailed' });
        return;
      }
      this._scheduleReconnect();
    };

    ws.onerror = () => { /* onclose handles the retry */ };
  }

  /** Keepalive: mobile NAT/carrier middleboxes drop idle sockets in ~60s. */
  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => this.send({ type: 'ping' }), 30000);
  }

  _stopPing() {
    clearInterval(this._pingTimer);
    this._pingTimer = null;
  }

  _scheduleReconnect() {
    if (!this.shouldReconnect) return;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._open(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15000);
  }

  /** Force an immediate reconnect (e.g. on PWA foreground). */
  wake() {
    if (this.status === 'authed' || this.status === 'connecting') return;
    this.reconnectDelay = 1000;
    this._open();
  }

  send(obj) {
    const open = this.ws && this.ws.readyState === WebSocket.OPEN;
    // Send once authed, and let the `auth` handshake through while merely
    // connected (else we'd deadlock: auth is sent before we are authed).
    if (open && (this.status === 'authed' || obj?.type === 'auth')) {
      this.ws.send(JSON.stringify(obj));
      return;
    }
    // Not ready: queue deliberate, id-addressed user actions so they survive a
    // blip; drop ephemeral messages, which the screens re-send on re-auth.
    if (obj && (obj.type === 'input' || obj.type === 'kill')) {
      this._queue.push(obj);
      if (this._queue.length > 200) this._queue.shift(); // bound the buffer
    }
  }

  _flushQueue() {
    if (this._queue.length === 0) return;
    const pending = this._queue;
    this._queue = [];
    for (const obj of pending) this.send(obj); // now authed, so these go out
  }

  close() {
    this.shouldReconnect = false;
    clearTimeout(this._reconnectTimer);
    this._stopPing();
    if (this.ws) { try { this.ws.close(); } catch { /* noop */ } }
  }
}
