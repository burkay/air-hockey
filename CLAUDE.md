# CLAUDE.md

## Proje amacı
iPhone tarayıcısından air hockey. İki mod:
- **Tek kişilik (Bilgisayara Karşı):** AI rakip, ağ yok. Zorluk: Kolay/Orta/Zor.
- **Arkadaşınla (uzaktan):** şifre ile eşleşme; kuran + şifre/kural belirler.

## Teknoloji
- Backend: Node.js + Express + Socket.IO (sadece eşleştirme + mesaj rölesi).
- Frontend: saf JS + HTML5 Canvas. Build adımı / framework yok.
- Fizik modeli: host-authoritative (kuran istemci simüle eder, durumu yollar).

## Komutlar
- `npm install` — bağımlılıklar
- `npm start` — sunucu (http://localhost:3000, `PORT` env ile değişir)

## Dizin yapısı
- `server.js` — oda eşleştirme + Socket.IO röle (fizik YOK)
- `public/js/game.js` — fizik + çizim + host/misafir rol ayrımı (çekirdek)
- `public/js/sfx.js` — Web Audio ile sentezlenen sesler (dosya yok); `Sfx.unlock()`
  iOS için ilk dokunuşta çağrılır (main.js global pointerdown)
- `public/js/net.js` — Socket.IO istemci sarmalayıcı
- `public/js/ui.js` — ekran geçişleri / DOM yardımcıları
- `public/js/main.js` — akış kontrolü, ağ olayları
- `public/index.html`, `public/css/style.css` — ekranlar ve mobil yerleşim

## Oyun dinamikleri (game.js sabitleri) — gerçekçi model
- Çarpışma: mallet = el kontrollü → sonsuz kütle. `collide()` bağıl normal
  hızını `PADDLE_E` (0.92) restitution ile yansıtır; momentum aktarımı bu
  modelden doğal gelir (yapay hız ekleme YOK). Puck sürtünmesiz → teğetsel
  bileşen değişmez (gerçekçi air hockey, "english" yok).
- `FRICTION=0.9997` (adım/120Hz) ≈ %3.5/sn hava direnci.
- `WALL_E=0.90` ray restitution'ı (bir miktar enerji kaybı).
- `MAX_SPD=240` tavan (tünelleme/absürt hız engeli). **Hız tabanı YOK** —
  puck doğal yavaşlar.
- Puck boyutu: `PR` artık `let`; `setPuckSize(n)` → `PUCK_SIZES`
  {small:2.4, med:3.2, large:4.4}. Lobide `[data-puck]`,
  `localStorage('ah_puck')`, `main.js applyPuck()`, `UI.markPuck()`.
  Fizik olduğu için host yetkili: state'e `pr` eklenir, misafir
  `handleState`'te `PR=d.pr` (host'un boyutu geçerli).
- Kale ağzı: puck kale çizgisini geçince (gol tetiği `H+2·PR`'a ulaşana
  kadar) `vy` zorla ≥40 (içeri) yapılır — yavaş puck ağızda TAKILMAZ
  (hız tabanı kaldırıldığı için kritik; bu olmadan oyun gol anında donar).
- Soft-lock yerine hakem reseti: puck `STALL_TIME` (2.2sn) boyunca
  `STALL_SPD` (14) altında kalırsa `faceoff()` merkeze koyup yeniden servis.
- `PADDLE_VMAX=520` el hızı sınırı (touch/ağ jitter fırlatmasını önler).
- AI: `pGuest` (üst paddle) kontrol eder. Presetler `AI_PRESETS`
  (easy/normal/hard): spd, predict (duvar sekmeli tahmin), aggro, home, err.
  `aiMove()` integrate() başında çağrılır; tek kişilik modda ağ kapalı
  (`maybeSend`/`handleInput` `ai` iken atlanır).
- Efektler: fizik olayları `pend`/`sendFx`'e biriktirilir; host/AI karede yerel
  ses çalar, host bunu state'in `fx` alanıyla misafire iletir (misafir fizik
  çalıştırmadığı için sesleri/golü oradan alır). Gol görseli `goalFx()`:
  ekran sarsıntısı + parlama + halka + parçacık (canvas) + "GOL!" mesajı
  (`onMessage(txt, isGoal)`), skor sayısı CSS `.pop` ile zıplar (UI.hud
  değişimi yakalar, `UI.resetScores()` yeni maçta sıfırlar).

## Zamanlama (KRİTİK — donma hatası dersi)
- TÜM oyun zamanlaması `dt` birikimine bağlı (`countdown`, `fx.goalLeft`
  saniye sayaçları; `dt` her karede azaltır). **Asla** rAF zaman damgasını
  `performance.now()` ile karşılaştırma — bu iki saat farklı orijinli
  olabilir; eskiden gol sonrası `serve()` hiç tetiklenmeyip oyun donuyordu.
- `frame()` gövdesi try/catch içinde: hata olsa bile rAF yeniden planlanır
  (kalıcı donma imkânsız), hata `console.error('[airhockey] kare hatasi')`.
- `dt = max(0, min(0.05, (now-lastT)/1000))` — negatif/sıçrama korumalı.

## Skin'ler (yalnızca görsel)
- `game.js` içinde `SKINS` (`neon` varsayılan, `arcade` = klasik BCP mavi).
  `Game.setSkin(name)` aktif skin'i seçer; `render()`/`drawGoal()`/
  `drawPaddle()` renkleri skin'den okur.
- **Çok oyuncuda görünüm+puck'ı KURAN belirler:** host `create_room`'da
  `skin`+`puck` yollar, sunucu odada saklar, misafire `joined`/`room_created`
  ile gider. `main.js useMatchLook()` misafirde host'unkini uygular
  (localStorage'a yazmadan; misafirin kendi tercihi korunur). Puck ayrıca
  `state.pr` ile sürekli host-yetkili. Tek kişilik/host kendi seçimini kullanır.
- Arcade: mavi gradient zemin, beyaz çizgi+daire+nokta, kırmızı kale yayı
  (crease, tablo-uzayı polyline → host/guest doğru), siyah kalın kasa,
  sarı puck, mavi/kırmızı paddle (beyaz halka).
- Seçim lobide `.skin-btn[data-skin]`, `localStorage('ah_skin')`'de saklanır,
  `main.js applySkin()` uygular; `body.skin-arcade` letterbox zeminini koyar.
- `render()` gradient'i `ctx.createLinearGradient` yoksa düz renge düşer
  (headless güvenli).
- Paddle = gerçekçi pusher: `drawPaddle()` koyu taban flanşı + radyal
  gradient kubbe + orta tutamak knob'u + specular. `shade(hex,amt)` ton
  açar/koyultur; `ring()` kontur. `createRadialGradient` yoksa düz renk
  fallback (headless güvenli). Renk skin pad renginden gelir.

## Ağ / netcode
- Gönderim ~60Hz (`maybeSend` 16ms). Misafir: puck **hızıyla ekstrapole**
  edilir (`netPuck` + dead-reckoning); rakip paddle fps-bağımsız yumuşatma.
- **Yetkili misafir paddle gecikmesiz:** host `pGuest = tgtGuest` (yapay
  yumuşatma YOK — eskiden `dt*22` ~90ms gecikme katıp hızlı kaydırmada
  ıskalatıyordu).
- **Süpürmeli (swept) çarpışma** (`collide(q1,pv,q0,px0,py0)`): puck (p0→p1)
  ve paddle (q0→q1) bağıl yolu minD'ye girerse vuruş — kuadratik giriş anı
  `t`. Hızlı paddle artık topun içinden geçmez. `integrate` adım öncesi
  puck (`px0,py0`) ve eski paddle konumlarını (`hq0,gq0`) verir.
- **Yeniden bağlanma:** kopma kalıcı bozmaz. Sunucu disconnect'te ~25sn
  **grace**; `peer_dropped` (geçici, oyun durmaz) → grace dolarsa `peer_left`
  (terminal). İstemci `connect` (reconnect) → `Net.resume(password, role)` →
  sunucu yeri geri verir → `peer_back`/`resumed`. Bilerek çıkış (`leave_room`)
  anında `peer_left`. Durum bildirimi ayrı `#netmsg` (game render dokunmaz).

## Konvansiyonlar / dikkat
- Sanal masa koordinatı `W=100 x H=200` (dikey). Pixel'e letterbox ile ölçeklenir.
- Misafir görünümü 180° döndürülür (`toView`/`fromView`); ikisi de alt kaleyi savunur.
- Kod tanımlayıcıları İngilizce, yorumlar Türkçe (ASCII).
- Oda anahtarı = şifrenin kendisi. Aynı şifreyle aktif oda varsa kurma reddedilir.
- Socket.IO olayları: `create_room`/`join_room`/`state`/`input`/`rematch`/
  `rematch_request`/`peer_joined`/`peer_left`/`error_msg`.
- Dağıtım: yerel PC + **Tailscale Funnel** (`tailscale funnel --bg 3000`)
  ya da `PORT` env + `npm start` ile herhangi bir kalıcı WebSocket Node
  host. Statik-only (GitHub Pages/Vercel/Netlify) uygun değil.
  (Render iptal edildi; `render.yaml` kaldırıldı.)
