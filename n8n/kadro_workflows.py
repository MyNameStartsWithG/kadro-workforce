"""KADRO sesli komut akislarini ana projenin CANLI akislarindan uretir.

    python kadro_workflows.py <canli_export_dizini> <cikti_dizini>

Neden kopya: ana projenin assist ve transcribe akislari kapisi (Guard), hata sozlesmesi ve
kimlik baglariyla birlikte canlida calisiyor. Ayni hatti KADRO icin ayri bir yolla
(/webhook/kadro/...) acmak, ana proje akislarina HIC dokunmadan bunlari devralmak demek.

Neden canli export uzerinden: depodaki JSON'larda kimlik kimlikleri yer tutucu;
canli export'tan kopyalaninca Groq ve DeepSeek baglari korunuyor.

Kapi (Guard) bilerek degistirilmiyor: ana projenin add_guard.py betigi her dagitimda
butun akislarin kapisini ayni koda esitliyor. Ozel bir kapi bir sonraki ana proje
dagitiminda sessizce ezilirdi.

Degisenler:
  kadro-assist      Build Request: sistem talimati KADRO'dan gelir (body.system).
                    Talimat KADRO surumuyle birlikte degisir; n8n'e dokunmak gerekmez.
  kadro-transcribe  Normalize Input + Groq STT: 'prompt' alani (personel adlari ipucu).
  kadro-log         (yeni, kopya degil) assist'in kapisi + "kadro_kayit" veri tablosu: KADRO'nun
                    komut ve kart olayi kayitlari (src/asistan-kayit.js). Model cagrisi yok.
"""
import glob
import io
import json
import os
import re
import sys
import uuid

KAYNAK = {'core-assist': 'kadro-assist', 'core-transcribe': 'kadro-transcribe'}
YOL = {'kadro-assist': 'kadro/assist', 'kadro-transcribe': 'kadro/transcribe', 'kadro-log': 'kadro/log'}
KIMLIK = {'kadro-assist': 'KADROassist00001', 'kadro-transcribe': 'KADROtranscr0001', 'kadro-log': 'KADROkayit000001'}
TABLO = 'kadro_kayit'   # n8n tabloyu adla ararken kucuk harfe ceviriyor
# Sutunlar: suzme ve siralamada kullanilanlar ayri; kaydin tamami "detay"da JSON.
SUTUNLAR = [('tip', 'string'), ('zaman', 'string'), ('gun', 'string'), ('olay', 'string'), ('komutId', 'string'),
            ('kartId', 'string'), ('konusmaId', 'string'), ('musteri', 'string'), ('kullanici', 'string'),
            ('surum', 'string'), ('kaynak', 'string'), ('cumle', 'string'), ('cevap', 'string'), ('araclar', 'string'),
            ('kartSayisi', 'number'), ('turSayisi', 'number'), ('sureMs', 'number'), ('sttMs', 'number'),
            ('modelMs', 'number'), ('girdiToken', 'number'), ('ciktiToken', 'number'), ('onbellekToken', 'number'),
            ('hata', 'string'), ('detay', 'string')]

KAYIT_HAZIRLA = r"""// KADRO komut kaydi (KADRO src/asistan-kayit.js): govdedeki kayitlari "kadro_kayit" satirlarina cevirir.
//
// Iki tur kayit gelir: "komut" (soylenen cumle, tur tur model suresi ve token, arac cagrilari ve
// sonuclari, acilan kartlar, cevap, hata) ve "olay" (kart onaylandi / vazgecildi / geri alindi /
// suresi doldu; komutId ile komuta baglanir). Suzmede kullanilan alanlar ayri sutun, kaydin
// tamami "detay"da JSON. Personel adlari ve puantaj ozetleri icerir (musteri onayiyla,
// 25 Ekim 2026); IBAN, telefon, pasaport ve notlar KADRO'dan hic gelmez.
const girdi = $input.first().json;
const body = girdi.body || {};
const kayitlar = (Array.isArray(body.kayitlar) ? body.kayitlar.slice(0, 100) : [])
  .filter((k) => k && typeof k === 'object');
if (!kayitlar.length) throw new Error('kayitlar bos');
const musteri = (girdi._guard && girdi._guard.who) || '';

const metin = (v, n) => { const s = v == null ? '' : String(v); return s.length > n ? s.slice(0, n) : s; };
const sayi = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const topla = (dizi, f) => {
  let t = null;
  for (const x of dizi) { const v = sayi(f(x)); if (v != null) t = (t || 0) + v; }
  return t;
};

return kayitlar.map((k) => {
  const turlar = Array.isArray(k.turlar) ? k.turlar : [];
  const araclar = [...new Set(turlar.flatMap((t) => (Array.isArray(t.cagrilar) ? t.cagrilar : []).map((c) => c && c.ad)).filter(Boolean))];
  const zaman = metin(k.zaman, 40);
  const komut = k.tip === 'komut';
  return {
    json: {
      tip: metin(k.tip, 20),
      zaman,
      gun: zaman.slice(0, 10),
      olay: metin(k.olay, 40),
      komutId: metin(komut ? k.id : k.komutId, 40),
      kartId: metin(k.kartId, 40),
      konusmaId: metin(k.konusmaId, 40),
      musteri,
      kullanici: metin(k.kullanici, 80),
      surum: metin(k.surum, 20),
      kaynak: metin(k.kaynak, 10),
      cumle: metin(k.cumle, 2000),
      cevap: metin(k.cevap, 2000),
      araclar: araclar.join(','),
      kartSayisi: komut && Array.isArray(k.kartlar) ? k.kartlar.length : null,
      turSayisi: komut ? turlar.length : null,
      sureMs: sayi(k.sureMs),
      sttMs: sayi(k.ses && k.ses.sureMs),
      modelMs: topla(turlar, (t) => t.sureMs),
      girdiToken: topla(turlar, (t) => t.token && t.token.prompt_tokens),
      ciktiToken: topla(turlar, (t) => t.token && t.token.completion_tokens),
      onbellekToken: topla(turlar, (t) => t.token && t.token.prompt_cache_hit_tokens),
      hata: metin(k.hata, 1000),
      detay: metin(JSON.stringify(k), 30000),
    },
  };
});
"""
# Yeni akista olmamasi gereken, kaynaga ait alanlar.
AT = ['shared', 'activeVersionId', 'activeVersion', 'versionCounter', 'createdAt', 'updatedAt', 'pinData', 'triggerCount']

BUILD_REQUEST = r"""// KADRO sesli komut: modele gidecek istegi kurar.
//
// Sistem talimati (kurallar, personel/ekip/ev listesi, bugunun tarihi) KADRO'dan
// gelir: src/asistan.js -> sistemMetni(). Talimat KADRO surumuyle birlikte degisir,
// burada sadece model cagrisi kurulur.
//
// response_format: json_object BILEREK YOK: arac cagrisi gelmez (core-assist ile ayni).
const body = $json.body || {};
const system = String(body.system || '').slice(0, 40000);
const messages = Array.isArray(body.messages) ? body.messages : [];
const tools = Array.isArray(body.tools) ? body.tools : [];

if (!system || !messages.length) {
  return [{ json: { _error: 'system ya da messages bos' } }];
}

const payload = {
  model: '__MODEL__',
  temperature: 0.1,
  max_tokens: 1500,
  messages: [{ role: 'system', content: system }].concat(messages),
};
if (tools.length) {
  payload.tools = tools;
  payload.tool_choice = 'auto';
}

return [{ json: { payload } }];
"""


def dugum(wf, ad):
    for n in wf['nodes']:
        if n['name'] == ad:
            return n
    raise SystemExit(f"DURDURULDU: {wf['name']} icinde '{ad}' dugumu yok")


def kimlikler(wf):
    return sorted((n['name'], json.dumps(n.get('credentials'), sort_keys=True)) for n in wf['nodes'] if n.get('credentials'))


def kopyala(kaynak, ad):
    wf = json.loads(json.dumps(kaynak))
    for k in AT:
        wf.pop(k, None)
    wf['id'] = KIMLIK[ad]
    wf['name'] = ad
    wf['active'] = False
    wf['staticData'] = None          # hiz siniri sayaclari kaynaktan tasinmasin
    wf['versionId'] = str(uuid.uuid4())
    wf['tags'] = []
    w = dugum(wf, 'Webhook')
    w['parameters']['path'] = YOL[ad]
    w['webhookId'] = str(uuid.uuid4())
    return wf


def assist(kaynak):
    eski = dugum(kaynak, 'Build Request')['parameters']['jsCode']
    m = re.search(r"model:\s*'([^']+)'", eski)
    if not m:
        raise SystemExit('DURDURULDU: canli Build Request icinde model adi bulunamadi')
    wf = kopyala(kaynak, 'kadro-assist')
    dugum(wf, 'Build Request')['parameters']['jsCode'] = BUILD_REQUEST.replace('__MODEL__', m.group(1))
    return wf, m.group(1)


def transcribe(kaynak):
    wf = kopyala(kaynak, 'kadro-transcribe')
    kod = dugum(wf, 'Normalize Input')['parameters']
    eski = "    timezone: body.timezone || 'Europe/Istanbul',\n"
    if eski not in kod['jsCode']:
        raise SystemExit('DURDURULDU: Normalize Input beklenen bicimde degil (timezone satiri yok)')
    kod['jsCode'] = kod['jsCode'].replace(
        eski, eski + "    // KADRO: Whisper'a isim ipucu (personel adlari). Bos kalirsa Groq'a bos gider.\n"
                     "    prompt: String(body.prompt || '').slice(0, 600),\n", 1)
    groq = dugum(wf, 'Groq STT')['parameters']['bodyParameters']['parameters']
    if not any(p.get('name') == 'prompt' for p in groq):
        groq.append({'name': 'prompt', 'value': '={{ $json.prompt }}'})
    return wf


def log(kaynak):
    """kadro-log: kapi (Webhook, Guard, Izin var mi?, Deny) assist'ten aynen; arkasi veri tablosuna yazar."""
    wf = kopyala(kaynak, 'kadro-log')
    kapi = ['Webhook', 'Guard', 'Izin var mi?', 'Deny']
    wf['nodes'] = [dugum(wf, ad) for ad in kapi]
    x, y = 900, 200
    kod = lambda ad, js, i: {'parameters': {'jsCode': js}, 'name': ad, 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
                             'position': [x + 220 * i, y], 'id': str(uuid.uuid4())}
    wf['nodes'] += [
        kod('Kayitlari Hazirla', KAYIT_HAZIRLA, 0),
        {   # Tablo yoksa olusturur, varsa olani dondurur; istek basina bir kez.
            'parameters': {'resource': 'table', 'operation': 'create', 'tableName': TABLO,
                           'columns': {'column': [{'name': a, 'type': t} for a, t in SUTUNLAR]},
                           'options': {'createIfNotExists': True}},
            'name': 'Tablo', 'type': 'n8n-nodes-base.dataTable', 'typeVersion': 1.1, 'executeOnce': True,
            'position': [x + 220, y], 'id': str(uuid.uuid4())},
        kod('Satirlar', "// Tablo dugumu tek oge dondurur; eklenecekler hazirlanan satirlar.\n"
                        "return $('Kayitlari Hazirla').all().map((i) => ({ json: i.json }));\n", 2),
        {
            'parameters': {'resource': 'row', 'operation': 'insert',
                           'dataTableId': {'__rl': True, 'mode': 'name', 'value': TABLO},
                           'columns': {'mappingMode': 'autoMapInputData', 'value': {}, 'matchingColumns': [], 'schema': [],
                                       'attemptToConvertTypes': False, 'convertFieldsToString': False},
                           'options': {'optimizeBulk': True}},
            'name': 'Ekle', 'type': 'n8n-nodes-base.dataTable', 'typeVersion': 1.1,
            'position': [x + 660, y], 'id': str(uuid.uuid4())},
        kod('Yanit', "return [{ json: { ok: true, adet: $('Satirlar').all().length } }];\n", 4),
        {'parameters': {'respondWith': 'firstIncomingItem', 'options': {'responseCode': 200}},
         'name': 'Respond', 'type': 'n8n-nodes-base.respondToWebhook', 'typeVersion': 1.1,
         'position': [x + 1100, y], 'id': str(uuid.uuid4())},
    ]
    zincir = ['Kayitlari Hazirla', 'Tablo', 'Satirlar', 'Ekle', 'Yanit', 'Respond']
    baglanti = lambda hedef: [{'node': hedef, 'type': 'main', 'index': 0}]
    wf['connections'] = {
        'Webhook': {'main': [baglanti('Guard')]},
        'Guard': {'main': [baglanti('Izin var mi?')]},
        'Izin var mi?': {'main': [baglanti('Kayitlari Hazirla'), baglanti('Deny')]},
        **{a: {'main': [baglanti(b)]} for a, b in zip(zincir, zincir[1:])},
    }
    # Kapidan sonra kimlik bagi olan dugum kalmamali (model yok, maliyet yok).
    if any(n.get('credentials') for n in wf['nodes']):
        raise SystemExit('DURDURULDU: kadro-log icinde kimlik bagli dugum var')
    return wf


def main(giris, cikis):
    canli = {}
    for f in glob.glob(os.path.join(giris, '*.json')):
        wf = json.load(io.open(f, encoding='utf-8'))
        canli[wf.get('name')] = wf
    for ad in KAYNAK:
        if ad not in canli:
            raise SystemExit(f'DURDURULDU: canlida {ad} yok')
    if any(ad in canli for ad in KAYNAK.values()):
        print('    UYARI: kadro akislari canlida zaten var; ayni kimlikle uzerine yazilacak')

    os.makedirs(cikis, exist_ok=True)
    a, model = assist(canli['core-assist'])
    t = transcribe(canli['core-transcribe'])
    for kaynak_ad, wf in (('core-assist', a), ('core-transcribe', t)):
        # Kimlik baglari kaynakla birebir ayni olmali; degilse kopya yanlis yerden tutmus.
        if kimlikler(wf) != kimlikler(canli[kaynak_ad]):
            raise SystemExit(f"DURDURULDU: {wf['name']} kimlik baglari kaynaktan farkli")
        if wf['connections'] != canli[kaynak_ad]['connections']:
            raise SystemExit(f"DURDURULDU: {wf['name']} baglantilari kaynaktan farkli")
        yol = os.path.join(cikis, wf['id'] + '.json')
        with io.open(yol, 'w', encoding='utf-8') as f:
            json.dump(wf, f, ensure_ascii=False, indent=2)
        print(f"    {wf['name']:18} /webhook/{YOL[wf['name']]}  ({len(wf['nodes'])} dugum, kimlikler kaynakla ayni)")
    k = log(canli['core-assist'])
    with io.open(os.path.join(cikis, k['id'] + '.json'), 'w', encoding='utf-8') as f:
        json.dump(k, f, ensure_ascii=False, indent=2)
    print(f"    {k['name']:18} /webhook/{YOL[k['name']]}  ({len(k['nodes'])} dugum, kapi assist'ten, tablo {TABLO})")
    print(f'    model: {model}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
