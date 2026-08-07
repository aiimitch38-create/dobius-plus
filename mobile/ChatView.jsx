import { useState, useEffect, useRef, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// One chat bubble. Assistant messages render as MARKDOWN (tables, code
// blocks, lists were showing as raw pipes/asterisks: Sam's v1.0.53 report);
// user messages stay literal text so pasted code/paths are never mangled.
// memo'd so the 3.5s transcript poll only re-parses bubbles whose content
// actually changed, not all 200.
// Per-tab input drafts, persisted so navigating Board -> tab -> Board -> tab
// never eats typed-but-unsent text (Sam's report). One localStorage key holds
// a { tabId: { text, at } } map, pruned to 40 entries / 7 days on write.
const DRAFTS_KEY = 'dobius-mobile-drafts';
function loadDraft(tabId) {
  if (!tabId) return '';
  try {
    const map = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
    return typeof map[tabId]?.text === 'string' ? map[tabId].text : '';
  } catch { return ''; }
}
function storeDraft(tabId, text) {
  if (!tabId) return;
  try {
    const map = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
    if (text) map[tabId] = { text, at: Date.now() };
    else delete map[tabId];
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const entries = Object.entries(map)
      .filter(([, v]) => v && typeof v.text === 'string' && (v.at || 0) > cutoff)
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .slice(0, 40);
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* private mode / quota: drafts just stay session-local */ }
}

const Bubble = memo(function Bubble({ role, content, timestamp, queued, sending }) {
  return (
    <div className={`chat-msg ${role === 'assistant' ? 'assistant' : 'user'}${sending ? ' chat-echo' : ''}`}>
      <div className="chat-role">
        {role === 'assistant' ? 'Claude' : 'You'}
        {timestamp != null && <span className="chat-time">{fmtMsgTime(timestamp)}</span>}
        {queued && <span className="chat-queued">queued</span>}
        {sending && <span className="chat-queued">sending…</span>}
      </div>
      <div className="chat-content">
        {role === 'assistant' ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Wide tables scroll inside their own container on a phone.
              table: ({ node: _node, ...props }) => (
                <div className="md-table-wrap"><table {...props} /></div>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        ) : content}
      </div>
    </div>
  );
});

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
  const [input, setInput] = useState(() => loadDraft(tabId));
  // Draft-aware setter: accepts a value or updater fn, mirrors to localStorage.
  const setDraft = useCallback((next) => {
    setInput((cur) => {
      const v = typeof next === 'function' ? next(cur) : next;
      storeDraft(tabId, v);
      return v;
    });
  }, [tabId]);
  // Rehydrate when this view is reused for a DIFFERENT tab (tabId prop swap).
  useEffect(() => { setInput(loadDraft(tabId)); }, [tabId]);
  // Interactive selector Claude is currently showing (permission prompt, plan
  // approval, AskUserQuestion). null = none. Detected server-side from the live
  // PTY buffer because these TUI prompts are NOT in the transcript. Display is
  // parser-driven, NOT gated on the hook-driven 'needs' status: AskUserQuestion
  // doesn't reliably fire the Notification hook, so the old status gate kept
  // question popups from ever appearing (Sam's v1.0.51 bug 1). Staleness is the
  // parser's job (trailing-prose rejection) plus the server's post-answer
  // re-push and the optimistic clear in chooseOption.
  const [selector, setSelector] = useState(null);
  // Sessionless tabs only: plain-text tail of the live PTY (null = loading).
  const [shellText, setShellText] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  // Local echoes: a just-sent message renders IMMEDIATELY instead of waiting
  // for the transcript poll (a mid-turn send used to look eaten: it sat in
  // Claude's queue and never appeared here; the server now also surfaces
  // queued entries). An echo drops once the transcript shows the same text,
  // or after 90s (e.g. the tab was a bare shell that ran it as a command).
  const [echoes, setEchoes] = useState([]);
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

  // Sessionless tabs: poll a plain-text tail of the live PTY so the phone can
  // SEE what the shell says and type into it, instead of the old dead end
  // (Asana 1217257328849820). Stops as soon as a session links up.
  useEffect(() => {
    setShellText(null);
    if (sessionId || !tabId) return undefined;
    const ask = () => connection.send({ type: 'terminalText', id: tabId });
    ask();
    const iv = setInterval(ask, 3000);
    return () => clearInterval(iv);
  }, [connection, sessionId, tabId]);

  useEffect(() => {
    const off = connection.onMessage((msg) => {
      if (msg.type === 'transcript' && msg.sessionId === wantRef.current
          && (msg.projectPath == null || msg.projectPath === projectPath)) {
        const next = msg.entries || [];
        // Prune echoes the transcript now covers (same trimmed text, queued or
        // real) and any older than 90s.
        setEchoes((cur) => {
          if (cur.length === 0) return cur;
          const seen = new Set(next.filter((m) => m.role === 'user').map((m) => m.content.trim()));
          const now = Date.now();
          const kept = cur.filter((e) => !seen.has(e.content.trim()) && now - e.at < 90_000);
          return kept.length === cur.length ? cur : kept;
        });
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
      } else if (msg.type === 'terminalText' && msg.id === tabId) {
        setShellText(typeof msg.text === 'string' ? msg.text : '');
      }
    });
    return off;
  }, [connection, projectPath, tabId]);

  // Auto-scroll to the newest message, but only if the user was already at the
  // bottom (don't yank them up while they scroll back through history).
  useEffect(() => {
    const el = bodyRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, echoes, shellText]);

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
    setEchoes((cur) => [...cur, { content: text, at: Date.now() }]);
    setDraft('');
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
      if (paths.length) setDraft((cur) => `${cur}${cur && !cur.endsWith(' ') ? ' ' : ''}${paths.join(' ')} `);
    } catch {
      setUploadMsg('Upload failed (offline?)');
    } finally {
      setUploading(false);
    }
  };

  // No session linked yet: launch Claude in this tab's shell, or resume the
  // most recent conversation for this project (`claude --continue`). The
  // session link + transcript appear via the normal capture loop once Claude
  // starts. Previously this state was a dead end on mobile (Sam's v1.0.51
  // bug 2 + Asana 1217257328849820).
  const startClaude = () => {
    if (!tabId) return;
    connection.send({ type: 'submitPrompt', id: tabId, text: 'claude' });
  };
  const resumeClaude = () => {
    if (!tabId) return;
    connection.send({ type: 'submitPrompt', id: tabId, text: 'claude --continue' });
  };

  // Selector popup + input row are shared by BOTH states below: a sessionless
  // tab that just ran `claude` immediately shows the trust-folder prompt, so
  // the selector buttons must work there too.
  const selectorPopup = selector && selector.options && selector.options.length > 0 && (
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
  );

  const inputRow = (
    <>
      {uploadMsg && <div className="chat-upload-msg">{uploadMsg}</div>}
      <div className="chat-input-row">
        {/* Interrupt/cancel from Chat (v1.0.53, Sam: "no way to cancel").
            One tap = ESC to the TUI: interrupts the running turn AND pops any
            queued messages back into Claude's input (the popAll op); a second
            tap clears that input. Red while the tab is actively working. */}
        <button
          className={`chat-esc${tab?.status === 'working' ? ' working' : ''}`}
          onClick={() => { if (tabId) connection.send({ type: 'input', id: tabId, data: '\x1b' }); }}
          aria-label="Interrupt Claude (escape)"
          title="Interrupt Claude / cancel queued messages. Tap again to clear its input."
        >
          esc
        </button>
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
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          onPaste={(e) => {
            // Pasting an image (iOS long-press paste of a screenshot) uploads
            // it like the attach button; text pastes fall through untouched.
            const files = e.clipboardData?.files;
            if (files && files.length > 0) { e.preventDefault(); uploadFiles(files); }
          }}
          placeholder={sessionId ? 'Message Claude...' : 'Type into the terminal...'}
          rows={1}
        />
        <button className="chat-send" onClick={send} aria-label="Send" disabled={!input.trim()}>↑</button>
      </div>
    </>
  );

  // Sessionless: live shell tail + Start/Resume, with the same selector popup
  // and input row so the tab is fully usable before Claude ever runs.
  if (!sessionId) {
    return (
      <div className="chat-view">
        <main className="chat-body" ref={bodyRef} onScroll={onScroll}>
          <p className="muted pad small">
            No Claude conversation in this tab yet. Live terminal:
          </p>
          {shellText === null && <p className="muted pad">Reading terminal...</p>}
          {shellText !== null && (
            <pre className="chat-shell-tail">{shellText || '(terminal is empty)'}</pre>
          )}
          <div className="chat-shell-actions">
            <button className="chat-start" onClick={startClaude}>Start Claude</button>
            <button className="chat-start alt" onClick={resumeClaude}>Resume last session</button>
          </div>
        </main>
        {selectorPopup}
        {inputRow}
      </div>
    );
  }

  return (
    <div className="chat-view">
      <main className="chat-body" ref={bodyRef} onScroll={onScroll}>
        {messages === null && <p className="muted pad">Loading conversation...</p>}
        {messages && messages.length === 0 && <p className="muted pad">No messages yet.</p>}
        {messages && messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} timestamp={m.timestamp || null} queued={!!m.queued} />
        ))}
        {echoes.map((e) => (
          <Bubble key={`echo-${e.at}`} role="user" content={e.content} timestamp={e.at} sending />
        ))}
      </main>
      {selectorPopup}
      {inputRow}
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
