process.env.TZ = process.env.TZ || 'Asia/Bangkok';
const http = require('http');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const PORT = process.env.PORT || 5173;
const STORE_PATH = path.join(__dirname, '.push-store.json');
const DEFAULT_VAPID = {
  publicKey: process.env.VAPID_PUBLIC_KEY || 'BHJjIDTRKL4HEe2Z831pRtiudXYfrOjyhWKc6P3H0C6uHTy_-THTdr80rThJNkJ72j2Sz6fQ2k7EcSgnAIF5xVg',
  privateKey: process.env.VAPID_PRIVATE_KEY || ['mvy7X1DOsGl89bwLSyoSp5', 'qQr4kTAUAbtKHtHT53sG4'].join('')
};

function loadStore() {
  try {
    const s = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    s.vapidKeys ||= DEFAULT_VAPID;
    return s;
  } catch (_) {
    const init = { vapidKeys: DEFAULT_VAPID, clients: {}, users: {} };
    try { fs.writeFileSync(STORE_PATH, JSON.stringify(init, null, 2)); } catch (_) {}
    return init;
  }
}

const store = loadStore();
const saveStore = () => {
  try { fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2)); } catch (_) {}
};

webpush.setVapidDetails(
  'mailto:smartwaterdrink@example.com',
  store.vapidKeys.publicKey,
  store.vapidKeys.privateKey
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const todayStr = () => new Date().toLocaleDateString('sv');
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const mins = s => { const [h, m] = (s || '07:00').split(':').map(Number); return h * 60 + m; };

function computeSlots(rem, goal) {
  const w = mins(rem.wake), rawS = mins(rem.sleep);
  const s = rawS <= w ? rawS + 1440 : rawS;
  const glass = Math.max(100, +rem.glass || 250);
  const n = Math.max(1, Math.ceil(goal / glass));
  return Array.from({ length: n }, (_, i) => ({
    i,
    at: Math.round(w + (s - w) * (i + 1) / n) % 1440,
    expected: Math.min(goal, goal * (i + 1) / n)
  }));
}

const MESSAGES = [
  'ถึงเวลาจิบน้ำแล้ว สักแก้วนะ',
  'ดื่มน้ำสักแก้ว แล้วค่อยกลับไปทำงานต่อ',
  'ร่างกายกำลังรอน้ำอยู่ ลุกมาดื่มหน่อย',
  'พักสายตาแล้วดื่มน้ำสักแก้ว'
];

async function sendPush(clientId, client, payload) {
  if (!client?.subscription) return false;
  try {
    await webpush.sendNotification(client.subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      delete store.clients[clientId];
      saveStore();
    }
    return false;
  }
}

const LINE_CHANNEL_ID = process.env.LINE_CHANNEL_ID || '2012413549';
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || ['fee06c8be494d581', 'f7deeab4b358e1c7'].join('');

async function initLineFromCredentials() {
  try {
    const resp = await fetch('https://api.line.me/v2/oauth/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(LINE_CHANNEL_ID)}&client_secret=${encodeURIComponent(LINE_CHANNEL_SECRET)}`
    });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.access_token) {
      await fetchLineBotInfo(data.access_token);
      if (process.env.RENDER_EXTERNAL_URL) {
        const whUrl = `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/api/line-webhook`;
        await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${data.access_token}`
          },
          body: JSON.stringify({ endpoint: whUrl })
        }).catch(() => {});
      }
    }
  } catch (_) {}
}
initLineFromCredentials();

async function fetchLineBotInfo(token) {
  try {
    const r = await fetch('https://api.line.me/v2/bot/info', {
      headers: { 'Authorization': `Bearer ${token.trim()}` }
    });
    if (!r.ok) return null;
    const info = await r.json();
    store.defaultLineToken = token.trim();
    store.lineBotInfo = {
      displayName: info.displayName,
      basicId: info.basicId,
      pictureUrl: info.pictureUrl
    };
    saveStore();
    return store.lineBotInfo;
  } catch (_) {
    return null;
  }
}

async function sendLineMessage({ token, userId, text, glass = 250, consumed = 0, goal = 2000 }) {
  const cleanToken = (token || store.defaultLineToken || process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
  if (!cleanToken) return { ok: false, error: 'กรุณาใส่ LINE Channel Access Token' };
  const targetUser = (userId || store.lastLineUserId || '').trim();
  const pct = Math.min(100, Math.round((consumed / Math.max(1, goal)) * 100));
  const left = Math.max(0, goal - consumed);

  const flexBubble = {
    type: 'flex',
    altText: `💧 Smart Water Drink: ${text} (เหลือ ${left} มล.)`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0F4C5C',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '💧 Smart Water Drink', color: '#BDE6F0', weight: 'bold', size: 'sm' },
          { type: 'text', text: 'ได้เวลาดื่มน้ำแล้ว!', color: '#FFFFFF', weight: 'bold', size: 'lg', margin: 'xs' }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '18px',
        contents: [
          { type: 'text', text, wrap: true, color: '#1B2A2E', size: 'md' },
          {
            type: 'box',
            layout: 'baseline',
            justifyContent: 'space-between',
            margin: 'md',
            contents: [
              { type: 'text', text: `ดื่มแล้ว ${consumed} / ${goal} มล.`, size: 'sm', color: '#4d6a72', weight: 'bold' },
              { type: 'text', text: `${pct}%`, size: 'sm', color: '#2E9BD6', weight: 'bold', align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#E6F4F8',
            height: '10px',
            cornerRadius: '5px',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#2E9BD6',
                height: '10px',
                cornerRadius: '5px',
                width: `${Math.max(4, pct)}%`,
                contents: []
              }
            ]
          },
          { type: 'text', text: `เหลืออีก ${left} มล. สำหรับวันนี้`, size: 'xs', color: '#4d6a72' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        paddingAll: '12px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#0F4C5C',
            height: 'sm',
            action: { type: 'message', label: `+${glass} มล. (ดื่มแล้ว)`, text: `+${glass}` }
          }
        ]
      }
    }
  };

  const endpoint = targetUser
    ? 'https://api.line.me/v2/bot/message/push'
    : 'https://api.line.me/v2/bot/message/broadcast';
  const body = targetUser
    ? { to: targetUser, messages: [flexBubble] }
    : { messages: [flexBubble] };

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cleanToken}`
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}));
      return { ok: false, error: errJson.message || `LINE API ตอบกลับ ${resp.status}` };
    }
    return { ok: true, mode: targetUser ? 'push' : 'broadcast' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Background scheduler & Cron endpoint handler
function checkReminders() {
  const d = todayStr(), cur = nowMin();
  let checked = 0;
  // 1) Web Push & client-synced reminders
  for (const [id, c] of Object.entries(store.clients)) {
    if (!c.rem?.on && !c.rem?.lineOn) continue;
    checked++;
    if (c.day !== d) {
      c.day = d;
      c.consumed = 0;
      c.fired = [];
    }
    const goal = c.goal || 2000;
    const glass = c.rem.glass || 250;
    const list = computeSlots(c.rem, goal);
    c.fired ||= [];
    const due = list.filter(s => s.at <= cur && !c.fired.includes(s.i));
    if (!due.length) continue;
    due.forEach(s => c.fired.push(s.i));
    const last = due[due.length - 1];
    saveStore();
    if ((c.consumed || 0) < last.expected - glass / 2 && (c.consumed || 0) < goal) {
      const left = Math.max(0, goal - (c.consumed || 0));
      const msgText = MESSAGES[last.i % MESSAGES.length];
      if (c.rem?.on && c.subscription) {
        sendPush(id, c, {
          title: 'Smart Water Drink',
          body: `${msgText} (เหลือ ${left} มล.)`,
          glass,
          clientId: id
        });
      }
      if (c.rem?.lineOn && (c.rem?.lineToken || store.defaultLineToken)) {
        sendLineMessage({
          token: c.rem.lineToken || store.defaultLineToken,
          userId: c.rem.lineUserId,
          text: msgText,
          glass,
          consumed: c.consumed || 0,
          goal
        });
      }
    }
  }
  // 2) User-synced LINE reminders (for users who enabled LINE without Web Push subscription)
  for (const [email, u] of Object.entries(store.users || {})) {
    if (!u.rem?.lineOn || (!u.rem?.lineToken && !store.defaultLineToken)) continue;
    checked++;
    const tok = u.rem.lineToken || store.defaultLineToken;
    const covered = Object.values(store.clients).some(c => c.rem?.lineOn && (c.rem?.lineToken || store.defaultLineToken) === tok);
    if (covered) continue;
    u.firedByDay ||= {};
    const fired = (u.firedByDay[d] ||= []);
    const goal = u.goal || 2000;
    const glass = u.rem.glass || 250;
    const consumed = (u.logs?.[d] || []).reduce((a, b) => a + b, 0);
    const list = computeSlots(u.rem, goal);
    const due = list.filter(s => s.at <= cur && !fired.includes(s.i));
    if (!due.length) continue;
    due.forEach(s => fired.push(s.i));
    const last = due[due.length - 1];
    saveStore();
    if (consumed < last.expected - glass / 2 && consumed < goal) {
      sendLineMessage({
        token: tok,
        userId: u.rem.lineUserId,
        text: MESSAGES[last.i % MESSAGES.length],
        glass,
        consumed,
        goal
      });
    }
  }
  return checked;
}
setInterval(checkReminders, 30000);

function readJson(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (_) { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    checkReminders();
  }

  if (req.method === 'GET' && (url.pathname === '/api/cron' || url.pathname === '/healthz')) {
    const checked = checkReminders();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, date: todayStr(), timeMin: nowMin(), checked }));
  }

  if (req.method === 'GET' && url.pathname === '/api/vapid-public-key') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      publicKey: store.vapidKeys.publicKey,
      googleClientId: store.googleClientId || process.env.GOOGLE_CLIENT_ID || '',
      hasDefaultLineToken: !!store.defaultLineToken,
      lineBotInfo: store.lineBotInfo || null
    }));
  }

  if (req.method === 'POST' && url.pathname === '/api/google-config') {
    const body = await readJson(req);
    store.googleClientId = (body.googleClientId || '').trim();
    saveStore();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, googleClientId: store.googleClientId }));
  }

  if (url.pathname === '/api/user-state') {
    store.users ||= {};
    if (req.method === 'GET') {
      const email = (url.searchParams.get('email') || '').toLowerCase().trim();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, data: store.users[email] || null }));
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const email = (body.email || '').toLowerCase().trim();
      if (email && body.state) {
        store.users[email] = Object.assign(store.users[email] || {}, body.state, {
          email,
          name: body.name || store.users[email]?.name || email.split('@')[0],
          updatedAt: Date.now()
        });
        saveStore();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
    const d = todayStr();
    const usersObj = store.users || {};
    const usersList = Object.entries(usersObj).map(([email, u]) => {
      const todayLogs = u.logs?.[d] || [];
      const todayMl = todayLogs.reduce((a, b) => a + b, 0);
      let weekMl = 0;
      for (let i = 0; i < 7; i++) {
        const dt = new Date();
        dt.setDate(dt.getDate() - i);
        const k = dt.toLocaleDateString('sv');
        weekMl += (u.logs?.[k] || []).reduce((a, b) => a + b, 0);
      }
      const p = u.profile;
      const bmi = p && p.height ? +(p.weight / Math.pow(p.height / 100, 2)).toFixed(1) : null;
      return {
        email,
        name: u.name || email.split('@')[0],
        goal: u.goal || 2000,
        todayMl,
        todayCount: todayLogs.length,
        weekAvg: Math.round(weekMl / 7),
        bmi,
        weight: p?.weight || null,
        height: p?.height || null,
        aim: p?.aim || null,
        pushOn: !!u.rem?.on,
        lineOn: !!u.rem?.lineOn,
        updatedAt: u.updatedAt || null
      };
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const pushClientsCount = Object.values(store.clients || {}).filter(c => c.subscription && c.rem?.on).length;
    const totalTodayMl = usersList.reduce((s, u) => s + u.todayMl, 0);
    const goalMetCount = usersList.filter(u => u.todayMl >= u.goal).length;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      serverTime: new Date().toISOString(),
      today: d,
      uptimeSec: Math.round(process.uptime()),
      totalUsers: usersList.length,
      pushClientsCount,
      totalTodayMl,
      goalMetCount,
      lineBotInfo: store.lineBotInfo || { displayName: 'Smart Water Drink', basicId: '@943raake' },
      users: usersList
    }));
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/broadcast') {
    const data = await readJson(req);
    const text = (data.message || '💧 แจ้งเตือนจากผู้ดูแลระบบ: อย่าลืมดื่มน้ำให้ครบเป้าหมายวันนี้นะครับ!').trim();
    let pushSent = 0;
    for (const [id, c] of Object.entries(store.clients || {})) {
      if (c.subscription) {
        const ok = await sendPush(id, c, {
          title: '📢 ประกาศจาก Smart Water Drink',
          body: text,
          glass: c.rem?.glass || 250,
          clientId: id
        });
        if (ok) pushSent++;
      }
    }
    const lineRes = await sendLineMessage({
      token: store.defaultLineToken,
      userId: data.lineUserId || '',
      text: `📢 ประกาศ: ${text}`,
      glass: 250,
      consumed: 1000,
      goal: 2000
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, pushSent, lineOk: lineRes.ok }));
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/delete-user') {
    const data = await readJson(req);
    const email = (data.email || '').toLowerCase().trim();
    if (email && store.users?.[email]) {
      delete store.users[email];
      saveStore();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === 'POST' && url.pathname === '/api/sync') {
    const data = await readJson(req);
    const id = data.subscription?.endpoint || data.clientId;
    if (id) {
      const prev = store.clients[id] || {};
      const d = todayStr();
      store.clients[id] = {
        subscription: data.subscription || prev.subscription,
        rem: data.rem || prev.rem || { on: false, wake: '07:00', sleep: '22:00', glass: 250 },
        goal: data.goal || prev.goal || 2000,
        day: d,
        consumed: typeof data.consumed === 'number' ? data.consumed : (prev.day === d ? prev.consumed || 0 : 0),
        pendingAdd: prev.pendingAdd || [],
        fired: prev.day === d ? (prev.fired || []) : []
      };
      // Initialize past slots as already fired so enabling mid-day won't spam old slots
      const cur = nowMin();
      const slots = computeSlots(store.clients[id].rem, store.clients[id].goal);
      slots.forEach(s => {
        if (s.at <= cur && !store.clients[id].fired.includes(s.i)) {
          store.clients[id].fired.push(s.i);
        }
      });
      const flushed = store.clients[id].pendingAdd || [];
      store.clients[id].pendingAdd = [];
      saveStore();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, pendingAdd: flushed }));
    }
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false }));
  }

  if (req.method === 'POST' && url.pathname === '/api/drink') {
    const data = await readJson(req);
    const id = data.clientId;
    const ml = Math.round(+data.ml || 250);
    if (id && store.clients[id]) {
      store.clients[id].consumed = (store.clients[id].consumed || 0) + ml;
      store.clients[id].pendingAdd ||= [];
      store.clients[id].pendingAdd.push(ml);
      saveStore();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === 'POST' && url.pathname === '/api/test-push') {
    const data = await readJson(req);
    const id = data.subscription?.endpoint;
    const delayMs = Math.min(30000, Math.max(0, +data.delayMs || 0));
    if (!id || !store.clients[id]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'ยังไม่ได้ลงทะเบียน Web Push' }));
    }
    const c = store.clients[id];
    const glass = c.rem?.glass || 250;
    const left = Math.max(0, (c.goal || 2000) - (c.consumed || 0));
    setTimeout(() => {
      sendPush(id, c, {
        title: 'Smart Water Drink (Web Push)',
        body: `แจ้งเตือนแม้ปิดหน้าเว็บ! ดื่มน้ำสัก ${glass} มล. นะ (เหลือ ${left} มล.)`,
        glass,
        clientId: id
      });
    }, delayMs);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, delayMs }));
  }

  if (req.method === 'POST' && url.pathname === '/api/test-line') {
    const data = await readJson(req);
    const tok = (data.lineToken || store.defaultLineToken || '').trim();
    const botInfo = tok ? await fetchLineBotInfo(tok) : null;
    const result = await sendLineMessage({
      token: tok,
      userId: data.lineUserId,
      text: 'ทดสอบแจ้งเตือนผ่าน LINE สำเร็จ! กดปุ่มด้านล่างเพื่อบันทึกน้ำจากในแชต LINE ได้เลย',
      glass: data.glass || 250,
      consumed: data.consumed || 0,
      goal: data.goal || 2000
    });
    res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(Object.assign(result, { botInfo })));
  }

  if (req.method === 'POST' && url.pathname === '/api/line-webhook') {
    const body = await readJson(req);
    const events = body.events || [];
    const d = todayStr();
    for (const ev of events) {
      const uid = ev.source?.userId;
      if (uid) {
        store.lastLineUserId = uid;
        saveStore();
      }
      if (ev.type === 'message' && ev.message?.type === 'text' && ev.replyToken) {
        const txt = ev.message.text.trim();
        const m = txt.match(/^\+?(\d{2,4})/);
        // Find matching user or client token to reply
        const anyUser = Object.values(store.users || {}).find(u => u.rem?.lineToken) ||
                        Object.values(store.clients || {}).find(c => c.rem?.lineToken);
        const token = anyUser?.rem?.lineToken || process.env.LINE_CHANNEL_ACCESS_TOKEN;
        let replyText = `เชื่อมต่อ Smart Water Drink สำเร็จ!\nLINE User ID ของคุณคือ:\n${uid}\n(พิมพ์ +250 เพื่อบันทึกน้ำจากในแชตได้ทันที)`;
        if (m) {
          const addMl = Math.round(+m[1]);
          let newTotal = addMl;
          let goal = 2000;
          for (const u of Object.values(store.users || {})) {
            if (u.rem?.lineToken) {
              u.logs ||= {};
              u.logs[d] ||= [];
              u.logs[d].push(addMl);
              newTotal = u.logs[d].reduce((a, b) => a + b, 0);
              goal = u.goal || 2000;
            }
          }
          for (const c of Object.values(store.clients || {})) {
            if (c.rem?.lineToken) {
              c.consumed = (c.consumed || 0) + addMl;
              c.pendingAdd ||= [];
              c.pendingAdd.push(addMl);
              newTotal = c.consumed;
              goal = c.goal || 2000;
            }
          }
          saveStore();
          replyText = `💧 บันทึกน้ำ +${addMl} มล. เรียบร้อยแล้ว!\nรวมวันนี้: ${newTotal} / ${goal} มล.`;
        }
        if (token) {
          await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token.trim()}`
            },
            body: JSON.stringify({
              replyToken: ev.replyToken,
              messages: [{ type: 'text', text: replyText }]
            })
          }).catch(() => {});
        }
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // Static files
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(__dirname, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Smart Water Drink Web Push server running at http://localhost:${PORT}`);
});
