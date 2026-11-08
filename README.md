# 🧲 MIKNATIS SAVAŞI

Tarayıcıda oynanan, 3D, çok oyunculu bir fizik oyunu. Havada yüzen bir hurdalık
adasında mıknatıs tabancanla karpuzları, varilleri, buzdolaplarını çek, rakiplerine
fırlat ve onları **aşağıdaki boşluğa** yolla. Can barı yok: son ayakta kalan kazanır!

- **Tek oyunculu:** 5 bota karşı (kolay / orta / zor). Sunucu gerekmez.
- **Çok oyunculu:** Oda kur, davet linkini arkadaşlarına gönder (en fazla 8 kişi).
  Boş yerleri botlar doldurur.

## 🎮 Kontroller

| Tuş | Ne yapar |
|---|---|
| `W A S D` | Hareket |
| `Boşluk` | Zıpla |
| Fare | Bakış (oyuna tıklayınca fare kilitlenir, `ESC` bırakır) |
| **Sol tık (basılı tut)** | Nişan aldığın eşyayı çek. Gelince önünde süzülür = **kalkan** |
| **Sağ tık** | Tuttuğun eşyayı fırlat |
| **Sağ tık** (eşya yokken) | Kısa menzilli **itme dalgası** (bekleme süresi var) |
| `E` | Metal yüzeye (direk, konteyner, şamandıra, dev mıknatıs) **kanca** at |
| Sol tık (eşya tutarken) | Eşyayı bırak |
| `Tab` | Skor tablosu · `M` ses · `F3` hata ayıklama paneli |

**İpuçları:** Hafif eşyalar (karpuz, koni) hızlı uçar ama az iter; ağırlar (kasa,
buzdolabı) yavaş uçar ama çok iter. Başkasının tuttuğu eşyayı sol tıkı basılı
tutarak **çekip kapabilirsin**. Havada uçan bir eşyayı mıknatısla **yakalayıp geri
yollayabilirsin**. Düşerken turuncu nişangâh gördüğün metale `E` ile kanca at, kurtul!
2 dakika bitince arena kenarlardan çökmeye başlar.

---

## 1. Plan ve mimari

```
           ┌──────────────── /shared (tarayıcıdan bağımsız) ────────────────┐
           │ Simulation: Rapier fiziği + oyun kuralları + botlar             │
           │ arena verisi, hareket kodu, nişan, girdi formatı, sabitler      │
           └───────▲───────────────────────────────────────────▲─────────────┘
                   │ aynı kod                                   │ aynı kod
   Tek oyunculu:   │                           Çok oyunculu:    │
   ┌───────────────┴──────────┐               ┌────────────────┴─────────────┐
   │ /client  LocalSession    │               │ /server  Colyseus GameRoom   │
   │ simülasyonu tarayıcıda   │   girdiler →  │ simülasyon 20 Hz, sunucu     │
   │ 60 Hz çalıştırır         │   ← durum     │ yetkili (server-authoritative)│
   └──────────────────────────┘   (delta)     └──────────────────────────────┘
                                   ▲
            /client NetSession: kendi oyuncun = tahmin (prediction),
            diğerleri ve eşyalar = ara değer (interpolation)
```

- **Server-authoritative:** İstemci sadece "hangi tuşa basıyorum, nereye bakıyorum"
  der (`[seq, mx, mz, yaw, pitch, butonlar]`, ~12 bayt). Fizik ve kurallar sunucuda.
- **Client-side prediction:** Kendi karakterin, sunucunun cevabını beklemeden
  aynı hareket koduyla (`shared/src/playerController.js`) tarayıcıda da hareket eder.
  Sunucu "şu numaralı girdine kadar işledim, sen buradasın" deyince işlenmemiş
  girdiler yeniden oynatılır; fark varsa yumuşakça düzeltilir (`client/src/game/Predictor.js`).
- **Interpolation:** Diğer oyuncular ve eşyalar ~110 ms geriden, iki sunucu
  görüntüsü arasında yumuşak geçişle çizilir. 20 Hz veri, 60 FPS'te akıcı görünür.

## 2. Dosya yapısı

```
miknatis-savasi/
├─ package.json              # npm workspaces: shared, client, server
├─ render.yaml               # Render'a tek tıkla kurulum (Blueprint)
├─ .github/workflows/pages.yml  # İstemciyi GitHub Pages'e otomatik yayınlar
├─ shared/                   # ⚙️ Oyun simülasyonu (tarayıcıya bağımlı DEĞİL)
│  ├─ src/constants.js       # Bütün ayarlar: hızlar, ağırlıklar, süreler, eşyalar
│  ├─ src/arena.js           # Arena düzeni (karolar, halkalar, engeller, doğma noktaları)
│  ├─ src/physicsWorld.js    # Rapier dünyası + arena çarpıştırıcıları (sadece kutu/küre)
│  ├─ src/playerController.js# Yürüme, zıplama, kanca (sunucu + tahmin ortak kodu)
│  ├─ src/simulation.js      # Oyunun kalbi: çek/fırlat/dalga/kanca, isabet, eleme, tur
│  ├─ src/bots.js            # Bot yapay zekâsı (saniyede 5 karar)
│  ├─ src/aim.js             # Nişan alınan eşyayı seçme
│  ├─ src/input.js           # Girdi formatı ve ağ kodlaması
│  ├─ src/math.js            # Vektör, kamera, quaternion sıkıştırma
│  ├─ src/turkish.js         # "Kemal'i karpuzla düşürdü!" ekleri
│  └─ test/simTest.js        # 8 bot bir tur oynar, tick süresini ölçer
├─ server/                   # 🖥️ Colyseus sunucusu
│  ├─ src/index.js           # Express (/health) + Colyseus, Rapier yükleme
│  ├─ src/GameRoom.js        # Oda: lobi, bot doldurma, kopan oyuncu → bot, 3 oda limiti
│  ├─ src/schema.js          # Ağ durumu (sıkıştırılmış alanlar, delta gönderim)
│  └─ test/netTest.js        # Sahte istemcilerle bant genişliği / oda limiti testi
└─ client/                   # 🎨 Tarayıcı: çizim, girdi, arayüz
   ├─ index.html             # Menü, lobi, HUD, tur sonu ekranları
   ├─ vite.config.js
   ├─ test/predTest.js       # Tahmin doğruluğu testi (Node'da)
   └─ src/
      ├─ main.js             # Ekran akışı, Rapier'in arka planda yüklenmesi
      ├─ net.js              # Sunucu uyandırma ("Sunucu başlatılıyor..."), bağlantı
      ├─ input.js            # Klavye/fare/pointer lock
      ├─ audio.js            # Sentezlenmiş sesler (dosya yok!)
      ├─ hud.js              # Süre, nişangâh, skor akışı, isim etiketleri
      ├─ style.css
      ├─ game/Game.js        # Ana döngü: olaylar, kamera, efektler
      ├─ game/LocalSession.js# Tek oyunculu (simülasyon tarayıcıda)
      ├─ game/NetSession.js  # Çok oyunculu (ağ + interpolation)
      ├─ game/Predictor.js   # Client-side prediction + reconciliation
      ├─ game/view.js        # Çizicinin okuduğu ortak veri yapısı
      └─ render/
         ├─ Renderer.js      # Sahne, ışık, gölge, otomatik kalite
         ├─ arena.js         # Ada: halka başına TEK birleştirilmiş mesh
         ├─ items.js         # Eşyalar: tür başına TEK InstancedMesh + parıltı
         ├─ players.js       # Robotlar: 6 InstancedMesh ile 16 oyuncu
         ├─ effects.js       # Parçacık havuzu, mıknatıs ışını, şok dalgası
         ├─ sky.js           # Gökyüzü, boşluk, bulutlar
         └─ geo.js           # Low-poly geometri yardımcıları
```

## 3. Yerelde çalıştırma

Gereken: [Node.js](https://nodejs.org) 20 veya üstü (22 önerilir).

```bash
npm install            # bir kez: bütün paketleri kurar

npm run dev:server     # 1. terminal: sunucu -> ws://localhost:2567
npm run dev:client     # 2. terminal: oyun   -> http://localhost:5173
```

Sadece tek oyunculu oynayacaksan sunucuyu açmana gerek yok.

### İki tarayıcı sekmesiyle çok oyunculu test

1. `http://localhost:5173` aç, adını yaz, **Oda Kur**'a bas.
2. Lobideki **Kopyala** ile davet linkini al (`http://localhost:5173/?oda=ABC123`).
3. Yeni bir sekme (ya da başka bir tarayıcı / gizli pencere) aç, linki yapıştır,
   farklı bir ad yaz, **Odaya Katıl**'a bas. İlk sekmede oyuncu listesinde göründüğünü gör.
4. İlk sekmede **Başlat**'a bas. Her sekmede oyuna bir kez tıklayıp fareyi kilitle.

> Arka plandaki sekme tarayıcı tarafından yavaşlatılır, bu normal. En iyi test için
> iki pencereyi yan yana koy. Aynı Wi-Fi'daki başka bir bilgisayardan da
> `npm run dev:client` çıktısındaki `Network:` adresiyle (`http://192.168.x.x:5173`)
> katılabilirsin; istemci sunucuyu aynı IP'de otomatik bulur.

### Testler

```bash
npm run test:sim                      # 8 bot tam bir tur oynar, tick süresini yazar
node server/test/netTest.js           # (sunucu açıkken) KB/s, oda limiti, kopma testi
node client/test/predTest.js          # (sunucu açıkken) tahmin doğruluğu
```

## 4. Yayınlama (arkadaşlarına link gönder)

İki parça var: **sunucu → Render**, **oyun (istemci) → GitHub Pages**.

### A) Sunucuyu Render'ın ücretsiz planına kur

1. [render.com](https://render.com)'a gir, **GitHub ile kayıt ol**.
2. Sağ üstte **New + → Blueprint** seç, `miknatis-savasi` reposunu bağla.
   Render `render.yaml` dosyasını okuyup her şeyi otomatik ayarlar → **Apply**.
   <details><summary>Blueprint yerine elle kurmak istersen</summary>

   **New + → Web Service** → repoyu seç, sonra:
   - Language: **Node**, Region: **Frankfurt**
   - Build Command: `npm ci --workspace server`
   - Start Command: `npm run start -w server`
   - Instance Type: **Free**
   - Advanced → Health Check Path: `/health`
   - Environment Variable: `NODE_VERSION` = `22`
   </details>
3. Kurulum bitince sayfanın üstünde adresin görünür, örn.
   `https://miknatis-savasi.onrender.com`. Tarayıcıda sonuna `/health` ekleyip aç:
   `{"ok":true,...}` görüyorsan sunucu çalışıyor. 🎉

### B) İstemciyi GitHub Pages'e yayınla

1. **Repo herkese açık olmalı** (ücretsiz GitHub'da Pages sadece public repolarda çalışır):
   repo → **Settings → General → en altta Danger Zone → Change visibility → Public**.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions** seç.
3. **Settings → Secrets and variables → Actions → Variables** sekmesi →
   **New repository variable**:
   - Name: `SERVER_URL`
   - Value: `wss://miknatis-savasi.onrender.com` ← kendi Render adresin, başı `https` yerine **`wss`**
4. **Actions** sekmesine git → soldan **"GitHub Pages'e yayınla"** → **Run workflow**.
   (Bundan sonra `main`'e her push'ta kendiliğinden yayınlanır.)
5. Bitince oyunun adresi: **`https://alideniztartma.github.io/miknatis-savasi/`**

### C) Arkadaşlarınla oyna

Oyunu aç → **Oda Kur** → **Kopyala** → linki WhatsApp/Discord'a at. Gelen link
`.../miknatis-savasi/?oda=ABC123` gibi olur; açan kişi adını yazıp **Odaya Katıl**'a basar.

> ⏰ Render'ın ücretsiz sunucusu 15 dk boş kalınca uyur. İlk bağlanan kişi
> "Sunucu başlatılıyor..." ekranını ~1 dakika görür; oyun otomatik tekrar dener.
> Tek oyunculu mod sunucuya hiç ihtiyaç duymaz.

## 5. Performans kararları (neden böyle?)

**Sunucu (0.1 CPU, 512 MB):**
- Sabit adımlı fizik, **20 Hz** tick (her tick 2 fizik alt adımı). Ölçülen: 8 oyunculu
  kaotik bir odada tick başına ~0.3–1.5 ms. Ortalama 20 ms'yi geçerse konsola uyarı yazar.
- Sadece **kutu / küre / kapsül** çarpıştırıcılar. Trimesh yok. Zemin = karo kutuları.
- **Sleeping açık:** duran eşyalar uyur, ne hesaplanır ne de ağdan gönderilir.
- **CCD** sadece fırlatılmış eşyada, uçtuğu sürece açık.
- Botlar **saniyede 5** karar verir.
- Oyun döngüsünde nesne oluşturulmaz: vektörler, olay listesi, girdi kuyruğu baştan ayrılır.
- En fazla **3 aktif oda** (`MAX_ROOMS`). Fazlası "Sunucu dolu" mesajı alır.
- Rapier **0.19.3** sürümü seçildi: daha yeni sürümler Node'da 2–3 kat fazla RAM kullanıyordu
  (ölçüm: 3 dolu oda ≈ 175 MB).

**Ağ (hedef < 10 KB/s oyuncu başına, ölçülen ~4–7 KB/s):**
- Konum = santimetre cinsinden `int16`, dönüş = 4 baytlık sıkıştırılmış quaternion.
- Colyseus Schema **delta** gönderir: sadece değişen alanlar gider.
- Olaylar (vuruş, eleme) durum yamasıyla aynı pakette gider.
- Girdiler her karede değil, **tick hızında** (20 Hz) gönderilir.

**İstemci:**
- Eşyalar tür başına **InstancedMesh**, oyuncular parça başına InstancedMesh,
  arena halka başına **birleştirilmiş (merge)** tek mesh. Tipik: **~25–45 draw call**.
- Tek yönlü ışık, **1024** gölge haritası, oyuncuların altında ucuz **blob gölge**.
- Parçacıklar **havuzdan** (object pool), `devicePixelRatio ≤ 1.5`.
- **Otomatik kalite:** FPS 3 saniye boyunca 50'nin altındaysa önce gölgeler ve
  parçacıklar azalır, sonra çözünürlük düşer.
- Rapier'in wasm dosyası **menü açılırken arka planda** yüklenir.
- `F3`: FPS, ping, sunucu tick süresi, draw call, gelen KB/s.

## 6. Dengeyi değiştirmek

Neredeyse her şey `shared/src/constants.js` içinde: eşyaların ağırlığı, fırlatma hızı,
itme gücü (`knock`), tur süresi, hareket hızı, bot zorlukları... Değiştir, kaydet,
sayfayı yenile. Çok oyunculu için sunucuyu da yeniden başlat (`dev:server` bunu
kendisi yapar).

## 7. Sorun giderme

| Sorun | Çözüm |
|---|---|
| "Sunucuya ulaşılamadı" | Render panelinde servis "Live" mı? `.../health` açılıyor mu? `SERVER_URL` değişkeni `wss://` ile mi başlıyor? Değiştirdiysen Actions'ta yeniden çalıştır. |
| Pages 404 veriyor | Repo public mi? Settings → Pages → Source "GitHub Actions" mı? Actions'taki iş yeşil mi? |
| Fare kilitlenmiyor | Oyun ekranına bir kez tıkla. Bazı tarayıcılarda `ESC` sonrası 1 sn beklemek gerekir. |
| Takılma / düşük FPS | `F3` ile bak. Otomatik kalite zaten düşürür; tarayıcıda donanım hızlandırmanın açık olduğundan emin ol. |
| Farklı bir sunucuyu denemek | Linke `?sunucu=wss://baska-adres.onrender.com` ekle. |
