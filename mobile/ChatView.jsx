import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Responsive conversation view for a session on mobile. Instead of mirroring the
 * width-locked raw terminal (a full-screen TUI drawn at the desktop's ~200 cols,
 * which shreds when squeezed onto a phone), this renders the session's TRANSCRIPT
 * as reflowing chat bubbles, and sends typed input straight to the PTY. The
 * desktop terminal is never resized or touched. Live-ish: it re-requests the
 * transcript on a short poll so new turns appear as Claude writes them.
 */
export default function ChatView({ connection, tab }) {
  const sessionId = tab?.sessionId || null;
  const projectPath = tab?.sessionProject || null;
  const tabId = tab?.id || null;
  const [messages, setMessages] = useState(null); // null = loading
  const [input, setInput] = useState('');
  const bodyRef = useRef(null);
  const atBottomRef = useRef(true);
  // Track the session we asked for so an out-of-order reply for a different
  // session (or a stale poll after switching tabs) can't render here.
  const wantRef = useRef(null);

  const request = useCallback(() => {
    if (!sessionId || !projectPath) return;
    wantRef.current = sessionId;
    // limit = number of recent messages; the server does a cheap overscanning
    // tail read, so polling a huge transcript stays light.
    connection.send({ type: 'loadTranscript', sessionId, projectPath, limit: 200 });
  }, [connection, sessionId, projectPath]);

  useEffect(() => {
    setMessages(null);
    if (!sessionId || !projectPath) return undefined;
    request();
    const poll = setInterval(request, 3500); // live-ish: pick up new turns
    return () => clearInterval(poll);
  }, [sessionId, projectPath, request]);

  useEffect(() => {
    const off = connection.onMessage((msg) => {
      if (msg.type === 'transcript' && msg.sessionId === wantRef.current
          && (msg.projectPath == null || msg.projectPath === projectPath)) {
        // Trust the server result. The overscanning tail read already prevents
        // spurious empties from a tool-heavy tail, so an empty reply now means the
        // transcript is genuinely empty/reset and should clear the view. Codex.
        setMessages(msg.entries || []);
      }
    });
    return off;
  }, [connection, projectPath]);

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
