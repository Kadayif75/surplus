# Lokale OCR-bestanden

Deze bestanden worden samen met de website geleverd. De foto wordt lokaal verwerkt.

- Worker: `tesseract.js@7.0.0`, `dist/worker.min.js`. Licentie: `TESSERACT-LICENSE` (Apache 2.0).
- Cores: `tesseract.js-core@7.0.0`, alle wasm/js-varianten, inclusief fallback, SIMD en relaxed SIMD. Licentie: `CORE-LICENSE` (Apache 2.0).
- Nederlandse taaldata: `https://tessdata.projectnaptha.com/4.0.0/nld.traineddata.gz`, gedownload op 6 oktober 2026. Tesseract-taaldata: Apache 2.0; zie [tessdata](https://github.com/tesseract-ocr/tessdata).

De app geeft workerPath, corePath en langPath expliciet door en gebruikt geen externe OCR-API. De bestanden mogen niet worden verwijderd bij het uploaden naar GitHub. De worker kiest zelf de passende core voor het apparaat.
