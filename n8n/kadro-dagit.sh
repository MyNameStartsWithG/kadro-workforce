#!/usr/bin/env bash
#
# KADRO sesli komut akislarini ana projenin CANLI n8n'ine kurar.
#
#   ./kadro-dagit.sh            -> onay sorar
#   YES=1 ./kadro-dagit.sh      -> sormaz
#   SSH_KEY=... SERVER=root@... ./kadro-dagit.sh
#
# Ne yapar:
#   1. canli workflow'lari export eder           -> GERI DONUS YEDEGI (silinmez)
#   2. core-assist / -transcribe kopyalarindan kadro-assist / kadro-transcribe uretir
#      (ana proje akislarina DOKUNULMAZ; kimlik baglari ve baglantilar degismediyse devam);
#      kadro-log: ayni kapi + "kadro_kayit" veri tablosuna komut kaydi (25 Ekim 2026)
#   3. .env'deki GUARD_KEYS listesine "kadro:<anahtar>" ekler (yoksa). .env once yedeklenir.
#   4. import -> publish (AYRI ssh oturumu) -> konteyneri yeniden olustur (yeni .env okunsun)
#   5. dogrulama: gecersiz anahtar -> bad_key; gecerli anahtarla kucuk bir assist cagrisi ve
#      kadro_kayit tablosuna tek bir "kurulum" satiri (tip=kurulum; analizde atlanir)
#
# Sira ve tuzaklar ana proje/scripts/workflow-dagit.sh ile ayni: publish import ile ayni
# oturumda tutmuyor, restart olmadan import etkisiz, webhook yolu healthz'den saniyeler
# sonra kayitlaniyor.
#
# GERI DONUS: n8n arayuzunden kadro-assist, kadro-transcribe ve kadro-log'u sil (ya da pasif yap),
# .env.bak-<damga> dosyasini .env'e geri kopyala, `docker compose up -d n8n`.
#
# Sonradan ana projenin workflow-dagit.sh'i calistirilirsa kadro akislarini da export
# edip yamalar: kapi (Guard) ve hata kodlari ayni kalir, bu istenen davranis.
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/n8n_sunucu}"
SERVER="${SERVER:-root@<sunucu-ip>}"
REMOTE_DIR="/opt/n8n"
CONTAINER="n8n"

cd "$(dirname "$0")"
ssh_cmd() { ssh -i "$SSH_KEY" "$SERVER" "$@"; }

STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="${WORK:-$PWD/yedek/workflows-$STAMP}"
mkdir -p "$WORK/canli" "$WORK/kadro"

echo "==> 1/5  canli workflow'lar aliniyor"
ssh_cmd "docker exec $CONTAINER sh -c 'rm -rf /tmp/wfexp && mkdir -p /tmp/wfexp \
  && n8n export:workflow --all --separate --output=/tmp/wfexp' >/dev/null 2>&1
rm -rf /tmp/wfexp-host && docker cp $CONTAINER:/tmp/wfexp /tmp/wfexp-host >/dev/null"
scp -q -i "$SSH_KEY" "$SERVER:/tmp/wfexp-host/*.json" "$WORK/canli/"
echo "    yedek (geri donus icin): $WORK/canli"

echo "==> 2/5  kadro akislari uretiliyor"
python kadro_workflows.py "$WORK/canli" "$WORK/kadro"

if [ -z "${YES:-}" ]; then
  printf '==> canli sunucuya kurulacak (ana proje akislarina dokunulmaz, n8n ~20 sn yeniden baslar). Devam? [e/H] '
  read -r answer
  case "$answer" in
    e|E|y|Y) ;;
    *) echo "iptal edildi (yedek $WORK/canli olarak kaldi)"; exit 1 ;;
  esac
fi

echo "==> 3/5  KADRO anahtari"
# Anahtar sunucuda uretiliyor ve sunucuda (chmod 600) duruyor; ekrana yazilmiyor.
ssh_cmd "cd $REMOTE_DIR && cp .env .env.bak-$STAMP && \
if grep -qE '^GUARD_KEYS=(.*,)?kadro:' .env; then echo '    kadro anahtari zaten var, dokunulmadi'; \
else K=\$(openssl rand -hex 24); \
  if grep -qE '^GUARD_KEYS=.+' .env; then sed -i \"s/^GUARD_KEYS=\(.*\)\$/GUARD_KEYS=\1,kadro:\$K/\" .env; \
  else sed -i \"s/^GUARD_KEYS=\$/GUARD_KEYS=kadro:\$K/\" .env; fi; \
  grep -qE '^GUARD_KEYS=(.*,)?kadro:' .env || { cp .env.bak-$STAMP .env; echo 'GUARD_KEYS satiri bulunamadi'; exit 1; }; \
  umask 077; echo \"\$K\" > $REMOTE_DIR/kadro-anahtar.txt; echo '    kadro anahtari eklendi (.env yedegi: .env.bak-$STAMP)'; fi"

echo "==> 4/5  import + publish + yeniden olustur"
ssh_cmd "mkdir -p /tmp/wf-kadro-$STAMP"
scp -q -i "$SSH_KEY" "$WORK/kadro/"*.json "$SERVER:/tmp/wf-kadro-$STAMP/"
ssh_cmd "docker cp /tmp/wf-kadro-$STAMP $CONTAINER:/tmp/wf-kadro >/dev/null
for f in /tmp/wf-kadro-$STAMP/*.json; do
  docker exec $CONTAINER n8n import:workflow --input=/tmp/wf-kadro/\$(basename \$f) 2>&1 | tail -1
done"
# publish AYRI ssh oturumunda (tuzak a).
ssh_cmd "for id in KADROassist00001 KADROtranscr0001 KADROkayit000001; do
  docker exec $CONTAINER n8n publish:workflow --id=\$id 2>&1 | tail -1
done"
# up -d: .env degistiyse konteyner yeniden olusur (restart .env'i okumaz); restart: import etkin olsun (tuzak b).
ssh_cmd "cd $REMOTE_DIR && docker compose up -d n8n >/dev/null 2>&1 && docker compose restart n8n >/dev/null 2>&1 && echo '    n8n yeniden baslatildi'"

echo "==> 5/5  dogrulama"
ssh_cmd "for i in \$(seq 1 30); do
  if docker exec $CONTAINER wget -qO- http://localhost:5678/healthz >/dev/null 2>&1; then echo '    healthz 200'; break; fi
  sleep 2
done
sleep 6"   # webhook yolu healthz'den SONRA kayitlaniyor (tuzak c)

HOST="$(ssh_cmd "grep '^N8N_HOST=' $REMOTE_DIR/.env | cut -d= -f2" | tr -d ' \r\n')"
URL="https://$HOST"
KEY="$(ssh_cmd "cat $REMOTE_DIR/kadro-anahtar.txt 2>/dev/null" | tr -d ' \r\n')"
HATA=0

# Webhook yolu healthz'den sonra 6 saniyeden de gec kayitlanabiliyor (23 Ekim'de olculdu):
# "Cannot POST" geldikce 60 saniyeye kadar bekle. Canlidaki kapi error_code yerine
# Turkce "API anahtari reddedildi" donduruyor; ikisi de ret sayilir.
for yol in kadro/assist kadro/transcribe kadro/log; do
  for i in $(seq 1 30); do
    B="$(curl -s -m 25 -X POST "$URL/webhook/$yol" -H 'X-Api-Key: bu-anahtar-bilerek-gecersiz' || true)"
    case "$B" in *'Cannot POST'*) sleep 2 ;; *) break ;; esac
  done
  case "$B" in *'"error_code":"bad_key"'*|*'reddedildi'*) echo "    $yol: ret yolu tamam" ;; *) echo "    $yol: BEKLENMEYEN yanit: $B" >&2; HATA=1 ;; esac
done

if [ -n "$KEY" ]; then
  # Gercek bir model cagrisi (birkac yuz token, bir kurusun altinda).
  B="$(curl -s -m 60 -X POST "$URL/webhook/kadro/assist" -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' \
    -d '{"system":"Kisa cevap ver.","messages":[{"role":"user","content":"Sadece tamam yaz."}],"tools":[]}' || true)"
  case "$B" in *'"say"'*) echo "    kadro/assist: model cevap verdi: $B" ;; *) echo "    kadro/assist: BEKLENMEYEN yanit: $B" >&2; HATA=1 ;; esac
  # Kayit ucu: tablo yoksa olusur, tek satir yazilir.
  Z="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  B="$(curl -s -m 60 -X POST "$URL/webhook/kadro/log" -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' \
    -d "{\"kayitlar\":[{\"id\":\"kurulum-$STAMP\",\"tip\":\"kurulum\",\"zaman\":\"$Z\",\"cumle\":\"kadro-dagit.sh dogrulama\"}]}" || true)"
  case "$B" in *'"ok":true'*) echo "    kadro/log: tabloya yazildi: $B" ;; *) echo "    kadro/log: BEKLENMEYEN yanit: $B" >&2; HATA=1 ;; esac
fi

echo
if [ "$HATA" = 0 ]; then
  echo "TAMAM. KADRO > Ayarlar > Sesli komut:"
  echo "  Adres  : $URL"
  echo "  Anahtar: sunucuda $REMOTE_DIR/kadro-anahtar.txt"
  echo "Anahtari iptal etmek: .env'deki GUARD_KEYS'ten kadro:... parcasini sil, docker compose up -d n8n."
else
  echo "Dogrulama basarisiz. Geri donus: bu betigin basindaki GERI DONUS notu; yedek $WORK/canli" >&2
  exit 1
fi
