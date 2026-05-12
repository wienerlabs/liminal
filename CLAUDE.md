# CLAUDE.md — LIMINAL

Bu dosya, LIMINAL projesinde çalışan Claude Code (ve diğer AI agent'ları) için proje anayasasıdır. Kodlamaya başlamadan önce tamamını okuyun. Kararlar bu doküman üzerinden verilir, her blok bir sonrakinin ön koşuludur.

---

## Proje Özeti (TL;DR)

- **Ürün:** LIMINAL — Solana üzerinde çalışan intelligent execution terminal.
- **Problem:** Büyük/time-sensitive swap'larda slippage + idle sermaye maliyeti + MEV riski aynı anda yaşanır.
- **Çözüm:** TWAP tabanlı execution + bekleyen sermayeyi Kamino'da yield'a çalıştırma + DFlow MEV-protected routing + Quicknode real-time sinyalleri + Solflare-native UX, hepsi tek ekranda.
- **Partnerler (4'ü de zorunlu):** DFlow, Kamino, Quicknode, Solflare.
- **Deploy:** Eitherway prompt-to-deploy, Solana **mainnet**.
- **Scope dışı:** Kendi AMM, kendi fiyatlama motoru, cross-chain, token ihracı, leverage/margin.

---

## BLOK 1: Ürün Tanımı ve Kapsam

### LIMINAL Nedir?

LIMINAL, Solana üzerinde çalışan bir **intelligent execution terminal**'dır. Kullanıcının large-size veya time-sensitive token swap'larını, bekleyen sermayeyi eş zamanlı yield'a çalıştırarak ve MEV'den koruyarak execute eder. Tek bir Solflare wallet bağlantısıyla, DFlow routing, Kamino vault yönetimi ve Quicknode real-time data'yı tek bir UX'te birleştirir.

### Core Value Proposition

Standart bir swap aggregator'ın yaptığı şey: "En iyi fiyatı bul, execute et." LIMINAL'in yaptığı şey: "Execute edene kadar geçen süreyi de gelire çevir, execute ederken MEV'den koru, tüm süreci tek ekrandan yönet." Bu fark, kullanıcıya **composite alpha** üretiyor, slippage savings ile idle yield aynı anda çalışıyor.

### Hedef Kullanıcı

**Primary:** $5K+ büyüklüğünde işlem yapan Solana-native trader. Market order'ın slippage'ından rahatsız, TWAP mantığını anlıyor, idle sermayenin maliyetini biliyor.

**Secondary:** Yield-aware DeFi kullanıcısı. Büyük bir pozisyon değiştirmeden önce sermayesinin "nerede beklediğini" önemsiyor.

### Ne Build Ediyoruz

**Execution engine:** Kullanıcı token pair, toplam miktar ve execution window (örneğin 30 dakika, 2 saat) girer. LIMINAL bu window'u TWAP dilimlerine böler, her dilimi Quicknode price feed'iyle izler, optimal fiyat momentinde DFlow routing üzerinden execute eder.

**Idle capital manager:** Execution window boyunca henüz swap edilmemiş kısım otomatik olarak Kamino'nun en yüksek APY vault'una park edilir. Her dilim execute edilmeden hemen önce vault'tan çekilir, slippage'a girmeden önce çıkmış olur.

**Real-time analytics panel:** Her tamamlanan dilim için "DFlow routing sayesinde baseline fiyata göre kaç bps kazandın, Kamino'da kaç dakika çalışarak ne kadar yield üretildi" gösterilir. Bu panel hem kullanıcı için utility kanıtı hem jüri için demo materyali.

**Solflare-native UX:** Wallet bağlantısı, transaction signing ve portfolio görünümü Solflare'in native flow'u üzerinden çalışır. Kullanıcı hiçbir zaman LIMINAL arayüzünden çıkmaz.

### Ne Build Etmiyoruz

Kendi AMM veya liquidity pool'umuzu yazmıyoruz. Kendi fiyatlama motoru geliştirmiyoruz. Cross-chain köprüsü veya kendi token'ı çıkarmıyoruz. Leverage veya margin mekanizması dahil etmiyoruz. Bunlar scope'u şişirir, hackathon süresinde teslim edilemez ve partnerlerin core capability'sinden uzaklaşır.

### Başarı Kriterleri (Submission Anında)

Mainnet'te en az gerçek işlem geçmişi olan, çalışır durumda bir dApp URL'i. Analytics panelinde görünür onchain aktivite. Her dört partnerin işlevsel entegrasyonu. Demo videosunda Jupiter ile yan yana execution kalitesi karşılaştırması.

---

## BLOK 2: Sistem Mimarisi ve Veri Akışı

### Genel Mimari Modeli

LIMINAL **stateless frontend + partner API orchestration** modeliyle çalışır. Kendi backend'i minimum düzeyde tutulur, ağır işlemler partnerlerin infrastructure'ına devredilir. Bu mimari seçim hackathon timeline'ı için kritik: ne kadar az custom backend, o kadar az hata yüzeyi.

### Katmanlar

**Presentation Layer:** Kullanıcının gördüğü tek sayfalık React uygulaması. Eitherway üzerinden deploy edilir. Solflare wallet adapter burada oturur. Tüm kullanıcı aksiyonları bu katmandan tetiklenir.

**Orchestration Layer:** LIMINAL'in "beyni". Kullanıcının girdiği execution parametrelerini alır, TWAP dilimlerini hesaplar, Quicknode'dan gelen fiyat sinyallerine göre execution zamanlaması yapar, Kamino deposit/withdraw döngüsünü koordine eder, DFlow'a swap talimatı iletir. Bu katman frontend içinde bir **state machine** olarak implemente edilir, ayrı bir sunucu gerektirmez.

**Data Layer:** Quicknode RPC + Streams burada oturur. Real-time fiyat feed'i, wallet balance güncellemeleri ve transaction confirmation sinyalleri bu katmandan gelir.

**Execution Layer:** DFlow routing API'si burada çalışır. Her dilim için optimal route hesaplanır, transaction build edilir, Solflare signing flow'una gönderilir.

**Yield Layer:** Kamino vault interface'i. Execution window boyunca idle sermayenin deposit ve withdraw döngüsünü yönetir.

### Veri Akışı: Mutlak Sırayla

**Adım 1 — Kullanıcı input alır:** Token pair seçer (örneğin SOL/USDC), toplam miktarı girer, execution window'u belirler (30dk, 1sa, 2sa), dilim sayısını seçer veya LIMINAL otomatik hesaplar.

**Adım 2 — Orchestration başlar:** State machine TWAP parametrelerini hesaplar. Toplam miktar dilim sayısına bölünür. Her dilim için tahmini execution timestamp üretilir.

**Adım 3 — Kamino deposit:** Execution window başlamadan önce toplam miktarın tamamı Kamino'nun uygun vault'una deposit edilir. Bu tek bir Solflare-signed transaction'dır.

**Adım 4 — Quicknode monitoring loop:** Her dilim execution zamanı yaklaşırken Quicknode price feed aktive olur. Kullanıcının belirlediği fiyat toleransı içinde kalındığında execution sinyali üretilir.

**Adım 5 — Kamino partial withdraw:** Execution sinyali geldiğinde o dilim için gereken miktar Kamino vault'undan çekilir. Withdraw transaction Solflare üzerinden imzalanır.

**Adım 6 — DFlow execution:** Çekilen miktar DFlow routing'e verilir. DFlow optimal route üzerinden swap'ı execute eder. MEV koruması bu aşamada devrededir.

**Adım 7 — Analytics güncellenir:** Tamamlanan dilimin execution fiyatı, baseline fiyatla karşılaştırılır, bps savings hesaplanır. Kamino'da geçirilen sürenin ürettiği yield hesaplanır. Panel güncellenir.

**Adım 8 — Sonraki dilim için döngü tekrar:** Tüm dilimler bitene kadar Adım 4-7 arası tekrar eder.

**Adım 9 — Execution tamamlanır:** Kullanıcıya toplam execution özeti sunulur: ortalama fill fiyatı, toplam slippage savings, toplam yield earned, toplam süre.

### State Machine Durumları

**IDLE:** Kullanıcı henüz order girmemiş. Wallet bağlı, panel boş.

**CONFIGURED:** Parametreler girilmiş, preview gösteriliyor, kullanıcı onay bekliyor.

**DEPOSITING:** Kamino deposit transaction broadcast edildi, confirmation bekleniyor.

**ACTIVE:** Execution window açık, Quicknode monitoring loop çalışıyor, dilimler sırayla execute ediliyor.

**COMPLETING:** Son dilim execute edildi, vault'ta kalan yield hesaplanıyor.

**DONE:** Tüm execution tamamlandı, özet gösteriliyor.

### Kritik Tasarım Kararı: Transaction Sayısını Minimize Et

Her dilim için Kamino withdraw + DFlow swap = 2 transaction. 4 dilimde 8 transaction, kullanıcının her birini imzalaması gerekir. Bu UX'i mahvedebilir. Çözüm: **transaction batching** nereye uygulanabiliyorsa uygula, mümkün olmayan yerde kullanıcıyı önceden bilgilendir, "toplam X transaction imzalayacaksın" preview'ı göster.

---

## BLOK 3: DFlow Entegrasyon Spesifikasyonu

### DFlow Nedir ve LIMINAL İçin Ne Anlama Gelir

DFlow, Solana üzerinde çalışan bir **order flow routing** protokolüdür. Retail order flow'unu market maker'lara yönlendirir, karşılığında kullanıcıya **price improvement** ve **MEV koruması** sağlar. LIMINAL için DFlow'un önemi şudur: standart Jupiter aggregator'dan farklı olarak DFlow, her swap için baseline fiyatın üzerinde ek bir fiyat iyileştirmesi sunabilir. Bu improvement sayısallaştırılabilir olduğu için analytics panel'inin temel metriği haline gelir.

### DFlow'un Core Capability'leri ve Kullandıklarımız

**Kullanacağımız:** Swap routing API'si, price improvement mekanizması, MEV-protected execution, quote endpoint'i.

**Kullanmayacağımız:** DFlow'un prediction market entegrasyonları bu versiyonda scope dışı. V2'de değerlendirilebilir ama hackathon submission'ını karmaşıklaştırır.

### Entegrasyon Akışı

**Quote aşaması:** Kullanıcı her dilim için execution sinyali aldığında, DFlow'un quote endpoint'ine token pair, dilim miktarı ve maksimum slippage toleransı gönderilir. DFlow iki değer döndürür: **market quote** (baseline fiyat) ve **DFlow quote** (price improvement dahil fiyat). Bu iki değerin farkı analytics panel'inde bps olarak gösterilir.

**Route build aşaması:** DFlow quote kabul edildiğinde, DFlow routing engine optimal execution path'i hesaplar. Bu path, Solana'daki mevcut liquidity pool'ları arasında MEV-protected bir route üzerinden geçer. Route build edilmiş transaction olarak frontend'e döner.

**Signing aşaması:** Build edilmiş transaction Solflare wallet adapter'a iletilir. Kullanıcı imzalar. Transaction broadcast edilir.

**Confirmation aşaması:** Quicknode RPC üzerinden transaction confirmation izlenir. Confirmation geldiğinde state machine bir sonraki adıma geçer, analytics güncellenir.

### Price Improvement Metriği: Nasıl Hesaplanır

Her dilim tamamlandığında şu hesaplama yapılır: DFlow execution fiyatı ile aynı anda alınan market baseline fiyatı arasındaki fark, baz puan cinsine çevrilir. Tüm dilimlerin weighted average price improvement'ı hesaplanır. Execution window sonunda bu değer "DFlow sayesinde toplam X bps kazandın" olarak özetlenir. Dolar cinsinden karşılığı da gösterilir: "Bu $10.000'lık trade'de $47 ekstra kazandın" formatı kullanıcıya anlamlı gelir.

### Slippage Yönetimi

LIMINAL iki katmanlı slippage kontrolü uygular. **Kullanıcı katmanı:** Kullanıcı maksimum kabul edilebilir slippage'ı girer (örneğin %0.5). **Execution katmanı:** DFlow quote'u bu threshold'u aşıyorsa dilim execute edilmez, bir sonraki Quicknode monitoring döngüsüne ertelenir. Bu erteleme kullanıcıya bildirilir: "Dilim 3 fiyat toleransı nedeniyle 5 dakika ertelendi."

### TWAP Dilim Boyutu ve DFlow Uyumu

DFlow'un price improvement mekanizması küçük lot size'larında daha etkili çalışır, çünkü market impact minimize edilir. Bu LIMINAL'in TWAP modeli ile doğal bir sinerji yaratır. Büyük bir pozisyonu tek seferde değil, dilimlere bölerek execute etmek hem market impact'i düşürür hem de her dilim için DFlow'un MEV korumasından tam olarak yararlanır. Bu ilişki analytics panel'inde "TWAP + DFlow sinerjisi" olarak ayrıca gösterilebilir.

### Fallback Mekanizması

DFlow quote endpoint'i bir dilim için yanıt vermezse veya quote kabul edilebilir sınırların dışındaysa, LIMINAL o dilimi bekletir ve kullanıcıya bildirim gönderir. **Doğrudan Jupiter'a fallback yapmayız.** Bunun nedeni hem DFlow entegrasyon depth'ini korumak hem de "MEV koruması garantili değildi" riskinden kaçınmak. Kullanıcı dilimi manuel olarak yeniden tetikleyebilir veya execution window'u uzatabilir.

### DFlow Entegrasyonunun Jüri İçin Değeri

Jüri "integration depth" kriterini değerlendirirken somut kanıt arar. LIMINAL'de DFlow sadece bir swap endpoint'i değil: her dilim için quote comparison yapan, price improvement'ı gerçek zamanlı hesaplayan, MEV korumasını execution'ın merkezine koyan bir sistem. Bu, "DFlow'u sadece plugged in" değil "DFlow'u core engine olarak kullanan" submission'ı doğrudan kanıtlar.

---

## BLOK 4: Kamino Entegrasyon Spesifikasyonu

### Kamino Nedir ve LIMINAL İçin Ne Anlama Gelir

Kamino, Solana'nın en büyük **lending ve liquidity management** protokolüdür. LIMINAL için Kamino'nun önemi şudur: execution window boyunca henüz swap edilmemiş sermaye atıl beklemek yerine Kamino vault'larında **gerçek yield üretir**. Bu, kullanıcıya standart bir swap aggregator'ın asla sunamadığı bir değer: beklerken para kazanmak. Analytics panel'inde bu değer somut dolar rakamına çevrildiğinde, Kamino entegrasyonunun utility kanıtı kendiliğinden ortaya çıkar.

### Kamino'nun Core Capability'leri ve Kullandıklarımız

**Kullanacağımız:** Kamino Lend (lending market deposit/withdraw), vault APY feed'i, position tracking endpoint'leri.

**Kullanmayacağımız:** Kamino'nun concentrated liquidity (CLMM) vault stratejileri bu versiyonda scope dışı. Bunlar impermanent loss riski taşır ve kullanıcının execution sermayesini risk altına sokar. LIMINAL'in idle capital manager'ı **sadece lending vault'larını** kullanır, LP pozisyonlarını asla.

### Vault Seçim Mantığı

Kullanıcı execution window'una başlamadan önce LIMINAL şu soruyu yanıtlamalıdır: "Hangi Kamino vault'una deposit edeceğiz?" Bu karar otomatik olarak yapılır, kullanıcıya bırakılmaz.

**Seçim kriterleri sırasıyla:** Deposit edilecek token ile eşleşen vault olması (USDC deposu için USDC vault, SOL deposu için SOL vault), vault'un anlık APY'sinin sıfırın üzerinde olması, vault'un yeterli likiditeye sahip olması (kısa sürede withdraw yapabilmek için), vault'un audit edilmiş ve aktif olması.

**Otomatik seçim akışı:** Kamino'nun vault listesi API'si çekilir, deposit token'ıyla eşleşen vault'lar filtrelenir, APY'ye göre sıralanır, en üstteki seçilir. Seçilen vault kullanıcıya "Kamino USDC Vault — %8.3 APY" gibi gösterilir, kullanıcı override edebilir ama default otomatiktir.

### Deposit Akışı

**Zamanlama:** Kullanıcı execution parametrelerini onayladıktan sonra, ilk dilim execute edilmeden önce toplam miktarın tamamı Kamino'ya deposit edilir. Bu tek bir transaction'dır.

**Deposit transaction içeriği:** Kullanıcının cüzdanından seçilen Kamino lending vault'una token transfer. Karşılığında kullanıcı **kToken** (Kamino'nun receipt token'ı) alır. Bu kToken, vault'taki pozisyonun kanıtıdır ve withdraw sırasında kullanılır.

**Solflare signing:** Deposit transaction Solflare wallet adapter üzerinden imzalanır. Kullanıcıya "Kamino'ya $10.000 USDC deposit ediyorsunuz, karşılığında 9.847 kUSDC alacaksınız" formatında preview gösterilir.

### Partial Withdraw Akışı

Her dilim execute edilmeden önce o dilim için gereken miktar Kamino'dan çekilir. Bu kritik bir timing meselesidir.

**Sıralama mutlak olmalıdır:** Önce Kamino withdraw transaction'ı broadcast edilir ve confirm edilir. Confirmation geldiğinde DFlow quote alınır. Quote kabul edilirse DFlow execution transaction'ı gönderilir. Bu sıra bozulursa, withdraw yapılmadan DFlow'a gönderim denenirse execution başarısız olur.

**Withdraw miktarı hesabı:** Her dilim için gereken token miktarı artı tahmini transaction fee buffer hesaplanır. kToken miktarı buna göre belirlenir. Küçük bir overshoot tercih edilir, artan miktar bir sonraki dilime eklenir veya son dilimde vault'ta kalır.

**Timing hassasiyeti:** Withdraw ile DFlow execution arasında mümkün olduğunca az süre geçmeli. Price impact hesaplaması withdraw anındaki fiyata göre yapılmış olduğundan, araya giren gecikme quote'u stale hale getirebilir. Quicknode confirmation sinyali alındıktan sonra DFlow quote 30 saniye içinde alınmalı ve execution başlatılmalı.

### Final Withdraw: Execution Tamamlandığında

Tüm dilimler execute edildikten sonra Kamino vault'unda kalan miktar üç kaynaktan oluşur: son dilim fazlasından kalan token artığı, tüm execution window boyunca birikmiş yield, kToken'ların withdraw anındaki değer artışı. Bu toplam miktar son bir withdraw transaction'ıyla kullanıcının cüzdanına gönderilir. Analytics panel'i bu noktada "Kamino'da X saat X dakika boyunca Y miktar çalıştı, Z dolar yield üretti" özetini gösterir.

### Yield Hesaplama ve Gösterimi

Gerçek yield hesabı şöyle yapılır: deposit anındaki kToken değeri ile withdraw anındaki kToken değeri karşılaştırılır, fark yield olarak raporlanır. Bu yöntem APY tahmininden daha doğrudur çünkü gerçek vault performansını yansıtır.

Kullanıcıya üç formatta gösterilir: Ham token miktarı (örneğin 0.84 USDC), APY karşılığı (bunu elde etmek için yıllık ne kadar kazanırdın), ve dolar değeri. Jüri için önemli olan: bu rakam gerçek onchain veridir, tahmini değil.

### Risk Yönetimi

Kamino lending vault'larında teorik olarak iki risk mevcuttur: **smart contract risk** ve **liquidity risk** (büyük para çekişlerinde withdrawal queue oluşabilir).

LIMINAL bu riskleri şöyle yönetir: Kullanıcıya onboarding sırasında açıkça bildirilir, kullanılan vault'ların audit durumu UI'da gösterilir, her withdraw için timeout belirlenir (örneğin 60 saniye içinde confirm gelmezse kullanıcı uyarılır ve manuel müdahale seçeneği sunulur).

### Kamino Entegrasyonunun Jüri İçin Değeri

Kamino, LIMINAL'in "idle capital = lost capital" problemini çözdüğünü kanıtlayan katmandır. Jüri "integration depth" değerlendirmesinde şunu görmek ister: Kamino sadece bir deposit butonu değil, execution döngüsünün içine gömülü, her dilim öncesi ve sonrası tetiklenen, gerçek yield üreten bir sistem. Bunu analytics panel'indeki gerçek rakamlar kanıtlar.

---

## BLOK 5: Quicknode Entegrasyon Spesifikasyonu

### Quicknode Nedir ve LIMINAL İçin Ne Anlama Gelir

Quicknode, LIMINAL'in **sinir sistemidir**. DFlow execute eder, Kamino yield üretir, ama bu iki sistemin ne zaman, hangi koşulda tetikleneceğine Quicknode karar verir. Real-time fiyat verisi, transaction confirmation sinyali ve wallet balance güncellemelerinin tamamı Quicknode üzerinden akar. Quicknode olmadan LIMINAL kör bir execution sistemi olur: ne zaman execute edeceğini bilmez, execute edilip edilmediğini göremez, kullanıcının bakiyesinin değiştiğini anlayamaz.

### Quicknode'un Core Capability'leri ve Kullandıklarımız

**Kullanacağımız:** Solana RPC endpoint'i (transaction broadcast ve confirmation), Quicknode Streams (real-time onchain event feed'i), Quicknode Functions (serverless compute, webhook tetikleyici olarak), fiyat feed entegrasyonu.

**Kullanmayacağımız:** Quicknode'un multi-chain capability'leri bu versiyonda irrelevant, LIMINAL Solana-only. NFT API'leri ve token metadata endpoint'leri scope dışı.

### Üç Ayrı Kullanım Senaryosu

LIMINAL, Quicknode'u tek bir amaçla değil üç farklı kritik senaryoda kullanır. Her biri ayrı spesifiye edilmeli.

### Senaryo 1: Real-Time Fiyat Monitoring

**Problem:** TWAP execution'ın her dilimi için "şu an iyi fiyat mı?" sorusunu yanıtlamak gerekir. Bunu yapmak için sürekli güncel fiyat verisi şart.

**Quicknode çözümü:** Quicknode'un Solana RPC'si üzerinden Pyth Network price feed'leri sorgulanır. Her dilim execution zamanı yaklaşırken monitoring loop aktive olur, belirlenen aralıkla (örneğin her 5 saniyede bir) token pair'in spot fiyatını çeker.

**Fiyat toleransı mantığı:** Kullanıcının belirlediği maksimum slippage threshold'u ile anlık fiyat karşılaştırılır. Fiyat threshold içindeyse execution sinyali üretilir, değilse monitoring devam eder. Kullanıcıya "Dilim 3 için optimal fiyat bekleniyor, şu an %0.7 slippage (limit: %0.5)" formatında gerçek zamanlı durum gösterilir.

**Polling vs. streaming kararı:** Hackathon scope'unda polling (her N saniyede bir RPC çağrısı) yeterlidir. Quicknode Streams entegrasyonu eklenmeli ama fiyat monitoring için polling başlangıç noktasıdır, streaming ise onchain event detection için kullanılır.

### Senaryo 2: Transaction Confirmation Detection

**Problem:** Kamino deposit, her partial withdraw, her DFlow execution ve final withdraw için transaction'ların confirm edildiği an bilinmeli. Confirmation gelmeden bir sonraki adım tetiklenemez.

**Quicknode çözümü:** Her transaction broadcast edildiğinde transaction signature Quicknode RPC'ye iletilir. Quicknode'un `confirmTransaction` metoduyla confirmation izlenir. **Commitment level seçimi kritiktir:** `confirmed` commitment (yaklaşık 400ms-1 saniye) LIMINAL için yeterlidir, `finalized` beklemek (yaklaşık 32 saniye) her dilim arası gecikmeyi kabul edilemez hale getirir.

**Quicknode Streams burada devreye girer:** Belirli bir wallet adresini veya program ID'sini dinleyen bir Stream kurulur. İlgili transaction confirm edildiğinde Stream event üretir, bu event state machine'i tetikler ve bir sonraki adıma geçilir. Bu yaklaşım polling'den daha güvenilir ve daha hızlıdır.

**Timeout yönetimi:** Her transaction için 60 saniyelik timeout belirlenir. Bu süre içinde confirmation gelmezse kullanıcı uyarılır: "Transaction gecikiyor, Solana ağ yoğunluğu nedeniyle retry önerilir." Retry mekanizması otomatik olarak bir kez dener, ikinci başarısızlıkta manuel müdahale gerektirir.

### Senaryo 3: Wallet Balance ve Position Tracking

**Problem:** Kullanıcının execution boyunca cüzdan bakiyesi, Kamino kToken pozisyonu ve swap çıktıları sürekli değişir. Analytics panel'inin bu değişiklikleri gerçek zamanlı göstermesi gerekir.

**Quicknode çözümü:** Kullanıcının wallet adresi Quicknode Streams üzerinden izlenir. Wallet'a gelen veya giden her token hareketi event olarak yakalanır. Bu eventler analytics panel'ini besler: her dilim tamamlandığında panel otomatik güncellenir, kullanıcı manuel refresh yapmak zorunda kalmaz.

**kToken tracking:** Kamino kToken bakiyesi ayrıca izlenir. Deposit sonrası artan kToken bakiyesi, her withdraw sonrası azalan bakiye ve yield birikiminden kaynaklanan artış gerçek zamanlı gösterilir.

### Quicknode Functions: Serverless Compute Katmanı

LIMINAL'in frontend'i pure client-side bir uygulamadır. Ancak bazı işlemler için persistent compute gerekir: execution window boyunca kullanıcı tarayıcıyı kapasa bile monitoring devam etmeli mi?

**Hackathon scope kararı:** Bu versiyonda background persistence **hedeflenmez**. Kullanıcı tarayıcıyı kapattığında execution duraklar, yeniden açıldığında kaldığı yerden devam eder. Bunu açıkça kullanıcıya bildirilir: "LIMINAL aktif execution sırasında sekme açık kalmalıdır."

**Quicknode Functions opsiyonel kullanımı:** Buna rağmen Quicknode Functions, execution window monitoring için basit bir webhook olarak kullanılabilir. Kullanıcı bir execution başlattığında Quicknode Function'a parametre gönderilir, Function belirlenen aralıkla fiyatı kontrol eder ve threshold aşıldığında frontend'e push notification gönderir. Bu eklenti hackathon için bonus puan değeri taşır ama kritik path üzerinde değil.

### RPC Performansı ve Latency

Quicknode'un standart public RPC endpoint'lerinden farklı olarak **dedicated endpoint** kullanımı LIMINAL için kritiktir. Shared endpoint'lerde rate limiting ve latency spikes, fiyat monitoring loop'unu bozabilir. Hackathon için Quicknode'un ücretsiz tier'ı yeterlidir ama dedicated endpoint alınabilirse execution kalitesi ölçülebilir şekilde artar.

**Latency hedefi:** Fiyat monitoring için RPC response süresi 100ms altında olmalı. Transaction confirmation detection için Stream event delivery süresi 500ms altında olmalı. Bu hedefler Quicknode'un standard tier'ında gerçekçidir.

### Analytics Panel İçin Quicknode Verisi

Quicknode'dan gelen ham veri doğrudan analytics panel'ini besleyen üç metriği üretir: her dilimin exact execution timestamp'i (confirmation anı), her transaction'ın Solana network fee'si (kullanıcıya toplam maliyet göstermek için), ve execution window boyunca kaçıncı slot'ta confirm edildiği (network koşullarını göstermek için). Bu veriler jüri için Quicknode'un "performance-critical feature" olarak kullanıldığının somut kanıtıdır.

### Quicknode Entegrasyonunun Jüri İçin Değeri

Jüri "fast, responsive UX powered by real-time data" ve "handles scale, latency, or data complexity effectively" kriterlerine bakıyor. LIMINAL'de Quicknode üç ayrı kritik rolde: fiyat monitoring backbone'u, transaction confirmation engine'i ve wallet state tracker'ı. Bu üç rolün hepsini demo video'da görünür kılmak, yani Streams event'lerini UI'da real-time olarak göstermek, Quicknode entegrasyonunun depth'ini jüriye kanıtlar.

---

## BLOK 6: Solflare Entegrasyon Spesifikasyonu

### Solflare Nedir ve LIMINAL İçin Ne Anlama Gelir

Solflare, LIMINAL'in **tek kullanıcı temas noktasıdır.** DFlow execute eder, Kamino yield üretir, Quicknode izler; ama kullanıcı bunların hiçbirini doğrudan görmez. Kullanıcının gördüğü şey Solflare üzerinden akan transaction'lardır. Bu nedenle Solflare entegrasyonu "wallet bağla ve unut" değil, ürünün UX kimliğinin merkezinde oturan bir katmandır. Hackathon track'inin tanımı da bunu destekliyor: "Wallet is core to the UX, not secondary."

### Solflare'in Core Capability'leri ve Kullandıklarımız

**Kullanacağımız:** Solflare wallet adapter (bağlantı ve session yönetimi), transaction signing flow, in-app browser uyumluluğu, transaction simulation, deep linking.

**Kullanmayacağımız:** Solflare'in stake veya NFT interface'leri LIMINAL için irrelevant.

### Wallet Adapter Entegrasyonu

Solflare, Solana wallet adapter standardını destekler. LIMINAL bu standardı kullanır ama **sadece Solflare'i destekler**, multi-wallet seçeneği sunmaz. Bu bilinçli bir karardır: Solflare track'inin "wallet is core" kriterini karşılamak için Phantom veya Backpack'e fallback sunmak entegrasyon depth'ini dilüte eder.

**Bağlantı akışı:** Kullanıcı LIMINAL'e girdiğinde tek bir "Connect Solflare" butonu görür. Solflare yüklü değilse yükleme sayfasına yönlendirme yapılır. Bağlantı kurulduğunda wallet adresi, SOL bakiyesi ve SPL token bakiyeleri otomatik çekilir. Session persistence sağlanır: kullanıcı sayfayı yenilediğinde yeniden bağlanması gerekmez.

### Transaction Signing Flow: LIMINAL'in En Kritik UX Kararı

Bir execution window boyunca kullanıcı potansiyel olarak şu transaction'ları imzalar: 1 Kamino deposit, N adet partial withdraw (dilim sayısı kadar), N adet DFlow swap (dilim sayısı kadar), 1 final Kamino withdraw. 4 dilimli bir execution'da bu 10 transaction demektir.

**Bu kabul edilemez.** Her transaction için ayrı Solflare popup açmak kullanıcıyı terk ettirir.

**Çözüm yaklaşımları sırasıyla:**

**Versioned Transaction Batching:** Solana'nın versioned transaction formatı birden fazla instruction'ı tek transaction'a paketlemeye izin verir. Kamino withdraw ve DFlow swap aynı anda tek transaction içine girer. Bu her dilim için 2 transaction'ı 1'e indirir. Deposit ve final withdraw ayrı kalır. Toplam: 4 dilim için 10 yerine 6 transaction.

**Transaction Simulation:** Her transaction kullanıcıya imzalatılmadan önce Solflare'in simulation endpoint'i üzerinden çalıştırılır. Simulation başarısız olursa kullanıcıya "Bu işlem başarısız olacak, nedeni: X" gösterilir ve imzalatma adımına geçilmez. Bu, kullanıcının boşuna gas harcamasını önler ve Solflare track'inin "transaction simulation" bonus kriterini karşılar.

**Pre-approval UX:** Execution başlamadan önce kullanıcıya "Bu execution boyunca toplam 6 transaction imzalamanız gerekecek, her biri için Solflare popup açılacak" formatında açık bir preview gösterilir. Sürpriz transaction, terk etmenin birincil nedenidir.

### In-App Browser Uyumluluğu

Solflare'in mobil uygulaması kendi in-app browser'ını içerir. LIMINAL bu browser içinde sorunsuz çalışmalıdır.

**Teknik gereksinimler:** Responsive layout zorunlu, mobil ekranda analytics panel'i collapsible olmalı. Solflare in-app browser'ında window.solflare object'i injection farklı çalışabilir, bu edge case test edilmeli. Deep link formatı kullanılarak mobil kullanıcılar Solflare uygulamasından direkt LIMINAL'e yönlendirilebilir: `solflare://browse?url=liminaltwap.com` formatı.

### Deep Linking

LIMINAL, Solflare deep linking'i iki senaryoda kullanır.

**Senaryo 1: Onboarding.** Kullanıcı Solflare yüklü değilse veya mobil cihazda LIMINAL'e giriyorsa, "Open in Solflare" butonu Solflare app'i açar ve LIMINAL'i in-app browser'da yükler. Kullanıcı wallet bağlantısını ayrıca kurması gerekmez, Solflare zaten bağlıdır.

**Senaryo 2: Execution notification.** Quicknode Functions üzerinden gönderilen push notification'a tıklandığında, kullanıcı doğrudan LIMINAL'in aktif execution ekranına deep link ile gider. "Dilim 3 execute edilmeye hazır, onaylamak için buraya dokun" formatı.

### Portfolio Analytics: Wallet Verisiyle Ne Yapıyoruz

Solflare bağlantısı kurulduğunda LIMINAL, kullanıcının wallet'ından şu verileri çeker ve gösterir: SOL bakiyesi, major SPL token bakiyeleri (USDC, USDT, en az 3 token), aktif Kamino kToken pozisyonları varsa bunlar da gösterilir.

Bu veriler iki amaçla kullanılır. **Fonksiyonel:** Kullanıcı execution için hangi token'ı ne kadar gönderebileceğini görerek input yapar, bakiyeden fazla miktar girmesi engellenir. **Deneyimsel:** Kullanıcı LIMINAL'e girdiğinde cüzdanının genel görünümünü görür, bu landing deneyimi ürünü bir "terminal" gibi hissettirir.

### Transaction History: LIMINAL'in Kendi Kaydı

Solflare'in transaction history'si tüm Solana transaction'larını listeler ama bunlar ham veridir. LIMINAL, Quicknode'dan gelen confirmation verisiyle kendi transaction log'unu tutar ve Solflare'den gelen history'yi zenginleştirir.

**Kullanıcı "Geçmiş" sekmesine girdiğinde şunu görür:** Her tamamlanmış execution'ın özeti, o execution'da kaç dilim olduğu, toplam DFlow price improvement miktarı, toplam Kamino yield miktarı, execution window süresi ve başlangıç/bitiş timestamp'leri. Bu history view, LIMINAL'i tekrar kullanan kullanıcı için "ne kadar kazandım" dashboardına dönüşür.

### Solflare Entegrasyonunun Jüri İçin Değeri

Solflare track kriterleri açıkça şunu söylüyor: "Wallet is core to the UX, not secondary. Improves how users interact with transactions. Feels like a better wallet experience than existing apps." LIMINAL'de Solflare üç katmanda çalışır: bağlantı ve session katmanı, transaction signing ve simulation katmanı, portfolio görünümü ve history katmanı. Demo video'da bu üç katmanı ayrı ayrı göstermek, Solflare entegrasyonunun "connect button'dan fazlası" olduğunu kanıtlar.

---

## BLOK 7: Frontend Mimari ve UX Akışı

### Temel Mimari Karar: Single Page Application

LIMINAL tek bir React SPA olarak build edilir. Sayfa geçişi yoktur, routing minimaldır. Kullanıcı her şeyi tek ekranda görür: wallet durumu, execution konfigürasyonu, aktif monitoring ve analytics. Bu "terminal" hissi kasıtlıdır ve Solflare track'inin "feels like a better wallet experience" kriterini destekler.

**Eitherway deploy modeliyle uyumu:** Eitherway prompt-to-deploy sistemi React uygulamalarını destekler. Tek dosya yapısı deployment friction'ı minimize eder.

### Ekran Yapısı: Üç Panel

LIMINAL'in arayüzü üç dikey panelden oluşur. Desktop'ta yan yana, mobilde tab'lara collapse olur.

**Sol Panel: Wallet ve Varlık Görünümü.** Solflare bağlantı durumu, SOL ve SPL token bakiyeleri, aktif Kamino kToken pozisyonları, geçmiş execution özetleri. Bu panel pasif bilgi katmanıdır, kullanıcı buradan aksiyon almaz sadece durumu okur.

**Orta Panel: Execution Konfigürasyonu ve Kontrolü.** LIMINAL'in aksiyon merkezi. Token pair seçimi, miktar girişi, execution window seçimi, dilim sayısı konfigürasyonu, slippage threshold, execution başlatma butonu, aktif execution'ın adım adım durumu. Kullanıcı zamanının büyük çoğunluğunu burada geçirir.

**Sağ Panel: Real-Time Analytics.** Her dilimin execution fiyatı ve bps savings, Kamino yield birikimi, toplam value capture özeti, Quicknode event log'u (opsiyonel, developer modunda görünür), network durumu göstergesi.

### Orta Panel: Execution Konfigürasyon Akışı

Kullanıcı orta panelde sırasıyla şu adımları tamamlar. Her adım bir sonrakini unlock eder, önceki tamamlanmadan ilerlenemez.

**Adım 1 — Token Pair Seçimi:** İki dropdown. "From" token ve "To" token. Wallet bakiyesindeki token'lar otomatik listelenir. Seçim yapıldığında anlık spot fiyat Quicknode'dan çekilir ve gösterilir.

**Adım 2 — Miktar Girişi:** Sayısal input alanı. "Max" butonu wallet bakiyesinin tamamını doldurur. Dolar karşılığı anlık hesaplanır ve gösterilir. Bakiyeden fazla miktar girilirse input kırmızıya döner, ilerleme engellenir.

**Adım 3 — Execution Window Seçimi:** Preset seçenekler: 30 dakika, 1 saat, 2 saat, 4 saat, özel. Seçime göre önerilen dilim sayısı otomatik hesaplanır: 30 dakika için 3 dilim, 1 saat için 4 dilim, 2 saat için 6 dilim. Kullanıcı dilim sayısını override edebilir.

**Adım 4 — Slippage Threshold:** Default %0.5. Slider veya sayısal input. Düşük threshold daha iyi fiyat garantisi ama daha uzun execution süresi anlamına gelir. Yüksek threshold daha hızlı execution ama daha az fiyat garantisi. Bu trade-off tooltip ile açıklanır.

**Adım 5 — Execution Preview:** Kullanıcı tüm parametreleri girdikten sonra özet gösterilir. Tahmini toplam Kamino yield (APY ve window süresine göre), tahmini DFlow price improvement (historical average baz alınarak), kaç transaction imzalanacağı, execution başlangıç zamanı. "Başlat" butonu bu adımda aktif olur.

### State Machine UI Mapping

Her state machine durumu orta panelde farklı görsel temsile sahip olur.

**IDLE:** Execution konfigürasyon formu görünür, boş ve hazır.

**CONFIGURED:** Preview gösterilir, "Başlat" butonu aktif.

**DEPOSITING:** "Kamino'ya deposit ediliyor..." progress indicator, Solflare signing popup açık. Buton disabled.

**ACTIVE:** Execution timeline görünür. Her dilim bir satır olarak listelenir: bekleyen dilimler gri, aktif dilim pulse animasyonlu, tamamlanan dilimler yeşil check ile. Anlık fiyat ve slippage threshold göstergesi sürekli güncellenir.

**COMPLETING:** "Final withdraw hesaplanıyor..." state, kısa bir loading süresi.

**DONE:** Execution özet kartı gösterilir. Konfeti animasyonu veya subtle success state. "Yeni Execution Başlat" butonu.

### Aktif Execution Timeline Komponenti

Bu LIMINAL'in en kritik UI komponentidir. Kullanıcının execution süresince ekranda bakacağı tek şey budur.

**Her dilim satırında şunlar görünür:** Dilim numarası ve toplam dilim sayısı (örneğin "Dilim 2/4"), hedef execution timestamp, o an için anlık fiyat, threshold durumu (yeşil: execute edilebilir, sarı: eşikte, kırmızı: bekliyor), tamamlandıysa gerçekleşen fiyat ve bps savings, tamamlandıysa Kamino'da o dilim için geçen süre ve üretilen yield.

**Üst özet bar:** Tüm execution boyunca güncellenen running total'lar. Şimdiye kadar toplam bps savings, şimdiye kadar toplam Kamino yield, tamamlanan dilim sayısı, tahmini kalan süre.

### Sağ Panel: Analytics Detayları

**DFlow Performance Grafiği:** Her tamamlanan dilim için bar chart. X ekseni dilim numarası, Y ekseni bps savings. Baseline sıfır çizgisi, her dilim bu çizginin üzerinde bir bar. Execution tamamlandığında weighted average gösterilir.

**Kamino Yield Tracker:** Zaman serisi grafik. X ekseni zaman, Y ekseni birikmiş yield dolar cinsinden. Gerçek zamanlı güncellenir, her dakika küçük bir artış görünür. Bu görsel "para çalışıyor" hissini somutlaştırır.

**Value Capture Özeti:** Tek bir büyük sayı. "Bu execution sayesinde ekstra kazandığın: $X.XX." DFlow savings ve Kamino yield toplamı. Bu sayı demo video'nun en güçlü frame'i olacak.

### Sol Panel: Geçmiş Executions

Her tamamlanan execution kart olarak listelenir, en yeni en üstte.

**Her kart şunları gösterir:** Token pair ve toplam miktar, execution tarihi ve süresi, ortalama fill fiyatı ve baseline ile karşılaştırma, toplam DFlow savings ve Kamino yield, Solana explorer linki (tüm transaction'lar).

**Bu history view iki amaca hizmet eder:** Geri dönen kullanıcılar için değer kanıtı, jüri için "real usage" evidansı.

### Renk Dili ve Görsel Kimlik

LIMINAL "liminal space" konseptinden görsel ipuçları alır. Karanlık zemin zorunlu, trading terminal estetiği. Vurgu rengi olarak **soluk mor ve derin teal** paleti: ne tam karanlık ne tam aydınlık, eşik hissi. Başarılı execution'lar için yeşil, bekleyen durumlar için nötr gri, threshold aşım uyarıları için amber. Kırmızı sadece gerçek hata durumlarında kullanılır, panik hissi yaratmamak için sparingly.

**Typography:** Monospace font tercih edilir, terminal estetiğini güçlendirir. Sayısal veriler özellikle monospace olmalı, rakamlar değişirken layout kayması olmaz.

### Loading ve Error State'leri

Hackathon submission'larının çoğu bu iki state'i ihmal eder. LIMINAL bunları eksiksiz implemente eder çünkü jüri kriterleri "error handling, edge cases, loading states" ifadesini açıkça içeriyor.

**Loading state'leri:** Her RPC çağrısı için skeleton loader veya spinner. "Fiyat yükleniyor", "Kamino APY çekiliyor", "Transaction broadcast ediliyor" formatında açıklayıcı mesajlar.

**Error state'leri:** RPC timeout, Kamino vault kapasitesi dolması, DFlow quote failure, Solflare rejection. Her hata için kullanıcıya ne olduğunu açıklayan ve ne yapabileceğini söyleyen message. "Bir şeyler yanlış gitti" değil, "DFlow quote 30 saniye içinde gelmedi, retry etmek ister misiniz?"

### Mobil Uyumluluk

Solflare in-app browser uyumluluğu için mobil layout şarttır. Üç panel tab yapısına geçer: "Cüzdan", "Execute", "Analytics" sekmeleri. Execution aktifken "Execute" sekmesi default açık kalır. Tab bar üstünde her zaman görünür mini status bar: aktif execution varsa dilim durumu ve running total gösterilir.

---

## BLOK 8: Onchain Aktivite Modeli

### Neden Bu Blok Kritik

Eitherway track'inin en belirgin vurgusu şudur: "dApps that survive the hackathon", "real user interaction, live usage, and active users", "evidence of viability, dApp remains live post-submission." Jüri adoption potential kriterini değerlendirirken soyut iddialar değil, **onchain veri** arar. Bu blok, submission anında jürinin göreceği onchain aktiviteyi nasıl ürettiğimizi planlar.

### Onchain Aktivite Kaynakları

LIMINAL'in bir execution'ı tamamladığında Solana blockchain'inde iz bırakan transaction türleri şunlardır.

**Kamino deposit transaction'ları:** Kullanıcı cüzdanından Kamino lending vault'una token transferi. Her execution'ın başlangıcında bir adet. Kamino program ID'siyle etiketli, Solana explorer'da doğrudan görünür.

**DFlow swap transaction'ları:** Her dilim için bir adet. DFlow routing program ID'si üzerinden geçer. Token pair, miktar ve execution fiyatı onchain kayıtlıdır.

**Kamino partial withdraw transaction'ları:** Her dilim öncesi bir adet. kToken yakma ve token geri alma işlemi onchain kayıtlıdır.

**Kamino final withdraw transaction'ları:** Her execution sonunda bir adet. Birikmiş yield dahil toplam çekim onchain kayıtlıdır.

Bu dört transaction türü birlikte LIMINAL'in her execution'ı için ortalama 1 + N + N + 1 = 2N+2 onchain iz bırakır. 4 dilimli bir execution için 10 transaction, bunların tamamı Solana explorer'da görünür, program ID'leriyle filtrelenebilir.

### Submission Öncesi Minimum Onchain Aktivite Hedefi

Jüriye "real usage" kanıtı sunmak için submission anında şu minimum eşiği geçmek hedeflenir.

**Minimum:** 5 farklı wallet adresi, her biri en az 1 tamamlanmış execution, toplam en az 50 transaction onchain. Bu rakam çok düşük görünebilir ama tüm transaction'ların DFlow ve Kamino program ID'leriyle etiketli olması quality signal'dır, raw sayıdan daha önemlidir.

**Hedef:** 15 farklı wallet adresi, toplam 150+ transaction, en az 3 farklı token pair üzerinde execution geçmişi. Bu rakama ulaşmak için ekip ve yakın çevre kullanımı yeterlidir, organik büyüme beklenmez.

**Stretch:** Sosyal dağıtım yoluyla 30+ wallet, 300+ transaction. Bu seviye "adoption potential" kriterinde maksimum skor için gerekir.

### Kendi Execution'larını Nasıl Üretirsin

Submission öncesi dönemde LIMINAL'i bizzat kullanarak onchain aktivite üretmek hem test hem de kanıt fonksiyonunu aynı anda yerine getirir.

**Pratik plan:** Her gün en az 2 test execution yap. Küçük miktarlarla bile olsa (10-50 USDC seviyesinde) gerçek mainnet transaction'ları üretilir. Farklı token pair'ler kullan: SOL/USDC, USDC/USDT, en az bir daha. Farklı execution window'ları test et: 30 dakika, 1 saat, 2 saat. Farklı dilim sayıları dene: 3, 4, 6. Bu çeşitlilik hem ürünü test eder hem de onchain veriyi zenginleştirir.

**Mainnet vs. devnet kararı:** Submission şartı mainnet. Geliştirme sürecinde devnet kullanılabilir ama submission öncesi son 1 haftada tüm test execution'ları mainnet'te yapılmalıdır.

### Çevre Kullanımı: Onchain Aktiviteyi Hızla Artırmanın Yolu

Ekip dışından 10-15 kişiyi LIMINAL'i kullanmaya davet etmek, organik olmayan ama meşru bir aktivite üretme yöntemidir. Hackathon jürileri bu pratiği bilir ve kabul eder, önemli olan kullanıcıların gerçek cüzdanlarla gerçek işlem yapmasıdır.

**Hedef profil:** Solana-native, DeFi kullanan, küçük miktarlarla test etmeye istekli kişiler. Miktarın önemi yoktur, 10 USDC'lik execution da 10.000 USDC'lik execution da aynı onchain izi bırakır.

**Motivasyon:** "LIMINAL'i test et, yield kazan" mesajı yeterlidir. Kamino yield gerçek olduğundan kullanıcıya gerçek bir fayda sunulur, teşvik yapay değildir.

### Onchain Aktiviteyi Submission'da Nasıl Sunarız

Jüri submission form'unda ve demo video'da onchain aktivite kanıtını üç formatta sunarız.

**Format 1: Solana Explorer Filter Link.** DFlow program ID'si üzerinden filtrelenmiş transaction listesi. "LIMINAL üzerinden gerçekleşen tüm DFlow transaction'larını burada görebilirsiniz" formatında direkt link. Jüri tek tıkla onchain veriye ulaşır.

**Format 2: Analytics Dashboard Screenshot.** LIMINAL'in kendi analytics panel'inden alınan screenshot. Toplam execution sayısı, toplam volume, toplam DFlow savings, toplam Kamino yield. Eğer LIMINAL'in kendi analytics panel'i aggregated data gösteriyorsa bu ekran hem ürün kalitesini hem aktiviteyi kanıtlar.

**Format 3: Demo Video'da Live Usage.** Demo video'nun bir bölümünde gerçek bir mainnet execution baştan sona gösterilir. Solflare signing popup'ları, Kamino deposit confirmation, DFlow swap execution ve analytics güncellemesi canlı gösterilir. Bu bölüm kesilmeden ve hızlandırılmadan çekilir, jürinin "bu gerçek mi?" sorusunu yanıtsız bırakmaz.

### Onchain Aktivite Modeli: Sürdürülebilirlik Boyutu

Eitherway track'i "still exists 30 days after submission" kriterini açıkça koymuş. Bu, jürinin submission sonrası ürünü kontrol edeceği anlamına gelir. LIMINAL'in submission sonrası hayatta kalması için gereken şartlar şunlardır.

**Teknik:** Eitherway deploy'u aktif kalmalı, URL erişilebilir olmalı. Quicknode endpoint süresi dolmamalı. DFlow ve Kamino API'larında breaking change olması durumunda hızlı patch gerekir.

**Ekonomik:** LIMINAL'in kendi gelir modeli yoktur bu versiyonda, dolayısıyla running cost sıfıra yakındır. Quicknode free tier yeterlidir, Eitherway hosting hackathon süresince kapsanır.

**Aktivite:** Submission sonrası 30 gün boyunca haftada en az 2-3 execution yapılmalıdır. Bu kendi execution'larınla bile karşılanabilir. Jüri 30 gün sonra explorer'dan kontrol ettiğinde son execution'ın "3 gün önce" değil "bu hafta" görünmesi gerekir.

### Onchain Veri Aggregation: Opsiyonel Ama Güçlü

Eğer zaman izin verirse LIMINAL'e bir "Protocol Stats" sayfası eklenebilir. Bu sayfa tüm kullanıcıların aggregated onchain verisini gösterir: toplam execution sayısı, toplam volume, toplam DFlow price improvement, toplam Kamino yield üretimi. Bu sayfa hem ürünün traction kanıtıdır hem de jüri için "bu ürün büyüyor" sinyalidir. Quicknode'dan gelen transaction verisi bu aggregation'ı besler.

---

## BLOK 9: Eitherway Prompt Stratejisi

### Eitherway'in Çalışma Mantığını Anlamak

Eitherway bir "prompt-to-deploy" platformudur. Kullanıcı natural language prompt yazar, platform React uygulaması üretir ve Solana mainnet'e deploy eder. Ancak bu süreç tek prompt ile tamamlanmaz ve tamamlanmamalıdır. LIMINAL gibi karmaşık bir ürünü Eitherway üzerinde build etmek **iteratif prompt mühendisliği** gerektirir. Bu blok, hangi sırayla ne yazılacağını planlar.

### Temel İlke: Modüler Prompt Serisi

LIMINAL'i tek bir prompt ile build etmeye çalışmak başarısız olur. Platform'un context window'u ve üretim kapasitesi sınırlıdır. Doğru yaklaşım şudur: her blok için ayrı prompt, her prompt bir öncekinin üzerine inşa eder, her adımda çalışan bir versiyon vardır ve bir sonraki prompt o versiyonu genişletir.

**Prompt serisi yapısı:** Foundation prompt, sonra her partner entegrasyonu için ayrı prompt, sonra UI refinement promptları, son olarak edge case ve error handling promptları.

### Prompt 1: Foundation ve Solflare Bağlantısı

Bu prompt LIMINAL'in iskeletini kurar. Partner adı açıkça geçmeli, çünkü Eitherway partner adını prompt içinde tanımlıyor.

**Prompt içeriği şu bilgileri kapsamalı:** Uygulamanın adı LIMINAL, Solana üzerinde çalışan intelligent execution terminal. Solflare wallet adapter entegrasyonu ile başlat. Kullanıcı Solflare bağladığında SOL ve SPL token bakiyeleri görünsün. Dark theme, monospace font, üç panel layout: sol panel wallet bilgisi, orta panel execution konfigürasyonu, sağ panel analytics. Şimdilik statik veri ile çalışsın, gerçek entegrasyonlar sonraki adımlarda eklenecek.

**Bu prompttan beklenen output:** Çalışan, deploy edilebilir bir React uygulaması. Solflare bağlantısı fonksiyonel, bakiye gösterimi çalışıyor, layout doğru. Gerçek execution mantığı yok ama görsel iskelet tam.

### Prompt 2: Quicknode RPC ve Fiyat Feed Entegrasyonu

Foundation çalışır hale geldikten sonra veri katmanı eklenir.

**Prompt içeriği:** Mevcut uygulamaya Quicknode Solana RPC entegrasyonu ekle. Token pair seçimi yapıldığında Quicknode üzerinden Pyth price feed'ini çek ve anlık fiyatı göster. Fiyat her 5 saniyede bir güncellenmeli. Quicknode'dan gelen veri yüklenirken skeleton loader göster, hata durumunda açıklayıcı error message göster.

**Bu prompttan beklenen output:** Token pair seçildiğinde gerçek Solana fiyat verisi ekrana yansıyor. Quicknode entegrasyonu çalışıyor, polling loop aktif, loading ve error state'leri implemente edilmiş.

### Prompt 3: Kamino Vault Entegrasyonu

Fiyat verisi çalıştıktan sonra yield katmanı eklenir.

**Prompt içeriği:** Kamino lending protokolü entegrasyonu ekle. Uygulama başladığında Kamino'nun aktif USDC ve SOL vault'larını çek, APY değerlerini göster. Kullanıcı execution konfigürasyonunda token seçtiğinde otomatik olarak en yüksek APY'li uygun Kamino vault'unu seç ve "Idle sermaye şu vault'a park edilecek: X Vault, %Y APY" olarak göster. Deposit ve withdraw fonksiyonlarını Kamino SDK ile entegre et, şimdilik Solflare signing ile test edilebilir hale getir.

**Bu prompttan beklenen output:** Kamino vault listesi çekiliyor, APY gösterimi çalışıyor, otomatik vault seçimi fonksiyonel, deposit ve withdraw transaction'ları build edilebilir hale gelmiş.

### Prompt 4: DFlow Swap Entegrasyonu

Kamino çalıştıktan sonra execution katmanı eklenir.

**Prompt içeriği:** DFlow swap routing entegrasyonu ekle. Kullanıcı token pair ve miktar girdiğinde DFlow'un quote endpoint'inden hem market quote hem DFlow quote çek. İki quote arasındaki farkı bps cinsinden hesapla ve göster. "DFlow sayesinde baseline fiyata göre X bps daha iyi fiyat" formatında göster. DFlow quote kabul edildiğinde transaction build et ve Solflare signing flow'una ilet. Slippage threshold kontrolü ekle: kullanıcının belirlediği threshold aşılırsa execution durdur ve uyar.

**Bu prompttan beklenen output:** DFlow quote comparison çalışıyor, bps savings hesabı doğru, transaction build ve signing fonksiyonel, slippage kontrolü aktif.

### Prompt 5: TWAP Execution State Machine

Dört partner entegrasyonu çalıştıktan sonra orchestration katmanı eklenir. Bu en karmaşık prompttur.

**Prompt içeriği:** TWAP execution state machine entegre et. Kullanıcı toplam miktar, execution window ve dilim sayısı girdiğinde state machine şu adımları sırasıyla execute etsin: önce toplam miktarı Kamino'ya deposit et ve confirmation bekle, sonra her dilim için sırasıyla Quicknode'dan fiyat kontrol et ve threshold içindeyse Kamino'dan partial withdraw yap sonra DFlow üzerinden swap execute et, tüm dilimler bitince Kamino'dan final withdraw yap. Her adım tamamlandığında state güncellenmeli ve UI bunu yansıtmalı. Execution timeline komponenti ekle: her dilim satır olarak görünsün, aktif dilim pulse animasyonlu, tamamlanan dilimler yeşil check ile işaretlensin.

**Bu prompttan beklenen output:** End-to-end execution akışı çalışıyor. State machine her adımı sırasıyla execute ediyor, UI her state değişikliğini yansıtıyor, execution timeline fonksiyonel.

### Prompt 6: Analytics Panel

Execution çalıştıktan sonra raporlama katmanı eklenir.

**Prompt içeriği:** Sağ panele real-time analytics ekle. Her tamamlanan dilim için DFlow bps savings bar chart olarak göster. Kamino yield birikimini zaman serisi grafik olarak göster, her dakika güncellenmeli. En büyük sayı olarak toplam value capture göster: DFlow savings artı Kamino yield toplamı dolar cinsinden. Execution tamamlandığında özet kart göster: ortalama fill fiyatı, toplam bps savings, toplam yield earned, execution süresi. Geçmiş executions sol panelde kart olarak listele.

**Bu prompttan beklenen output:** Analytics panel tamamen fonksiyonel, grafikler gerçek execution verisiyle güncelleniyor, geçmiş execution history çalışıyor.

### Prompt 7: Error Handling ve Edge Case'ler

Mutlak son polishing adımı.

**Prompt içeriği:** Kapsamlı error handling ekle. DFlow quote gelmezse, Kamino withdraw gecikirse, Solflare transaction reddedilirse, Quicknode RPC timeout olursa her biri için ayrı, açıklayıcı error message göster. Transaction'lar için 60 saniyelik timeout ekle, aşılırsa kullanıcıya retry seçeneği sun. Her RPC çağrısı için loading state ekle. Mobil layout düzenle: üç panel tab yapısına geçsin, aktif execution varsa üstte mini status bar göster. Solflare in-app browser uyumluluğunu test et ve gerekli düzeltmeleri yap.

**Bu prompttan beklenen output:** Production-ready hata yönetimi, mobil uyumluluk, Solflare in-app browser çalışıyor.

### Prompt Yazarken Genel Kurallar

**Partner adını her zaman açıkça yaz.** "DFlow entegrasyonu ekle" değil "DFlow swap routing protokolü entegre et." Platform partner adını keyword olarak tanımlıyor.

**Her promptta referans ver.** "Mevcut uygulamaya ekle" veya "önceki adımda eklenen Kamino entegrasyonunu kullanarak" formatı, platformun context'i korumasına yardımcı olur.

**Beklenen output'u tanımla.** Her promptun sonuna "Bu adım tamamlandığında şu fonksiyonlar çalışıyor olmalıdır" formatında acceptance criteria ekle. Bu hem platformun doğru üretmesine yardımcı olur hem de output'u test ederken referans noktası sağlar.

**Küçük tut, net tut.** Bir prompt bir sorunu çözmeli. "Hem DFlow ekle hem Kamino ekle hem analytics ekle" formatındaki promptlar tutarsız output üretir.

### Eitherway'de Test Döngüsü

Her prompt sonrası şu test döngüsü uygulanır: deploy edilen URL açılır, o adımda eklenen fonksiyon manuel test edilir, hata varsa bir sonraki prompt hata düzeltme odaklı yazılır, başarılıysa bir sonraki feature promptuna geçilir. Bu döngü hackathon süresince günde birden fazla kez tekrarlanabilir, Eitherway'in iteratif deploy modeliyle uyumludur.

### Eitherway'in Sınırlarını Aşmanın Yolu

Bazı mantık kısımları Eitherway'in otomatik üretiminin ötesine geçebilir, özellikle state machine ve transaction batching. Bu durumda platform'un "custom code extension" özelliği devreye girer: Eitherway'in ürettiği kodu GitHub'a export et, manual düzenleme yap, tekrar deploy et. Bu hibrit yaklaşım hem platformun otomatik entegrasyon kabiliyetinden hem de custom kod esnekliğinden yararlanır.

---

## Agent Çalışma Kuralları (Bu Projede Özel)

1. **Scope disiplini:** BLOK 1'deki "Ne build etmiyoruz" listesine giren hiçbir şeyi önerme veya ekleme. Kullanıcı açıkça istese bile önce uyar, sonra yap.
2. **Partner-first:** Her yeni özellik "bu dört partnerden hangisini daha derin entegre ediyor?" sorusuyla başlamalı. Partner entegrasyon depth'ini dilüte eden her şey reddedilir (örn. Jupiter fallback).
3. **Mainnet-first:** Devnet sadece erken geliştirmede. Submission öncesi son 1 hafta tüm testler mainnet'te.
4. **Transaction count minimization:** Yeni bir akış tasarlarken ilk soru: "Kaç Solflare popup açılıyor?" Cevap 1'den fazlaysa versioned transaction batching incele.
5. **Simulation zorunlu:** Her broadcast öncesi Solflare `simulateTransaction`. Simulation fail olursa kullanıcı imzalatma aşamasına geçmez.
6. **Commitment level:** `confirmed` kullan, `finalized` bekleme.
7. **Timeout:** Her transaction 60s timeout, tek otomatik retry, sonra manuel.
8. **UX kopyaları Türkçe:** Tüm kullanıcıya dönük metinler Türkçe (bkz. BLOK 7 örnekleri). Teknik loglar İngilizce kalabilir.
9. **Renk paleti:** Dark zemin + soluk mor/derin teal. Yeşil: success. Amber: threshold uyarısı. Kırmızı: sadece gerçek hata. Monospace font.
10. **İteratif Eitherway promptları:** BLOK 9'daki 7-promptluk sıraya sadık kal. Bir prompt = bir concern. Promptları birleştirme.
11. **Onchain aktivite:** Her yeni build'den sonra mainnet'te en az 1 smoke execution çalıştır, explorer link'ini not al.
12. **Jüri perspektifi:** Her feature için "bu demo video'da gösterilebilir mi? Integration depth kanıtı mı?" sorusunu sor. Cevap hayırsa önceliği düşür.

---

## Hızlı Referans: State Machine

```
IDLE → CONFIGURED → DEPOSITING → ACTIVE → COMPLETING → DONE
                                   ↑  ↓
                                   └──┘  (her dilim için: Quicknode check → Kamino withdraw → DFlow swap)
```

## Hızlı Referans: Transaction Akışı (4 Dilimli Örnek)

| # | Tip | Program | Açıklama |
|---|-----|---------|----------|
| 1 | Deposit | Kamino Lend | Toplam miktarı vault'a park et |
| 2 | Batch | Kamino + DFlow | Dilim 1: withdraw + swap (versioned tx) |
| 3 | Batch | Kamino + DFlow | Dilim 2: withdraw + swap |
| 4 | Batch | Kamino + DFlow | Dilim 3: withdraw + swap |
| 5 | Batch | Kamino + DFlow | Dilim 4: withdraw + swap |
| 6 | Withdraw | Kamino Lend | Final: kalan + yield çek |

**Toplam:** 4 dilim → 6 imza (10 değil).

## Hızlı Referans: Partner Rolleri

| Partner | Rol | Kritik Capability |
|---------|-----|-------------------|
| **DFlow** | Execution engine | MEV-protected routing + price improvement (bps) |
| **Kamino** | Idle capital yield | Lending vault deposit/withdraw, kToken |
| **Quicknode** | Real-time nervous system | RPC + Streams + fiyat feed + confirmation |
| **Solflare** | Tek UX yüzeyi | Wallet adapter + signing + simulation + deep link |
