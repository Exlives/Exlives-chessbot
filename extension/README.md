# Exlives chessbot

Chrome veya Edge'de `chrome://extensions` / `edge://extensions` sayfasını açın, Geliştirici modunu etkinleştirin, **Paketlenmemiş öğe yükle** düğmesine basın ve bu `extension` klasörünü seçin. Ardından Chess.com, Lichess ya da World Chess oyun sekmesini açıp uzantı simgesine tıklayın. Uygulama ekranın sağ üst köşesinde ayrı bir pencerede açılır, başka bir yere tıklayınca kapanmaz; sağ üstteki **×** düğmesiyle kapatılır.

Dosyalar değiştirildikten sonra uzantılar sayfasındaki **Yenile** simgesine basın ve açık satranç sekmesini de yenileyin. Analiz düğmesi içerik betiğine bağlanamazsa betiği bir kez yüklemeyi dener.

Pencere açıldığında ve **Yeni oyun** düğmesine bastığınızda **Senin taşlarının rengi** tahtanın altındaki renge göre otomatik seçilir; gerekirse listeden değiştirebilirsiniz. Varsayılan analiz derinliği **Derin** olur. Uzantı yalnızca sizin sıranızda hamle önerir; rakibin sırası geldiğinde öneri vermez. **Ekran izleme** açıkken konum değişikliklerini otomatik takip eder, görüntüyü ve öneriyi yeniler. İzleme kapalıyken yalnızca **Şimdi analiz et** düğmesine bastığınızda tahtayı okur. **Yeni oyun** yardımcıdaki takibi ve hamle belleğini sıfırlar; web sitesindeki oyunu sıfırlamaz. Hamleyi oyun sayfasında kendin uygularsın. Derin analiz daha uzun sürebilir.

**Tahtada oku göster** düğmesi yardımcıyı sağ üstte küçük pencereye alır ve desteklenen oyun tahtasını otomatik algılayıp hamle okunu oyun tahtasında gösterir. Tahta algılanamazsa mevcut otomatik tahta okuma uyarısı görünür. Küçük pencerenin üstündeki ok düğmesiyle büyütebilirsiniz.

Küçük pencere, başka bir Chrome penceresi öne geçtiğinde yeniden öne alınır. Chrome uzantı API'si işletim sistemi düzeyinde `her zaman üstte` ayarına izin vermediğinden bu davranış Chrome pencereleriyle sınırlıdır.

Öneriler yerel Stockfish 19 lite motoruyla, tarayıcı içinde WebAssembly kullanılarak hesaplanır. Uzantı Chess.com ve Lichess hamle listesini okuyabildiğinde tam geçmişi yeniden oynatıp doğru sıra, rok ve geçerken alma haklarını korur; liste yoksa mevcut taş diziliminden geçici konum kurar. Hamle açıklaması motor puanı, kısa varyant ve hamlenin görünen etkisini (şah, taş alma, terfi) gösterir. Stockfish lisansı ve kaynak bilgisi `vendor/stockfish/` altındadır; chess.js lisansı `vendor/CHESSJS-LICENSE.txt` dosyasındadır.

Uzantı tahtadaki taşları okuyarak konumu kurar. Sıradaki oyuncuyu otomatik belirlemez; açılır menüden seçmelisin. Görüntüden geçiş hamlesi (en passant) ve önceki hamlelerde kaybedilmiş rok hakları güvenilir biçimde anlaşılamadığı için özel konumlarda öneri yanlış olabilir. Standart açılışta roka, şah ve kale başlangıç karelerindeyse izin verilir.
