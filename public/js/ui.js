// Ekran gecisleri ve kucuk DOM yardimcilari.

const UI = (() => {
  const $ = (id) => document.getElementById(id);

  function show(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $('screen-' + name).classList.add('active');
  }

  function lobbyMode(which) {
    $('lobby-home').classList.toggle('hidden', which !== 'home');
    $('form-create').classList.toggle('hidden', which !== 'create');
    $('form-join').classList.toggle('hidden', which !== 'join');
    $('form-ai').classList.toggle('hidden', which !== 'ai');
    $('lobby-error').textContent = '';
  }

  function lobbyError(msg) { $('lobby-error').textContent = msg || ''; }

  function waitPassword(pw) { $('wait-password').textContent = pw; }

  let prevTop = null, prevBottom = null;

  function pulse(el) {
    el.classList.remove('pop');
    void el.offsetWidth;          // reflow -> animasyon yeniden tetiklensin
    el.classList.add('pop');
  }

  function hud(top, bottom, timerTxt) {
    const elTop = $('score-top'), elBot = $('score-bottom');
    if (top !== prevTop) { elTop.textContent = top; if (prevTop !== null) pulse(elTop); prevTop = top; }
    if (bottom !== prevBottom) { elBot.textContent = bottom; if (prevBottom !== null) pulse(elBot); prevBottom = bottom; }
    const t = $('timer');
    if (timerTxt == null) {
      t.classList.add('hidden');
    } else {
      t.classList.remove('hidden');
      t.textContent = timerTxt;
    }
  }

  function resetScores() { prevTop = null; prevBottom = null; }

  function message(txt, isGoal) {
    const el = $('center-msg');
    el.textContent = txt || '';
    el.classList.toggle('goal', !!isGoal && !!txt);
  }

  function endScreen(result, scoreLine, note) {
    const title = result === 'win' ? 'Kazandin! 🎉'
                : result === 'lose' ? 'Kaybettin'
                : 'Berabere';
    $('end-title').textContent = title;
    $('end-score').textContent = scoreLine;
    $('end-note').textContent = note || '';
    show('end');
  }

  function markSkin(name) {
    document.querySelectorAll('[data-skin]').forEach((b) =>
      b.classList.toggle('active', b.dataset.skin === name));
  }

  function markPuck(size) {
    document.querySelectorAll('[data-puck]').forEach((b) =>
      b.classList.toggle('active', b.dataset.puck === size));
  }

  // Baglanti durum bildirimi (game render'in dokunmadigi ayri eleman)
  function netMsg(txt) {
    const el = $('netmsg');
    if (!el) return;
    el.textContent = txt || '';
    el.classList.toggle('show', !!txt);
  }

  return { $, show, lobbyMode, lobbyError, waitPassword, hud, resetScores, message, endScreen, markSkin, markPuck, netMsg };
})();
