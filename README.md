# Air Hockey — Uzaktan 2 Kişilik (iPhone tarayıcısı)

Telefon tarayıcısından air hockey. İki mod:

- **Bilgisayara Karşı:** tek başına AI rakip (Kolay / Orta / Zor), ağ yok.
- **Arkadaşınla (uzaktan):** **şifre ile eşleşme** — bir kişi oyunu kurup şifre
  ve maç kuralını seçer (ilk 7 / ilk 11 / süreli 2 dk), arkadaşı o şifreyi
  girip katılır.

Ek: skin (Neon / Arcade), puck boyutu (Küçük / Orta / Büyük), Web Audio ses
efektleri, gerçekçi fizik. Kısa ağ kopmaları maçı bozmaz (otomatik yeniden
bağlanma).

## Kurulum

Node.js 16+ gerekir.

```bash
npm install
npm start
```

Sunucu `http://localhost:3000` adresinde açılır.

## Nasıl oynanır

- **Tek kişilik:** Lobide **"Bilgisayara Karşı"** → kural + zorluk seç → başla.
- **Arkadaşınla:** Bir oyuncu **"Oyun Kur"** + şifre + kural; diğeri
  **"Oyuna Katıl"** + aynı şifre.
- Oyun: parmakla kendi paddle'ını (alt taraf) sürükle; herkes kendi ekranında
  **alttaki kaleyi** savunur. Maç bitince **"Yeniden Oyna"**.
- Lobide **Görünüm** (Neon/Arcade) ve **Puck** (Küçük/Orta/Büyük) seçilir;
  çok oyunculuda **kuranın** seçimi geçerli olur. Sağ üstte **🔊** ile ses
  aç/kapa (iOS: ilk dokunuştan sonra ses gelir, sessiz anahtarı kapalı olmalı).

## Test / oynama seçenekleri

- **Aynı bilgisayar:** İki tarayıcı sekmesi aç (biri kurar, biri katılır).
- **Aynı Wi-Fi:** Telefonlardan `http://<PC-LAN-IP>:3000` adresini açın.
  Windows'ta LAN IP için: `ipconfig` → "IPv4 Address".
- **Farklı internetler (gerçek uzaktan oyun):** Sunucu PC'de `npm start` ile
  çalışır; internetten erişim için (PC açık + sunucu çalışır olmalı):
  - **Tailscale Funnel (arkadaş kurulum yapmadan):**
    `tailscale funnel --bg 3000` → çıkan herkese açık `https://<ad>.ts.net/`
    linkini arkadaşına gönder. Kapatmak: `tailscale funnel --https=443 off`.
  - **Tailscale tailnet (en düşük gecikme):** arkadaş Tailscale kurup
    tailnet'e katılır, `http://<tailscale-ip>:3000` açar.
  - **Geçici tünel (hesapsız):** `npx cloudflared tunnel --url http://localhost:3000`.

> GitHub Pages / Vercel / Netlify gibi salt statik platformlar **uygun
> değildir** — kalıcı WebSocket sunucusu gerekir. İstenirse `process.env.PORT`
> + `npm start` ile herhangi bir kalıcı Node host'a da yüklenebilir.

## Mimari (kısa)

- `server.js` — Express + Socket.IO. Yalnızca **eşleştirme + mesaj rölesi**.
- Fizik **host-authoritative**: oyunu kuran istemci simülasyonu çalıştırır,
  durumu misafire **~60 Hz** yollar; misafir kendi paddle'ını anında oynatır,
  puck'ı hızıyla ekstrapole edip (dead-reckoning) yumuşatarak çizer.
- Çarpışma **süpürmeli (swept)** — hızlı vuruşta paddle topun içinden geçmez.
- `public/js/game.js` çekirdek (fizik + çizim + rol ayrımı).

## Proje yapısı

```
server.js              Express + Socket.IO röle/eşleştirme
public/index.html      Ekranlar (lobi/bekleme/oyun/bitiş)
public/css/style.css   Mobil öncelikli stiller
public/js/net.js       Socket.IO istemci sarmalayıcı
public/js/sfx.js       Web Audio ses efektleri (dosyasız)
public/js/game.js      Fizik + çizim + ağ senkronu
public/js/ui.js        Ekran geçişleri / DOM yardımcıları
public/js/main.js      Akış kontrolü ve olay bağlama
```
