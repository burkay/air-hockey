// Ekran gecisleri ve kucuk DOM yardimcilari.

const UI = (() => {
  const $ = (id) => document.getElementById(id);

  let current = 'lobby';
  const showHooks = [];
  function show(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $('screen-' + name).classList.add('active');
    $('screen-' + name).scrollTop = 0;
    document.body.classList.toggle('in-game', name === 'game');
    current = name;
    showHooks.forEach((fn) => fn(name));
  }
  function onShow(fn) { showHooks.push(fn); }
  function screen() { return current; }

  // Lobi ici gorunum: 'home' | 'join' | 'create'
  function lobbyMode(which) {
    $('lobby-table').dataset.mode = which;
    $('lobby-home').classList.toggle('hidden', which !== 'home');
    $('form-create').classList.toggle('hidden', which !== 'create');
    $('form-join').classList.toggle('hidden', which !== 'join');
    lobbyError('');
  }

  function lobbyError(msg) {
    $('lobby-error').textContent = msg || '';
    $('lobby-error').classList.remove('info');
  }
  // Notr durum mesaji (or. "Baglaniyor...")
  function lobbyInfo(msg) {
    $('lobby-error').textContent = msg || '';
    $('lobby-error').classList.add('info');
  }

  // Kisa kod -> kutucuklar; uzun sifre -> tek kutu
  function waitPassword(pw) {
    const el = $('wait-password');
    const s = String(pw);
    const tiles = s.length <= 6 && !/\s/.test(s);
    el.classList.toggle('long', !tiles);
    el.textContent = '';
    (tiles ? s.split('') : [s]).forEach((c) => {
      const t = document.createElement('span');
      t.textContent = c;
      el.appendChild(t);
    });
  }

  let prevTop = null, prevBottom = null;
  // Skorun gorunen hali canvas'ta (Game.render); burada erisilebilir metin + sure
  function hud(top, bottom, timerTxt) {
    if (top !== prevTop) { $('score-top').textContent = top; prevTop = top; }
    if (bottom !== prevBottom) { $('score-bottom').textContent = bottom; prevBottom = bottom; }
    const t = $('timer');
    t.classList.toggle('hidden', timerTxt == null);
    if (timerTxt != null && t.textContent !== timerTxt) t.textContent = timerTxt;
  }
  function resetScores() { prevTop = null; prevBottom = null; }

  let prevMsg = null;
  function message(txt, isGoal, isMy) {
    const key = (txt || '') + '|' + isGoal + '|' + isMy;
    if (key === prevMsg) return;              // her karede DOM'a dokunma
    prevMsg = key;
    const el = $('center-msg');
    el.textContent = txt || '';
    el.classList.toggle('goal', !!isGoal && !!txt);
    el.classList.toggle('bad', !!isGoal && !isMy);
  }

  function clock(sec) {
    const s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // o: { me, op, series: {me,op}|null, stats: {time, top, hitsMe, hitsOp}|null }
  function endScreen(result, o) {
    document.querySelector('#screen-end .end').dataset.result = result;
    $('end-title').textContent = result === 'win' ? 'Kazandın' : result === 'lose' ? 'Kaybettin' : 'Berabere';
    $('end-me').textContent = o.me;
    $('end-op').textContent = o.op;
    $('end-series').textContent = o.series ? 'Seri ' + o.series.me + ' – ' + o.series.op : '';
    $('end-stats').classList.toggle('hidden', !o.stats);
    if (o.stats) {
      $('st-time').textContent = clock(o.stats.time);
      $('st-top').textContent = o.stats.top > 0 ? o.stats.top + ' km/sa' : '–';
      $('st-hits').textContent = o.stats.hitsMe + ' – ' + o.stats.hitsOp;
    }
    $('end-note').textContent = '';
    show('end');
  }

  // Rovans hazirlik durumu (yalniz online)
  function ready(online, me, op) {
    $('end-ready').classList.toggle('hidden', !online);
    $('rd-me').classList.toggle('on', !!me);
    $('rd-op').classList.toggle('on', !!op);
    const b = $('rematch-btn');
    b.disabled = online && !!me;
    b.textContent = !online ? 'Yeniden oyna' : me ? 'Hazırsın' : 'Rövanş';
    if (!online) return;
    $('end-note').textContent = me && !op ? 'Rakibin hazır olması bekleniyor.'
                              : op && !me ? 'Rakip rövanş istiyor.' : '';
  }

  function mark(attr, value) {
    document.querySelectorAll('[data-' + attr + ']').forEach((b) => {
      const on = b.dataset[attr] === value;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function markSkin(name) { mark('skin', name); }
  function markPuck(size) { mark('puck', size); }
  function markCtrl(c) { mark('ctrl', c); }
  function markSound(on) { mark('sound', on ? 'on' : 'off'); }

  // Baglanti kalitesi (yalniz online). ms=0 -> henuz olculmedi
  function ping(online, ms) {
    const el = $('ping');
    el.classList.toggle('hidden', !online || !ms);
    if (!online || !ms) return;
    const r = Math.max(1, Math.round(ms));
    el.dataset.q = r < 80 ? 'ok' : r < 150 ? 'mid' : 'bad';
    el.lastElementChild.textContent = r + ' ms';
  }

  // Baglanti bildirimi: her ekranin ustunde
  function netMsg(txt) {
    const el = $('netmsg');
    el.textContent = txt || '';
    el.classList.toggle('show', !!txt);
  }

  return { $, show, onShow, screen, lobbyMode, lobbyError, lobbyInfo, waitPassword, hud, resetScores, message,
           endScreen, ready, markSkin, markPuck, markCtrl, markSound, ping, netMsg };
})();
