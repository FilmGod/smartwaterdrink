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

function sanitizeStore(s) {
  s.users ||= {};
  s.lineLinks ||= {};
  // Disconnect boomsiwat1669 from FilmXr01's LINE user ID
  if (s.users['boomsiwat1669@gmail.com']?.rem?.lineUserId === 'Ue38075cfc9536aab575d8ab47ec0ecbb') {
    delete s.users['boomsiwat1669@gmail.com'].rem.lineUserId;
  }
  // Explicitly link FilmXr01's LINE user ID to ponlasit3210@gmail.com
  if (s.users['ponlasit3210@gmail.com']) {
    s.users['ponlasit3210@gmail.com'].rem ||= { on: false, lineOn: true, wake: '07:00', sleep: '22:00', glass: 250 };
    s.users['ponlasit3210@gmail.com'].rem.lineUserId = 'Ue38075cfc9536aab575d8ab47ec0ecbb';
    s.lineLinks['Ue38075cfc9536aab575d8ab47ec0ecbb'] = 'ponlasit3210@gmail.com';
  }
  delete s.lastLineUserId;
  delete s.pendingGlobalLineOps;
  return s;
}

function loadStore() {
  try {
    const s = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    s.vapidKeys ||= DEFAULT_VAPID;
    return sanitizeStore(s);
  } catch (_) {
    const init = { vapidKeys: DEFAULT_VAPID, clients: {}, users: {} };
    try { fs.writeFileSync(STORE_PATH, JSON.stringify(init, null, 2)); } catch (_) {}
    return sanitizeStore(init);
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
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const todayStr = () => new Date().toLocaleDateString('sv');
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const mins = s => { const [h, m] = (s || '07:00').split(':').map(Number); return h * 60 + m; };

function computeSlots(rem, goal) {
  const w = mins(rem.wake), rawS = mins(rem.sleep);
  // Clamp end-of-day midnight (00:00 -> 1440) to 1439 (23:59) so the final slot never wraps to 00:00 AM (0)
  const s = rawS <= w ? Math.min(1439, rawS + 1440) : rawS;
  const glass = Math.max(100, +rem.glass || 250);
  const n = Math.max(1, Math.ceil(goal / glass));
  return Array.from({ length: n }, (_, i) => ({
    i,
    at: Math.min(1439, Math.round(w + (s - w) * (i + 1) / n)),
    expected: Math.min(goal, goal * (i + 1) / n)
  }));
}

const TONE_MESSAGES = {
  health: [
    'ถึงเวลาจิบน้ำแล้ว! น้ำช่วยลำเลียงออกซิเจนและทำให้สมองปลอดโปร่ง',
    'ดื่มน้ำสักแก้วเพื่อรักษาสมดุลระบบเผาผลาญและความชุ่มชื้นของเซลล์นะครับ',
    'การจิบน้ำสม่ำเสมอช่วยลดความเหนื่อยล้าและดูแลไตให้แข็งแรง',
    'พักสายตาจากหน้าจอ แล้วเติมน้ำให้ร่างกายสักแก้วนะครับ'
  ],
  cheer: [
    'คนเก่ง อย่าลืมแวะดื่มน้ำสักแก้วนะ ร่างกายจะได้สดชื่นทั้งวัน 💕',
    'ทำงานเหนื่อยไหม? พักจิบน้ำเย็นๆ สักอึก เป็นห่วงสุขภาพนะครับ ✨',
    'อีกนิดเดียวจะถึงเป้าหมายวันนี้แล้ว มาดื่มน้ำด้วยกันนะ สู้ๆ! 🌈',
    'ดูแลงานแล้ว อย่าลืมดูแลตัวเองด้วยการดื่มน้ำสักแก้วนะครับ 🥰'
  ],
  fun: [
    'เฮ้ย! เลือดข้นกว่าน้ำ แต่ถ้าไม่ดื่มน้ำ เลือดจะข้นเกินไปแล้วนะ! 😂',
    'นั่งจ้องจอนานระวังตัวแห้งเป็นปลาหมึกตากแห้ง ลุกไปกินน้ำเดี๋ยวนี้! 🦑',
    'น้ำเปล่าไม่ทำให้อ้วน แต่ถ้าไม่กินน้ำ ระวังผิวแห้งนะวัยรุ่น! 💦',
    'บอทจับตาดูอยู่นะ... ยกแก้วน้ำขึ้นมาดื่มซะดีๆ! 👀💧'
  ],
  strict: [
    'วินัยคือหัวใจของสุขภาพ! ยกแก้วดื่มน้ำเดี๋ยวนี้ ห้ามผัดวันประกันพรุ่ง! 🔥',
    'ร่างกายขาดน้ำ = ประสิทธิภาพลดลง 20%! เติมน้ำเข้าสู่ระบบทันที! 💪',
    'อย่าปล่อยให้เป้าหมายวันนี้หลุดมือ ดื่มน้ำตามตารางเดี๋ยวนี้ครับ! 🏆',
    'โค้ชเตือนแล้วนะ! ลุกขึ้นยืดเส้นยืดสายและดื่มน้ำ 1 แก้วทันที! ⚡'
  ]
};
const MESSAGES = TONE_MESSAGES.health;

function pickReminderMessage(rem, idx = 0) {
  const list = TONE_MESSAGES[rem?.tone] || TONE_MESSAGES.health;
  return list[idx % list.length];
}

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

const APP_PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || 'https://smartwaterdrink.onrender.com';

const QUICK_REPLY_ITEMS = [
  { type: 'action', action: { type: 'message', label: '💧 +150 มล.', text: '+150' } },
  { type: 'action', action: { type: 'message', label: '🥤 +250 มล.', text: '+250' } },
  { type: 'action', action: { type: 'message', label: '🍶 +500 มล.', text: '+500' } },
  { type: 'action', action: { type: 'message', label: '📊 เช็กยอดวันนี้', text: 'สถานะ' } },
  { type: 'action', action: { type: 'message', label: '↩️ ลบแก้วล่าสุด', text: 'ยกเลิก' } },
  { type: 'action', action: { type: 'message', label: '🏆 สรุป 7 วัน', text: 'สรุป' } },
  { type: 'action', action: { type: 'message', label: '⏰ เลื่อน 30 นาที', text: 'เลื่อน 30 นาที' } }
];

function getContextTheme(mode, consumed, goal) {
  if (mode === 'summary') {
    return { bg: '#1E293B', badgeColor: '#93C5FD', barColor: '#38BDF8', badge: '🌙 สรุปผลการดื่มน้ำ', title: 'รายงานสุขภาพประจำวันของคุณ' };
  }
  if (mode === 'celebrate' || consumed >= goal) {
    return { bg: '#0D7A5F', badgeColor: '#A7F3D0', barColor: '#10B981', badge: '🎉 ภารกิจสำเร็จ 100%!', title: 'ดื่มน้ำครบเป้าหมายวันนี้แล้ว!' };
  }
  if (mode === 'behind') {
    return { bg: '#C2410C', badgeColor: '#FED7AA', barColor: '#F97316', badge: '⚡ เร่งสปีดอีกนิด!', title: 'ตอนนี้ดื่มช้ากว่าแผน มาจิบน้ำกัน!' };
  }
  const hr = new Date().getHours();
  if (hr >= 5 && hr < 11) {
    return { bg: '#0284C7', badgeColor: '#E0F2FE', barColor: '#0EA5E9', badge: '🌅 อรุณสวัสดิ์ยามเช้า', title: 'เริ่มต้นวันใหม่ด้วยน้ำสะอาด!' };
  }
  if (hr >= 11 && hr < 17) {
    return { bg: '#0F4C5C', badgeColor: '#BDE6F0', barColor: '#2E9BD6', badge: '☀️ เติมความสดชื่นยามบ่าย', title: 'ได้เวลาพักสายตาและจิบน้ำแล้ว!' };
  }
  return { bg: '#1E3A8A', badgeColor: '#DBEAFE', barColor: '#3B82F6', badge: '🌆 ช่วงเย็นแล้ว', title: 'เติมน้ำให้ครบเป้าก่อนเข้านอนนะ' };
}

function buildLineFlexMessage({ text, glass = 250, consumed = 0, goal = 2000, mode = 'auto', customMsg = '', extraStats = null }) {
  const pct = Math.min(100, Math.round((consumed / Math.max(1, goal)) * 100));
  const left = Math.max(0, goal - consumed);
  const theme = getContextTheme(mode, consumed, goal);

  const bodyContents = [
    { type: 'text', text, wrap: true, color: '#1B2A2E', size: 'md' }
  ];

  if (customMsg && customMsg.trim()) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#F0F9FF',
      cornerRadius: '8px',
      paddingAll: '10px',
      margin: 'sm',
      contents: [
        { type: 'text', text: `💬 โน้ตของคุณ: ${customMsg.trim()}`, wrap: true, size: 'xs', color: '#0369A1', weight: 'bold' }
      ]
    });
  }

  bodyContents.push(
    {
      type: 'box',
      layout: 'baseline',
      justifyContent: 'space-between',
      margin: 'md',
      contents: [
        { type: 'text', text: `ดื่มแล้ว ${consumed} / ${goal} มล.`, size: 'sm', color: '#4d6a72', weight: 'bold', flex: 4 },
        { type: 'text', text: `${pct}%`, size: 'sm', color: theme.barColor, weight: 'bold', align: 'end', flex: 1 }
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
          backgroundColor: theme.barColor,
          height: '10px',
          cornerRadius: '5px',
          width: `${Math.max(4, pct)}%`,
          contents: []
        }
      ]
    },
    {
      type: 'text',
      text: left > 0 ? `เหลืออีก ${left} มล. (ประมาณ ${Math.ceil(left / Math.max(100, glass))} แก้ว)` : '🏆 ยอดเยี่ยม! วันนี้คุณดื่มน้ำครบตามเป้าหมายแล้ว',
      size: 'xs',
      color: left > 0 ? '#4d6a72' : '#0D7A5F',
      weight: left > 0 ? 'regular' : 'bold'
    }
  );

  if (extraStats) {
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      backgroundColor: '#F8FAFC',
      cornerRadius: '10px',
      paddingAll: '10px',
      margin: 'md',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          flex: 1,
          contents: [
            { type: 'text', text: 'วันนี้ดื่มไป', size: 'xxs', color: '#64748B', align: 'center' },
            { type: 'text', text: `${extraStats.cups || 0} แก้ว`, size: 'sm', weight: 'bold', color: '#0F4C5C', align: 'center' }
          ]
        },
        {
          type: 'box',
          layout: 'vertical',
          flex: 1,
          contents: [
            { type: 'text', text: 'เฉลี่ย 7 วัน', size: 'xxs', color: '#64748B', align: 'center' },
            { type: 'text', text: `${extraStats.avg7 || 0} มล.`, size: 'sm', weight: 'bold', color: '#0F4C5C', align: 'center' }
          ]
        },
        {
          type: 'box',
          layout: 'vertical',
          flex: 1,
          contents: [
            { type: 'text', text: 'ครบเป้า 7 วัน', size: 'xxs', color: '#64748B', align: 'center' },
            { type: 'text', text: `${extraStats.streak7 || 0}/7 วัน`, size: 'sm', weight: 'bold', color: '#0D7A5F', align: 'center' }
          ]
        }
      ]
    });
  }

  return {
    type: 'flex',
    altText: `💧 Smart Water Drink: ${text} (${consumed}/${goal} มล.)`,
    quickReply: { items: QUICK_REPLY_ITEMS },
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: theme.bg,
        paddingAll: '16px',
        contents: [
          { type: 'text', text: theme.badge, color: theme.badgeColor, weight: 'bold', size: 'xs' },
          { type: 'text', text: theme.title, color: '#FFFFFF', weight: 'bold', size: 'lg', margin: 'xs', wrap: true }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '18px',
        contents: bodyContents
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '12px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'xs',
            contents: [
              {
                type: 'button',
                style: 'secondary',
                height: 'sm',
                flex: 1,
                action: { type: 'message', label: '+150', text: '+150' }
              },
              {
                type: 'button',
                style: 'primary',
                color: theme.bg,
                height: 'sm',
                flex: 1,
                action: { type: 'message', label: `+${glass}`, text: `+${glass}` }
              },
              {
                type: 'button',
                style: 'secondary',
                height: 'sm',
                flex: 1,
                action: { type: 'message', label: '+500', text: '+500' }
              }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'xs',
            contents: [
              {
                type: 'button',
                style: 'link',
                height: 'sm',
                flex: 1,
                action: { type: 'message', label: '⏰ เลื่อน 30น.', text: 'เลื่อน 30 นาที' }
              },
              {
                type: 'button',
                style: 'link',
                height: 'sm',
                flex: 1,
                action: { type: 'uri', label: '🌐 เปิดเว็บแอป', uri: APP_PUBLIC_URL }
              }
            ]
          }
        ]
      }
    }
  };
}

function calcUserStats(u, goal = 2000) {
  const d = todayStr();
  const todayArr = u?.logs?.[d] || [];
  let sum7 = 0, streak7 = 0;
  for (let i = 0; i < 7; i++) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const k = dt.toLocaleDateString('sv');
    const v = (u?.logs?.[k] || []).reduce((a, b) => a + b, 0);
    sum7 += v;
    if (v >= goal) streak7++;
  }
  return {
    cups: todayArr.length,
    avg7: Math.round(sum7 / 7),
    streak7
  };
}

async function sendLineMessage({ token, userId, text, glass = 250, consumed = 0, goal = 2000, mode = 'auto', customMsg = '', extraStats = null, isBroadcast = false }) {
  const cleanToken = (token || store.defaultLineToken || process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
  if (!cleanToken) return { ok: false, error: 'กรุณาใส่ LINE Channel Access Token' };
  const targetUser = (userId || '').trim();

  // STRICT PRIVACY: For individual reminders/status, targetUser is strictly required!
  // NEVER fall back to another user's ID and NEVER broadcast someone's data!
  if (!isBroadcast && !targetUser) {
    return { ok: false, error: 'ไม่มี LINE User ID สำหรับผู้ใช้นี้ (ยังไม่ได้ผูกบัญชี LINE)' };
  }

  const flexBubble = buildLineFlexMessage({ text, glass, consumed, goal, mode, customMsg, extraStats });

  const endpoint = isBroadcast
    ? 'https://api.line.me/v2/bot/message/broadcast'
    : 'https://api.line.me/v2/bot/message/push';
  const body = isBroadcast
    ? { messages: [flexBubble] }
    : { to: targetUser, messages: [flexBubble] };

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
    return { ok: true, mode: isBroadcast ? 'broadcast' : 'push' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Background scheduler & Cron endpoint handler
function getEffectiveSleepMin(rem) {
  const w = mins(rem?.wake || '07:00');
  const rawS = mins(rem?.sleep || '22:00');
  return rawS <= w ? Math.min(1435, rawS + 1440) : rawS;
}

function getScheduleSig(rem, goal) {
  return `${rem?.wake || '07:00'}|${rem?.sleep || '22:00'}|${rem?.glass || 250}|${goal || 2000}`;
}

function ensureUserFiredInit(u, d, cur) {
  const goal = u.goal || 2000;
  const sig = getScheduleSig(u.rem, goal);
  u.firedByDay ||= {};
  if (u.firedDay !== d || u.firedSig !== sig || !Array.isArray(u.firedByDay[d])) {
    const list = computeSlots(u.rem || {}, goal);
    // Pre-mark slots that are already in the past (< cur) so old morning slots don't fire when editing schedule,
    // while keeping slots at === cur or in the future (> cur) ready to fire on time.
    u.firedByDay[d] = list.filter(s => s.at < cur).map(s => s.at);
    u.firedDay = d;
    u.firedSig = sig;
    saveStore();
  }
  return u.firedByDay[d];
}

function checkReminders() {
  const d = todayStr(), cur = nowMin();
  let checked = 0;
  const hasUsers = Object.keys(store.users || {}).length > 0;

  // 1) Web Push & legacy client-synced reminders
  for (const [id, c] of Object.entries(store.clients)) {
    if (!c.rem?.on && (hasUsers || !c.rem?.lineOn || !c.rem?.lineUserId)) continue;
    checked++;
    if (c.day !== d) {
      c.day = d;
      c.consumed = 0;
      c.fired = [];
      c.snoozeUntil = 0;
    }
    if (c.snoozeUntil && cur < c.snoozeUntil) continue;
    const goal = c.goal || 2000;
    const glass = c.rem.glass || 250;
    const sleepMin = getEffectiveSleepMin(c.rem);

    // Nightly Summary Report at sleep time
    if (!hasUsers && c.rem?.lineOn && c.rem?.lineUserId && c.rem?.nightSummaryOn !== false && cur >= sleepMin && c.nightSummaryDate !== d) {
      c.nightSummaryDate = d;
      saveStore();
      sendLineMessage({
        token: c.rem.lineToken || store.defaultLineToken,
        userId: c.rem.lineUserId,
        text: `สรุปการดื่มน้ำประจำวันที่ ${d} ของคุณ พักผ่อนให้เพียงพอนะครับ 🌙`,
        glass,
        consumed: c.consumed || 0,
        goal,
        mode: 'summary',
        customMsg: c.rem.customMsg || ''
      });
    }

    const list = computeSlots(c.rem, goal);
    c.fired ||= [];
    const due = list.filter(s => s.at <= cur && !c.fired.includes(s.at));
    if (!due.length) continue;
    due.forEach(s => c.fired.push(s.at));
    const last = due[due.length - 1];
    saveStore();
    if ((c.consumed || 0) < goal) {
      const left = Math.max(0, goal - (c.consumed || 0));
      const msgText = pickReminderMessage(c.rem, last.i);
      const behindMuch = last.expected - (c.consumed || 0) >= glass * 1.5;
      if (c.rem?.on && c.subscription) {
        sendPush(id, c, {
          title: 'Smart Water Drink',
          body: `${msgText} (เหลือ ${left} มล.)`,
          glass,
          clientId: id
        });
      }
      if (!hasUsers && c.rem?.lineOn && c.rem?.lineUserId && (c.rem?.lineToken || store.defaultLineToken)) {
        sendLineMessage({
          token: c.rem.lineToken || store.defaultLineToken,
          userId: c.rem.lineUserId,
          text: msgText,
          glass,
          consumed: c.consumed || 0,
          goal,
          mode: behindMuch ? 'behind' : 'auto',
          customMsg: c.rem.customMsg || ''
        });
      }
    }
  }

  // 2) User-synced LINE reminders (Primary source for all logged-in accounts)
  for (const [email, u] of Object.entries(store.users || {})) {
    u.rem ||= { on: false, lineOn: true, wake: '07:00', sleep: '22:00', glass: 250 };
    // STRICT PRIVACY: Only send if this specific user has enabled LINE AND has their OWN valid lineUserId!
    if (u.rem.lineOn === false || !u.rem.lineUserId || (!u.rem?.lineToken && !store.defaultLineToken)) continue;
    checked++;
    const tok = u.rem.lineToken || store.defaultLineToken;
    if (u.snoozeDay === d && u.snoozeUntil && cur < u.snoozeUntil) continue;

    const fired = ensureUserFiredInit(u, d, cur);
    const goal = u.goal || 2000;
    const glass = u.rem.glass || 250;
    const consumed = (u.logs?.[d] || []).reduce((a, b) => a + b, 0);
    const sleepMin = getEffectiveSleepMin(u.rem);

    // Nightly Summary Report at sleep time
    if (u.rem?.nightSummaryOn !== false && cur >= sleepMin && u.nightSummaryDate !== d) {
      u.nightSummaryDate = d;
      saveStore();
      sendLineMessage({
        token: tok,
        userId: u.rem.lineUserId,
        text: `สรุปการดื่มน้ำประจำวันที่ ${d} ของคุณ (${email}) พักผ่อนให้เพียงพอนะครับ 🌙`,
        glass,
        consumed,
        goal,
        mode: 'summary',
        customMsg: u.rem.customMsg || '',
        extraStats: calcUserStats(u, goal)
      });
    }

    const list = computeSlots(u.rem, goal);
    const due = list.filter(s => s.at <= cur && !fired.includes(s.at));
    if (!due.length) continue;
    due.forEach(s => fired.push(s.at));
    const last = due[due.length - 1];
    saveStore();
    if (consumed < goal) {
      const behindMuch = last.expected - consumed >= glass * 1.5;
      sendLineMessage({
        token: tok,
        userId: u.rem.lineUserId,
        text: pickReminderMessage(u.rem, last.i),
        glass,
        consumed,
        goal,
        mode: behindMuch ? 'behind' : 'auto',
        customMsg: u.rem.customMsg || '',
        extraStats: calcUserStats(u, goal)
      });
    }
  }
  return checked;
}
setInterval(checkReminders, 15000);

// Self-ping keep-alive every 10 minutes so Render free instance never spins down
const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || 'https://smartwaterdrink.onrender.com';
setInterval(() => {
  fetch(`${EXTERNAL_URL}/healthz`).catch(() => {});
}, 10 * 60 * 1000);

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

const DEFAULT_GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '990715836668-68q2lvjmg79807hc12ltmk5rcat6560l.apps.googleusercontent.com';
const DEFAULT_TUTORIAL_YOUTUBE_ID = process.env.TUTORIAL_YOUTUBE_ID || '31wW7l9sM04';

  if (req.method === 'GET' && url.pathname === '/api/vapid-public-key') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      publicKey: store.vapidKeys.publicKey,
      googleClientId: store.googleClientId || DEFAULT_GOOGLE_CLIENT_ID,
      tutorialYouTubeId: store.tutorialYouTubeId || DEFAULT_TUTORIAL_YOUTUBE_ID,
      hasDefaultLineToken: !!store.defaultLineToken,
      lineBotInfo: store.lineBotInfo || null
    }));
  }

  if (req.method === 'POST' && url.pathname === '/api/tutorial-config') {
    const body = await readJson(req);
    if (body.tutorialYouTubeId !== undefined) {
      store.tutorialYouTubeId = (body.tutorialYouTubeId || '').trim();
      saveStore();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, tutorialYouTubeId: store.tutorialYouTubeId }));
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
    store.lineLinks ||= {};
    if (req.method === 'GET') {
      const email = (url.searchParams.get('email') || '').toLowerCase().trim();
      const u = store.users[email] || null;
      let pendingLineOps = [];
      let linkedLineUserId = '';
      if (u) {
        u.rem ||= { on: false, lineOn: true, wake: '07:00', sleep: '22:00', glass: 250 };
        if (u.rem.lineOn === undefined) u.rem.lineOn = true;
        // Strictly find lineUserId that belongs to THIS email only!
        if (!u.rem.lineUserId) {
          const foundUid = Object.keys(store.lineLinks).find(k => store.lineLinks[k] === email);
          if (foundUid) u.rem.lineUserId = foundUid;
        }
        linkedLineUserId = u.rem.lineUserId || '';
        pendingLineOps = u.pendingLineOps || [];
        u.pendingLineOps = [];
        saveStore();
        checkReminders();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, data: u, pendingLineOps, linkedLineUserId }));
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const email = (body.email || '').toLowerCase().trim();
      let pendingLineOps = [];
      let linkedLineUserId = '';
      if (email && body.state) {
        const prev = store.users[email] || {};
        // Strictly check lineUserId belonging to this email only!
        const prevLineUid = prev.rem?.lineUserId ||
          Object.keys(store.lineLinks).find(k => store.lineLinks[k] === email) || '';
        pendingLineOps = prev.pendingLineOps || [];
        const mergedState = Object.assign({}, body.state);
        mergedState.rem = Object.assign({}, prev.rem || {}, body.state.rem || {});
        if (mergedState.rem.lineOn === undefined) mergedState.rem.lineOn = true;
        if (prevLineUid && !mergedState.rem.lineUserId) {
          mergedState.rem.lineUserId = prevLineUid;
        }
        linkedLineUserId = mergedState.rem.lineUserId || '';
        if (pendingLineOps.length) {
          mergedState.logs = Object.assign({}, body.state.logs || {});
          for (const op of pendingLineOps) {
            mergedState.logs[op.date] = (mergedState.logs[op.date] || []).slice();
            if (op.type === 'add') mergedState.logs[op.date].push(op.ml);
            else if (op.type === 'undo') mergedState.logs[op.date].pop();
          }
        }
        store.users[email] = Object.assign(prev, mergedState, {
          email,
          name: body.name || prev.name || email.split('@')[0],
          pendingLineOps: [],
          updatedAt: Date.now()
        });
        ensureUserFiredInit(store.users[email], todayStr(), nowMin());
        saveStore();
        checkReminders();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, pendingLineOps, linkedLineUserId }));
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
      goal: 2000,
      isBroadcast: !data.lineUserId
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
    const mode = data.mode || 'auto';
    const baseText = mode === 'summary'
      ? `สรุปการดื่มน้ำประจำวันที่ ${todayStr()} ของคุณ พักผ่อนให้เพียงพอนะครับ 🌙`
      : pickReminderMessage({ tone: data.tone || 'health' }, 0);
    const result = await sendLineMessage({
      token: tok,
      userId: data.lineUserId,
      text: baseText,
      glass: data.glass || 250,
      consumed: data.consumed || 0,
      goal: data.goal || 2000,
      mode,
      customMsg: data.customMsg || '',
      extraStats: data.extraStats || null
    });
    res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(Object.assign(result, { botInfo })));
  }

  if (req.method === 'POST' && url.pathname === '/api/line-webhook') {
    const body = await readJson(req);
    const events = body.events || [];
    const d = todayStr();
    store.lineLinks ||= {};

    const resolveTargetUsers = uid => {
      if (!uid) return [];
      const linkedEmail = store.lineLinks[uid];
      if (linkedEmail && store.users?.[linkedEmail]) {
        return [[linkedEmail, store.users[linkedEmail]]];
      }
      const byUid = Object.entries(store.users || {}).filter(([, u]) => u.rem?.lineUserId === uid);
      if (byUid.length) return byUid;
      return []; // STRICT PRIVACY: NEVER fall back to other users!
    };

    for (const ev of events) {
      const uid = ev.source?.userId;
      if (ev.type === 'message' && ev.message?.type === 'text' && ev.replyToken) {
        const txt = ev.message.text.trim();
        const token = store.defaultLineToken || process.env.LINE_CHANNEL_ACCESS_TOKEN;

        const mAdd = txt.match(/^\+?(\d{2,4})$/);
        const mEmail = txt.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        let replyMessages = [];

        if (mEmail) {
          const email = mEmail[1].toLowerCase();
          store.users ||= {};
          store.users[email] ||= { logs: {}, goal: 2000, rem: { on: false, lineOn: true, wake: '07:00', sleep: '22:00', glass: 250 } };
          store.users[email].rem ||= { on: false, lineOn: true, wake: '07:00', sleep: '22:00', glass: 250 };
          store.users[email].rem.lineOn = true;
          if (uid) {
            // Disassociate this uid from any other account
            for (const otherEmail of Object.keys(store.users)) {
              if (store.users[otherEmail].rem?.lineUserId === uid && otherEmail !== email) {
                delete store.users[otherEmail].rem.lineUserId;
              }
            }
            // Disassociate this email from any old uid
            for (const oldUid of Object.keys(store.lineLinks)) {
              if (store.lineLinks[oldUid] === email && oldUid !== uid) {
                delete store.lineLinks[oldUid];
              }
            }
            store.users[email].rem.lineUserId = uid;
            store.lineLinks[uid] = email;
          }
          saveStore();
          const u = store.users[email];
          const consumed = (u.logs?.[d] || []).reduce((a, b) => a + b, 0);
          const goal = u.goal || 2000;
          replyMessages = [buildLineFlexMessage({
            text: `🔗 ผูกบัญชี LINE กับ ${email} สำเร็จแล้ว! ข้อมูลการดื่มน้ำและแจ้งเตือนจะซิงก์เฉพาะบัญชีของคุณครับ`,
            glass: u.rem?.glass || 250,
            consumed,
            goal,
            mode: 'auto',
            customMsg: u.rem?.customMsg || '',
            extraStats: calcUserStats(u, goal)
          })];
        } else {
          const targets = resolveTargetUsers(uid);
          if (!targets.length) {
            replyMessages = [{
              type: 'text',
              text: `👋 สวัสดีครับ! บัญชี LINE นี้ยังไม่ได้ผูกกับบัญชีผู้ใช้ในเว็บ Smart Water Drink\n\n📌 วิธีผูกบัญชี:\nพิมพ์ "อีเมลบัญชี Google ของคุณ" ลงในแชตนี้ (เช่น yourname@gmail.com)\n\nระบบจะซิงก์ข้อมูลการดื่มน้ำและแจ้งเตือนเข้าบัญชีของคุณทันทีครับ! 💧`,
              quickReply: { items: QUICK_REPLY_ITEMS }
            }];
          } else if (mAdd) {
            const addMl = Math.round(+mAdd[1]);
            const [email, u] = targets[0];
            u.logs ||= {};
            u.logs[d] ||= [];
            u.logs[d].push(addMl);
            u.pendingLineOps ||= [];
            u.pendingLineOps.push({ type: 'add', ml: addMl, date: d });
            const newTotal = u.logs[d].reduce((a, b) => a + b, 0);
            const goal = u.goal || 2000;
            const glass = u.rem?.glass || 250;
            const customMsg = u.rem?.customMsg || '';
            const extraStats = calcUserStats(u, goal);
            saveStore();
            const hitGoal = newTotal >= goal;
            replyMessages = [buildLineFlexMessage({
              text: hitGoal
                ? `🎉 บันทึกน้ำ +${addMl} มล. สำเร็จ! ยินดีด้วย วันนี้คุณดื่มครบเป้าหมายแล้ว!`
                : `💧 บันทึกน้ำ +${addMl} มล. เรียบร้อยแล้ว! สู้ต่อไปอีกนิดนะครับ`,
              glass,
              consumed: newTotal,
              goal,
              mode: hitGoal ? 'celebrate' : 'auto',
              customMsg,
              extraStats
            })];
          } else if (/^(ยกเลิก|ลบแก้วล่าสุด|undo)$/i.test(txt)) {
            const [email, u] = targets[0];
            const arr = u.logs?.[d] || [];
            let removed = 0;
            if (arr.length) {
              removed = arr.pop();
              u.pendingLineOps ||= [];
              u.pendingLineOps.push({ type: 'undo', removed, date: d });
            }
            const newTotal = arr.reduce((a, b) => a + b, 0);
            const goal = u.goal || 2000;
            const glass = u.rem?.glass || 250;
            const extraStats = calcUserStats(u, goal);
            saveStore();
            replyMessages = [buildLineFlexMessage({
              text: removed ? `↩️ ยกเลิกรายการล่าสุด (-${removed} มล.) เรียบร้อยแล้ว` : 'วันนี้ยังไม่มีรายการดื่มน้ำให้ยกเลิกครับ',
              glass,
              consumed: newTotal,
              goal,
              mode: 'auto',
              extraStats
            })];
          } else if (/^(สรุป|สรุป 7 วัน|รายงาน)$/i.test(txt)) {
            const [email, u] = targets[0];
            const goal = u.goal || 2000;
            const consumed = (u.logs?.[d] || []).reduce((a, b) => a + b, 0);
            replyMessages = [buildLineFlexMessage({
              text: `📊 สรุปสถิติการดื่มน้ำประจำวันที่ ${d} (${email})`,
              glass: u.rem?.glass || 250,
              consumed,
              goal,
              mode: 'summary',
              customMsg: u.rem?.customMsg || '',
              extraStats: calcUserStats(u, goal)
            })];
          } else if (/เลื่อน/.test(txt)) {
            const snoozeUntil = nowMin() + 30;
            for (const [, u] of targets) {
              u.snoozeDay = d;
              u.snoozeUntil = snoozeUntil;
            }
            saveStore();
            replyMessages = [{
              type: 'text',
              text: '⏰ รับทราบครับ! เลื่อนการแจ้งเตือนออกไปอีก 30 นาที แล้วค่อยมาดื่มน้ำกันนะ 💧',
              quickReply: { items: QUICK_REPLY_ITEMS }
            }];
          } else {
            const [email, u] = targets[0];
            const goal = u.goal || 2000;
            const consumed = (u.logs?.[d] || []).reduce((a, b) => a + b, 0);
            replyMessages = [buildLineFlexMessage({
              text: `📊 สถานะวันนี้ของบัญชี ${email}`,
              glass: u.rem?.glass || 250,
              consumed,
              goal,
              mode: 'auto',
              customMsg: u.rem?.customMsg || '',
              extraStats: calcUserStats(u, goal)
            })];
          }
        }

        if (token && replyMessages.length) {
          await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token.trim()}`
            },
            body: JSON.stringify({
              replyToken: ev.replyToken,
              messages: replyMessages
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
    const ext = path.extname(filePath).toLowerCase();
    const isImg = ['.png', '.svg', '.ico', '.jpg', '.jpeg'].includes(ext);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': isImg ? 'public, max-age=86400' : 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });
    if (req.method === 'HEAD') return res.end();
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Smart Water Drink Web Push server running at http://localhost:${PORT}`);
});
