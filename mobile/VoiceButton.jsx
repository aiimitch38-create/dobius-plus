import { useState, useRef } from 'react';

const TOKEN_KEY = 'dobius-mobile-token';

// Hold-to-talk mic. Records a command, uploads it to /voice/audio (the Mac
// transcribes locally with whisper.cpp + routes to the Conductor), shows what
// was heard, then the Conductor's spoken reply. Needs a secure context for the
// mic, so it disables itself on plain HTTP with a hint. v1.0.43 Phase 5.
export default function VoiceButton() {
  const [state, setState] = useState('idle'); // idle | recording | working | done | error
  const [line, setLine] = useState('');
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const resetRef = useRef(null);

  const secure = typeof window !== 'undefined' && window.isSecureContext;
  const supported = secure
    && typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined';

  const resetSoon = (ms) => {
    clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => { setState('idle'); setLine(''); }, ms);
  };

  const start = async () => {
    if (!supported || state === 'recording' || state === 'working') return;
    clearTimeout(resetRef.current);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = upload;
      mrRef.current = mr;
      mr.start();
      setState('recording');
      setLine('Listening…');
    } catch {
      setState('error');
      setLine('Microphone permission denied');
      resetSoon(4000);
    }
  };

  const stop = () => {
    if (mrRef.current && state === 'recording') {
      try { mrRef.current.stop(); } catch { /* noop */ }
    }
  };

  const upload = async () => {
    const stream = streamRef.current;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    const type = mrRef.current?.mimeType || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type });
    if (!blob.size) { setState('idle'); setLine(''); return; }
    setState('working');
    setLine('Transcribing…');
    const token = localStorage.getItem(TOKEN_KEY) || '';
    try {
      const res = await fetch('./voice/audio', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type },
        body: blob,
      });
      const j = await res.json();
      if (!j.ok) { setState('error'); setLine(j.error || 'Transcription failed'); resetSoon(5000); return; }
      setLine(`“${j.transcript}”`);
      if (j.requestId) { setState('working'); pollReply(j.requestId, token); }
      else { setState('done'); resetSoon(7000); } // heard it, but no Conductor to answer
    } catch {
      setState('error'); setLine('Upload failed'); resetSoon(4000);
    }
  };

  const pollReply = async (requestId, token) => {
    try {
      const res = await fetch('./voice/reply', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, timeoutMs: 30000 }),
      });
      const j = await res.json();
      setState('done');
      if (j.ok && j.reply) setLine(j.reply);
      resetSoon(10000);
    } catch {
      setState('done'); resetSoon(7000);
    }
  };

  if (!supported) {
    return (
      <button className="voice-fab disabled" disabled title={secure ? 'Voice not supported on this device' : 'Voice needs HTTPS (enable it in Dobius Settings)'}>
        <span aria-hidden="true">🎙</span>
      </button>
    );
  }

  return (
    <>
      {line && <div className={`voice-bubble voice-${state}`}>{line}</div>}
      <button
        className={`voice-fab voice-${state}`}
        onPointerDown={(e) => { e.preventDefault(); start(); }}
        onPointerUp={(e) => { e.preventDefault(); stop(); }}
        onPointerLeave={() => stop()}
        aria-label="Hold to talk"
      >
        <span aria-hidden="true">🎙</span>
      </button>
    </>
  );
}
