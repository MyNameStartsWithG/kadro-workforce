#!/usr/bin/env bash
#
# KADRO sesli komut kayitlarini (n8n "kadro_kayit" veri tablosu) analiz icin indirir.
#
#   ./kayit-indir.sh                 -> butun kayitlar
#   ./kayit-indir.sh 2026-11-01      -> bu gunden (dahil) sonrakiler
#
# Cikti: kayitlar/kadro-kayit-<damga>.jsonl, satir basina bir kayit. "detay" alani KADRO'nun gonderdigi
# kaydin tamami (JSON metni): tur tur model suresi ve token, arac cagrilari, argumanlari ve sonuclari,
# acilan kartlar. Personel adlari ve puantaj ozetleri icerir; dosyayi paylasmayin.
#
# Salt okunur: veritabanina READONLY baglanir, n8n'e dokunmaz.
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/n8n_sunucu}"
SERVER="${SERVER:-root@<sunucu-ip>}"
CONTAINER="n8n"
GUN="${1:-0000-00-00}"
case "$GUN" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) echo "tarih YYYY-AA-GG olmali" >&2; exit 1 ;; esac

cd "$(dirname "$0")"
mkdir -p kayitlar
CIKTI="kayitlar/kadro-kayit-$(date +%Y%m%d-%H%M%S).jsonl"

# Satirlar stdout'a JSONL, ozet stderr'e.
ssh -i "$SSH_KEY" "$SERVER" "docker exec -w /usr/local/lib/node_modules/n8n $CONTAINER node -e '
const sqlite3 = require(\"sqlite3\");
const db = new sqlite3.Database(\"/home/node/.n8n/database.sqlite\", sqlite3.OPEN_READONLY);
db.get(\"select id from data_table where name = ?\", [\"kadro_kayit\"], (e, t) => {
  if (e || !t) { console.error(e ? e.message : \"kadro_kayit tablosu yok\"); process.exit(1); }
  db.all(\"select * from data_table_user_\" + t.id + \" where gun >= ? order by id\", [\"$GUN\"], (e2, satirlar) => {
    if (e2) { console.error(e2.message); process.exit(1); }
    let bayt = 0;
    for (const s of satirlar) { const j = JSON.stringify(s); bayt += j.length; console.log(j); }
    console.error(\"    \" + satirlar.length + \" kayit, \" + (bayt / 1024).toFixed(0) + \" KB (n8n veri tablolari varsayilan siniri 50 MB)\");
  });
});'" > "$CIKTI"

echo "    $CIKTI"
