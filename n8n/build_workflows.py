"""Builds the Kadro voice-command workflows from the LIVE workflows of the core project.

    python build_workflows.py <live_export_dir> <output_dir>

Why a copy: the core project's assist and transcribe workflows already run live with their gate (Guard),
error contract and credential bindings. Opening the same pipeline for Kadro on a separate path
(/webhook/kadro/...) means inheriting all of that WITHOUT touching the core workflows at all.

Why from the live export: in the repository JSON the credential ids are placeholders;
copying from the live export keeps the Groq and DeepSeek bindings.

The gate (Guard) is deliberately left unchanged: the core project's add_guard.py script resets the gate
of every workflow to the same code on each deploy. A custom gate would be silently overwritten on the
next core deploy.

What changes:
  kadro-assist      Build Request: the system prompt comes from Kadro (body.system).
                    The prompt changes with the Kadro version; n8n does not need to be touched.
  kadro-transcribe  Normalize Input + Groq STT: a 'prompt' field (employee names as a hint).
  kadro-log         (new, not a copy) the assist gate + the "kadro_log" data table: Kadro's
                    command and card event records (src/assistant-log.js). No model call.
"""
import glob
import io
import json
import os
import re
import sys
import uuid

SOURCE = {'core-assist': 'kadro-assist', 'core-transcribe': 'kadro-transcribe'}
PATH = {'kadro-assist': 'kadro/assist', 'kadro-transcribe': 'kadro/transcribe', 'kadro-log': 'kadro/log'}
WORKFLOW_ID = {'kadro-assist': 'KADROassist00001', 'kadro-transcribe': 'KADROtranscr0001', 'kadro-log': 'KADROlog00000001'}
TABLE = 'kadro_log'   # n8n lower-cases the name when looking a table up
# The gate nodes as they are named in the core workflows.
GATE = ['Webhook', 'Guard', 'Allowed?', 'Deny']
# Columns: the ones used for filtering and sorting are separate; the whole record is JSON in "detail".
COLUMNS = [('kind', 'string'), ('time', 'string'), ('day', 'string'), ('event', 'string'), ('commandId', 'string'),
           ('cardId', 'string'), ('conversationId', 'string'), ('customer', 'string'), ('user', 'string'),
           ('version', 'string'), ('source', 'string'), ('sentence', 'string'), ('reply', 'string'), ('tools', 'string'),
           ('cardCount', 'number'), ('turnCount', 'number'), ('ms', 'number'), ('sttMs', 'number'),
           ('modelMs', 'number'), ('inputTokens', 'number'), ('outputTokens', 'number'), ('cacheTokens', 'number'),
           ('error', 'string'), ('detail', 'string')]

PREPARE_RECORDS = r"""// Kadro command log (Kadro src/assistant-log.js): turns the records in the body into "kadro_log" rows.
//
// Two kinds of record arrive: "command" (the sentence spoken, model time and tokens per turn, tool calls and
// their results, the cards opened, the reply, any error) and "event" (card approved / cancelled / undone /
// expired; linked to its command by commandId). Fields used for filtering are separate columns, the whole
// record is JSON in "detail". Records contain employee names and timesheet summaries (with the customer's
// consent); IBANs, phone numbers, passports and notes never leave Kadro.
const input = $input.first().json;
const body = input.body || {};
const records = (Array.isArray(body.records) ? body.records.slice(0, 100) : [])
  .filter((k) => k && typeof k === 'object');
if (!records.length) throw new Error('records empty');
const customer = (input._guard && input._guard.who) || '';

const text = (v, n) => { const s = v == null ? '' : String(v); return s.length > n ? s.slice(0, n) : s; };
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const sum = (list, f) => {
  let t = null;
  for (const x of list) { const v = num(f(x)); if (v != null) t = (t || 0) + v; }
  return t;
};

return records.map((k) => {
  const turns = Array.isArray(k.turns) ? k.turns : [];
  const tools = [...new Set(turns.flatMap((t) => (Array.isArray(t.calls) ? t.calls : []).map((c) => c && c.name)).filter(Boolean))];
  const time = text(k.time, 40);
  const command = k.kind === 'command';
  return {
    json: {
      kind: text(k.kind, 20),
      time,
      day: time.slice(0, 10),
      event: text(k.event, 40),
      commandId: text(command ? k.id : k.commandId, 40),
      cardId: text(k.cardId, 40),
      conversationId: text(k.conversationId, 40),
      customer,
      user: text(k.user, 80),
      version: text(k.version, 20),
      source: text(k.source, 10),
      sentence: text(k.sentence, 2000),
      reply: text(k.reply, 2000),
      tools: tools.join(','),
      cardCount: command && Array.isArray(k.cards) ? k.cards.length : null,
      turnCount: command ? turns.length : null,
      ms: num(k.ms),
      sttMs: num(k.audio && k.audio.ms),
      modelMs: sum(turns, (t) => t.ms),
      inputTokens: sum(turns, (t) => t.usage && t.usage.prompt_tokens),
      outputTokens: sum(turns, (t) => t.usage && t.usage.completion_tokens),
      cacheTokens: sum(turns, (t) => t.usage && t.usage.prompt_cache_hit_tokens),
      error: text(k.error, 1000),
      detail: text(JSON.stringify(k), 30000),
    },
  };
});
"""
# Fields of the source that must not be in the new workflow.
DROP = ['shared', 'activeVersionId', 'activeVersion', 'versionCounter', 'createdAt', 'updatedAt', 'pinData', 'triggerCount']

BUILD_REQUEST = r"""// Kadro voice commands: builds the request sent to the model.
//
// The system prompt (rules, employee/crew/house list, today's date) comes from Kadro:
// src/assistant.js -> systemPrompt(). The prompt changes with the Kadro version;
// only the model call is built here.
//
// response_format: json_object is deliberately ABSENT: tool calls would not come back (same as core-assist).
const body = $json.body || {};
const system = String(body.system || '').slice(0, 40000);
const messages = Array.isArray(body.messages) ? body.messages : [];
const tools = Array.isArray(body.tools) ? body.tools : [];

if (!system || !messages.length) {
  return [{ json: { _error: 'system or messages empty' } }];
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


def node(wf, name):
    for n in wf['nodes']:
        if n['name'] == name:
            return n
    raise SystemExit(f"STOPPED: no '{name}' node in {wf['name']}")


def credentials(wf):
    return sorted((n['name'], json.dumps(n.get('credentials'), sort_keys=True)) for n in wf['nodes'] if n.get('credentials'))


def copy(source, name):
    wf = json.loads(json.dumps(source))
    for k in DROP:
        wf.pop(k, None)
    wf['id'] = WORKFLOW_ID[name]
    wf['name'] = name
    wf['active'] = False
    wf['staticData'] = None          # rate-limit counters must not come over from the source
    wf['versionId'] = str(uuid.uuid4())
    wf['tags'] = []
    w = node(wf, 'Webhook')
    w['parameters']['path'] = PATH[name]
    w['webhookId'] = str(uuid.uuid4())
    return wf


def assist(source):
    old = node(source, 'Build Request')['parameters']['jsCode']
    m = re.search(r"model:\s*'([^']+)'", old)
    if not m:
        raise SystemExit('STOPPED: no model name found in the live Build Request')
    wf = copy(source, 'kadro-assist')
    node(wf, 'Build Request')['parameters']['jsCode'] = BUILD_REQUEST.replace('__MODEL__', m.group(1))
    return wf, m.group(1)


def transcribe(source):
    wf = copy(source, 'kadro-transcribe')
    code = node(wf, 'Normalize Input')['parameters']
    old = "    timezone: body.timezone || 'Europe/Istanbul',\n"
    if old not in code['jsCode']:
        raise SystemExit('STOPPED: Normalize Input is not in the expected shape (no timezone line)')
    code['jsCode'] = code['jsCode'].replace(
        old, old + "    // Kadro: a name hint for Whisper (employee names). If empty, Groq gets an empty one.\n"
                   "    prompt: String(body.prompt || '').slice(0, 600),\n", 1)
    groq = node(wf, 'Groq STT')['parameters']['bodyParameters']['parameters']
    if not any(p.get('name') == 'prompt' for p in groq):
        groq.append({'name': 'prompt', 'value': '={{ $json.prompt }}'})
    return wf


def log(source):
    """kadro-log: the gate (Webhook, Guard, Allowed?, Deny) unchanged from assist; behind it, writes to the data table."""
    wf = copy(source, 'kadro-log')
    wf['nodes'] = [node(wf, name) for name in GATE]
    x, y = 900, 200
    code = lambda name, js, i: {'parameters': {'jsCode': js}, 'name': name, 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
                                'position': [x + 220 * i, y], 'id': str(uuid.uuid4())}
    wf['nodes'] += [
        code('Prepare Records', PREPARE_RECORDS, 0),
        {   # Creates the table if missing, returns the existing one otherwise; once per request.
            'parameters': {'resource': 'table', 'operation': 'create', 'tableName': TABLE,
                           'columns': {'column': [{'name': a, 'type': t} for a, t in COLUMNS]},
                           'options': {'createIfNotExists': True}},
            'name': 'Table', 'type': 'n8n-nodes-base.dataTable', 'typeVersion': 1.1, 'executeOnce': True,
            'position': [x + 220, y], 'id': str(uuid.uuid4())},
        code('Rows', "// The Table node returns a single item; the rows to insert are the prepared ones.\n"
                     "return $('Prepare Records').all().map((i) => ({ json: i.json }));\n", 2),
        {
            'parameters': {'resource': 'row', 'operation': 'insert',
                           'dataTableId': {'__rl': True, 'mode': 'name', 'value': TABLE},
                           'columns': {'mappingMode': 'autoMapInputData', 'value': {}, 'matchingColumns': [], 'schema': [],
                                       'attemptToConvertTypes': False, 'convertFieldsToString': False},
                           'options': {'optimizeBulk': True}},
            'name': 'Insert', 'type': 'n8n-nodes-base.dataTable', 'typeVersion': 1.1,
            'position': [x + 660, y], 'id': str(uuid.uuid4())},
        code('Reply', "return [{ json: { ok: true, count: $('Rows').all().length } }];\n", 4),
        {'parameters': {'respondWith': 'firstIncomingItem', 'options': {'responseCode': 200}},
         'name': 'Respond', 'type': 'n8n-nodes-base.respondToWebhook', 'typeVersion': 1.1,
         'position': [x + 1100, y], 'id': str(uuid.uuid4())},
    ]
    chain = ['Prepare Records', 'Table', 'Rows', 'Insert', 'Reply', 'Respond']
    link = lambda target: [{'node': target, 'type': 'main', 'index': 0}]
    wf['connections'] = {
        'Webhook': {'main': [link('Guard')]},
        'Guard': {'main': [link('Allowed?')]},
        'Allowed?': {'main': [link('Prepare Records'), link('Deny')]},
        **{a: {'main': [link(b)]} for a, b in zip(chain, chain[1:])},
    }
    # No node with a credential binding may remain after the gate (no model, no cost).
    if any(n.get('credentials') for n in wf['nodes']):
        raise SystemExit('STOPPED: kadro-log contains a node with credentials')
    return wf


def main(src_dir, out_dir):
    live = {}
    for f in glob.glob(os.path.join(src_dir, '*.json')):
        wf = json.load(io.open(f, encoding='utf-8'))
        live[wf.get('name')] = wf
    for name in SOURCE:
        if name not in live:
            raise SystemExit(f'STOPPED: {name} is not live')
    if any(name in live for name in SOURCE.values()):
        print('    WARNING: the kadro workflows are already live; they will be overwritten with the same id')

    os.makedirs(out_dir, exist_ok=True)
    a, model = assist(live['core-assist'])
    t = transcribe(live['core-transcribe'])
    for source_name, wf in (('core-assist', a), ('core-transcribe', t)):
        # Credential bindings must be exactly the same as the source; otherwise the copy came from the wrong place.
        if credentials(wf) != credentials(live[source_name]):
            raise SystemExit(f"STOPPED: {wf['name']} credential bindings differ from the source")
        if wf['connections'] != live[source_name]['connections']:
            raise SystemExit(f"STOPPED: {wf['name']} connections differ from the source")
        path = os.path.join(out_dir, wf['id'] + '.json')
        with io.open(path, 'w', encoding='utf-8') as f:
            json.dump(wf, f, ensure_ascii=False, indent=2)
        print(f"    {wf['name']:18} /webhook/{PATH[wf['name']]}  ({len(wf['nodes'])} nodes, credentials same as the source)")
    k = log(live['core-assist'])
    with io.open(os.path.join(out_dir, k['id'] + '.json'), 'w', encoding='utf-8') as f:
        json.dump(k, f, ensure_ascii=False, indent=2)
    print(f"    {k['name']:18} /webhook/{PATH[k['name']]}  ({len(k['nodes'])} nodes, gate from assist, table {TABLE})")
    print(f'    model: {model}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
