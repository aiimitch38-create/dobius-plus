import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Responsive conversation view for a session on mobile. Instead of mirroring the
 * width-locked raw terminal (a full-screen TUI drawn at the desktop's ~200 cols,
 * which shreds when squeezed onto a phone), this renders the session's TRANSCRIPT
 * as reflowing chat bubbles, and sends typed input straight to the PTY. The
 * desktop terminal is never resized or touched. Live-ish: it re-requests the
 * transcript on a short poll so new turns appear as Claude writes them.
 */
export default function ChatView({ connection, tab, onOpenTerminal }) {
  const sessionId = tab?.sessionId || null;
  const projectPath = tab?.sessionProject || null;
  const tabId = tab?.id || null;
  // Hook-confirmed "Claude is waiting on a prompt right now" (the same signal as
  // the red tab dot). Selector buttons only show while this holds, so a stale
  // selector lingering in the append-only PTY buffer after being answered can't
  // resurface (status flips to working/done the moment it's answered). Codex.
  const tabStatus = tab?.status || null;
  const [messages, setMessages] = useState(null); // null = loading
  const [input, setInput] = useState('');
  // Interactive selector Claude is currently showing (permission prompt, plan
  // approval, pick-one menu). null = none. Detected server-side from the live
  // PTY buffer because these TUI prompts are NOT in the transcript.
  const [selector, setSelector] = useState(null);
  // Live mirror of tabStatus for the message handler: a selector reply that
  // arrives AFTER status left 'needs' (in-flight when the prompt was answered)
  // must be dropped, or it would be stored and briefly shown when the tab next
  // enters 'needs' for a different (non-selector) prompt. Codex.
  const statusRef = useRef(tabStatus);
  const bodyRef = useRef(null);
  const atBottomRef = useRef(true);
  // Track the session we asked for so an out-of-order reply for a different
  // session (or a stale poll after switching tabs) can't render here.
  const wantRef = useRef(null);
  // Consecutive empty replies, to debounce clearing: a single transient empty
  // shouldn't blank a live conversation, but a persistent empty (transcript
  // reset/deleted) should. Resolves the transient-vs-real tension.
  const emptyStreakRef = useRef(0);

  const request = useCallback(() => {
    if (!sessionId || !projectPath) return;
    wantRef.current = sessionId;
    // limit = number of recent messages; the server does a cheap overscanning
    // tail read, so polling a huge transcript stays light.
    connection.send({ type: 'loadTranscript', sessionId, projectPath, limit: 200 });
  }, [connection, sessionId, projectPath]);

  // Ask the server whether the tab's live PTY is showing a selection prompt.
  const probeSelector = useCallback(() => {
    if (tabId) connection.send({ type: 'selectorSnapshot', id: tabId });
  }, [connection, tabId]);

  useEffect(() => {
    setMessages(null);
    emptyStreakRef.current = 0;
    if (!sessionId || !projectPath) return undefined;
    request();
    const poll = setInterval(request, 3500); // live-ish: pick up new turns
    return () => clearInterval(poll);
  }, [sessionId, projectPath, request]);

  useEffect(() => { statusRef.current = tabStatus; }, [tabStatus]);

  // Probe for a selector ONLY while Claude is waiting on a prompt (status
  // 'needs'). Always clear first: entering 'needs' for a NEW prompt must not
  // show a previous prompt's buttons until the fresh probe confirms, and
  // leaving 'needs' hides them immediately. Re-runs when tabStatus flips.
  useEffect(() => {
    setSelector(null);
    if (tabStatus !== 'needs') return undefined;
    probeSelector();
    const iv = setInterval(probeSelector, 2000);
    return () => clearInterval(iv);
  }, [tabStatus, probeSelector]);

  useEffect(() => {
    const off = connection.onMessage((msg) => {
      if (msg.type === 'transcript' && msg.sessionId === wantRef.current
          && (msg.projectPath == null || msg.projectPath === projectPath)) {
        const next = msg.entries || [];
        if (next.length > 0) {
          emptyStreakRef.current = 0;
          setMessages(next);
        } else {
          emptyStreakRef.current += 1;
          // Clear on first load / already-empty, or once an empty PERSISTS (a
          // real reset). A single transient empty after real content is kept, so
          // the chat doesn't flicker to "No messages yet". Codex.
          setMessages((prev) => (!prev || prev.length === 0 || emptyStreakRef.current >= 2 ? [] : prev));
        }
      } else if (msg.type === 'selector' && msg.id === tabId) {
        // Drop a reply that raced past the prompt being answered. Codex.
        setSelector(statusRef.current === 'needs' ? (msg.selector || null) : null);
      }
    });
    return off;
  }, [connection, projectPath, tabId]);

  // Auto-scroll to the newest message, but only if the user was already at the
  // bottom (don't yank them up while they scroll back through history).
  useEffect(() => {
    const el = bodyRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const send = () => {
    const text = input.trim();
    if (!text || !tabId) return;
    // Input is width-independent, so it goes straight to the live PTY; the reply
    // shows up on the next transcript poll.
    connection.send({ type: 'input', id: tabId, data: `${text}\r` });
    setInput('');
    atBottomRef.current = true;
  };

  // Pick a selector option. Sends the ABSOLUTE option number the user tapped
  // (Claude's numbered prompts select on the digit key). Never relative arrows,
  // so a parse error in the cursor position can't select a DIFFERENT option than
  // the label. No trailing Enter, so a stray newline can't confirm a chained
  // prompt. Optimistically clear; the next probe reflects the real state.
  const chooseOption = (num) => {
    if (!tabId) return;
    connection.send({ type: 'input', id: tabId, data: String(num) });
    setSelector(null);
    atBottomRef.current = true;
  };

  if (!sessionId) {
    return (
      <div className="chat-empty">
        <p className="muted">No Claude conversation in this tab yet.</p>
        <p className="muted small">Switch to Terminal to see raw output, or start Claude here.</p>
      </div>
    );
  }

  return (
    <div className="chat-view">
      <main className="chat-body" ref={bodyRef} onScroll={onScroll}>
        {messages === null && <p className="muted pad">Loading conversation...</p>}
        {messages && messages.length === 0 && <p className="muted pad">No messages yet.</p>}
        {messages && messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role === 'assistant' ? 'assistant' : 'user'}`}>
            <div className="chat-role">{m.role === 'assistant' ? 'Claude' : 'You'}</div>
            <div className="chat-content">{m.content}</div>
          </div>
        ))}
      </main>
      {tabStatus === 'needs' && selector && selector.options && selector.options.length > 0 && (
        <div className="chat-selector">
          <div className="chat-selector-title">
            {selector.prompt || 'Claude is waiting for you to choose:'}
          </div>
          {selector.options.map((opt) => (
            <button
              key={opt.num}
              className="chat-selector-opt"
              onClick={() => chooseOption(opt.num)}
            >
              <span className="chat-selector-num">{opt.num}</span>
              <span className="chat-selector-label">{opt.label}</span>
            </button>
          ))}
          {onOpenTerminal && (
            <button className="chat-selector-term" onClick={onOpenTerminal}>
              Open terminal to answer manually
            </button>
          )}
        </div>
      )}
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Message Claude..."
          rows={1}
        />
        <button className="chat-send" onClick={send} aria-label="Send" disabled={!input.trim()}>↑</button>
      </div>
    </div>
  );
}
