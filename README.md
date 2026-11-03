# Hamle. — Satranç analiz yardımcısı

Başka bir sitedeki tahtayı analiz etmek için [`extension`](extension/README.md) klasöründeki Chrome/Edge uzantısını yükleyin. Chess.com ve Lichess'in 2B tahtasını okur ve önerilen hamleyi gösterir.

## Kendi tahtasında botla oyna

Uygulamayı `index.html` dosyasını bir web sunucusu üzerinden açarak çalıştırın. Örneğin proje klasöründe:

```sh
python -m http.server 8000
```

Ardından `http://localhost:8000` adresine gidin. Satranç kuralları için `chess.js` kütüphanesi `esm.sh` üzerinden yüklenir; ilk açılışta internet bağlantısı gerekir.

Taş rengini ve bot seviyesini seçin. Taşa, ardından hedef kareye tıklayarak oynayın. Bot yasal hamleleri alpha-beta aramasıyla değerlendirip otomatik oynar. Terfi hamlelerinde taş seçebilirsiniz; “↶” son turu (senin ve botun hamlelerini) geri alır.
