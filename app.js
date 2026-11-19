(() => {
  const $ = id => document.getElementById(id);
  const KEY = 'swd.v1';
  const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD local
  const calm = false;

  const state = Object.assign({
    user: null, profile: null, goal: 2000, logs: {}, fired: {},
    rem: { on: false, lineOn: true, nightSummaryOn: true, wake: '07:00', sleep: '22:00', glass: 250 }
  }, JSON.parse(localStorage.getItem(KEY) || '{}'));
  if (state.rem && state.rem.lineOn === undefined) state.rem.lineOn = true;
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
      }).then(r => r.json()).then(d => {
        if (d?.linkedLineUserId && state.rem.lineUserId !== d.linkedLineUserId) {
          state.rem.lineUserId = d.linkedLineUserId;
          localStorage.setItem(KEY, JSON.stringify(state));
          renderLineLinkState();
        }
        if (d?.pendingLineOps?.length) applyPendingLineOps(d.pendingLineOps);
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
  const ADMIN_EMAIL = 'ponlasit3210@gmail.com';
  const isAdminUser = () => (state.user?.email || '').trim().toLowerCase() === ADMIN_EMAIL;
  const catNav = document.querySelector('.cat-tabs');
  const slidesTrack = $('slidesTrack');
  const tabBtns = [...document.querySelectorAll('.tab-btn')];
  const panels = [...document.querySelectorAll('.slide-panel')];
  let curTab = 0;

  function switchTab(idx) {
    const maxIdx = isAdminUser() ? panels.length - 1 : panels.length - 2;
    idx = Math.max(0, Math.min(maxIdx, +idx || 0));
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
    } else if (idx === 4 && isAdminUser()) {
      checkAdminAccess();
    }
  }
  tabBtns.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  if ($('brandLogo')) {
    $('brandLogo').addEventListener('click', e => {
      switchTab(0);
      const r = e.currentTarget.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, 18);
      playSloshSound(0.6);
    });
  }

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
  let tiltTarget = 0, lastGamma = null, tiltActive = false;
  let soundOn = localStorage.getItem('swd.sound') !== '0';
  let soundStyle = localStorage.getItem('swd.soundStyle') || 'bubbles';

  /* ---------- Web Audio API: 5 Selectable Water Pour & Slosh Sound Styles ---------- */
  let audioCtx = null;
  function getAudio() {
    if (!soundOn) return null;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    } catch (_) {
      return null;
    }
  }

  function playSloshSound(power = 0.5) {
    const ctx = getAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const count = Math.max(2, Math.round(2 + power * 3));
    for (let i = 0; i < count; i++) {
      const t0 = now + i * 0.055 + Math.random() * 0.03;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const baseF = 300 + Math.random() * 260;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseF, t0);
      osc.frequency.exponentialRampToValueAtTime(baseF * 1.65, t0 + 0.06);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.055 * power, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.065);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.07);
    }
  }

  function playPourSound(ml, fBefore, fAfter) {
    const ctx = getAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Duration scales with poured volume (ml): ~0.55s for 150ml, ~0.88s for 250ml, ~1.45s for 500ml
    const dur = Math.min(2.1, Math.max(0.45, 0.28 + (ml / 250) * 0.58));
    const intensity = Math.min(1.3, Math.max(0.7, ml / 250));

    if (soundStyle === 'bubbles') {
      // Style 1: 🫧 หยดน้ำปุ๋งๆ (Pure clean sine water droplets & rising pitch blips — zero noise hiss)
      const count = Math.min(20, Math.max(5, Math.round(ml / 30)));
      for (let i = 0; i < count; i++) {
        const prog = i / Math.max(1, count - 1);
        const t0 = now + 0.02 + prog * (dur - 0.1) + (Math.random() - 0.5) * 0.022;
        const fillNow = fBefore + (fAfter - fBefore) * prog;
        const baseF = 360 + fillNow * 380 + (Math.random() - 0.3) * 140;
        const bDur = 0.055 + Math.random() * 0.03;

        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseF, t0);
        osc.frequency.exponentialRampToValueAtTime(baseF * (1.72 + Math.random() * 0.22), t0 + bDur);

        const peak = (0.085 + Math.random() * 0.045) * intensity;
        g.gain.setValueAtTime(0.0008, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + 0.009);
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + bDur);
        osc.connect(g).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + bDur + 0.01);
      }
    } else if (soundStyle === 'glug') {
      // Style 2: 🍶 รินน้ำขวดแก้ว (Deep rhythmic bottle "glug-glug-glug" with rising neck resonance)
      const glugs = Math.min(14, Math.max(4, Math.round(ml / 42)));
      const step = (dur - 0.08) / glugs;
      for (let i = 0; i < glugs; i++) {
        const prog = i / Math.max(1, glugs - 1);
        const t0 = now + 0.02 + i * step;
        const fillNow = fBefore + (fAfter - fBefore) * prog;
        const fLow = 175 + fillNow * 210 + (i % 2) * 18;
        const gDur = Math.min(0.11, step * 0.88);

        const osc = ctx.createOscillator();
        const sub = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        sub.type = 'triangle';
        osc.frequency.setValueAtTime(fLow * 0.85, t0);
        osc.frequency.exponentialRampToValueAtTime(fLow * 1.55, t0 + gDur);
        sub.frequency.setValueAtTime(fLow * 0.5, t0);
        sub.frequency.exponentialRampToValueAtTime(fLow * 0.9, t0 + gDur);

        const peak = 0.12 * intensity;
        g.gain.setValueAtTime(0.001, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + 0.016);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + gDur);

        osc.connect(g);
        sub.connect(g);
        g.connect(ctx.destination);
        osc.start(t0);
        sub.start(t0);
        osc.stop(t0 + gDur + 0.01);
        sub.stop(t0 + gDur + 0.01);
      }
    } else if (soundStyle === 'ice') {
      // Style 3: 🧊 เทน้ำใส่น้ำแข็ง (Crisp glass-and-ice clinks + refreshing droplets)
      const clinks = Math.min(10, Math.max(3, Math.round(ml / 55)));
      for (let i = 0; i < clinks; i++) {
        const t0 = now + 0.03 + (i / clinks) * (dur - 0.1) + Math.random() * 0.035;
        const fIce = 1750 + Math.random() * 1150;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const g = ctx.createGain();
        osc1.type = 'sine';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(fIce, t0);
        osc2.frequency.setValueAtTime(fIce * 1.414, t0);
        g.gain.setValueAtTime(0.0008, t0);
        g.gain.linearRampToValueAtTime(0.065 * intensity, t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.085);
        osc1.connect(g);
        osc2.connect(g);
        g.connect(ctx.destination);
        osc1.start(t0);
        osc2.start(t0);
        osc1.stop(t0 + 0.09);
        osc2.stop(t0 + 0.09);
      }
      // Underlying cool water droplets
      const dropsCount = Math.min(14, Math.max(4, Math.round(ml / 38)));
      for (let i = 0; i < dropsCount; i++) {
        const prog = i / Math.max(1, dropsCount - 1);
        const t0 = now + 0.04 + prog * (dur - 0.1);
        const baseF = 440 + prog * 340 + Math.random() * 120;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseF, t0);
        osc.frequency.exponentialRampToValueAtTime(baseF * 1.65, t0 + 0.05);
        g.gain.setValueAtTime(0.001, t0);
        g.gain.linearRampToValueAtTime(0.06 * intensity, t0 + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.055);
        osc.connect(g).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.06);
      }
    } else if (soundStyle === 'sparkle') {
      // Style 4: ✨ หยดน้ำคริสตัล (Pentatonic aqua harp / marimba water droplets rising with ml)
      const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5, 1567.98];
      const notes = Math.min(14, Math.max(4, Math.round(ml / 36)));
      for (let i = 0; i < notes; i++) {
        const prog = i / Math.max(1, notes - 1);
        const t0 = now + prog * (dur - 0.12);
        const idx = Math.min(scale.length - 1, Math.floor(prog * (scale.length - 1)) + (i % 2));
        const freq = scale[idx];
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 0.96, t0);
        osc.frequency.exponentialRampToValueAtTime(freq, t0 + 0.025);
        g.gain.setValueAtTime(0.001, t0);
        g.gain.linearRampToValueAtTime(0.085 * intensity, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.22);
        osc.connect(g).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.23);
      }
    } else {
      // Style 5: 🏞️ สายน้ำรินไหล (Warm, ultra-soft low-passed stream + gentle bubbles)
      const bufLen = Math.ceil(ctx.sampleRate * dur);
      const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let b0 = 0, b1 = 0;
      for (let i = 0; i < bufLen; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.992 * b0 + white * 0.04;
        b1 = 0.965 * b1 + b0 * 0.06;
        data[i] = b1 * (0.8 + 0.2 * Math.sin((i / ctx.sampleRate) * Math.PI * 2 * 8));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'bandpass';
      lp.Q.setValueAtTime(3.2, now);
      lp.frequency.setValueAtTime(320 + fBefore * 280, now);
      lp.frequency.exponentialRampToValueAtTime(420 + fAfter * 420, now + dur);

      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.001, now);
      sg.gain.linearRampToValueAtTime(0.16 * intensity, now + 0.08);
      sg.gain.exponentialRampToValueAtTime(0.001, now + dur);
      noise.connect(lp).connect(sg).connect(ctx.destination);
      noise.start(now);
      noise.stop(now + dur + 0.02);

      const numBubbles = Math.min(18, Math.max(5, Math.round(ml / 32)));
      for (let i = 0; i < numBubbles; i++) {
        const prog = i / Math.max(1, numBubbles - 1);
        const t0 = now + 0.05 + prog * (dur - 0.12);
        const baseF = 340 + (fBefore + (fAfter - fBefore) * prog) * 380 + (Math.random() - 0.4) * 110;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseF, t0);
        osc.frequency.exponentialRampToValueAtTime(baseF * 1.62, t0 + 0.055);
        g.gain.setValueAtTime(0.001, t0);
        g.gain.linearRampToValueAtTime(0.065 * intensity, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.06);
        osc.connect(g).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.065);
      }
    }

    // Celebratory crystal water chime when reaching 100% daily goal
    if (fBefore < 1 && fAfter >= 1) {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
        const tC = now + dur * 0.75 + idx * 0.09;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, tC);
        g.gain.setValueAtTime(0.001, tC);
        g.gain.linearRampToValueAtTime(0.11, tC + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0008, tC + 0.45);
        osc.connect(g).connect(ctx.destination);
        osc.start(tC);
        osc.stop(tC + 0.46);
      });
    }
  }

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

    // Whole-surface lateral slosh pendulum (oscillates around phone's real gravity tiltTarget)
    const sloshAcc = -0.046 * (sloshAngle - tiltTarget);
    sloshVel = (sloshVel + sloshAcc) * 0.955;
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
      const tilt = (u - 0.5) * sloshAngle * 52;
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

    // Build 3 layered wave paths (front, mid, back) sharing the gravity tilt for realistic tilted water
    const frontPts = [], midPts = [], backPts = [];
    for (let i = 0; i < N; i++) {
      const x = X0 + i * DX;
      const u = i / (N - 1);
      const tiltHere = (u - 0.5) * sloshAngle * 52;
      const mirrorTilt = ((1 - u) - 0.5) * sloshAngle * 52;
      const mirrorWave = sp[N - 1 - i].y - mirrorTilt;
      const yF = sp[i].y;
      const yM = tiltHere - mirrorWave * 0.7 - 5.5 + Math.sin(t * 2.6 - u * 5) * 2.8;
      const yB = tiltHere + mirrorWave * 0.5 - 10 + Math.cos(t * 1.9 + u * 4) * 3.2;
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
    playSloshSound(0.6);
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

  /* ---------- Real-time Phone Tilt & Shake (DeviceOrientation / DeviceMotion) ---------- */
  const soundToggleBtn = $('soundToggleBtn');
  const soundStyleSelect = $('soundStyleSelect');

  function updateSoundBtn() {
    if (!soundToggleBtn) return;
    soundToggleBtn.classList.toggle('active', soundOn);
    soundToggleBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    soundToggleBtn.textContent = soundOn ? '🔊 เสียงน้ำ: เปิด' : '🔇 เสียงน้ำ: ปิด';
    if (soundStyleSelect) soundStyleSelect.classList.toggle('active', soundOn);
  }
  if (soundStyleSelect) {
    soundStyleSelect.value = soundStyle;
    soundStyleSelect.onchange = () => {
      soundStyle = soundStyleSelect.value || 'bubbles';
      localStorage.setItem('swd.soundStyle', soundStyle);
      if (!soundOn) {
        soundOn = true;
        localStorage.setItem('swd.sound', '1');
        updateSoundBtn();
      }
      playPourSound(250, 0.35, 0.65);
    };
  }
  updateSoundBtn();
  if (soundToggleBtn) {
    soundToggleBtn.onclick = () => {
      soundOn = !soundOn;
      localStorage.setItem('swd.sound', soundOn ? '1' : '0');
      updateSoundBtn();
      if (soundOn) playPourSound(150, 0.4, 0.55);
    };
  }

  function handleOrientation(e) {
    if (e.gamma === null || e.gamma === undefined) return;
    const g = Math.max(-65, Math.min(65, e.gamma));
    // Opposite sign so water surface stays horizontal with Earth gravity when phone tilts
    const nextTarget = -g / 20;
    if (lastGamma !== null) {
      const dg = g - lastGamma;
      if (Math.abs(dg) > 0.35) {
        sloshVel += (-dg / 20) * 0.16;
        if (Math.abs(dg) > 2.4) {
          const sideIdx = dg > 0 ? Math.floor(N * 0.25) : Math.floor(N * 0.75);
          pluck(sideIdx, Math.min(8, Math.abs(dg) * 0.55), 4);
        }
      }
    }
    lastGamma = g;
    tiltTarget = nextTarget;
  }

  let lastShakeT = 0;
  function handleMotion(e) {
    const acc = e.acceleration || e.accelerationIncludingGravity;
    if (!acc) return;
    const ax = acc.x || 0;
    if (Math.abs(ax) > 3.5) {
      sloshVel += Math.max(-0.22, Math.min(0.22, ax * 0.015));
      const now = performance.now();
      if (Math.abs(ax) > 10 && now - lastShakeT > 340) {
        lastShakeT = now;
        const idx = Math.floor(N * (0.25 + Math.random() * 0.5));
        pluck(idx, 11, 5);
        spawnSplash(X0 + idx * DX, 0.75);
        playSloshSound(0.55);
      }
    }
  }

  let motionSubscribed = false;
  async function enableDeviceTilt() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const p = await DeviceOrientationEvent.requestPermission();
        if (p !== 'granted') return;
      }
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try { await DeviceMotionEvent.requestPermission(); } catch (_) {}
      }
    } catch (_) {}
    if (!motionSubscribed) {
      motionSubscribed = true;
      window.addEventListener('deviceorientation', handleOrientation, true);
      window.addEventListener('devicemotion', handleMotion, true);
    }
  }
  enableDeviceTilt();
  document.addEventListener('pointerdown', () => enableDeviceTilt(), { once: true });

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

    const pctRaw = Math.round((t / Math.max(1, g)) * 100);
    const pctClamped = Math.min(100, Math.max(0, pctRaw));
    const fillEl = $('heroProgressFill'), pctEl = $('heroPctPill');
    if (fillEl) {
      fillEl.style.width = `${pctClamped}%`;
      fillEl.classList.toggle('goal-hit', pctRaw >= 100);
    }
    if (pctEl) {
      pctEl.textContent = `${pctRaw}%`;
      pctEl.classList.toggle('goal-hit', pctRaw >= 100);
    }

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

  function getBottleScreenPoint(svgX, svgY) {
    if (bottleSvg && bottleSvg.getScreenCTM) {
      const pt = bottleSvg.createSVGPoint();
      pt.x = svgX; pt.y = svgY;
      const t = pt.matrixTransform(bottleSvg.getScreenCTM());
      return { x: t.x, y: t.y };
    }
    const r = bottleSvg.getBoundingClientRect();
    return {
      x: r.left + r.width * (svgX / 200),
      y: r.top + r.height * ((svgY + 70) / 490)
    };
  }

  function pourStreamFromScreenTop(ml, ySurfSvg, onImpact, onFinish) {
    const fx = $('fx');
    if (!fx) {
      if (onImpact) onImpact();
      if (onFinish) onFinish();
      return;
    }

    const mouthPt = getBottleScreenPoint(100, 10);
    const surfPt = getBottleScreenPoint(100, ySurfSvg);

    const streamX = mouthPt.x;
    const surfY = surfPt.y;
    const power = Math.min(1.5, Math.max(0.6, ml / 250));
    const streamWidth = Math.round(10 + power * 6); // 13px - 19px
    const pourDuration = Math.round(Math.min(1600, Math.max(500, 360 + (ml / 250) * 480)));
    const fallDuration = 180; // Fast plunge from screen top (0px) to surface
    const drainDuration = 220; // Tail leaves top of screen and drains into bottle

    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('class', 'pour-stream-svg');
    overlay.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    overlay.innerHTML = `
      <defs>
        <linearGradient id="screenPourGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.85"/>
          <stop offset="28%" stop-color="#E0F7FF" stop-opacity="0.95"/>
          <stop offset="50%" stop-color="#FFFFFF" stop-opacity="1"/>
          <stop offset="72%" stop-color="#0284C7" stop-opacity="0.95"/>
          <stop offset="100%" stop-color="#0369A1" stop-opacity="0.85"/>
        </linearGradient>
      </defs>
      <path class="pour-stream-body"/>
      <path class="pour-stream-core"/>
      <ellipse class="pour-stream-cap" cx="${streamX.toFixed(1)}" cy="0" rx="0" ry="0"/>
    `;
    fx.appendChild(overlay);

    const bodyPath = overlay.querySelector('.pour-stream-body');
    const corePath = overlay.querySelector('.pour-stream-core');
    const cap = overlay.querySelector('.pour-stream-cap');

    let impacted = false;
    const startT = performance.now();

    function renderRibbon(topY, botY, t) {
      if (botY <= topY + 2) {
        bodyPath.setAttribute('d', '');
        corePath.setAttribute('d', '');
        cap.setAttribute('rx', '0');
        cap.setAttribute('ry', '0');
        return;
      }
      const halfW = streamWidth * 0.5;
      const count = Math.max(6, Math.min(28, Math.floor((botY - topY) / 26)));
      const step = (botY - topY) / count;
      const leftPts = [];
      const rightPts = [];
      const corePts = [];

      for (let i = 0; i <= count; i++) {
        const y = topY + i * step;
        const p = i / count;
        const pinch = 1 - 0.2 * Math.sin(p * Math.PI);
        const w = halfW * pinch;
        const wave = Math.sin(y * 0.038 - t * 0.022) * 1.6;
        const cx = streamX + wave;
        leftPts.push(`${(cx - w).toFixed(1)},${y.toFixed(1)}`);
        rightPts.unshift(`${(cx + w).toFixed(1)},${y.toFixed(1)}`);
        corePts.push(`${cx.toFixed(1)},${y.toFixed(1)}`);
      }

      bodyPath.setAttribute('d', `M ${leftPts.join(' L ')} L ${rightPts.join(' L ')} Z`);
      corePath.setAttribute('d', `M ${corePts.join(' L ')}`);
      cap.setAttribute('cx', streamX.toFixed(1));
      cap.setAttribute('cy', botY.toFixed(1));
      cap.setAttribute('rx', (streamWidth * 0.55).toFixed(1));
      cap.setAttribute('ry', (streamWidth * 0.28).toFixed(1));
    }

    function frame(now) {
      const elapsed = now - startT;
      let topY = 0;
      let botY = surfY;

      if (elapsed < fallDuration) {
        // Plunging down from screen top edge (0px)
        const prog = Math.min(1, elapsed / fallDuration);
        const eased = 1 - Math.pow(1 - prog, 3);
        botY = Math.max(0, eased * surfY);
        topY = 0;
      } else if (elapsed < pourDuration) {
        // Steady pour into bottle
        topY = 0;
        botY = surfY;
        if (!impacted) {
          impacted = true;
          if (onImpact) onImpact();
        }
      } else if (elapsed < pourDuration + drainDuration) {
        // Tail drains from top edge down into bottle
        const drainElapsed = elapsed - pourDuration;
        const prog = Math.min(1, drainElapsed / drainDuration);
        const eased = prog * prog;
        topY = eased * surfY;
        botY = surfY;
      } else {
        // Clean up completely
        overlay.remove();
        if (onFinish) onFinish();
        return;
      }

      renderRibbon(topY, botY, elapsed);
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  function dropInto(fBefore, fAfter, ml, done) {
    const ySurf = level(fBefore);
    playPourSound(ml, fBefore, fAfter);
    if (calm) return done();
    const power = Math.min(1.5, Math.max(0.6, ml / 250));
    const pourMs = Math.round(Math.min(1600, Math.max(500, 360 + (ml / 250) * 480)));
    const mid = Math.floor(N / 2);

    pourStreamFromScreenTop(ml, ySurf, () => {
      // 1. Water stream impacts the water surface inside bottle!
      pluck(mid, 16 * power, 6);
      sloshVel += (Math.random() > 0.5 ? 1 : -1) * 0.28 * power;
      spawnSplash(100, power);
      replay(bottleSvg, 'wobble');

      $('ripple')?.animate([
        { transform: 'scale(.12)', opacity: .95 },
        { transform: 'scale(1.2)', opacity: 0 }
      ], { duration: pourMs, easing: 'ease-out' });

      // Agitation pulses during pouring
      let pulses = Math.max(2, Math.round(ml / 80));
      const pTimer = setInterval(() => {
        pluck(mid + Math.round((Math.random() - 0.5) * 4), 6 * power, 4);
        if (--pulses <= 0) clearInterval(pTimer);
      }, 110);

      done();
    }, () => {
      // Pour finished and cleaned up
    });
  }

  function add(ml) {
    ml = Math.round(+ml);
    if (!(ml > 0)) return;
    const before = total();
    dayLog().push(ml); save();
    const after = total();
    const bw = document.querySelector('.bottle-wrap');
    if (bw) {
      bw.classList.add('pouring-glow');
      setTimeout(() => bw.classList.remove('pouring-glow'), 950);
    }
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
  const mins = s => { const [h, m] = (s || '07:00').split(':').map(Number); return h * 60 + m; };
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

  function slots() {
    const { wake = '07:00', sleep = '22:00', glass = 250 } = state.rem || {};
    const w = mins(wake), rawS = mins(sleep);
    const s = rawS <= w ? Math.min(1439, rawS + 1440) : rawS;
    const n = Math.max(1, Math.ceil(state.goal / Math.max(100, +glass || 250)));
    return Array.from({ length: n }, (_, i) => ({
      at: Math.min(1439, Math.round(w + (s - w) * (i + 1) / n)),
      expected: Math.min(state.goal, state.goal * (i + 1) / n)
    }));
  }
  function expectedNow() {
    const w = mins(state.rem.wake), rawS = mins(state.rem.sleep), cur = nowMin();
    const s = rawS <= w ? Math.min(1439, rawS + 1440) : rawS;
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
    fetch('/api/cron').catch(() => {});
  }
  setInterval(tick, 15000);

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

  let lineSettingsExpanded = false;
  function renderLineLinkState() {
    const isLinked = !!(state.rem?.lineUserId);
    const linkedBanner = $('lineLinkedBanner');
    const unlinkedBox = $('lineUnlinkedBox');
    const settingsBody = $('lineSettingsBody');
    const toggleBtn = $('toggleLineSettingsBtn');
    const linkedSub = $('lineLinkedSub');

    if (linkedBanner) linkedBanner.hidden = !isLinked;
    if (unlinkedBox) unlinkedBox.hidden = isLinked;
    if (linkedSub && state.user?.email) {
      linkedSub.textContent = `ผูกกับ ${state.user.email} • แจ้งเตือนผ่าน @943raake`;
    }
    if (toggleBtn) {
      toggleBtn.hidden = !isLinked;
      toggleBtn.textContent = lineSettingsExpanded ? '⚙️ ซ่อนตั้งค่า ▴' : '⚙️ ปรับแต่งการ์ด ▾';
    }
    if (settingsBody) {
      settingsBody.hidden = isLinked && !lineSettingsExpanded;
    }
  }
  if ($('toggleLineSettingsBtn')) {
    $('toggleLineSettingsBtn').onclick = () => {
      lineSettingsExpanded = !lineSettingsExpanded;
      renderLineLinkState();
    };
  }

  function syncRemInputsToState(showToast = false) {
    Object.assign(state.rem, {
      on: false,
      wake: $('wake').value || '07:00',
      sleep: $('sleep').value || '22:00',
      glass: Math.max(100, +$('glass').value || 250),
      lineOn: $('lineOn').checked,
      nightSummaryOn: $('nightSummaryOn') ? $('nightSummaryOn').checked : true,
      tone: $('remTone') ? $('remTone').value : 'health',
      customMsg: $('remCustomMsg') ? $('remCustomMsg').value.trim() : ''
    });
    slotSig = '';
    save();
    render();
    if (showToast) {
      const msg = $('remMsg');
      if (msg) {
        msg.textContent = state.rem.lineOn
          ? 'บันทึกตารางเวลาและเปิดแจ้งเตือน LINE (@943raake) แล้ว'
          : 'บันทึกการตั้งค่าแล้ว';
      }
      toast('บันทึกการตั้งค่าแจ้งเตือนแล้ว');
    }
  }

  $('remForm').onsubmit = async e => {
    e.preventDefault();
    syncRemInputsToState(true);
  };
  ['wake', 'sleep', 'glass', 'lineOn', 'nightSummaryOn', 'remTone', 'remCustomMsg'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('change', () => syncRemInputsToState(false));
  });

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

  async function sendTestLineCard(mode = 'auto') {
    const btn = mode === 'summary' ? $('testSummaryLineBtn') : $('testLineBtn');
    const origText = btn ? btn.textContent : '';
    const msg = $('remMsg');
    Object.assign(state.rem, {
      on: false,
      lineOn: true,
      nightSummaryOn: $('nightSummaryOn') ? $('nightSummaryOn').checked : true,
      tone: $('remTone') ? $('remTone').value : 'health',
      customMsg: $('remCustomMsg') ? $('remCustomMsg').value.trim() : ''
    });
    $('lineOn').checked = true;
    save();
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'กำลังส่งเข้า LINE...';
    }
    let sum7 = 0, streak7 = 0;
    for (let i = 0; i < 7; i++) {
      const dt = new Date(); dt.setDate(dt.getDate() - i);
      const k = dt.toLocaleDateString('sv');
      const v = (state.logs[k] || []).reduce((a, b) => a + b, 0);
      sum7 += v;
      if (v >= state.goal) streak7++;
    }
    try {
      const res = await fetch('/api/test-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineUserId: state.rem.lineUserId || '',
          glass: state.rem.glass || 250,
          consumed: total(),
          goal: state.goal,
          mode,
          tone: state.rem.tone || 'health',
          customMsg: state.rem.customMsg || '',
          extraStats: {
            cups: dayLog().length,
            avg7: Math.round(sum7 / 7),
            streak7
          }
        })
      });
      const data = await res.json();
      if (data.botInfo) {
        serverHasLineToken = true;
        renderLineBotBanner(data.botInfo);
      }
      if (data.ok) {
        msg.textContent = mode === 'summary'
          ? 'ส่งการ์ดสรุปผลประจำวันเข้า LINE สำเร็จแล้ว! เปิดดูในแอป LINE ได้เลย'
          : 'ส่งการ์ดเตือนดื่มน้ำพร้อมปุ่มลัด Quick Reply เข้า LINE สำเร็จแล้ว!';
        toast('ส่งเข้า LINE สำเร็จแล้ว!');
      } else {
        msg.textContent = `ส่งเข้า LINE ไม่สำเร็จ: ${data.error || 'ตรวจสอบการแอดเพื่อนบอทอีกครั้ง'}`;
        if (data.isQuotaExceeded && $('lineQuotaNotice')) {
          $('lineQuotaNotice').hidden = false;
        }
        toast(data.isQuotaExceeded ? 'โควตา LINE บอทเต็มแล้ว' : 'ส่งเข้า LINE ไม่สำเร็จ');
      }
    } catch (_) {
      msg.textContent = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ส่ง LINE ได้';
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
  $('testLineBtn').onclick = () => sendTestLineCard('auto');
  if ($('testSummaryLineBtn')) $('testSummaryLineBtn').onclick = () => sendTestLineCard('summary');

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

  function removeSavedAccount(email) {
    const list = getSavedAccounts().filter(a => a.email !== email);
    localStorage.setItem(ACC_KEY, JSON.stringify(list));
    renderSavedAccounts();
    toast('ลบบัญชีออกจากรายการแล้ว');
  }

  function renderSavedAccounts() {
    const list = getSavedAccounts();
    const box = $('savedAccounts');
    const modalList = $('modalAccountList');
    const anotherBtn = $('useAnotherAccBtn');
    const form = $('gmailForm');
    if (modalList) {
      if (list.length) {
        modalList.innerHTML = list.map(a => {
          const disp = a.name || a.email.split('@')[0];
          const init = (disp[0] || 'G').toUpperCase();
          const ava = a.picture
            ? `<img src="${a.picture}" alt="" class="g-acc-ava" style="object-fit:cover">`
            : `<span class="g-acc-ava">${init}</span>`;
          return `
            <div class="g-acc-item">
              <button type="button" class="g-acc-row" data-email="${a.email}" data-name="${a.name || ''}" data-pic="${a.picture || ''}">
                ${ava}
                <div><strong>${disp}</strong><small>${a.email}</small></div>
              </button>
              <button type="button" class="acc-del-btn" data-del-acc="${a.email}" title="ลบบัญชีนี้" aria-label="ลบบัญชีนี้">✕</button>
            </div>
          `;
        }).join('');
        modalList.querySelectorAll('.g-acc-row').forEach(btn => {
          btn.onclick = () => loginWithGmail(btn.dataset.email, btn.dataset.name, btn.dataset.pic);
        });
        modalList.querySelectorAll('[data-del-acc]').forEach(btn => {
          btn.onclick = e => {
            e.stopPropagation();
            removeSavedAccount(btn.dataset.delAcc);
          };
        });
        if (anotherBtn && form) {
          anotherBtn.hidden = false;
          form.hidden = true;
          anotherBtn.onclick = () => {
            anotherBtn.hidden = true;
            form.hidden = false;
            setTimeout(() => $('gmailInput')?.focus(), 40);
          };
        }
      } else {
        modalList.innerHTML = '';
        if (anotherBtn) anotherBtn.hidden = true;
        if (form) form.hidden = false;
      }
    }
    if (!list.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = `<p class="muted">เลือกบัญชี Google ของคุณ</p>` + list.map(a => `
      <div class="acc-item-wrap">
        <button type="button" class="acc-chip" data-email="${a.email}" data-name="${a.name || ''}" data-pic="${a.picture || ''}">
          <div><strong>${a.name || a.email.split('@')[0]}</strong><small>${a.email}</small></div>
          <span>เข้าใช้ →</span>
        </button>
        <button type="button" class="acc-del-btn" data-del-acc="${a.email}" title="ลบบัญชีนี้" aria-label="ลบบัญชีนี้">✕</button>
      </div>
    `).join('');
    box.querySelectorAll('.acc-chip').forEach(btn => {
      btn.onclick = () => loginWithGmail(btn.dataset.email, btn.dataset.name, btn.dataset.pic);
    });
    box.querySelectorAll('[data-del-acc]').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        removeSavedAccount(btn.dataset.delAcc);
      };
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
    $('glass').value = state.rem.glass;
    state.rem.on = false;
    $('lineOn').checked = state.rem.lineOn !== false;
    if ($('nightSummaryOn')) $('nightSummaryOn').checked = state.rem.nightSummaryOn !== false;
    if ($('remTone')) $('remTone').value = state.rem.tone || 'health';
    if ($('remCustomMsg')) $('remCustomMsg').value = state.rem.customMsg || '';
    renderLineLinkState();
    render();
  }

  async function loginWithGmail(rawEmail, rawName, rawPic) {
    const email = (rawEmail || '').trim().toLowerCase();
    const err = $('loginErr');
    if (!email) {
      err.textContent = 'กรุณากรอกอีเมลหรือชื่อบัญชีของคุณ';
      return;
    }
    err.textContent = '';
    if ($('googleModal')) $('googleModal').hidden = true;
    const name = (rawName || '').trim() || email.split('@')[0];
    const picture = rawPic || '';
    state.user = { email, name, picture };
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
    const ava = $('userAvatar');
    if (state.user.picture) {
      ava.innerHTML = `<img src="${state.user.picture}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    } else {
      ava.textContent = (state.user.name || state.user.email)[0].toUpperCase();
    }
    const isAdmin = isAdminUser();
    if (tabBtns[4]) tabBtns[4].hidden = !isAdmin;
    catNav.style.setProperty('--tab-count', isAdmin ? 5 : 4);
    if (!isAdmin && curTab === 4) switchTab(0);
    applyStateToUI();
    syncUserFromServer();
  }

  function applyPendingLineOps(ops) {
    if (!Array.isArray(ops) || !ops.length) return;
    let addedMl = 0, undoneCount = 0;
    const before = total();
    for (const op of ops) {
      const dt = op.date || today();
      state.logs[dt] ||= [];
      if (op.type === 'add' && op.ml > 0) {
        state.logs[dt].push(op.ml);
        if (dt === today()) addedMl += op.ml;
      } else if (op.type === 'undo') {
        if (state.logs[dt].length) {
          state.logs[dt].pop();
          if (dt === today()) undoneCount++;
        }
      }
    }
    localStorage.setItem(KEY, JSON.stringify(state));
    const after = total();
    if (addedMl > 0) {
      dropInto(Math.min(before / state.goal, 1), Math.min(after / state.goal, 1), addedMl, () => {
        render();
        replay($('ml'), 'pop');
      });
      toast(`💧 ซิงก์จาก LINE +${addedMl} มล. แล้ว!`);
    } else if (undoneCount > 0) {
      pluck(Math.floor(N / 2), -8, 6);
      sloshVel -= 0.16;
      render();
      toast('↩️ ซิงก์การยกเลิกจาก LINE แล้ว');
    } else {
      render();
    }
  }

  let syncingUser = false;
  async function syncUserFromServer() {
    if (!state.user?.email || syncingUser) return;
    syncingUser = true;
    try {
      const res = await fetch(`/api/user-state?email=${encodeURIComponent(state.user.email)}`);
      if (res.ok) {
        const { data, pendingLineOps, linkedLineUserId } = await res.json();
        const uid = linkedLineUserId || data?.rem?.lineUserId || '';
        if (uid && state.rem.lineUserId !== uid) {
          state.rem.lineUserId = uid;
          localStorage.setItem(KEY, JSON.stringify(state));
          renderLineLinkState();
        }
        if (!data) {
          // Server restarted or doesn't have our user record yet -> push local state
          save();
        } else if (Array.isArray(pendingLineOps) && pendingLineOps.length) {
          applyPendingLineOps(pendingLineOps);
        }
      }
    } catch (_) {}
    syncingUser = false;
  }
  setInterval(() => {
    if (!document.hidden) syncUserFromServer();
  }, 3000);
  window.addEventListener('focus', syncUserFromServer);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncUserFromServer();
  });

  $('gmailForm').onsubmit = e => {
    e.preventDefault();
    loginWithGmail($('gmailInput').value, $('gmailName').value);
  };

  const DEFAULT_GOOGLE_CLIENT_ID = '990715836668-68q2lvjmg79807hc12ltmk5rcat6560l.apps.googleusercontent.com';
  let googleTokenClient = null;
  let activeGoogleClientId = localStorage.getItem('swd-gclient-id') || DEFAULT_GOOGLE_CLIENT_ID;

  function setupGoogleOAuth(clientId) {
    if (!clientId) return;
    activeGoogleClientId = clientId.trim();
    if ($('gClientIdInput')) $('gClientIdInput').value = activeGoogleClientId;
    const initGis = () => {
      if (window.google?.accounts?.oauth2) {
        googleTokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: activeGoogleClientId,
          scope: 'openid email profile',
          prompt: 'select_account',
          callback: async resp => {
            if (resp && resp.access_token) {
              try {
                const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                  headers: { Authorization: `Bearer ${resp.access_token}` }
                });
                const info = await r.json();
                if (info.email) {
                  loginWithGmail(info.email, info.name || info.given_name || '', info.picture || '');
                }
              } catch (_) {}
            }
          }
        });
      }
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: activeGoogleClientId,
          callback: resp => {
            try {
              const payload = JSON.parse(atob(resp.credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
              if (payload.email) loginWithGmail(payload.email, payload.name || '', payload.picture || '');
            } catch (_) {}
          }
        });
      }
    };
    if (window.google?.accounts) {
      initGis();
    } else if (!document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = initGis;
      document.head.appendChild(s);
    }
  }

  setupGoogleOAuth(activeGoogleClientId);

  function openGoogleModal() {
    if (googleTokenClient) {
      googleTokenClient.requestAccessToken({ prompt: 'select_account' });
      return;
    }
    renderSavedAccounts();
    if ($('googleModal')) {
      $('googleModal').hidden = false;
      if (!$('gmailForm')?.hidden) {
        setTimeout(() => $('gmailInput')?.focus(), 50);
      }
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
  if ($('saveGClientIdBtn')) {
    $('saveGClientIdBtn').onclick = async () => {
      const cid = ($('gClientIdInput')?.value || '').trim();
      const st = $('gClientIdStatus');
      if (!cid) {
        localStorage.removeItem('swd-gclient-id');
        googleTokenClient = null;
        if (st) st.textContent = 'ล้างค่า Client ID แล้ว';
        return;
      }
      localStorage.setItem('swd-gclient-id', cid);
      try {
        await fetch('/api/google-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ googleClientId: cid })
        });
      } catch (_) {}
      setupGoogleOAuth(cid);
      if (st) st.textContent = '✅ บันทึกแล้ว! กดปุ่มเข้าสู่ระบบด้วย Google เพื่อเลือกบัญชีได้เลย';
      setTimeout(() => {
        if (googleTokenClient) {
          closeGoogleModal();
          googleTokenClient.requestAccessToken({ prompt: 'select_account' });
        }
      }, 600);
    };
  }

  $('logoutBtn').onclick = () => {
    state.user = null;
    localStorage.setItem(KEY, JSON.stringify(state));
    enterApp();
    toast('ออกจากระบบแล้ว');
  };

  // Optional Google Identity Services (GIS) button + server-wide LINE bot info
  fetch('/api/vapid-public-key').then(r => r.json()).then(({ googleClientId, hasDefaultLineToken, lineBotInfo, tutorialYouTubeId, lineQuota }) => {
    if (lineQuota && $('lineQuotaNotice')) {
      $('lineQuotaNotice').hidden = !lineQuota.isExceeded;
    }
    if (tutorialYouTubeId) {
      activeTutorialYouTubeId = tutorialYouTubeId;
      if ($('adminTutorialYtInput')) $('adminTutorialYtInput').value = tutorialYouTubeId;
    }
    if (hasDefaultLineToken) serverHasLineToken = true;
    if (lineBotInfo) renderLineBotBanner(lineBotInfo);
    const cid = googleClientId || activeGoogleClientId;
    if (cid) setupGoogleOAuth(cid);
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
  const escHtml = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  let adminUnlocked = sessionStorage.getItem('swd.admin') === '1';
  let adminUsersCache = [];
  let adminFeedbackCache = [];

  function checkAdminAccess() {
    if (isAdminUser() || adminUnlocked) {
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
      if ($('aKpiUsers')) $('aKpiUsers').textContent = `${data.totalUsers} คน`;
      if ($('aKpiUsersSub')) $('aKpiUsersSub').textContent = `ดื่มน้ำวันนี้ ${data.activeTodayCount || 0} คน`;
      if ($('aKpiMetSub')) $('aKpiMetSub').textContent = `${r0(data.totalTodayMl)} มล.`;
      if ($('aKpiMet')) $('aKpiMet').textContent = `ครบเป้า ${data.goalMetCount} / ${data.totalUsers} คน`;
      if ($('aKpiAllTime')) $('aKpiAllTime').textContent = `${r0(data.totalAllTimeMl || 0)} มล.`;
      const avgPerUser = data.totalUsers ? Math.round((data.totalAllTimeMl || 0) / data.totalUsers) : 0;
      if ($('aKpiAllTimeSub')) $('aKpiAllTimeSub').textContent = `เฉลี่ย ${r0(avgPerUser)} มล./คน`;

      const fbStats = data.feedbackStats || { count: 0, avgRating: 0, ratingDist: {} };
      if ($('aKpiFeedback')) $('aKpiFeedback').textContent = `${Number(fbStats.avgRating || 0).toFixed(1)} ★`;
      if ($('aKpiFeedbackSub')) $('aKpiFeedbackSub').textContent = `จาก ${fbStats.count || 0} แบบประเมิน`;

      if ($('aKpiBot')) $('aKpiBot').textContent = data.lineBotInfo?.basicId || '@943raake';
      if ($('aKpiPush')) {
        let qText = 'ออนไลน์';
        if (data.lineQuota) {
          const q = data.lineQuota;
          qText = `LINE ${q.used}/${q.limit}${q.isExceeded ? ' ⚠️' : ''}`;
        }
        $('aKpiPush').innerHTML = `Push ${data.pushClientsCount} เครื่อง • <span id="aKpiUptime">${qText}</span>`;
      }
      adminUsersCache = data.users || [];
      adminFeedbackCache = data.feedbacks || [];
      renderAdminTable();
      renderAdminFeedbacks(fbStats);
    } catch (_) {}
  }

  function renderAdminTable() {
    const q = ($('adminSearch')?.value || '').trim().toLowerCase();
    const list = adminUsersCache.filter(u =>
      !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
    const tbody = $('adminUsersBody');
    if (!tbody) return;
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
        <td><strong>${escHtml(u.name)}</strong><br><small class="muted">${escHtml(u.email)}</small></td>
        <td>
          <div><strong>${r0(u.todayMl)}</strong> / ${r0(u.goal)} มล. <small class="muted">(${u.todayCount || 0} แก้ว • ${pct}%)</small></div>
          <div class="admin-prog-wrap">
            <div class="admin-prog-bar"><div class="admin-prog-fill ${pct >= 100 ? 'hit' : ''}" style="width:${pct}%"></div></div>
          </div>
        </td>
        <td><strong>${r0(u.totalAllTimeMl || 0)}</strong> มล.<br><small class="muted">${u.totalLoggedDays || 0} วัน • ครบเป้า ${u.daysGoalMet || 0} วัน</small></td>
        <td>${r0(u.weekAvg)} มล./วัน</td>
        <td>${badges}</td>
        <td style="white-space:nowrap">
          <button type="button" class="mini-btn info-btn" data-detail="${escHtml(u.email)}">📋 ประวัติ</button>
          <button type="button" class="mini-btn" data-del="${escHtml(u.email)}">ลบ</button>
        </td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-detail]').forEach(btn => {
      btn.onclick = () => openAdminUserDetailModal(btn.dataset.detail);
    });
    tbody.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm(`ยืนยันการลบข้อมูลผู้ใช้ ${btn.dataset.del} ?`)) return;
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

  function openAdminUserDetailModal(email) {
    const u = adminUsersCache.find(item => item.email === email);
    const modal = $('adminUserDetailModal');
    if (!u || !modal) return;
    $('adminDetailTitle').textContent = `${u.name}`;
    $('adminDetailSub').textContent = `${u.email} • เป้าหมาย ${r0(u.goal)} มล./วัน`;

    $('adminDetailStats').innerHTML = `
      <div class="admin-stat-chip"><small>ดื่มวันนี้</small><strong>${r0(u.todayMl)} มล.</strong></div>
      <div class="admin-stat-chip"><small>สะสมทั้งหมด</small><strong>${r0(u.totalAllTimeMl || 0)} มล.</strong></div>
      <div class="admin-stat-chip"><small>ทำครบเป้า</small><strong>${u.daysGoalMet || 0} / ${u.totalLoggedDays || 0} วัน</strong></div>
    `;

    const weekArr = (u.history7Days || []).slice().reverse();
    const maxMl = Math.max(u.goal || 2000, ...weekArr.map(d => d.ml), 500);
    $('adminDetailWeekBars').innerHTML = weekArr.map(d => {
      const h = Math.max(4, Math.round((d.ml / maxMl) * 76));
      const shortDate = d.date.slice(5);
      return `<div class="ad-w-col">
        <span class="ad-w-val">${d.ml > 0 ? r0(d.ml) : ''}</span>
        <div class="ad-w-bar ${d.goalMet ? 'hit' : ''}" style="height:${h}px" title="${d.date}: ${r0(d.ml)} มล. (${d.cups} แก้ว)"></div>
        <span>${shortDate}</span>
      </div>`;
    }).join('') || '<p class="muted">ยังไม่มีข้อมูล 7 วัน</p>';

    const logs = u.dailyLogs || [];
    $('adminDetailLogsList').innerHTML = logs.length
      ? logs.map(day => {
          const pct = Math.min(100, Math.round((day.ml / Math.max(1, u.goal)) * 100));
          const cupsHtml = (day.entries || []).map(v => `<span class="ad-cup-pill">+${r0(v)} มล.</span>`).join('');
          return `<div class="ad-log-row">
            <div class="ad-log-top">
              <strong>📅 ${day.date}</strong>
              <span><strong>${r0(day.ml)}</strong> มล. (${day.cups} แก้ว • ${pct}%)</span>
            </div>
            <div class="ad-log-cups">${cupsHtml}</div>
          </div>`;
        }).join('')
      : '<p class="muted" style="text-align:center;padding:1rem">ผู้ใช้นี้ยังไม่มีประวัติการบันทึกการดื่มน้ำ</p>';

    modal.hidden = false;
  }

  if ($('closeAdminDetailXBtn')) {
    $('closeAdminDetailXBtn').onclick = () => { $('adminUserDetailModal').hidden = true; };
  }
  if ($('adminUserDetailModal')) {
    $('adminUserDetailModal').addEventListener('click', e => {
      if (e.target === $('adminUserDetailModal')) $('adminUserDetailModal').hidden = true;
    });
  }

  function renderAdminFeedbacks(stats = {}) {
    const summaryEl = $('adminFeedbackSummaryText');
    const pillsEl = $('adminRatingPills');
    const tbody = $('adminFeedbackBody');
    if (!tbody) return;

    const count = stats.count || adminFeedbackCache.length;
    const avg = Number(stats.avgRating || 0).toFixed(1);
    if (summaryEl) {
      summaryEl.textContent = count
        ? `คะแนนความพึงพอใจเฉลี่ย ${avg} / 5.0 ดาว จากผู้ประเมินทั้งหมด ${count} คน`
        : 'ยังไม่มีผู้ส่งแบบประเมินความพึงพอใจเข้ามาในระบบ';
    }
    if (pillsEl) {
      const dist = stats.ratingDist || {};
      pillsEl.innerHTML = [5, 4, 3, 2, 1]
        .filter(s => (dist[s] || 0) > 0)
        .map(s => `<span class="admin-rating-pill">${s} ★ (${dist[s]})</span>`)
        .join('');
    }

    if (!adminFeedbackCache.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="muted">ยังไม่มีแบบประเมินและข้อเสนอแนะ</td></tr>`;
      return;
    }

    tbody.innerHTML = adminFeedbackCache.map(fb => {
      const stars = '★'.repeat(fb.rating || 5) + '☆'.repeat(5 - (fb.rating || 5));
      const cats = (fb.categories || []).map(c => `<span class="fb-cat-tag">${escHtml(c)}</span>`).join('');
      const commentTxt = fb.comment ? `<div style="margin-top:.2rem">${escHtml(fb.comment)}</div>` : '<small class="muted">— ไม่มีข้อความเพิ่มเติม —</small>';
      return `<tr>
        <td style="white-space:nowrap"><small>${escHtml(fb.dateStr || '')}</small></td>
        <td><strong>${escHtml(fb.name || 'ผู้ใช้ทั่วไป')}</strong><br><small class="muted">${escHtml(fb.email || '')}</small></td>
        <td><span class="fb-stars-view">${stars}</span><br><small class="muted">${fb.rating}/5 ดาว</small></td>
        <td class="fb-comment-cell">${cats}${commentTxt}</td>
        <td><button type="button" class="mini-btn" data-delfb="${escHtml(fb.id)}">ลบ</button></td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-delfb]').forEach(btn => {
      btn.onclick = async () => {
        await fetch('/api/admin/delete-feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: btn.dataset.delfb })
        });
        toast('ลบรายการประเมินแล้ว');
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

  /* ---------- Admin Tutorial Video Config ---------- */
  if ($('adminTutorialForm')) {
    $('adminTutorialForm').onsubmit = async e => {
      e.preventDefault();
      const raw = $('adminTutorialYtInput').value.trim();
      const vid = extractYouTubeId(raw);
      if (!vid) {
        $('adminTutorialStatus').textContent = '⚠️ กรุณาระบุลิงก์หรือ Video ID ของ YouTube ให้ถูกต้อง';
        return;
      }
      $('adminTutorialStatus').textContent = 'กำลังบันทึก...';
      try {
        const res = await fetch('/api/tutorial-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tutorialYouTubeId: vid })
        });
        const data = await res.json();
        if (data.ok) {
          activeTutorialYouTubeId = data.tutorialYouTubeId;
          localStorage.setItem('swd.tutorialVideoId', data.tutorialYouTubeId);
          $('adminTutorialStatus').textContent = `✅ บันทึกวิดีโอสำเร็จ (ID: ${data.tutorialYouTubeId})`;
          toast('บันทึกคลิปวิดีโอสอนการใช้งานเรียบร้อยแล้ว');
        }
      } catch (_) {
        $('adminTutorialStatus').textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
      }
    };
  }

  if ($('adminPreviewTutorialBtn')) {
    $('adminPreviewTutorialBtn').onclick = () => {
      const raw = $('adminTutorialYtInput')?.value.trim();
      const vid = extractYouTubeId(raw) || activeTutorialYouTubeId;
      openTutorialModal(vid);
    };
  }

  /* ---------- Tutorial Video & Onboarding Modal ---------- */
  let activeTutorialYouTubeId = localStorage.getItem('swd.tutorialVideoId') || '4kwqAYfVGio';
  const tutorialModal = $('tutorialModal');
  const tutorialVideoIframe = $('tutorialVideoIframe');
  const closeTutorialXBtn = $('closeTutorialXBtn');
  const startUsingAppBtn = $('startUsingAppBtn');
  const topTutorialBtn = $('topTutorialBtn');
  const landingTutorialBtn = $('landingTutorialBtn');

  function extractYouTubeId(urlOrId) {
    if (!urlOrId) return '';
    const str = String(urlOrId).trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
    const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
    return match ? match[1] : str;
  }

  function openTutorialModal(customId) {
    if (!tutorialModal) return;
    const vid = customId || activeTutorialYouTubeId;
    if (tutorialVideoIframe) {
      tutorialVideoIframe.src = `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0&modestbranding=1`;
    }
    tutorialModal.hidden = false;
  }

  function closeTutorialModal() {
    if (!tutorialModal) return;
    tutorialModal.hidden = true;
    if (tutorialVideoIframe) {
      tutorialVideoIframe.src = ''; // Stop video audio/playback immediately
    }
  }

  if (closeTutorialXBtn) closeTutorialXBtn.onclick = closeTutorialModal;
  if (startUsingAppBtn) {
    startUsingAppBtn.onclick = () => {
      localStorage.setItem('swd.tutorialSeen', '1');
      closeTutorialModal();
      toast('💧 เริ่มต้นดื่มน้ำแก้วแรกของวันกันเลย!');
    };
  }
  if (topTutorialBtn) topTutorialBtn.onclick = () => openTutorialModal();
  if (landingTutorialBtn) landingTutorialBtn.onclick = () => openTutorialModal();
  if (tutorialModal) {
    tutorialModal.addEventListener('click', e => {
      if (e.target === tutorialModal) closeTutorialModal();
    });
  }

  /* ---------- PWA Install App Prompt Modal ---------- */
  let deferredInstallPrompt = null;
  const installAppModal = $('installAppModal');
  const installAppNowBtn = $('installAppNowBtn');
  const closeInstallModalBtn = $('closeInstallModalBtn');
  const closeInstallXBtn = $('closeInstallXBtn');
  const installManualGuide = $('installManualGuide');
  const topInstallBtn = $('topInstallBtn');

  function isStandaloneApp() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true ||
           document.referrer.includes('android-app://') ||
           location.search.includes('source=pwa');
  }

  function buildManualInstallGuideHTML() {
    const ua = navigator.userAgent || '';
    const isLineApp = /Line\//i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isLineApp) {
      return `<strong>💡 คุณกำลังเปิดผ่านแชต LINE:</strong>
        <ol>
          <li>กดปุ่ม <strong>⋮</strong> หรือปุ่มแชร์ที่มุมขวาล่าง/ขวาบนของจอ</li>
          <li>เลือก <strong>"เปิดในเบราว์เซอร์เริ่มต้น" (Open in default browser)</strong></li>
          <li>เมื่อเปิดใน Chrome หรือ Safari แล้ว กดปุ่ม <strong>"📲 ติดตั้งแอปลงโทรศัพท์"</strong> ได้ทันที!</li>
        </ol>`;
    }
    if (isIOS) {
      return `<strong>🍏 วิธีติดตั้งแอปบน iPhone / iPad:</strong>
        <ol>
          <li>กดปุ่ม <strong>แชร์ (Share ⬆️)</strong> ที่แถบเมนูด้านล่างของ Safari</li>
          <li>เลื่อนลงมาแล้วเลือก <strong>"เพิ่มไปยังหน้าจอโฮม" (Add to Home Screen ➕)</strong></li>
          <li>กด <strong>"เพิ่ม" (Add)</strong> ที่มุมขวาบน ไอคอนแอปจะอยู่บนหน้าจอมือถือทันที!</li>
        </ol>`;
    }
    return `<strong>📲 วิธีติดตั้งลงหน้าจอมือถือใน 2 ขั้นตอน:</strong>
      <ol>
        <li>กดปุ่มเมนู <strong>⋮ (จุด 3 จุด มุมขวาบน)</strong> ของเบราว์เซอร์ Chrome</li>
        <li>เลือก <strong>"ติดตั้งแอป" (Install app)</strong> หรือ <strong>"เพิ่มลงในหน้าจอหลัก"</strong> แล้วกดยืนยัน</li>
      </ol>`;
  }

  function openInstallModal() {
    if (!installAppModal || isStandaloneApp()) return;
    if (installManualGuide) installManualGuide.hidden = true;
    installAppModal.hidden = false;
  }

  function closeInstallModal() {
    if (installAppModal) installAppModal.hidden = true;
  }

  function updateInstallUI() {
    const standalone = isStandaloneApp();
    if (topInstallBtn) topInstallBtn.hidden = standalone;
    if (standalone && installAppModal) installAppModal.hidden = true;
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    updateInstallUI();
    if (installAppNowBtn) {
      installAppNowBtn.textContent = '📲 ติดตั้งแอปลงโทรศัพท์ทันที';
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    closeInstallModal();
    if (topInstallBtn) topInstallBtn.hidden = true;
    toast('🎉 ติดตั้งแอป Smart Water Drink ลงบนเครื่องเรียบร้อยแล้ว!');
  });

  if (installAppNowBtn) {
    installAppNowBtn.onclick = async () => {
      if (deferredInstallPrompt) {
        try {
          deferredInstallPrompt.prompt();
          const { outcome } = await deferredInstallPrompt.userChoice;
          if (outcome === 'accepted') {
            deferredInstallPrompt = null;
            closeInstallModal();
            if (topInstallBtn) topInstallBtn.hidden = true;
          }
          return;
        } catch (_) {}
      }
      if (installManualGuide) {
        installManualGuide.innerHTML = buildManualInstallGuideHTML();
        installManualGuide.hidden = false;
      }
    };
  }
  if (closeInstallModalBtn) closeInstallModalBtn.onclick = closeInstallModal;
  if (closeInstallXBtn) closeInstallXBtn.onclick = closeInstallModal;
  if (topInstallBtn) topInstallBtn.onclick = openInstallModal;
  if (installAppModal) {
    installAppModal.addEventListener('click', e => {
      if (e.target === installAppModal) closeInstallModal();
    });
  }

  /* ---------- Draggable Dark-Blue Feedback FAB & Modal ---------- */
  const feedbackFab = $('feedbackFab');
  const feedbackModal = $('feedbackModal');
  const closeFeedbackXBtn = $('closeFeedbackXBtn');
  const cancelFeedbackBtn = $('cancelFeedbackBtn');
  const feedbackForm = $('feedbackForm');
  const fbStarRow = $('fbStarRow');
  const fbRatingLabel = $('fbRatingLabel');
  const fbCategoryChips = $('fbCategoryChips');
  const fbCommentInput = $('fbComment');
  const fbUserNameInput = $('fbUserName');
  const fbStatusMsg = $('fbStatusMsg');

  let selectedFbRating = 5;
  const ratingLabels = {
    1: 'ควรปรับปรุง 🤔 (1/5 ดาว)',
    2: 'พอใช้ 😐 (2/5 ดาว)',
    3: 'ปานกลาง 🙂 (3/5 ดาว)',
    4: 'ดีมาก 😊 (4/5 ดาว)',
    5: 'ประทับใจมากที่สุด! 🤩 (5/5 ดาว)'
  };

  function updateFbStarsUI(val) {
    selectedFbRating = val;
    if (fbStarRow) {
      fbStarRow.querySelectorAll('.fb-star').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.val) <= val);
      });
    }
    if (fbRatingLabel) fbRatingLabel.textContent = ratingLabels[val] || '';
  }

  if (fbStarRow) {
    fbStarRow.querySelectorAll('.fb-star').forEach(btn => {
      btn.onclick = () => updateFbStarsUI(Number(btn.dataset.val));
    });
  }

  if (fbCategoryChips) {
    fbCategoryChips.querySelectorAll('.fb-chip').forEach(chip => {
      chip.onclick = () => chip.classList.toggle('selected');
    });
  }

  function openFeedbackModal() {
    if (!feedbackModal) return;
    if (fbUserNameInput && state.user?.name && !fbUserNameInput.value) {
      fbUserNameInput.value = state.user.name;
    }
    if (fbStatusMsg) fbStatusMsg.textContent = '';
    feedbackModal.hidden = false;
  }

  function closeFeedbackModal() {
    if (feedbackModal) feedbackModal.hidden = true;
  }

  if (closeFeedbackXBtn) closeFeedbackXBtn.onclick = closeFeedbackModal;
  if (cancelFeedbackBtn) cancelFeedbackBtn.onclick = closeFeedbackModal;
  if (feedbackModal) {
    feedbackModal.addEventListener('click', e => {
      if (e.target === feedbackModal) closeFeedbackModal();
    });
  }

  if (feedbackForm) {
    feedbackForm.onsubmit = async e => {
      e.preventDefault();
      const categories = fbCategoryChips
        ? [...fbCategoryChips.querySelectorAll('.fb-chip.selected')].map(c => c.dataset.cat)
        : [];
      const comment = (fbCommentInput?.value || '').trim();
      const customName = (fbUserNameInput?.value || '').trim();
      const email = state.user?.email || 'ผู้ใช้งานทั่วไป (Guest)';
      const name = customName || state.user?.name || (email.includes('@') ? email.split('@')[0] : 'ผู้ใช้ทั่วไป');
      const activeTabEl = document.querySelector('.tab-btn[aria-selected="true"]');
      const page = !($('appView')?.hidden) && activeTabEl ? activeTabEl.textContent.trim() : 'หน้าแรก / Landing';

      const submitBtn = $('submitFeedbackBtn');
      if (submitBtn) submitBtn.disabled = true;
      if (fbStatusMsg) fbStatusMsg.textContent = 'กำลังส่งแบบประเมิน...';

      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rating: selectedFbRating,
            categories,
            comment,
            name,
            email,
            page
          })
        });
        const data = await res.json();
        if (data.ok) {
          toast('💙 ขอบคุณสำหรับแบบประเมินและข้อเสนอแนะของคุณ!');
          if (fbCommentInput) fbCommentInput.value = '';
          if (fbCategoryChips) fbCategoryChips.querySelectorAll('.fb-chip.selected').forEach(c => c.classList.remove('selected'));
          updateFbStarsUI(5);
          closeFeedbackModal();
          if (adminUnlocked || isAdminUser()) loadAdminDashboard();
        } else {
          if (fbStatusMsg) fbStatusMsg.textContent = 'ส่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
        }
      } catch (_) {
        if (fbStatusMsg) fbStatusMsg.textContent = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ในขณะนี้';
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    };
  }

  if (feedbackFab) {
    const FAB_KEY = 'swd.fabPos';
    let isDragging = false;
    let dragMoved = false;
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;
    let suppressClickUntil = 0;

    function clampFabPos(left, top) {
      const rect = feedbackFab.getBoundingClientRect();
      const w = rect.width || 110;
      const h = rect.height || 48;
      const minX = 8, maxX = Math.max(minX, window.innerWidth - w - 8);
      const minY = 8, maxY = Math.max(minY, window.innerHeight - h - 8);
      return {
        left: Math.min(maxX, Math.max(minX, left)),
        top: Math.min(maxY, Math.max(minY, top))
      };
    }

    function applyFabPos(left, top) {
      const c = clampFabPos(left, top);
      feedbackFab.style.left = c.left + 'px';
      feedbackFab.style.top = c.top + 'px';
      feedbackFab.style.right = 'auto';
      feedbackFab.style.bottom = 'auto';
      return c;
    }

    try {
      const saved = JSON.parse(localStorage.getItem(FAB_KEY) || 'null');
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        requestAnimationFrame(() => applyFabPos(saved.left, saved.top));
      }
    } catch (_) {}

    window.addEventListener('resize', () => {
      if (feedbackFab.style.left && feedbackFab.style.top) {
        applyFabPos(parseFloat(feedbackFab.style.left), parseFloat(feedbackFab.style.top));
      }
    });

    feedbackFab.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      isDragging = true;
      dragMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = feedbackFab.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;
      try { feedbackFab.setPointerCapture(e.pointerId); } catch (_) {}
    });

    window.addEventListener('pointermove', e => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragMoved && Math.hypot(dx, dy) > 6) {
        dragMoved = true;
        feedbackFab.classList.add('dragging');
      }
      if (dragMoved) {
        applyFabPos(origLeft + dx, origTop + dy);
      }
    });

    const endDrag = e => {
      if (!isDragging) return;
      isDragging = false;
      feedbackFab.classList.remove('dragging');
      try { feedbackFab.releasePointerCapture(e.pointerId); } catch (_) {}
      if (dragMoved) {
        suppressClickUntil = Date.now() + 250;
        const rect = feedbackFab.getBoundingClientRect();
        try {
          localStorage.setItem(FAB_KEY, JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) }));
        } catch (_) {}
      }
    };

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    feedbackFab.addEventListener('click', e => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      openFeedbackModal();
    });
  }

  /* ---------- keyboard Escape dismiss for active dialogs ---------- */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (feedbackModal && !feedbackModal.hidden) { closeFeedbackModal(); return; }
    if ($('adminUserDetailModal') && !$('adminUserDetailModal').hidden) { $('adminUserDetailModal').hidden = true; return; }
    if (tutorialModal && !tutorialModal.hidden) { closeTutorialModal(); return; }
    if (installAppModal && !installAppModal.hidden) { closeInstallModal(); return; }
    const gM = $('gModal');
    if (gM && !gM.hidden) { gM.hidden = true; }
  });

  /* ---------- init ---------- */
  enterApp();
  updateInstallUI();
  if (isStandaloneApp()) {
    // Opened from home screen as installed app:
    // If not seen yet, show onboarding video modal!
    if (!localStorage.getItem('swd.tutorialSeen')) {
      setTimeout(() => openTutorialModal(), 650);
    }
  } else {
    // Opened in regular web browser:
    // Prompt installation to phone screen
    setTimeout(openInstallModal, 450);
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(() => syncPush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncPush();
    });
  }
})();
