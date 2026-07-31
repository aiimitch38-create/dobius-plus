import { useState, useEffect } from 'react';
import Pairing from './Pairing';
import Board from './Board';
import TerminalScreen from './Terminal';
import History from './History';
import { Connection } from './connection';

const TOKEN_KEY = 'dobius-mobile-token';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [conn, setConn] = useState(null);
  const [status, setStatus] = useState('disconnected');
  const [view, setView] = useState('board'); // 'board' | 'terminal' | 'history'
  const [openTabId, setOpenTabId] = useState(null); // terminal opened from the board

  useEffect(() => {
    if (!token) { setConn(null); return undefined; }

    const c = new Connection(token);
    const offStatus = c.onStatus(setStatus);
    const offMsg = c.onMessage((msg) => {
      if (msg.type === 'authFailed') {
        // The stored token was rejected, so wipe it and drop back to pairing.
        localStorage.removeItem(TOKEN_KEY);
        setToken('');
      }
    });
    c.connect();
    setConn(c);

    // iOS kills the WebSocket while the PWA is backgrounded; reconnect on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') c.wake();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      offStatus();
      offMsg();
      c.close();
    };
  }, [token]);

  // Deep-link from a push tap: a cold start lands on ?open=<id>, and a warm app
  // gets a postMessage {type:'open-session'} from the service worker. Either way,
  // jump to that session instead of the last-shown screen. Audit MED-12.
  useEffect(() => {
    const openSession = (id) => { if (id) { setOpenTabId(id); setView('terminal'); } };
    try {
      const p = new URLSearchParams(window.location.search).get('open');
      if (p) {
        openSession(p);
        window.history.replaceState(null, '', window.location.pathname); // don't re-trigger on refresh
      }
    } catch { /* noop */ }
    const onSwMsg = (e) => { if (e.data?.type === 'open-session') openSession(e.data.id); };
    navigator.serviceWorker?.addEventListener('message', onSwMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onSwMsg);
  }, []);

  const handlePaired = (newToken) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
  };

  if (!token) {
    return <Pairing onPaired={handlePaired} />;
  }
  if (!conn) {
    return <div className="screen center"><p className="muted">Connecting...</p></div>;
  }
  if (view === 'history') {
    return <History connection={conn} onBack={() => setView('board')} />;
  }
  if (view === 'terminal') {
    return (
      <TerminalScreen
        connection={conn}
        status={status}
        initialId={openTabId}
        onBack={() => setView('board')}
        onShowHistory={() => setView('history')}
      />
    );
  }
  // Home: the session board.
  return (
    <Board
      connection={conn}
      status={status}
      onOpen={(id) => { setOpenTabId(id); setView('terminal'); }}
      onShowHistory={() => setView('history')}
    />
  );
}
