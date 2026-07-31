// Mobile Connection outbound queue (v1.0.43 resilience). Verifies that user
// input typed during a disconnect is buffered and flushed on re-auth, that
// ephemeral messages are not queued, and that the auth handshake is not
// deadlocked by the "send only when authed" guard.
const instances = [];
global.WebSocket = class {
  constructor() { this.readyState = 0; this.sent = []; instances.push(this); }
  send(d) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; }
};
global.WebSocket.OPEN = 1;
global.location = { protocol: 'http:', host: 'x' };

const { Connection } = await import('../../mobile/connection.js');

let pass = 0, fail = 0;
const check = (label, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };

const c = new Connection('tok');

// 1. Before any socket: user input is queued, ephemeral is dropped.
c.send({ type: 'input', id: 't1', data: 'ls\r' });
c.send({ type: 'listTerminals' });
c.send({ type: 'ping' });
check('input queued while disconnected', c._queue.length === 1);
check('ephemeral (listTerminals/ping) not queued', c._queue.every((m) => m.type === 'input'));

// 2. Connect + open: the auth handshake goes out even though not yet authed.
c.connect();
const ws = instances[instances.length - 1];
ws.readyState = 1; // OPEN
ws.onopen();
check('auth sent on open (not deadlocked)', ws.sent.some((m) => m.type === 'auth'));
check('queued input NOT sent before authed', !ws.sent.some((m) => m.type === 'input'));

// 3. Authed: the queue flushes, input is delivered, queue emptied.
ws.onmessage({ data: JSON.stringify({ type: 'authed', version: 't' }) });
check('queued input flushed after authed', ws.sent.some((m) => m.type === 'input' && m.data === 'ls\r'));
check('queue emptied after flush', c._queue.length === 0);

// 4. While authed, sends go straight out.
c.send({ type: 'input', id: 't1', data: 'pwd\r' });
check('live input sent immediately when authed', ws.sent.filter((m) => m.type === 'input').length === 2);

// 5. Queue is bounded.
const c2 = new Connection('tok');
for (let i = 0; i < 500; i++) c2.send({ type: 'input', id: 't', data: `${i}` });
check('queue bounded at 200', c2._queue.length === 200);
check('bounded queue keeps the NEWEST', c2._queue[c2._queue.length - 1].data === '499');

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
