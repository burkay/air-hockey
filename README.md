# Air Hockey — Uzaktan 2 Kişilik (iPhone tarayıcısı)

Telefon tarayıcısından air hockey. İki mod:

- **Bilgisayara Karşı:** tek başına AI rakip (Kolay / Orta / Zor), ağ yok.
- **Arkadaşınla (uzaktan):** **şifre ile eşleşme** — bir kişi oyunu kurup şifre
  ve maç kuralını seçer (ilk 7 / ilk 11 / süreli 2 dk), arkadaşı o şifreyi
  girip katılır.

Ek: skin (Neon / Arcade), puck boyutu (Küçük / Orta / Büyük), Web Audio ses
efektleri, gerçekçi fizik. Kısa ağ kopmaları maçı bozmaz (otomatik yeniden
bağlanma).

## Oyna

**https://burkay.github.io/air-hockey/** — kurulum yok, sunucu yok.

İki kişilik mod **WebRTC ile doğrudan (peer-to-peer)** bağlanır: veri iki
telefon arasında gider, araya uzak bir sunucu girmez. Bu yüzden iki oyuncu
birbirine yakınsa (ör. Sofya ↔ İstanbul) gecikme düşüktür.

## Nasıl oynanır

- **Tek kişilik:** Lobide **"Bilgisayara Karşı"** → kural + zorluk seç → başla.
- **Arkadaşınla:** Bir oyuncu **"Oyun Kur"** + şifre + kural; diğeri
  **"Oyuna Katıl"** + aynı şifre.
- Oyun: parmakla kendi paddle'ını (alt taraf) sürükle; herkes kendi ekranında
  **alttaki kaleyi** savunur. Maç bitince **"Yeniden Oyna"**.
- Lobide **Görünüm** (Neon/Arcade) ve **Puck** (Küçük/Orta/Büyük) seçilir;
  çok oyunculuda **kuranın** seçimi geçerli olur. Sağ üstte **🔊** ile ses
  aç/kapa (iOS: ilk dokunuştan sonra ses gelir, sessiz anahtarı kapalı olmalı).
- "Rakibe bağlanılamadı" hatası: bazı mobil operatörler doğrudan bağlantıyı
  engeller; birinizin Wi-Fi'ye (ya da mobil veriye) geçmesi genelde çözer.

## Yerelde çalıştırma

Build yok; klasörü herhangi bir statik sunucuyla aç:

```bash
npx http-server -p 8080 -c-1
```

Sonra `http://localhost:8080`. İki sekme açıp biri kurar, biri katılır.
(`file://` ile doğrudan açmak da çoğu tarayıcıda çalışır.)

## Mimari (kısa)

- Sunucu yok. **PeerJS**'in ücretsiz genel sunucusu yalnızca eşleştirme
  (signaling) yapar. Oda kimliği şifrenin özetidir; şifrenin kendisi
  gönderilmez. Doğrudan yol kurulamazsa PeerJS'in TURN rölesi devreye girer.
- Fizik **host-authoritative**: oyunu kuran istemci simülasyonu çalıştırır,
  durumu misafire **~60 Hz** yollar; misafir kendi paddle'ını anında oynatır,
  puck'ı hızıyla ekstrapole edip (dead-reckoning) yumuşatarak çizer.
- Çarpışma **süpürmeli (swept)** — hızlı vuruşta paddle topun içinden geçmez.
- `js/game.js` çekirdek (fizik + çizim + rol ayrımı).

## Proje yapısı

```
index.html      Ekranlar (lobi/bekleme/oyun/bitiş)
css/style.css   Mobil öncelikli stiller
js/net.js       WebRTC (PeerJS) bağlantı katmanı
js/sfx.js       Web Audio ses efektleri (dosyasız)
js/game.js      Fizik + çizim + ağ senkronu
js/ui.js        Ekran geçişleri / DOM yardımcıları
js/main.js      Akış kontrolü ve olay bağlama
```
