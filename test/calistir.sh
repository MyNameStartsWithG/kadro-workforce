#!/usr/bin/env bash
#
# Test takımı: her grup için temiz örnek veriyle AYRI bir KADRO (port 4417, test/.calisma) ve sahte n8n
# (port 4499, test/mock-n8n.mjs) açılır. Gerçek veriye (Belgeler\KADRO ya da ./veri) dokunulmaz,
# internete çıkılmaz, model çağrılmaz.
#
#   test/calistir.sh          -> API testleri: sesli komut (48), komut kaydı (25), çalışma dönemi kilidi (3)
#   test/calistir.sh ui       -> + arayüz testleri (Python + Playwright: pip install playwright && playwright install chromium)
#
# Not: örnek veri Eylül–Ekim 2026 puantaj dönemlerini içerir. Testler "bugün"ün açık bir dönemde
# olduğunu varsayar; o tarihlerden sonra çalıştırılırsa puantaj testleri için yeni dönem açmak gerekir.
set -uo pipefail
cd "$(dirname "$0")/.."
T="$PWD/test/.calisma"
G="$T/gunluk.jsonl"
HATA=0

grup() {   # grup <ad> <komut...>
  local ad="$1"; shift
  echo; echo "==== $ad"
  node test/hazirla.mjs "$T" >/dev/null
  node test/mock-n8n.mjs 4499 "$G" > "$T/mock.log" 2>&1 & local MP=$!
  KADRO_KLASOR="$T" PORT=4417 KADRO_ASISTAN_ADRES=http://127.0.0.1:4499 KADRO_ASISTAN_ANAHTARI=test-anahtar \
    KADRO_TARAYICI_ACMA=1 node server.js > "$T/kadro.log" 2>&1 & local EP=$!
  for _ in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:4417/api/durum && break; sleep 0.5; done
  # Git Bash'te node.exe'nin Windows pid'i ayrı; test-kayit sahte n8n'i kapatıp açabilsin diye verilir.
  local MPW; MPW="$(cat /proc/$MP/winpid 2>/dev/null || echo $MP)"
  KAPAT="$MPW" MOCK="test/mock-n8n.mjs" "$@" | tee "$T/sonuc.txt"
  grep -q "HEPSİ GEÇTİ" "$T/sonuc.txt" || HATA=1
  kill $EP $MP 2>/dev/null; wait $EP $MP 2>/dev/null
}

grup "Sesli komut" node test/test-asistan.mjs 4417 "$G" "$T/veri/db.json"
grup "Komut kaydı" node test/test-kayit.mjs 4417 "$T" "$G"
grup "Çalışma dönemi kilidi" node test/test-kontrat-durum.mjs
if [ "${1:-}" = "ui" ]; then
  export PYTHONIOENCODING=utf-8
  grup "Arayüz: sesli komut" python test/ui-asistan.py
  grup "Arayüz: çalışanın gözünden" python test/ui-calisan.py
fi

echo
[ "$HATA" = 0 ] && echo "TÜM GRUPLAR GEÇTİ" || { echo "HATA VAR (ayrıntı yukarıda; günlükler test/.calisma)"; exit 1; }
