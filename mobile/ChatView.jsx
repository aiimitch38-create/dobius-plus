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
  const [messages, setMessages] = useState(null); // null = loading
  const [input, setInput] = useState('');
  // Interactive selector Claude is currently showing (permission prompt, plan
  // approval, AskUserQuestion). null = none. Detected server-side from the live
  // PTY buffer because these TUI prompts are NOT in the transcript. Display is
  // parser-driven, NOT gated on the hook-driven 'needs' status: AskUserQuestion
  // doesn't reliably fire the Notification hook, so the old status gate kept
  // question popups from ever appearing (Sam's v1.0.51 bug 1). Staleness is the
  // parser's job (trailing-prose rejection) plus the server's post-answer
  // re-push and the optimistic clear in chooseOption.
  const [selector, setSelector] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const fileInputRef = useRef(null);
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
    // tabId authorizes this socket to send input to the tab (server gates
    // input/kill on the socket's touched-tab set, and the Chat view never
    // attaches). Audit Medium.
    connection.send({ type: 'loadTranscript', sessionId, projectPath, tabId, limit: 200 });
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

  // Probe for a selector on a steady interval while this tab's chat is open.
  // Cheap server-side (strip + regex over the rolling PTY tail). Clear on tab
  // switch so another tab's buttons never flash here.
  useEffect(() => {
    setSelector(null);
    if (!tabId) return undefined;
    probeSelector();
    const iv = setInterval(probeSelector, 2500);
    return () => clearInterval(iv);
  }, [tabId, probeSelector]);

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
        setSelector(msg.selector || null);
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
    // submitPrompt: the server bracketed-pastes the text, then presses Enter as
    // a DISCRETE keypress after the paste settles. Sending `text\r` in one
    // chunk made Claude's Ink TUI treat the \r as pasted newline, so messages
    // sat in the input box unsubmitted (Sam's v1.0.51 bug 3).
    connection.send({ type: 'submitPrompt', id: tabId, text });
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

  // Fine-control keys for the selector (v1.0.53 UX): multiSelect prompts need
  // arrows to move, space to toggle, Enter to confirm, Esc to cancel; tapping a
  // digit alone can't finish those. Enter/Esc optimistically clear the popup
  // (the server re-push + probe restore it if a chained prompt follows).
  const SELECTOR_KEYS = [
    ['↑', '\x1b[A', false], ['↓', '\x1b[B', false], ['space', ' ', false],
    ['esc', '\x1b', true], ['enter', '\r', true],
  ];
  const sendSelectorKey = (seq, closes) => {
    if (!tabId) return;
    connection.send({ type: 'input', id: tabId, data: seq });
    if (closes) setSelector(null);
  };

  // Upload a screenshot / file from the phone: POST the bytes, get back an
  // absolute temp path on the Mac, and append that path to the input so it
  // rides the normal submitPrompt (Claude Code reads local file paths, same
  // contract as the desktop clipboard-image flow). v1.0.53.
  const uploadFiles = async (files) => {
    if (!files?.length || uploading) return;
    setUploading(true);
    setUploadMsg(''); // clear a stale error from a previous attempt (Codex Low)
    try {
      const paths = [];
      for (const f of [...files].slice(0, 5)) {
        // Always octet-stream: the server's raw parser accepts everything, and
        // a real JSON mime would otherwise be consumed by express.json (Codex).
        const res = await fetch(`./upload?name=${encodeURIComponent(f.name || 'upload')}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/octet-stream' },
          body: f,
        });
        const data = await res.json().catch(() => null);
        if (data?.ok && data.path) paths.push(data.path);
        else setUploadMsg(data?.error || `Upload failed (${res.status})`);
      }
      if (paths.length) setInput((cur) => `${cur}${cur && !cur.endsWith(' ') ? ' ' : ''}${paths.join(' ')} `);
    } catch {
      setUploadMsg('Upload failed (offline?)');
    } finally {
      setUploading(false);
    }
  };

  // No session linked yet: offer to launch Claude in this tab's shell (the
  // paced submitPrompt path types `claude` + Enter at the prompt). The session
  // link + transcript appear via the normal capture loop once Claude starts.
  // Previously this state was a dead end on mobile (Sam's v1.0.51 bug 2).
  const startClaude = () => {
    if (!tabId) return;
    connection.send({ type: 'submitPrompt', id: tabId, text: 'claude' });
  };

  if (!sessionId) {
    return (
      <div className="chat-empty">
        <p className="muted">No Claude conversation in this tab yet.</p>
        <button className="chat-start" onClick={startClaude}>Start Claude</button>
        <p className="muted small">Runs `claude` in this tab's shell. Or switch to Term for raw output.</p>
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
            <div className="chat-role">
              {m.role === 'assistant' ? 'Claude' : 'You'}
              {m.timestamp && <span className="chat-time">{fmtMsgTime(m.timestamp)}</span>}
            </div>
            <div className="chat-content">{m.content}</div>
          </div>
        ))}
      </main>
      {selector && selector.options && selector.options.length > 0 && (
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
          {/* Fine-control row: arrows/space for multiSelect movement + toggle,
              enter/esc to confirm/cancel, without leaving Chat. v1.0.53. */}
          <div className="chat-selector-keys">
            {SELECTOR_KEYS.map(([label, seq, closes]) => (
              <button key={label} className="chat-selector-key" onClick={() => sendSelectorKey(seq, closes)}>
                {label}
              </button>
            ))}
          </div>
          {onOpenTerminal && (
            <button className="chat-selector-term" onClick={onOpenTerminal}>
              Open terminal to answer manually
            </button>
          )}
        </div>
      )}
      {uploadMsg && <div className="chat-upload-msg">{uploadMsg}</div>}
      <div className="chat-input-row">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }}
        />
        <button
          className="chat-attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label="Attach a screenshot or file"
          title="Attach a screenshot or file (uploads to the Mac, path goes into the prompt)"
        >
          {uploading ? '…' : '+'}
        </button>
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          onPaste={(e) => {
            // Pasting an image (iOS long-press paste of a screenshot) uploads
            // it like the attach button; text pastes fall through untouched.
            const files = e.clipboardData?.files;
            if (files && files.length > 0) { e.preventDefault(); uploadFiles(files); }
          }}
          placeholder="Message Claude..."
          rows={1}
        />
        <button className="chat-send" onClick={send} aria-label="Send" disabled={!input.trim()}>↑</button>
      </div>
    </div>
  );
}

// "15:42" today, "Aug 4 15:42" earlier. Transcript timestamps are ISO strings.
function fmtMsgTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${hm}`;
}
