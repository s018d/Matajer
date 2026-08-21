(function () {
  const KEY = 'mc_sound_on';
  let last = null;
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.25, now + i * 0.22);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.22);
        osc.stop(now + i * 0.22 + 0.19);
      }
    } catch (e) {}
  }
  function setBadge(n) {
    const b = document.getElementById('ordersBadge');
    if (!b) return;
    b.textContent = n;
    b.hidden = !n;
  }
  function poll() {
    fetch('/panel/api/neworders' + (last ? '?since=' + encodeURIComponent(last) : ''), { headers: { accept: 'application/json' } })
      .then(r => r.json())
      .then(d => {
        const n = Number(d.count) || 0;
        if (last !== null && n > 0 && localStorage.getItem(KEY) !== '0') beep();
        last = last === null ? new Date().toISOString().slice(0, 19).replace('T', ' ') : last;
        setBadge(n);
      })
      .catch(() => {});
  }
  document.addEventListener('DOMContentLoaded', function () {
    last = null;
    poll();
    setInterval(poll, 30000);
  });
  window.toggleSound = function () {
    const on = localStorage.getItem(KEY) !== '0';
    localStorage.setItem(KEY, on ? '0' : '1');
    const btn = document.getElementById('soundBtn');
    if (btn) btn.textContent = on ? '🔕 إيقاف التنبيه' : '🔔 تشغيل التنبيه';
  };
})();