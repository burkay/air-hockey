# CLAUDE.md

## Proje amacı
iPhone tarayıcısından air hockey. İki mod:
- **Tek kişilik (Bilgisayara Karşı):** AI rakip, ağ yok. Zorluk: Kolay/Orta/Zor.
- **Arkadaşınla (uzaktan):** şifre ile eşleşme; kuran + şifre/kural belirler.

## Teknoloji
- Sunucu YOK: statik site, GitHub Pages'ten yayınlanır (`main` / kök dizin).
- Çok oyunculu: WebRTC peer-to-peer, PeerJS 1.5.4 (unpkg CDN). PeerJS genel
  sunucusu yalnız signaling; varsayılan ICE'ta Google STUN + PeerJS TURN var.
- Frontend: saf JS + HTML5 Canvas. Build adımı / framework yok.
- Fizik modeli: host-authoritative (kuran istemci simüle eder, durumu yollar).

## Komutlar
- Yerel: `npx http-server -p 8080 -c-1` → http://localhost:8080 (iki sekme).
- Yayın: `main`'e push → https://burkay.github.io/air-hockey/
- Mutlak yol (`/js/...`) KULLANMA: Pages alt dizinden (`/air-hockey/`) sunar.
- **CSS/JS değişince `index.html`'deki `?v=N`'i hepsinde birlikte artır.** Pages
  `max-age=600` gönderir; telefon yeni HTML + eski JS ile kalıp yeni düğmeleri
  "ölü" gösteriyordu (Kontrol seçimi tıklanmıyordu).

## Dizin yapısı
- `js/game.js` — fizik + çizim + host/misafir rol ayrımı (çekirdek)
- `js/sfx.js` — Web Audio ile sentezlenen sesler (dosya yok); `Sfx.unlock()`
  iOS için ilk dokunuşta çağrılır (main.js global pointerdown)
- `js/net.js` — WebRTC/PeerJS bağlantı katmanı (oda, heartbeat, yeniden bağlanma)
- `js/ui.js` — ekran geçişleri / DOM yardımcıları
- `js/main.js` — akış kontrolü, ağ olayları
- `index.html`, `css/style.css` — ekranlar ve mobil yerleşim

## Oyun dinamikleri (game.js sabitleri) — gerçekçi model
- Çarpışma: mallet = el kontrollü → sonsuz kütle. `collide()` bağıl normal
  hızını `PADDLE_E` (0.80) restitution ile yansıtır (eski yapay 0.4·padV
  hilesi YOK; momentum modelden doğal gelir). Puck sürtünmesiz → teğetsel
  bileşen değişmez. **Süpürmeli (swept)** ve detayı "Ağ / netcode"da.
- **Yapışma önleyici:** temas sonrası puck DAİMA dışa `MIN_OUT` (30) hız
  alır → yavaş puck duran paddle'a yapışmaz (takılma + ses spam'i olmazdı).
  `pend.hit`/ses yalnız gerçek vuruşta (yaklaşırken, `vn<0`); yaslanmada yok.
- Sürtünme `drag()`: `DRAG_C + DRAG_1·v + DRAG_2·v²` (v=100'de ~%16/sn). Host ve
  misafir tahmini (`coast`) aynı fonksiyonu kullanır; ayrı ayrı değiştirme.
- `WALL_E=0.90` ray restitution'ı (bir miktar enerji kaybı).
- Hız tavanı YUMUŞAK (`softCap`): `SPD_KNEE` (170) altı aynen, üstü tavana
  yaklaşarak sıkışır; sert vuruş hep daha hızlı. Tavan AI'da 360, ağda 290.
  Sert kesme (eski `MAX_SPD=240`) KOYMA: 60Hz'de el hızı 60+ hepsi eşitti.
  **Hız tabanı YOK** — puck doğal yavaşlar.
- Paddle hızı kare `dt`'siyle ölçülür ve süzülür (`trackMallet`), konum kare
  içindeki adımlara bölünür (`stepMallet`, `mHost`/`mGuest`). Kare yer
  değiştirmesini tek `STEP`'e BÖLME: 60Hz'de vuruş 2 kat sert çıkıyordu.
- `collide()` temas sonrası puck'ı adımın kalanında YENİ hızıyla ilerletir; iç
  içe başlayan adımda puck hareketini silmez. Eskiden silindiği için vurulan
  puck paddle durana kadar yapışıp sürükleniyordu (tek vuruş 37-46 adım).
- AI vuruştan sonra `AI_RECOIL` (0.18sn) geri çekilir (duvara art arda itmesin).
- Puck boyutu: `PR` artık `let`; `setPuckSize(n)` → `PUCK_SIZES`
  {small:2.4, med:3.2, large:4.4}. Lobide `[data-puck]`,
  `localStorage('ah_puck')`, `main.js applyPuck()`, `UI.markPuck()`.
  Fizik olduğu için host yetkili: state'e `pr` eklenir, misafir
  `handleState`'te `PR=d.pr` (host'un boyutu geçerli).
- Kale ağzı: puck kale çizgisini geçince (gol tetiği `H+2·PR`'a ulaşana
  kadar) `vy` zorla ≥40 (içeri) yapılır — yavaş puck ağızda TAKILMAZ
  (hız tabanı kaldırıldığı için kritik; bu olmadan oyun gol anında donar).
- Soft-lock yerine hakem reseti (sabit adım sayacı, `STEP` toplanır):
  puck `STALL_TIME` (2.2sn) `STALL_SPD` (14) altında kalırsa VEYA `TRAP_TIME`
  (2.5sn) boyunca `TRAP_DIST` (8) yarıçaplı alandan çıkamazsa `faceoff()`.
  İkincisi köşe sıkışması içindir: paddle puck'ı köşeye bastırınca puck hızlı
  sekip durur (ses gelir, oyun donar) — hız kontrolü bunu yakalamaz.
- AI köşe sıkıştırmasın: puck duvar dibinde ve `trapT > AI_BACKOFF` (0.6sn)
  ise AI kalesine çekilir. AI "puck'ın arkasına geç" hedefi köşede tam
  puck'ın üstüne düştüğü için sıkıştırıyordu.
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
- **Çok oyuncuda görünüm+puck'ı KURAN belirler:** host bağlanan misafire
  `hello` mesajıyla `rules`+`skin`+`puck` yollar, misafirde `joined` olayı
  olarak gelir. `main.js useMatchLook()` misafirde host'unkini uygular
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
- **Gecikme telafisi (misafir):** `net.js` ping/pong ile `Net.rtt()` ölçer;
  `handleState` puck'ı `leadTime()` kadar (RTT + çizim yumuşatması, en çok
  0.18+0.03sn) `coast` ile ileri alır. Yalnız misafirin yarısında (y<H·0.4
  tam, H·0.6'da sıfır): orada rakip dokunamaz, tahmin güvenli.
- **Yetkili misafir paddle gecikmesiz:** host `pGuest = tgtGuest` (yapay
  yumuşatma YOK — eskiden `dt*22` ~90ms gecikme katıp hızlı kaydırmada
  ıskalatıyordu).
- **Süpürmeli (swept) çarpışma** (`collide(q1,pv,q0,px0,py0)`): puck (p0→p1)
  ve paddle (q0→q1) bağıl yolu minD'ye girerse vuruş — kuadratik giriş anı
  `t`. Hızlı paddle artık topun içinden geçmez. `integrate` adım öncesi
  puck (`px0,py0`) ve eski paddle konumlarını (`hq0,gq0`) verir.
- **Bağlantı (net.js):** host PeerJS kimliği = `bk-airhockey-v2-` + şifre
  özeti (`roomId`); misafir rastgele kimlikle o kimliği arar. Tek veri kanalı,
  `reliable` + `json`. Mesajlar `{t}`: `s` state, `i` input, `rm`/`rq`
  rematch, `hello` (host→misafir: kural/skin/puck), `full`, `bye`, `ping`/`pong` (`ts`).
- **Kopma algılama:** WebRTC `close` geç gelebilir → heartbeat: 500ms'de bir
  `ping`, 4sn veri yoksa kopmuş say. iOS arka planda timer'lar donar; dönünce
  sessizlik yakalanır.
- **Yeniden bağlanma:** ~25sn **grace**; `peer_dropped` (geçici, oyun durmaz)
  → grace dolarsa `peer_left` (terminal). Misafir 2sn'de bir yeniden arar;
  host aynı misafiri `metadata.token` ile tanır → `peer_back`. Başka token
  gelirse `full`. Signaling kopması (`disconnected`) → `peer.reconnect()`
  (aynı kimlik, açık kanal etkilenmez). Bilerek çıkış (`bye`) anında
  `peer_left`. Durum bildirimi ayrı `#netmsg` (game render dokunmaz).

## Mobil
- Ekranlar `.screen` kaydırılabilir; `.panel{margin:auto}` sığarsa ortalar,
  sığmazsa üstten başlar (align-items:center kullanma: taşan üst kısım kesilir).
- CSS sonunda telefon blokları: `max-height:700px` (kısa ekran / Safari çubukları),
  `max-width:600px`, `orientation:landscape and max-height:520px` (oyunda
  `.rotate` "Telefonu dik tut" katmanı; masa dikey olduğu için).
- Seçimler `.seg` (gizli radio + span düğme); `name`/`value`'lar main.js'te okunur.
- Şifre: `autocapitalize/autocorrect=off`; `roomId` küçük harf + boşluk
  normalize eder (iOS ilk harfi büyütüyordu → oda bulunamıyordu).
  i/ı/İ/I hepsi `i`'ye katlanır. `toLocaleLowerCase('tr')` KULLANMA:
  'I'→'ı' yapar, aynı şifre farklı odaya gider.
- **Kontrol modu** (`Game.setControl`, lobide `[data-ctrl]`,
  `localStorage('ah_ctrl')`, ağa gitmez):
  - `offset` (varsayılan): paddle merkezi parmağın `offsetPx()` = paddle
    yarıçapı + `FINGER_CLEAR` (30 CSS px) üstünde; kendi kale çizgisinden
    `H*OFFSET_TAPER` içinde ofset doğrusal 0'a iner (kale ağzına inebilsin).
    Görünüm koordinatında hesaplanır (`pointerToView`).
  - `drag`: touchpad; pointerdown'da ışınlanma yok, hareket × `DRAG_GAIN` (1.25).
- Paddle `MR=8.5` (Pro Max'te ~65px çap; parmaktan büyük olsun diye istendi).
- Puck etrafına halka / vuruşta dalga efekti EKLEME: Burkay sevmedi; sabit
  halka ayrıca puck boyutu farkını gizliyordu ("puck ayarı çalışmıyor" sanıldı).
  Dokunmatikte varsayılan puck `large` (kayıtlı tercih yoksa).
- Çok oyuncuda puck boyutunu KURAN belirler; katılanın seçimi o maçta geçmez.
- `Game._peek()` / `Game._setPuck()` yalnız test içindir (durum okuma, köşe senaryosu).
- Davet linki `#oda=<şifre>`: bekleme ekranında `navigator.share` (yoksa
  panoya kopyala); açılışta hash okunur, temizlenir, otomatik katılır.
- `UI.onShow` kancası: wait/game/end(çok oyuncu) ekranında Wake Lock
  (ekran kararmasın) + `history.pushState` (iOS kenardan geri kaydırma
  sayfayı terk etmesin). Lobiye dönünce Kur/Katıl düğmeleri yeniden aktif.
- `net.js` `visibilitychange` → sunucuya hemen yeniden bağlan (`wake()`).
- Ana ekran: `manifest.webmanifest`, `icon-180.png` (apple-touch-icon),
  `icon-512.png`. Arayüz metinleri Türkçe karakterli; kod yorumları ASCII.
- Ekran boyutu kontrolü: 375×553 (SE + Safari), 390×664, 430×739, 844×330 yatay.

## Konvansiyonlar / dikkat
- Sanal masa koordinatı `W=100 x H=200` (dikey). Pixel'e letterbox ile ölçeklenir.
- Misafir görünümü 180° döndürülür (`toView`/`fromView`); ikisi de alt kaleyi savunur.
- Kod tanımlayıcıları İngilizce, yorumlar Türkçe (ASCII).
- Oda = şifre özeti. Aynı şifreyle açık oda varsa PeerJS `unavailable-id` →
  "şifre kullanımda".
- `Net` olayları (main.js/game.js dinler): `room_created`/`joined`/
  `peer_joined`/`peer_left`/`peer_dropped`/`peer_back`/`state`/`input`/
  `rematch`/`rematch_request`/`error_msg`.
- Eski Socket.IO sunucusu + Render kaldırıldı (gecikme: tüm trafik uzak
  sunucudan geçiyordu). Geri getirme; P2P daha hızlı.
- Repo public. Commit'ler GitHub noreply e-postasıyla; gerçek e-posta,
  anahtar ya da servis URL'si koyma.
