(() => {
  const $ = id => document.getElementById(id);
  const KEY = 'swd.v1';
  const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD local
  const calm = false;

  const state = Object.assign({
    user: null, profile: null, goal: 2000, logs: {}, fired: {},
    rem: { on: false, wake: '07:00', sleep: '22:00', glass: 250 }
  }, JSON.parse(localStorage.getItem(KEY) || '{}'));
  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(state));
    if (state.user?.email) {
      fetch('/api/user-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: state.user.email,
          name: state.user.name || state.user.email.split('@')[0],
          state: { profile: state.profile, goal: state.goal, logs: state.logs, rem: state.rem }
        })
      }).catch(() => {});
    }
  };
  const dayLog = () => (state.logs[today()] ||= []);
  const total = () => dayLog().reduce((a, b) => a + b, 0);

  /* ---------- motion helpers ---------- */
  function countTo(el, to, { dec = 0, fmt = true, ms = 900 } = {}) {
    const from = el._v ?? 0; el._v = to;
    const show = v => el.textContent = fmt ? v.toLocaleString('th-TH', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec);
    if (calm || from === to) return show(to);
    cancelAnimationFrame(el._raf);
    const t0 = performance.now();
    const step = t => {
      const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      show(from + (to - from) * e);
      if (p < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }
  const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function burst(x, y, n = 28) {
    if (calm) return;
    const fx = $('fx'), colors = ['#2E9BD6', '#4FB8E8', '#9BD8F2', '#FF6B57', '#0F4C5C'];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      const a = Math.random() * Math.PI * 2, d = 80 + Math.random() * 160;
      s.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 60}px;--r:${Math.random() * 360}deg;--c:${colors[i % colors.length]};animation-delay:${Math.random() * 120}ms`;
      fx.appendChild(s);
      setTimeout(() => s.remove(), 1500);
    }
  }

  // ripple ink on every button
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest('button'); if (!b || calm) return;
    const r = b.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2;
    const ink = document.createElement('span');
    ink.className = 'ink';
    ink.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    b.appendChild(ink); setTimeout(() => ink.remove(), 650);
  });

  /* ---------- sliding category tabs ---------- */
  const catNav = document.querySelector('.cat-tabs');
  const slidesTrack = $('slidesTrack');
  const tabBtns = [...document.querySelectorAll('.tab-btn')];
  const panels = [...document.querySelectorAll('.slide-panel')];
  let curTab = 0;

  function switchTab(idx) {
    idx = Math.max(0, Math.min(panels.length - 1, +idx || 0));
    curTab = idx;
    catNav.style.setProperty('--tab-idx', idx);
    slidesTrack.style.setProperty('--tab-idx', idx);
    tabBtns.forEach((b, i) => {
      b.classList.toggle('active', i === idx);
      b.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    panels.forEach((p, i) => p.classList.toggle('active', i === idx));
    if (idx === 0) {
      // Gentle slosh when sliding back to the bottle tab
      pluck(Math.floor(N / 2), 4, 4);
      sloshVel += 0.12;
    } else if (idx === 3) {
      renderUserDashboard();
    } else if (idx === 4) {
      checkAdminAccess();
    }
  }
  tabBtns.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // Swipe left/right support on touch devices
  let touchX = null, touchY = null;
  $('viewport').addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    }
  }, { passive: true });
  $('viewport').addEventListener('touchend', e => {
    if (touchX === null || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      switchTab(curTab + (dx < 0 ? 1 : -1));
    }
  }, { passive: true });

  /* ---------- bottle & fluid physics ---------- */
  const BOTTOM = 410, TOP = 60;
  const level = f => BOTTOM - f * (BOTTOM - TOP);
  const ticks = $('ticks');
  [0.25, 0.5, 0.75, 1].forEach(f => {
    const y = level(f);
    ticks.insertAdjacentHTML('beforeend',
      `<line x1="34" x2="${f === 1 ? 54 : 48}" y1="${y}" y2="${y}"/><text x="4" y="${y + 4}" data-f="${f}"></text>`);
  });

  // 1D coupled spring wave columns + whole-bottle slosh tilt
  const N = 29, X0 = 24, X1 = 176, DX = (X1 - X0) / (N - 1);
  const sp = Array.from({ length: N }, () => ({ y: 0, v: 0 }));
  const drops = []; // airborne splash droplets above surface
  let curY = BOTTOM, targetY = BOTTOM, velY = 0;
  let sloshAngle = 0, sloshVel = 0, agitation = 0;

  function pluck(centerIdx, strength, radius = 4) {
    for (let i = 0; i < N; i++) {
      const dist = Math.abs(i - centerIdx);
      if (dist <= radius) {
        const w = Math.cos((dist / radius) * (Math.PI / 2));
        sp[i].v += strength * w;
      }
    }
    agitation = Math.min(1, agitation + Math.min(0.8, Math.abs(strength) / 18));
  }

  function spawnSplash(x, power) {
    if (calm) return;
    const count = Math.min(9, Math.round(3 + power * 5));
    for (let i = 0; i < count; i++) {
      drops.push({
        x: x + (Math.random() - 0.5) * 18,
        y: -2,
        vx: (Math.random() - 0.5) * (2.4 + power * 2.2),
        vy: -(2.6 + Math.random() * 3.2 * power),
        r: 1.5 + Math.random() * 2.2
      });
    }
    // dynamic aeration bubbles plunging and rising inside the bottle
    const bGroup = $('bubbles');
    for (let i = 0; i < count + 3; i++) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const bx = 55 + Math.random() * 90;
      const startDepth = 18 + Math.random() * 75 * power;
      c.setAttribute('cx', bx);
      c.setAttribute('cy', startDepth);
      c.setAttribute('r', (1.4 + Math.random() * 2.8).toFixed(1));
      c.setAttribute('class', 'burst-b');
      c.style.setProperty('--d', (0.9 + Math.random() * 1.1).toFixed(2) + 's');
      c.style.setProperty('--bx', ((Math.random() - 0.5) * 26).toFixed(1) + 'px');
      c.style.setProperty('--by', (-startDepth - 4).toFixed(1) + 'px');
      bGroup.appendChild(c);
      setTimeout(() => c.remove(), 2100);
    }
  }

  function smoothPath(pts, closeBottom = true) {
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(2)} ${mx.toFixed(1)} ${my.toFixed(2)}`;
    }
    const last = pts[pts.length - 1];
    d += ` L${last[0].toFixed(1)} ${last[1].toFixed(2)}`;
    if (closeBottom) d += ` V500 H${pts[0][0].toFixed(1)} Z`;
    return d;
  }

  const wEl = $('water'), wfEl = $('waveFront'), wmEl = $('waveMid'), wbEl = $('waveBack'), flEl = $('foamLine'), spEl = $('splashes');

  let lastFrame = performance.now();
  function stepFluid(now) {
    const dt = Math.min(2.5, Math.max(0.5, (now - lastFrame) / 16.67));
    lastFrame = now;
    const t = now * 0.001;
    // Smooth vertical level transition with brisk spring response
    const dy = targetY - curY;
    velY = (velY + dy * 0.12 * dt) * Math.pow(0.72, dt);
    curY += velY * dt;
    if (Math.abs(dy) < 0.15 && Math.abs(velY) < 0.05) curY = targetY;
    wEl.style.transform = `translateY(${curY.toFixed(2)}px)`;

    // Whole-surface lateral slosh pendulum
    const sloshAcc = -0.042 * sloshAngle;
    sloshVel = (sloshVel + sloshAcc) * 0.965;
    sloshAngle += sloshVel;
    agitation *= 0.985;

    // Hooke's law + neighbor propagation + ambient idle micro-waves
    const k = 0.038, damp = 0.955, spread = 0.22;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1); // 0..1 across width
      // Idle gentle breathing: superposition of slow traveling & standing ripples
      const idle =
        Math.sin(t * 2.3 + u * Math.PI * 2.5) * 3.8 +
        Math.cos(t * 1.6 - u * Math.PI * 3.5) * 2.4 +
        Math.sin(t * 3.8 + u * Math.PI * 5.0) * (0.8 + agitation * 2.5);
      // Meniscus slight upward curve at glass walls + slosh tilt
      const wall = Math.pow(Math.abs(u - 0.5) * 2, 4) * -2.5;
      const tilt = (u - 0.5) * sloshAngle * 38;
      const rest = idle + wall + tilt;

      const force = -k * (sp[i].y - rest);
      sp[i].v = (sp[i].v + force) * damp;
    }

    // Neighbor coupling (2 passes for fast wave propagation & wall reflection)
    const lDelta = new Array(N).fill(0), rDelta = new Array(N).fill(0);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        if (i > 0) {
          lDelta[i] = spread * (sp[i].y - sp[i - 1].y);
          sp[i - 1].v += lDelta[i];
        }
        if (i < N - 1) {
          rDelta[i] = spread * (sp[i].y - sp[i + 1].y);
          sp[i + 1].v += rDelta[i];
        }
      }
      for (let i = 0; i < N; i++) {
        if (i > 0) sp[i - 1].y += lDelta[i];
        if (i < N - 1) sp[i + 1].y += rDelta[i];
      }
    }
    for (let i = 0; i < N; i++) sp[i].y += sp[i].v;

    // Build 3 layered wave paths (front, mid, back) for 3D volumetric depth
    const frontPts = [], midPts = [], backPts = [];
    for (let i = 0; i < N; i++) {
      const x = X0 + i * DX;
      const u = i / (N - 1);
      const yF = sp[i].y;
      const yM = -sp[N - 1 - i].y * 0.7 - 5.5 + Math.sin(t * 2.6 - u * 5) * 2.8;
      const yB = sp[N - 1 - i].y * 0.5 - 10 + Math.cos(t * 1.9 + u * 4) * 3.2;
      frontPts.push([x, yF]);
      midPts.push([x, yM]);
      backPts.push([x, yB]);
    }
    wfEl.setAttribute('d', smoothPath(frontPts, true));
    wmEl.setAttribute('d', smoothPath(midPts, true));
    wbEl.setAttribute('d', smoothPath(backPts, true));
    flEl.setAttribute('d', smoothPath(frontPts, false));

    // Step airborne splash droplets; when they fall back to y >= 0, pluck surface!
    if (drops.length) {
      let html = '';
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.x += d.vx;
        d.y += d.vy;
        d.vy += 0.28; // gravity
        if (d.y >= 0 && d.vy > 0) {
          const idx = Math.max(1, Math.min(N - 2, Math.round((d.x - X0) / DX)));
          pluck(idx, d.vy * 1.2, 2);
          drops.splice(i, 1);
        } else {
          html += `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${d.r.toFixed(1)}"/>`;
        }
      }
      spEl.innerHTML = html;
    } else if (spEl.innerHTML) {
      spEl.innerHTML = '';
    }

    if (!calm) requestAnimationFrame(stepFluid);
  }
  if (!calm) requestAnimationFrame(stepFluid);

  // Interactive bottle slosh on click or pointer move across the bottle
  const bottleSvg = document.querySelector('.bottle');
  bottleSvg.addEventListener('pointerdown', e => {
    if (calm) return;
    const r = bottleSvg.getBoundingClientRect();
    const relX = (e.clientX - r.left) / r.width;
    const idx = Math.max(2, Math.min(N - 3, Math.round(relX * (N - 1))));
    pluck(idx, 9, 5);
    sloshVel += (relX - 0.5) * 0.35;
    spawnSplash(X0 + idx * DX, 0.55);
    replay(bottleSvg, 'wobble');
  });
  let lastHoverT = 0;
  bottleSvg.addEventListener('pointermove', e => {
    const now = performance.now();
    if (calm || now - lastHoverT < 90) return;
    lastHoverT = now;
    const r = bottleSvg.getBoundingClientRect();
    const relX = (e.clientX - r.left) / r.width;
    const idx = Math.max(2, Math.min(N - 3, Math.round(relX * (N - 1))));
    pluck(idx, (e.movementX ? Math.min(4, Math.abs(e.movementX) * 0.25) : 1.8), 3);
    sloshVel += Math.max(-0.08, Math.min(0.08, (e.movementX || 0) * 0.004));
  });

  let lastStatus = '';
  function render() {
    const t = total(), g = state.goal, f = Math.min(t / g, 1);
    targetY = level(f);
    if (calm) {
      curY = targetY;
      wEl.style.transform = `translateY(${targetY}px)`;
    }
    countTo($('ml'), t, { fmt: false });
    $('goal').textContent = g;
    ticks.querySelectorAll('text').forEach(el => el.textContent = Math.round(g * el.dataset.f / 50) * 50);

    const st = $('status');
    let txt, cls = '';
    if (!state.profile) txt = 'ตั้งค่าร่างกายด้านล่างเพื่อคำนวณเป้าหมายของคุณ';
    else if (t >= g) { txt = 'ครบเป้าหมายแล้ววันนี้ เก่งมาก!'; cls = 'done'; }
    else {
      const need = g - t, cups = Math.ceil(need / state.rem.glass);
      const behind = expectedNow() - t >= state.rem.glass;
      txt = `เหลืออีก ${need} มล. (ประมาณ ${cups} แก้ว)` + (behind ? ' – ตอนนี้ดื่มช้ากว่าแผน' : '');
      if (behind) cls = 'behind';
    }
    if (txt !== lastStatus) {
      st.textContent = txt; st.className = 'status ' + cls;
      if (lastStatus) replay(st, 'swap');
      lastStatus = txt;
    }
    renderWeek(); renderSlots(); renderUserDashboard();
  }

  let weekSig = '';
  function renderWeek() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push([d, (state.logs[d.toLocaleDateString('sv')] || []).reduce((a, b) => a + b, 0)]);
    }
    const sig = days.map(x => x[1]).join() + '|' + state.goal;
    if (sig === weekSig) return;
    const first = !weekSig; weekSig = sig;
    const box = $('weekBars');
    if (first) {
      box.innerHTML = days.map(([d, v], i) =>
        `<div title="${v} มล."><i style="--i:${i}"></i>${d.toLocaleDateString('th-TH', { weekday: 'short' })}</div>`).join('');
    }
    [...box.children].forEach((el, i) => {
      const v = days[i][1], bar = el.firstChild;
      el.title = `${v} มล.`;
      bar.style.height = Math.min(v / state.goal, 1) * 62 + 'px';
      bar.style.transition = first ? '' : 'height .8s cubic-bezier(.22,1,.36,1)';
      bar.classList.toggle('hit', v >= state.goal);
    });
  }

  function dropInto(fBefore, fAfter, ml, done) {
    const drop = $('drop'), stream = $('stream'), ySurf = level(fBefore);
    if (calm || !drop.animate) return done();
    const power = Math.min(1.4, Math.max(0.6, ml / 250));
    const mid = Math.floor(N / 2);

    // 1. Pouring stream & leading drop fall from mouth of bottle to water surface
    stream.setAttribute('height', Math.max(0, ySurf + 12));
    stream.animate([
      { opacity: 0, transform: 'scaleX(.4)' },
      { opacity: .85, transform: 'scaleX(1.1)', offset: .25 },
      { opacity: .8, transform: 'scaleX(.9)', offset: .75 },
      { opacity: 0, transform: 'scaleX(.2)' }
    ], { duration: 680, easing: 'ease-out' });

    drop.animate([
      { transform: 'translateY(0) scale(.6)', opacity: 0 },
      { transform: 'translateY(10px) scale(1)', opacity: 1, offset: .18 },
      { transform: `translateY(${ySurf + 30}px) scale(.75,1.25)`, opacity: 1 }
    ], { duration: 420, easing: 'cubic-bezier(.55,0,1,.45)' }).onfinish = () => {
      // 2. Impact! Depress center springs, trigger slosh, splash droplets & bubbles
      pluck(mid, 14 * power, 5);
      sloshVel += (Math.random() > 0.5 ? 1 : -1) * 0.24 * power;
      spawnSplash(100, power);
      done();

      // Continuous pouring agitation pulses while stream finishes
      let pulses = 3;
      const pTimer = setInterval(() => {
        pluck(mid + Math.round((Math.random() - 0.5) * 4), 6 * power, 4);
        if (--pulses <= 0) clearInterval(pTimer);
      }, 110);

      $('ripple').animate([
        { transform: 'scale(.12)', opacity: .95 },
        { transform: 'scale(1.15)', opacity: 0 }
      ], { duration: 850, easing: 'ease-out' });
      replay(bottleSvg, 'wobble');
    };
  }

  function add(ml) {
    ml = Math.round(+ml);
    if (!(ml > 0)) return;
    const before = total();
    dayLog().push(ml); save();
    const after = total();
    dropInto(Math.min(before / state.goal, 1), Math.min(after / state.goal, 1), ml, () => {
      render();
      syncPush();
      replay($('ml'), 'pop');
      if (before < state.goal && after >= state.goal) {
        const r = bottleSvg.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height * .35, 40);
        toast('ครบเป้าหมายแล้ววันนี้!');
      } else toast(`เพิ่ม ${ml} มล. แล้ว`);
    });
  }
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => add(b.dataset.add));
  $('undo').onclick = () => {
    const v = dayLog().pop(); save();
    if (v && !calm) {
      pluck(Math.floor(N / 2), -8, 6);
      sloshVel -= 0.16;
    }
    render();
    syncPush();
    toast(v ? `ลบ ${v} มล. ล่าสุดแล้ว` : 'วันนี้ยังไม่มีรายการให้ย้อนกลับ');
  };
  $('custom').onsubmit = e => { e.preventDefault(); add($('customMl').value); $('customMl').value = ''; };

  /* ---------- reminders ---------- */
  const mins = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

  function slots() {
    const { wake, sleep, glass } = state.rem;
    const w = mins(wake); let s = mins(sleep); if (s <= w) s += 1440;
    const n = Math.max(1, Math.ceil(state.goal / glass));
    return Array.from({ length: n }, (_, i) => ({
      at: Math.round(w + (s - w) * (i + 1) / n) % 1440,
      expected: Math.min(state.goal, state.goal * (i + 1) / n)
    }));
  }
  function expectedNow() {
    const w = mins(state.rem.wake), s = mins(state.rem.sleep), cur = nowMin();
    if (s <= w || cur <= w) return 0;
    return state.goal * Math.min(1, (cur - w) / (s - w));
  }
  let slotSig = '';
  function renderSlots() {
    const cur = nowMin(), list = slots();
    const nextIdx = list.findIndex(s => s.at > cur);
    const sig = list.map(s => s.at).join() + '|' + nextIdx;
    if (sig === slotSig) return; slotSig = sig;
    $('slots').innerHTML = list.map((s, i) =>
      `<li class="${s.at <= cur ? 'done' : i === nextIdx ? 'next' : ''}">${hhmm(s.at)}</li>`).join('');
  }

  const messages = [
    'ถึงเวลาจิบน้ำแล้ว สักแก้วนะ', 'ดื่มน้ำสักแก้ว แล้วค่อยกลับไปทำงานต่อ',
    'ร่างกายกำลังรอน้ำอยู่ ลุกมาดื่มหน่อย', 'พักสายตาแล้วดื่มน้ำสักแก้ว'
  ];
  async function notify(body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, icon: 'icon.svg', tag: 'swd', renotify: true };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) return reg.showNotification('Smart Water Drink', opts);
    } catch (_) {}
    new Notification('Smart Water Drink', opts);
  }

  function tick() {
    render();
    if (!state.rem.on || !state.profile) return;
    const d = today(), cur = nowMin();
    const fired = (state.fired[d] ||= []);
    const due = slots().map((s, i) => ({ ...s, i })).filter(s => s.at <= cur && !fired.includes(s.i));
    if (!due.length) return;
    due.forEach(s => fired.push(s.i));
    const last = due[due.length - 1];
    save();
    if (total() < last.expected - state.rem.glass / 2 && total() < state.goal) {
      notify(`${messages[last.i % messages.length]} (เหลือ ${state.goal - total()} มล.)`);
    }
  }
  setInterval(tick, 30000);

  /* ---------- Web Push & Calendar (.ics) ---------- */
  function b64ToUint8(base64String) {
    const pad = '='.repeat((4 - base64String.length % 4) % 4);
    const b64 = (base64String + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  let pushSub = null;
  async function ensurePushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const res = await fetch('/api/vapid-public-key');
        if (!res.ok) return null;
        const { publicKey } = await res.json();
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToUint8(publicKey)
        });
      }
      pushSub = sub;
      return sub;
    } catch (_) {
      return null;
    }
  }

  async function syncPush() {
    try {
      const sub = pushSub || (state.rem.on && Notification.permission === 'granted' ? await ensurePushSubscription() : null);
      if (!sub) return false;
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub,
          rem: state.rem,
          goal: state.goal,
          consumed: total()
        })
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (Array.isArray(data.pendingAdd) && data.pendingAdd.length) {
        data.pendingAdd.forEach(ml => dayLog().push(ml));
        save();
        render();
        toast(`ซิงก์ข้อมูลน้ำที่กดจากแจ้งเตือน +${data.pendingAdd.reduce((a, b) => a + b, 0)} มล.`);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'DRINK_FROM_NOTIFICATION') {
        add(e.data.ml || state.rem.glass || 250);
      }
    });
  }

  $('remForm').onsubmit = async e => {
    e.preventDefault();
    Object.assign(state.rem, {
      on: $('remOn').checked, wake: $('wake').value, sleep: $('sleep').value,
      glass: Math.max(100, +$('glass').value || 250),
      lineOn: $('lineOn').checked,
      lineToken: $('lineToken').value.trim(),
      lineUserId: $('lineUserId').value.trim()
    });
    save();
    const msg = $('remMsg');
    const parts = [];
    if (state.rem.on) {
      if (!('Notification' in window)) parts.push('เบราว์เซอร์ไม่รองรับ Web Push');
      else {
        const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
        if (p === 'granted') {
          const ok = await syncPush();
          parts.push(ok ? 'เปิด Web Push สำเร็จ' : 'เปิดแจ้งเตือนเบราว์เซอร์สำเร็จ');
          notify('เปิดระบบแจ้งเตือนดื่มน้ำเรียบร้อยแล้ว');
        } else {
          parts.push('เบราว์เซอร์ปิดกั้นสิทธิ์แจ้งเตือน');
        }
      }
    } else {
      await syncPush();
    }
    if (state.rem.lineOn) {
      parts.push('เปิดแจ้งเตือน LINE (@943raake) แล้ว');
    }
    msg.textContent = parts.length ? parts.join(' • ') : 'บันทึกการตั้งค่าแล้ว';
    toast('บันทึกการตั้งค่าแจ้งเตือนแล้ว');
    render();
  };

  let serverHasLineToken = true;
  function renderLineBotBanner(info) {
    const b = $('lineBotBanner');
    if (!b || !info?.basicId) return;
    b.hidden = false;
    const url = `https://line.me/R/ti/p/${encodeURIComponent(info.basicId)}`;
    b.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;flex-wrap:wrap;background:#e7faef;padding:.6rem .85rem;border-radius:10px;border:1px solid #06C755">
        <div><strong style="color:#058538">บอท: ${info.displayName || 'Smart Water Drink'} (${info.basicId})</strong><br><small class="muted">แอดเพื่อนเพื่อรับแจ้งเตือนเข้า LINE ทันที</small></div>
        <a href="${url}" target="_blank" rel="noopener" style="background:#06C755;color:#fff;text-decoration:none;padding:.4rem .85rem;border-radius:99px;font-weight:700;font-size:.86rem">+ เพิ่มเพื่อน LINE</a>
      </div>`;
  }

  $('testLineBtn').onclick = async () => {
    const btn = $('testLineBtn'), msg = $('remMsg');
    const lineToken = $('lineToken').value.trim();
    const lineUserId = $('lineUserId').value.trim();
    if (!lineToken && !serverHasLineToken) {
      msg.textContent = 'กรุณาวาง LINE Channel Access Token ก่อนกดทดสอบ';
      toast('กรุณาใส่ LINE Channel Access Token');
      $('lineToken').focus();
      return;
    }
    Object.assign(state.rem, {
      lineOn: true,
      lineToken,
      lineUserId
    });
    $('lineOn').checked = true;
    save();
    btn.disabled = true;
    btn.textContent = 'กำลังส่งเข้า LINE...';
    try {
      const res = await fetch('/api/test-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineToken,
          lineUserId,
          glass: state.rem.glass || 250,
          consumed: total(),
          goal: state.goal
        })
      });
      const data = await res.json();
      if (data.botInfo) {
        serverHasLineToken = true;
        renderLineBotBanner(data.botInfo);
      }
      if (data.ok) {
        msg.textContent = 'ส่งข้อความการ์ด Flex Message เข้า LINE สำเร็จแล้ว! เปิดดูในแอป LINE ได้เลย';
        toast('ส่งเข้า LINE สำเร็จแล้ว!');
      } else {
        msg.textContent = `ส่งเข้า LINE ไม่สำเร็จ: ${data.error || 'ตรวจสอบ Token อีกครั้ง'}`;
        toast('ส่งเข้า LINE ไม่สำเร็จ');
      }
    } catch (_) {
      msg.textContent = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ส่ง LINE ได้';
    }
    btn.disabled = false;
    btn.textContent = 'ส่งทดสอบเข้า LINE ทันที';
  };

  $('testPushBtn').onclick = async () => {
    const btn = $('testPushBtn'), msg = $('remMsg');
    if (!('Notification' in window)) {
      msg.textContent = 'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน';
      return;
    }
    const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (p !== 'granted') {
      msg.textContent = 'กรุณาอนุญาตสิทธิ์การแจ้งเตือนของเบราว์เซอร์ก่อนทดสอบ';
      return;
    }
    await syncPush();
    if (pushSub) {
      await fetch('/api/test-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: pushSub, delayMs: 5000 })
      }).catch(() => {});
    } else {
      setTimeout(() => notify('ทดสอบแจ้งเตือนดื่มน้ำ (ครบ 5 วินาที)'), 5000);
    }
    let sec = 5;
    btn.disabled = true;
    msg.textContent = 'กำลังส่ง Web Push ในอีก 5 วินาที — ลองพับหน้าจอหรือปิดแท็บเว็บตอนนี้ได้เลย!';
    const tId = setInterval(() => {
      sec--;
      if (sec > 0) btn.textContent = `จะแจ้งเตือนใน ${sec} วิ...`;
      else {
        clearInterval(tId);
        btn.disabled = false;
        btn.textContent = 'ทดสอบเตือนในอีก 5 วิ (ลองพับ/ปิดเว็บดูได้)';
        msg.textContent = 'ส่งแจ้งเตือน Web Push แล้ว! กดปุ่ม "+มล. (ดื่มแล้ว)" บนแจ้งเตือนได้เลย';
      }
    }, 1000);
  };

  $('icsBtn').onclick = () => {
    const list = slots();
    const d = new Date();
    const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const events = list.map((s, idx) => {
      const hh = String(Math.floor(s.at / 60)).padStart(2, '0');
      const mm = String(s.at % 60).padStart(2, '0');
      return [
        'BEGIN:VEVENT',
        `UID:swd-slot-${idx}-${s.at}@smartwaterdrink`,
        `DTSTAMP:${ymd}T000000Z`,
        `DTSTART:${ymd}T${hh}${mm}00`,
        `DURATION:PT5M`,
        `RRULE:FREQ=DAILY`,
        `SUMMARY:💧 ดื่มน้ำ ${state.rem.glass} มล. (เป้าสะสม ${Math.round(s.expected)} มล.)`,
        `DESCRIPTION:ถึงเวลาดื่มน้ำตามแผน Smart Water Drink (${hh}:${mm})`,
        'BEGIN:VALARM',
        'TRIGGER:-PT0M',
        'ACTION:DISPLAY',
        'DESCRIPTION:ถึงเวลาดื่มน้ำแล้ว',
        'END:VALARM',
        'END:VEVENT'
      ].join('\r\n');
    }).join('\r\n');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Smart Water Drink//TH',
      'CALSCALE:GREGORIAN',
      events,
      'END:VCALENDAR'
    ].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'smart-water-drink.ics';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('ดาวน์โหลดไฟล์ปฏิทิน (.ics) แล้ว');
  };

  /* ---------- body calculations ---------- */
  function bmiInfo(b) {
    // เกณฑ์เอเชีย-แปซิฟิก (กรมอนามัย)
    if (b < 18.5) return ['น้ำหนักน้อย', 'ต่ำกว่าเกณฑ์ ควรเพิ่มอาหารที่มีโปรตีนและพลังงานพอเพียง'];
    if (b < 23) return ['สมส่วน', 'อยู่ในเกณฑ์ปกติ รักษาไว้'];
    if (b < 25) return ['น้ำหนักเกิน', 'เริ่มเกินเกณฑ์เล็กน้อย ปรับอาหารและเพิ่มการเคลื่อนไหว'];
    if (b < 30) return ['โรคอ้วนระดับ 1', 'ควรลดน้ำหนักอย่างค่อยเป็นค่อยไป'];
    return ['โรคอ้วนระดับ 2', 'ควรปรึกษาแพทย์เพื่อวางแผนลดน้ำหนัก'];
  }

  function calc(p) {
    const hm = p.height / 100, bmi = p.weight / (hm * hm);
    // Mifflin-St Jeor
    const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
    const tdee = bmr * p.activity;
    const adj = { lose: -0.2, keep: 0, gain: 0.12 }[p.aim];
    const floor = p.sex === 'm' ? 1500 : 1200;
    const kcal = Math.max(floor, tdee * (1 + adj));
    const pPerKg = { lose: 1.6, keep: 1.2, gain: 1.8 }[p.aim];
    const protein = p.weight * pPerKg;
    const fat = kcal * 0.28 / 9;
    const carb = (kcal - protein * 4 - fat * 9) / 4;
    const water = p.weight * 35 + (p.activity >= 1.55 ? 500 : p.activity >= 1.375 ? 250 : 0) + (p.hot ? 500 : 0);
    return {
      bmi, bmr, tdee, kcal, protein, fat, carb, water: Math.round(water / 50) * 50,
      fiber: Math.max(25, kcal / 1000 * 14),
      sugar: kcal * 0.05 / 4, sodium: 2000
    };
  }

  const r0 = n => Math.round(n).toLocaleString('th-TH');
  function unitCount(el, v, unit) {
    el.innerHTML = '<span></span> ' + unit;
    countTo(el.firstChild, Math.round(v));
  }
  function showResults(p, r, animate) {
    const box = $('results');
    const [cat, note] = bmiInfo(r.bmi);
    countTo($('bmiVal'), r.bmi, { dec: 1, fmt: false, ms: 1100 });
    $('bmiCat').textContent = cat;
    $('bmiNote').textContent = note + ' (เกณฑ์ BMI สำหรับคนเอเชีย)';
    const pin = $('bmiPin');
    pin.style.left = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() =>
      pin.style.left = Math.max(0, Math.min(100, (r.bmi - 15) / 20 * 100)) + '%'));
    unitCount($('rWater'), r.water, 'มล.');
    unitCount($('rBmr'), r.bmr, 'kcal');
    unitCount($('rTdee'), r.tdee, 'kcal');
    unitCount($('rKcal'), r.kcal, 'kcal');
    const rows = [
      ['โปรตีน', r0(r.protein) + ' ก.', `${{ lose: '1.6', keep: '1.2', gain: '1.8' }[p.aim]} ก./น้ำหนักตัว 1 กก.`],
      ['คาร์โบไฮเดรต', r0(r.carb) + ' ก.', 'พลังงานส่วนที่เหลือ เน้นธัญพืชไม่ขัดสี'],
      ['ไขมัน', r0(r.fat) + ' ก.', 'ประมาณ 28% ของพลังงาน เน้นไขมันไม่อิ่มตัว'],
      ['ใยอาหาร', r0(r.fiber) + ' ก.', '14 ก. ต่อพลังงาน 1,000 kcal (ขั้นต่ำ 25 ก.)'],
      ['น้ำตาลเติม', '≤ ' + r0(r.sugar) + ' ก.', 'ไม่เกิน 5% ของพลังงาน (WHO)'],
      ['โซเดียม', '< ' + r0(r.sodium) + ' มก.', 'เกณฑ์ WHO ประมาณเกลือ 5 ก.']
    ];
    $('macroBody').innerHTML = rows.map((c, i) =>
      `<tr style="--i:${i + 4}"><th scope="row">${c[0]}</th><td>${c[1]}</td><td>${c[2]}</td></tr>`).join('');
    box.querySelectorAll('.facts>div').forEach((d, i) => d.style.setProperty('--i', i));
    if (animate) replay(box, 'reveal');
  }

  $('bodyForm').onsubmit = e => {
    e.preventDefault();
    const p = {
      sex: $('sex').value, age: +$('age').value, weight: +$('weight').value, height: +$('height').value,
      activity: +$('activity').value, aim: $('aim').value, hot: $('hot').checked
    };
    state.profile = p;
    const r = calc(p);
    state.goal = r.water;
    save(); showResults(p, r, true); render(); syncPush();
    toast(`คำนวณสำเร็จ! เป้าดื่มน้ำ ${r0(r.water)} มล./วัน`);
  };

  /* ---------- Gmail Login & Session ---------- */
  const ACC_KEY = 'swd.accounts';
  const getSavedAccounts = () => JSON.parse(localStorage.getItem(ACC_KEY) || '[]');
  function rememberAccount(user) {
    const list = getSavedAccounts().filter(a => a.email !== user.email);
    list.unshift(user);
    localStorage.setItem(ACC_KEY, JSON.stringify(list.slice(0, 4)));
  }

  function renderSavedAccounts() {
    const list = getSavedAccounts();
    const box = $('savedAccounts');
    const modalList = $('modalAccountList');
    if (modalList) {
      if (list.length) {
        modalList.innerHTML = list.map(a => {
          const disp = a.name || a.email.split('@')[0];
          const init = (disp[0] || 'G').toUpperCase();
          return `
            <button type="button" class="g-acc-row" data-email="${a.email}" data-name="${a.name || ''}">
              <span class="g-acc-ava">${init}</span>
              <div><strong>${disp}</strong><small>${a.email}</small></div>
            </button>
          `;
        }).join('');
        modalList.querySelectorAll('.g-acc-row').forEach(btn => {
          btn.onclick = () => loginWithGmail(btn.dataset.email, btn.dataset.name);
        });
      } else {
        modalList.innerHTML = '';
      }
    }
    if (!list.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = `<p class="muted">บัญชี Google ที่เคยเข้าใช้ในเครื่องนี้</p>` + list.map(a => `
      <button type="button" class="acc-chip" data-email="${a.email}" data-name="${a.name || ''}">
        <div><strong>${a.name || a.email.split('@')[0]}</strong><small>${a.email}</small></div>
        <span>เข้าใช้ →</span>
      </button>
    `).join('');
    box.querySelectorAll('.acc-chip').forEach(btn => {
      btn.onclick = () => loginWithGmail(btn.dataset.email, btn.dataset.name);
    });
  }

  function applyStateToUI() {
    if (state.profile) {
      const p = state.profile;
      $('sex').value = p.sex; $('age').value = p.age; $('weight').value = p.weight; $('height').value = p.height;
      $('activity').value = p.activity; $('aim').value = p.aim; $('hot').checked = p.hot;
      showResults(p, calc(p), false);
    } else {
      // Show initial default calculation so the Body tab looks complete right away
      const defP = {
        sex: $('sex').value, age: +$('age').value, weight: +$('weight').value, height: +$('height').value,
        activity: +$('activity').value, aim: $('aim').value, hot: $('hot').checked
      };
      showResults(defP, calc(defP), false);
    }
    $('wake').value = state.rem.wake; $('sleep').value = state.rem.sleep;
    $('glass').value = state.rem.glass; $('remOn').checked = state.rem.on;
    $('lineOn').checked = !!state.rem.lineOn;
    $('lineToken').value = state.rem.lineToken || '';
    $('lineUserId').value = state.rem.lineUserId || '';
    const wh = $('webhookUrlText');
    if (wh) wh.textContent = `${location.origin}/api/line-webhook`;
    render();
  }

  async function loginWithGmail(rawEmail, rawName) {
    const email = (rawEmail || '').trim().toLowerCase();
    const err = $('loginErr');
    if (!email) {
      err.textContent = 'กรุณากรอกอีเมลหรือชื่อบัญชีของคุณ';
      return;
    }
    err.textContent = '';
    if ($('googleModal')) $('googleModal').hidden = true;
    const name = (rawName || '').trim() || email.split('@')[0];
    state.user = { email, name };
    rememberAccount(state.user);

    // Fetch cloud-synced state for this Gmail user if available
    try {
      const res = await fetch(`/api/user-state?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const { data } = await res.json();
        if (data) {
          if (data.profile) state.profile = data.profile;
          if (data.goal) state.goal = data.goal;
          if (data.logs) state.logs = Object.assign({}, state.logs, data.logs);
          if (data.rem) state.rem = Object.assign({}, state.rem, data.rem);
        }
      }
    } catch (_) {}

    save();
    enterApp();
    toast(`ยินดีต้อนรับ ${name}`);
  }

  function enterApp() {
    if (!state.user?.email) {
      $('landingView').hidden = false;
      $('appView').hidden = true;
      renderSavedAccounts();
      return;
    }
    $('landingView').hidden = true;
    $('appView').hidden = false;
    $('userName').textContent = state.user.name || state.user.email.split('@')[0];
    $('userEmail').textContent = state.user.email;
    $('userAvatar').textContent = (state.user.name || state.user.email)[0].toUpperCase();
    applyStateToUI();
  }

  $('gmailForm').onsubmit = e => {
    e.preventDefault();
    loginWithGmail($('gmailInput').value, $('gmailName').value);
  };

  function openGoogleModal() {
    renderSavedAccounts();
    if ($('googleModal')) {
      $('googleModal').hidden = false;
      setTimeout(() => $('gmailInput')?.focus(), 50);
    }
  }
  function closeGoogleModal() {
    if ($('googleModal')) $('googleModal').hidden = true;
  }
  if ($('openGooglePopupBtn')) $('openGooglePopupBtn').onclick = openGoogleModal;
  if ($('closeGoogleModal')) $('closeGoogleModal').onclick = closeGoogleModal;
  if ($('cancelGoogleModal')) $('cancelGoogleModal').onclick = closeGoogleModal;
  if ($('googleModal')) {
    $('googleModal').onclick = e => {
      if (e.target === $('googleModal')) closeGoogleModal();
    };
  }

  $('logoutBtn').onclick = () => {
    state.user = null;
    localStorage.setItem(KEY, JSON.stringify(state));
    enterApp();
    toast('ออกจากระบบแล้ว');
  };

  // Optional Google Identity Services (GIS) button + server-wide LINE bot info
  fetch('/api/vapid-public-key').then(r => r.json()).then(({ googleClientId, hasDefaultLineToken, lineBotInfo }) => {
    if (hasDefaultLineToken) serverHasLineToken = true;
    if (lineBotInfo) renderLineBotBanner(lineBotInfo);
    if (googleClientId) {
      const initGis = () => {
        if (!window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: resp => {
            try {
              const payload = JSON.parse(atob(resp.credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
              if (payload.email) loginWithGmail(payload.email, payload.name || '');
            } catch (_) {}
          }
        });
        const wrap = $('gBtnWrap');
        wrap.hidden = false;
        window.google.accounts.id.renderButton(wrap, { theme: 'outline', size: 'large', shape: 'pill' });
      };
      if (window.google?.accounts?.id) {
        initGis();
      } else {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = initGis;
        document.head.appendChild(s);
      }
    }
  }).catch(() => {});

  /* ---------- User Dashboard ---------- */
  function renderUserDashboard() {
    if (!$('uKpiToday')) return;
    const t = total(), g = state.goal || 2000;
    const pct = Math.round((t / g) * 100);
    $('uKpiToday').textContent = `${pct}%`;
    $('uKpiTodaySub').textContent = `${r0(t)} / ${r0(g)} มล.`;

    // 14-day history & 7-day average
    const days14 = [];
    let sum7 = 0, hit14 = 0;
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = d.toLocaleDateString('sv');
      const v = (state.logs[k] || []).reduce((a, b) => a + b, 0);
      if (i < 7) sum7 += v;
      if (v >= g) hit14++;
      days14.push({ d, k, v });
    }
    const avg7 = Math.round(sum7 / 7);
    $('uKpiAvg').textContent = `${r0(avg7)} มล.`;
    $('uKpiAvgSub').textContent = avg7 >= g ? 'ถึงเป้าหมายเฉลี่ยรายวัน!' : `ต่ำกว่าเป้าเฉลี่ย ${r0(g - avg7)} มล.`;
    $('uKpiStreak').textContent = `${hit14} วัน`;
    $('uKpiStreakSub').textContent = `จาก 14 วันล่าสุด (${Math.round(hit14 / 14 * 100)}%)`;

    if (state.profile) {
      const r = calc(state.profile);
      const [cat] = bmiInfo(r.bmi);
      $('uKpiBmi').textContent = `${r.bmi.toFixed(1)} (${cat})`;
      $('uKpiBmiSub').textContent = `พลังงานเป้าหมาย ${r0(r.kcal)} kcal/วัน`;
    } else {
      $('uKpiBmi').textContent = 'ยังไม่ระบุ';
      $('uKpiBmiSub').textContent = 'คำนวณในหมวดร่างกาย';
    }

    // 14-day bar chart
    const maxVal = Math.max(g, ...days14.map(x => x.v), 100);
    $('chart14').innerHTML = days14.map(x => {
      const h = Math.max(4, Math.round((x.v / maxVal) * 105));
      const hit = x.v >= g;
      const lbl = x.d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
      return `<div class="c-col" title="${lbl}: ${r0(x.v)} มล.">
        <span class="c-val">${x.v ? (x.v >= 1000 ? (x.v / 1000).toFixed(1) + 'L' : x.v) : ''}</span>
        <div class="c-bar ${hit ? 'hit' : ''}" style="height:${h}px"></div>
        <span>${x.d.getDate()}</span>
      </div>`;
    }).join('');

    // Today's cup-by-cup timeline
    const list = dayLog();
    $('uLogCount').textContent = `${list.length} แก้ว (${r0(t)} มล.)`;
    const tl = $('todayTimeline');
    if (!list.length) {
      tl.innerHTML = `<li class="muted">วันนี้ยังไม่มีบันทึกการดื่มน้ำ กดปุ่ม +มล. ในหมวด "วันนี้" ได้เลย</li>`;
    } else {
      let running = 0;
      tl.innerHTML = list.map((ml, idx) => {
        running += ml;
        return `<li>
          <span>แก้วที่ ${idx + 1}: <strong>+${ml} มล.</strong></span>
          <span class="muted">สะสม ${r0(running)} มล.</span>
        </li>`;
      }).reverse().join('');
    }
  }

  $('exportCsvBtn').onclick = () => {
    const rows = [['Date', 'Total_ml', 'Goal_ml', 'Glasses_Count', 'Status']];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = d.toLocaleDateString('sv');
      const arr = state.logs[k] || [];
      const sum = arr.reduce((a, b) => a + b, 0);
      rows.push([k, sum, state.goal, arr.length, sum >= state.goal ? 'Met' : 'Below']);
    }
    const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `smart-water-log-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('ดาวน์โหลดไฟล์ CSV เรียบร้อยแล้ว');
  };

  /* ---------- Admin Dashboard ---------- */
  let adminUnlocked = sessionStorage.getItem('swd.admin') === '1';
  let adminUsersCache = [];

  function checkAdminAccess() {
    const isOwner = /^(admin|filmgod)/i.test(state.user?.email || '');
    if (adminUnlocked || isOwner) {
      adminUnlocked = true;
      $('adminGate').hidden = true;
      $('adminContent').hidden = false;
      loadAdminDashboard();
    } else {
      $('adminGate').hidden = false;
      $('adminContent').hidden = true;
    }
  }

  $('adminAuthForm').onsubmit = e => {
    e.preventDefault();
    const pass = $('adminPass').value.trim();
    if (pass === 'admin1234' || pass === '1234' || pass === 'admin') {
      adminUnlocked = true;
      sessionStorage.setItem('swd.admin', '1');
      $('adminAuthMsg').textContent = '';
      checkAdminAccess();
      toast('เข้าสู่โหมดผู้ดูแลระบบแล้ว');
    } else {
      $('adminAuthMsg').textContent = 'รหัสผ่านไม่ถูกต้อง (ค่าเริ่มต้นคือ admin1234)';
    }
  };

  async function loadAdminDashboard() {
    try {
      const res = await fetch('/api/admin/overview');
      if (!res.ok) return;
      const data = await res.json();
      $('aKpiUsers').textContent = `${data.totalUsers} คน`;
      $('aKpiMet').textContent = `${data.goalMetCount} / ${data.totalUsers} คน`;
      $('aKpiMetSub').textContent = `น้ำรวมวันนี้ ${r0(data.totalTodayMl)} มล.`;
      $('aKpiPush').textContent = `${data.pushClientsCount} เครื่อง`;
      $('aKpiBot').textContent = data.lineBotInfo?.basicId || '@943raake';
      const minsUp = Math.max(1, Math.round((data.uptimeSec || 60) / 60));
      $('aKpiUptime').textContent = `ออนไลน์ • Uptime ${minsUp} นาที`;
      adminUsersCache = data.users || [];
      renderAdminTable();
    } catch (_) {}
  }

  function renderAdminTable() {
    const q = ($('adminSearch')?.value || '').trim().toLowerCase();
    const list = adminUsersCache.filter(u =>
      !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
    const tbody = $('adminUsersBody');
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted">ยังไม่มีข้อมูลผู้ใช้งานที่ตรงกับการค้นหา</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(u => {
      const pct = Math.min(100, Math.round((u.todayMl / Math.max(1, u.goal)) * 100));
      const badges = [
        u.lineOn ? '<span class="badge ok">LINE</span>' : '',
        u.pushOn ? '<span class="badge">Push</span>' : ''
      ].filter(Boolean).join(' ') || '<span class="muted">ปิด</span>';
      return `<tr>
        <td><strong>${u.name}</strong><br><small class="muted">${u.email}</small></td>
        <td><strong>${r0(u.todayMl)}</strong> / ${r0(u.goal)} มล. <small>(${pct}%)</small></td>
        <td>${r0(u.weekAvg)} มล./วัน</td>
        <td>${u.bmi ? u.bmi : '–'}</td>
        <td>${badges}</td>
        <td><button type="button" class="mini-btn" data-del="${u.email}">ลบ</button></td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = async () => {
        await fetch('/api/admin/delete-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: btn.dataset.del })
        });
        toast(`ลบผู้ใช้ ${btn.dataset.del} แล้ว`);
        loadAdminDashboard();
      };
    });
  }

  $('adminSearch').oninput = renderAdminTable;
  $('refreshAdminBtn').onclick = () => { loadAdminDashboard(); toast('รีเฟรชข้อมูลแอดมินแล้ว'); };

  $('broadcastForm').onsubmit = async e => {
    e.preventDefault();
    const message = $('broadcastMsg').value.trim();
    if (!message) return;
    const st = $('broadcastStatus');
    st.textContent = 'กำลังส่งประกาศแจ้งเตือน...';
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await res.json();
      st.textContent = `ส่งประกาศสำเร็จ! (LINE: ${data.lineOk ? 'ส่งแล้ว' : 'ไม่สำเร็จ'}, Web Push: ${data.pushSent || 0} เครื่อง)`;
      $('broadcastMsg').value = '';
      toast('ส่งประกาศหาผู้ใช้ทุกคนแล้ว');
    } catch (_) {
      st.textContent = 'เกิดข้อผิดพลาดในการส่งประกาศ';
    }
  };

  /* ---------- init ---------- */
  enterApp();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(() => syncPush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncPush();
    });
  }
})();
