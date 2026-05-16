# Air Hockey — Uzaktan 2 Kişilik (iPhone tarayıcısı)

İki kişinin telefon tarayıcısından, **şifre ile eşleşerek** birbirine karşı
oynadığı air hockey. Bir kişi oyunu kurup şifre belirler ve maç kuralını seçer
(ilk 7 / ilk 11 / süreli 2 dk), arkadaşı o şifreyi girip katılır.

## Kurulum

Node.js 16+ gerekir.

```bash
npm install
npm start
```

Sunucu `http://localhost:3000` adresinde açılır.

## Nasıl oynanır

1. Bir oyuncu **"Oyun Kur"** der, bir şifre yazar, kuralı seçer, **"Kur"**.
2. Diğeri **"Oyuna Katıl"** deyip aynı şifreyi girer.
3. Maç başlar. Parmakla kendi paddle'ını (alt taraf) sürükle. Her oyuncu
   kendi ekranında **alttaki kaleyi** savunur.
4. Maç bitince **"Yeniden Oyna"** ile rövanş yapılabilir.

## Test / oynama seçenekleri

- **Aynı bilgisayar:** İki tarayıcı sekmesi aç (biri kurar, biri katılır).
- **Aynı Wi-Fi:** Telefonlardan `http://<PC-LAN-IP>:3000` adresini açın.
  Windows'ta LAN IP için: `ipconfig` → "IPv4 Address".
- **Farklı internetler (gerçek uzaktan oyun):** Sunucuya internetten
  erişilebilmesi gerekir. İki yol:
  - **Geçici tünel (hesapsız):** `npx cloudflared tunnel --url http://localhost:3000`
    komutu çalışırken verilen `https://...trycloudflare.com` linkini arkadaşına
    gönder. (PC açık kalmalı; her çalıştırmada link değişir.)
  - **Bulut (kalıcı link — önerilen):** aşağıdaki Render adımları.

> GitHub Pages / Vercel / Netlify gibi salt statik (veya kısa ömürlü
> fonksiyon) platformları **uygun değildir** — kalıcı WebSocket sunucusu
> gerekir.

## Render'a dağıtım (ücretsiz, kalıcı link)

Repo bir `render.yaml` (Blueprint) içerir; Render bunu okuyup servisi
otomatik kurar. Private repo da desteklenir.

1. https://render.com → **GitHub ile kaydol/giriş yap** (ücretsiz).
2. Dashboard → **New +** → **Blueprint**.
3. `air-hockey` reposunu seç (Render erişim isterse onayla) → **Apply**.
   - `render.yaml`: Node, `npm install` → `npm start`, health `/healthz`,
     `PORT` Render tarafından otomatik verilir (kod zaten `process.env.PORT`).
4. İlk derleme ~1-2 dk. Bittiğinde `https://air-hockey-XXXX.onrender.com`
   linki çıkar. Bu linki iki telefonda aç → biri **Oyun Kur** + şifre,
   diğeri **Oyuna Katıl** + aynı şifre.

Notlar:
- **Ücretsiz plan uykuya geçer:** ~15 dk hareketsizlikte durur; sonraki
  açılış ~30-60 sn (cold start) gecikir. Oynarken sorun olmaz; ilk açılış
  yavaş olabilir, birkaç saniye bekleyin.
- Repoya `git push` yapınca Render **otomatik yeniden dağıtır**
  (`autoDeploy: true`).

## Mimari (kısa)

- `server.js` — Express + Socket.IO. Yalnızca **eşleştirme + mesaj rölesi**.
- Fizik **host-authoritative**: oyunu kuran istemci simülasyonu çalıştırır,
  durumu misafire ~30 Hz yollar; misafir kendi paddle'ını anında oynatır,
  gerisini yumuşatarak çizer.
- `public/js/game.js` çekirdek (fizik + çizim + rol ayrımı).

## Proje yapısı

```
server.js              Express + Socket.IO röle/eşleştirme
public/index.html      Ekranlar (lobi/bekleme/oyun/bitiş)
public/css/style.css   Mobil öncelikli stiller
public/js/net.js       Socket.IO istemci sarmalayıcı
public/js/game.js      Fizik + çizim + ağ senkronu
public/js/ui.js        Ekran geçişleri / DOM yardımcıları
public/js/main.js      Akış kontrolü ve olay bağlama
```
