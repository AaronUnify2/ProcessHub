#!/usr/bin/env python3
"""
Import CustomerService.html into the Process Hub data model.

Each leaf node of the call-flow diagram becomes one process. The node body is
decomposed into steps: numbered items become action steps, "[ ]" lines become
checks on the step above them, italic passages become the call script, and
context chips become article references.

This is a structural extraction, not a rewrite. Everything it produces is
marked `status: "draft"`, and anything needing human judgement is recorded as
an issue on the process rather than guessed at.

Run from the repository root, AFTER import-faq.py:

    python3 processhub/tools/import-flowcharts.py

It merges into the existing data files rather than overwriting them.
"""

import html
import json
import os
import re
import sys
from datetime import date

SOURCE = 'CustomerService.html'
DATA_DIR = os.path.join('processhub', 'data')
TODAY = date.today().isoformat()

# ---------------------------------------------------------------------------
# Taxonomy. Departments come from the FAQ register; Works is added because the
# flowcharts carry roads and engineering work that the FAQ list has no home
# for. Sub-departments are seeded from the flowchart sections.
# ---------------------------------------------------------------------------

EXTRA_DEPARTMENTS = ['Works']

# section id -> (department name, sub-department name)
SECTION_MAP = {
    'rates':          ('Revenue', 'Rates'),
    'building':       ('Building', 'Building'),
    'buildingguide':  ('Building', 'Building'),
    'plumbing':       ('Building', 'Plumbing'),
    'planning':       ('Planning', 'Planning'),
    'planningguide':  ('Planning', 'Planning'),
    'water':          ('Water', 'Water'),
    'animals':        ('Local Laws', 'Animal Control'),
    'environmental':  ('Regulatory', 'Environmental Health'),
    'waste':          ('Waste', 'Waste & Recycling'),
    'complaints':     ('Governance', 'Complaints'),
    'cemetery':       ('Parks and Recreation', 'Cemeteries'),
    'venues':         ('Parks and Recreation', 'Venues & Facilities'),
    'campgrounds':    ('Parks and Recreation', 'Campgrounds'),
    'disaster':       ('Governance', 'Disaster Management'),
    'claims':         ('Governance', 'Insurance & Claims'),
    'roads':          ('Works', 'Roads'),
    'works':          ('Works', 'Engineering'),
    'weeds':          ('Regulatory', 'Biosecurity'),
    'pests':          ('Regulatory', 'Biosecurity'),
    'licence':        ('Regulatory', 'Licensing'),
    'disputes':       ('Governance', 'Disputes'),
}

# Disputes split by the nature of the dispute rather than sitting in one place.
# These are guesses and each one carries an issue asking for confirmation.
DISPUTE_OVERRIDES = {
    'DisputeCouncil':    ('Regulatory', 'Environmental Health'),
    'DisputeUnapproved': ('Regulatory', 'Building Compliance'),
    'DisputeHomeBiz':    ('Planning', 'Planning'),
    'DisputePrivate':    ('Governance', 'Disputes'),
    'DisputeTree':       ('Governance', 'Disputes'),
    'DisputeFencing':    ('Governance', 'Disputes'),
}

# Internal system names, extracted so a rename is one edit rather than many.
SYSTEM_VARIABLES = [
    ('var_sys_intranet',  'Eli',        'Is Eli still the name of the staff intranet?'),
    ('var_sys_requests',  'CRM',        'Is the customer request system still called the CRM?'),
    ('var_sys_mapping',   'Intramaps',  'Is Intramaps still the internal mapping tool?'),
    ('var_sys_property',  'TechOne',    'Is TechOne still the property and rates system?'),
    ('var_sys_payments',  'BPOINT',     'Is BPOINT still the payment system?'),
    ('var_sys_water',     'Aqualas',    'Is Aqualas still the water system?'),
    ('var_sys_records',   'ECM',        'Is ECM still the records system?'),
    ('var_sys_notices',   'Payreq',     'Is Payreq still used for rates notices?'),
    ('var_sys_reporting', 'XLOne',      'Is XLOne still the reporting tool used for payment agreements?'),
    ('var_sys_directory', 'The Pulse',  'Is The Pulse still the staff directory?'),
    ('var_sys_collections', 'Echo',     'Is the bin collection system still called Echo?'),
]

RETIRED = {'Merit': 'var_sys_requests'}

# Current system names are substituted too, so the variables actually have
# references and a future rename stays a single edit.
CURRENT_TERMS = {
    'Eli': 'var_sys_intranet',
    'TechOne': 'var_sys_property',
    'Intramaps': 'var_sys_mapping',
    'BPOINT': 'var_sys_payments',
    'Aqualas': 'var_sys_water',
    'Payreq': 'var_sys_notices',
    'XLOne': 'var_sys_reporting',
    'ECM': 'var_sys_records',
    'The Pulse': 'var_sys_directory',
}

# A handoff is a step whose work leaves the contact centre. Detected only when
# transfer language appears alongside a department or role, so that merely
# mentioning another team does not count as a handoff.
HANDOFF_VERBS = (r'transfer|refer|callback|call back|arrange|notify|escalate|'
                 r'send to|sent to|forward|pass to|hand over|await|awaiting|'
                 r'email .{0,40} to|emailing')
HANDOFF_TARGETS = [
    (r'revenue|rate recovery|\bR&amp;R\b|\bR&R\b', 'Revenue', 'Rates'),
    (r'building certifier|building team|built environment|sdrcbuilding|certifier',
     'Building', 'Building'),
    (r'plumbing (?:team|inspector)', 'Building', 'Plumbing'),
    (r'\bplanner\b|planning (?:team|department|officer)', 'Planning', 'Planning'),
    (r'local laws', 'Local Laws', None),
    (r'water (?:team|maintenance)|maintenance supervisor', 'Water', 'Water'),
    (r'waste team', 'Waste', 'Waste & Recycling'),
    (r'engineering|works (?:team|department)|technical officer', 'Works', 'Engineering'),
    (r'\brecords\b', 'Governance', 'Records'),
    (r'\brangers?\b|animal control', 'Local Laws', 'Animal Control'),
    (r'environmental health|health officer', 'Regulatory', 'Environmental Health'),
]


def detect_handoff(text):
    """Return (department, sub-department) when a step hands work to another team."""
    for line in re.split(r'[\n.]', text):
        low = line.lower()
        if not re.search(HANDOFF_VERBS, low):
            continue
        for pattern, dept, sub in HANDOFF_TARGETS:
            if re.search(pattern, low, re.I):
                return dept, sub
    return None


RESOLUTIONS = [
    (r'\bMerit\b|\bCRM\b',              'Request logged in the CRM',
     'Log the request in the CRM. Confirm the customer\'s mobile number and send the request ID by SMS.'),
    (r'Email Form|Email the form|📧',   'Form emailed to customer',
     'Find the form, confirm the email address, attach and send.'),
    (r'BPOINT|Process [Pp]ayment',      'Payment processed',
     'Process the payment and email the receipt to the confirmed address.'),
    (r'[Tt]ransfer|[Cc]allback|[Cc]all back', 'Transferred or callback arranged',
     'Establish context, check availability, transfer or arrange a callback.'),
]
DEFAULT_RESOLUTION = ('Information provided',
                      'Customer has the answer or the referral contact they needed.')


def slugify(text, limit=48):
    s = re.sub(r'<[^>]+>', ' ', str(text or ''))
    s = re.sub(r'[^\x00-\x7F]+', ' ', s)
    s = s.lower().strip()
    s = re.sub(r'[^a-z0-9]+', '_', s)
    return re.sub(r'^_+|_+$', '', s)[:limit] or 'item'


def plain(text):
    """Strip tags and decode entities, for titles and short labels."""
    t = re.sub(r'<[^>]+>', '', text or '')
    t = html.unescape(t)
    t = re.sub(r'[^\x00-\x7F]+', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def unique(base, seen):
    if base not in seen:
        seen.add(base)
        return base
    n = 2
    while f'{base}_{n}' in seen:
        n += 1
    out = f'{base}_{n}'
    seen.add(out)
    return out


# ------------------------------------------------------------ source parsing

def read_source():
    src = open(SOURCE, encoding='utf-8').read()

    s = src.index('const SECTIONS = {')
    e = src.index('\n    };', s)
    sections = dict(re.findall(r"'([a-z]+)':\s*`(.*?)`,\s*\n", src[s:e], re.S))

    s = src.index('const CONTEXT_NODES = {')
    e = src.index('const HEADER', s)
    ctx_block = src[s:e]
    contexts = []
    for m in re.finditer(
            r"'([A-Za-z0-9_]+)':\s*\{\s*\n\s*parentId:\s*'([^']*)',"
            r"\s*\n\s*nodeId:\s*'[^']*',\s*\n\s*label:\s*`(.*?)`\s*\n\s*\}",
            ctx_block, re.S):
        contexts.append({'key': m.group(1), 'parentId': m.group(2), 'label': m.group(3)})

    return sections, contexts


def leaf_nodes(section_body):
    """Every `Decision -->|Branch| NodeId["body"]` in a section."""
    out = []
    for m in re.finditer(r'-->\|([^|]*)\|\s*([A-Za-z0-9_]+)\["(.*?)"\]', section_body, re.S):
        out.append({'branch': m.group(1).strip(), 'id': m.group(2), 'body': m.group(3)})
    return out


# -------------------------------------------------------------- body parsing

RE_NUMBERED = re.compile(r'^\s*(\d+)[.)]\s+(.*)$')
RE_CHECK = re.compile(r'^\s*\[\s*\]\s*(.*)$')
RE_HEADING = re.compile(r'^\s*<u>(.*?)</u>:?\s*$')
RE_SCRIPT = re.compile(r'<i>(.*?)</i>', re.S)
RE_CONTEXT = re.compile(r"data-context='([A-Za-z0-9_]+)'")


def parse_body(body):
    """Decompose a node body into its structural parts."""
    lines = re.split(r'<br\s*/?>', body)
    parsed = {
        'title': '', 'preamble': [], 'procedure': [], 'script': [],
        'references': [], 'warnings': [], 'articleRefs': [], 'headings': [],
    }

    if lines:
        parsed['title'] = plain(lines[0]).strip()
        lines = lines[1:]

    current = None
    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        for key in RE_CONTEXT.findall(line):
            if key not in parsed['articleRefs']:
                parsed['articleRefs'].append(key)
        line_nochip = re.sub(r"<span data-context=.*?</span>", '', line).strip()
        if not line_nochip:
            continue

        script = RE_SCRIPT.search(line_nochip)
        if script:
            text = plain(script.group(1)).strip().strip('"')
            if text:
                parsed['script'].append(text)
            continue

        check = RE_CHECK.match(line_nochip)
        if check:
            text = plain(check.group(1))
            if current is not None:
                current['checks'].append(text)
            else:
                parsed['preamble'].append('[ ] ' + text)
            continue

        numbered = RE_NUMBERED.match(plain(line_nochip))
        if numbered:
            current = {'n': int(numbered.group(1)), 'text': numbered.group(2).strip(),
                       'checks': [], 'extra': []}
            parsed['procedure'].append(current)
            continue

        heading = RE_HEADING.match(line_nochip)
        if heading:
            parsed['headings'].append(plain(heading.group(1)))
            current = None
            parsed['preamble'].append(plain(line_nochip).rstrip(':') + ':')
            continue

        text = plain(line_nochip)
        if not text:
            continue
        if text.startswith('⚠') or text.lower().startswith('warning'):
            parsed['warnings'].append(text.lstrip('⚠ ').strip())
        elif raw.strip().startswith('\U0001F4CC') or '\U0001F4CC' in raw:
            parsed['references'].append(text.lstrip('\U0001F4CC ').strip())
        elif current is not None:
            current['extra'].append(text)
        else:
            parsed['preamble'].append(text)

    return parsed


def apply_retired_terms(text):
    """Swap system names for their variables. Returns (text, retired names hit)."""
    hits = []
    for old, var_id in RETIRED.items():
        pattern = re.compile(r'\b' + re.escape(old) + r'\b')
        if pattern.search(text):
            hits.append(old)
            text = pattern.sub('{{' + var_id + '}}', text)
    for term, var_id in CURRENT_TERMS.items():
        text = re.sub(r'\b' + re.escape(term) + r'\b', '{{' + var_id + '}}', text)
    return text, hits


def infer_resolution(body):
    for pattern, title, sop in RESOLUTIONS:
        if re.search(pattern, body):
            return title, sop
    return DEFAULT_RESOLUTION


# ------------------------------------------------------------ process building

def build_process(node, section, tax_ids, seen_proc, seen_step):
    parsed = parse_body(node['body'])
    dept, sub = DISPUTE_OVERRIDES.get(node['id'], SECTION_MAP[section])
    tax_id = tax_ids[(dept, sub)]

    name = parsed['title'] or plain(node['branch'])
    if ' - ' in name:
        name = name.split(' - ', 1)[1].strip() or name
    name = name.strip()

    proc_id = unique('proc_' + slugify(f'{sub} {name}'), seen_proc)
    steps, connections, issues = [], [], []
    retired_hits = set()

    cs_tax = tax_ids[('Customer Service', 'Customer Service')]

    def add_step(**kw):
        # These are contact-centre call flows, so the officer performs the step
        # unless the wording hands the work to another team.
        kw.setdefault('departmentId', cs_tax)
        kw.setdefault('responsibleRole', 'Customer service officer')
        kw.setdefault('escalationPoint', '')
        kw.setdefault('timeframe', '')
        kw.setdefault('sop', '')
        kw.setdefault('completionTrigger', '')
        kw.setdefault('script', '')
        kw.setdefault('checks', [])
        kw.setdefault('systems', [])
        kw.setdefault('articleRefs', [])
        kw.setdefault('faqRefs', [])
        kw.setdefault('custom', {})
        kw['id'] = unique('step_' + slugify(f'{proc_id} {kw["title"]}', 60), seen_step)
        kw['x'] = 80 + len(steps) * 320
        kw['y'] = 80
        steps.append(kw)
        return kw

    # --- entry: the shared call opening from the diagram header
    entry_sop = ('1. Listen and take notes as the customer explains why they are calling\n'
                 '2. Ask follow-up questions until the reason is clear\n'
                 '3. Confirm the service or information you are about to provide\n'
                 '4. Verify name, address, mobile and email against '
                 '{{var_sys_property}} where the enquiry requires it')
    entry = add_step(
        type='entry', title='Call received',
        departmentId=tax_ids[('Customer Service', 'Customer Service')],
        sop=entry_sop,
        script='Southern Downs Regional Council, this is [name] speaking. How can I help you today?',
        completionTrigger='Reason for the call understood and caller details verified',
        systems=['TechOne'])
    if parsed['preamble']:
        entry['custom']['context'] = apply_retired_terms('\n'.join(parsed['preamble']))[0]

    # --- action steps from the numbered procedure
    if parsed['procedure']:
        for item in parsed['procedure']:
            text = item['text']
            body_lines = [text] + item['extra']
            sop, hits = apply_retired_terms('\n'.join(body_lines))
            retired_hits.update(hits)
            title = re.sub(r'\s*(?::| [-–] ).*$', '', text).strip()
            target = detect_handoff(sop)
            add_step(type='action', title=(title or text)[:60], sop=sop,
                     departmentId=tax_ids[target] if target else cs_tax,
                     responsibleRole=f'{target[1]} officer' if target else 'Customer service officer',
                     escalationPoint=target[0] if target else '',
                     checks=[{'id': f'chk_{i + 1}', 'text': c} for i, c in enumerate(item['checks'])])
    else:
        sop, hits = apply_retired_terms('\n'.join(parsed['preamble']) or name)
        retired_hits.update(hits)
        target = detect_handoff(sop)
        add_step(type='action', title=name[:60], sop=sop,
                 departmentId=tax_ids[target] if target else cs_tax,
                 responsibleRole=f'{target[1]} officer' if target else 'Customer service officer')

    # The call script sits on the first action step, where the officer needs it.
    if parsed['script'] and len(steps) > 1:
        steps[1]['script'] = '\n\n'.join(parsed['script'])

    # Context articles attach to the first action step rather than the entry.
    if parsed['articleRefs'] and len(steps) > 1:
        steps[1]['articleRefs'] = ['art_' + slugify(k) for k in parsed['articleRefs']]

    # --- resolution inferred from what the node tells the officer to do
    res_title, res_sop = infer_resolution(node['body'])
    res_target = detect_handoff(node['body']) if 'Transferred' in res_title else None
    add_step(type='resolution', title=res_title, sop=res_sop,
             departmentId=tax_ids[res_target] if res_target else cs_tax,
             completionTrigger='Call closed. "Is there anything else I can help you with today?"')

    for a, b in zip(steps, steps[1:]):
        connections.append({'id': f'conn_{len(connections) + 1}', 'from': a['id'],
                            'to': b['id'], 'condition': ''})

    # --- issues: things a human must decide
    def issue(note, severity, step_id=None):
        issues.append({'id': f'iss_{len(issues) + 1}', 'stepId': step_id, 'note': note,
                       'severity': severity, 'raised': TODAY, 'raisedBy': 'Migration'})

    if retired_hits:
        issue('Content referenced Merit. The system name now resolves to the CRM '
              'variable, but the surrounding wording still describes the Merit '
              'workflow and needs rewriting for the CRM (request ID sent by SMS '
              'by default).', 'high')
    for warning in parsed['warnings']:
        issue('Flagged in the source content: ' + warning, 'medium')
    if node['id'] in DISPUTE_OVERRIDES:
        issue(f'Department assigned by the migration as a guess ({dept} / {sub}). '
              'Disputes split between Regulatory, Governance and Local Laws '
              'depending on their nature — confirm.', 'low')
    if not parsed['procedure']:
        issue('No numbered procedure in the source, so this imported as a single '
              'action step. Needs breaking into real steps.', 'medium')

    return {
        'id': proc_id,
        'name': name,
        'taxonomyId': tax_id,
        'status': 'draft',
        'owner': '',
        'lastReviewed': '',
        'purpose': plain(node['branch']),
        'entryPoint': 'Phone',
        'resolutionDefinition': res_sop,
        'steps': steps,
        'connections': connections,
        'issues': issues,
        'articleRefs': [],
        'faqRefs': [],
        'canvas': {'cardDetail': 'default'},
        'created': TODAY,
        'updated': TODAY,
        'custom': {'sourceNode': node['id'], 'sourceSection': section,
                   'references': [apply_retired_terms(r)[0] for r in parsed['references']]},
    }


def build_articles(contexts, node_section, tax_ids, seen):
    articles = []
    for c in contexts:
        lines = re.split(r'<br\s*/?>', c['label'])
        title = plain(lines[0]).replace('\U0001F4D6', '').strip()
        if ' — ' in title:
            title = title.split(' — ', 1)[-1].strip()
        body = '<br/>'.join(lines[1:]).strip()
        body, _ = apply_retired_terms(body)

        section = node_section.get(c['parentId'])
        dept, sub = (DISPUTE_OVERRIDES.get(c['parentId'])
                     or (SECTION_MAP.get(section) if section else None)
                     or ('Customer Service', 'Customer Service'))

        articles.append({
            'id': unique('art_' + slugify(c['key']), seen),
            'title': title or c['key'],
            'summary': '',
            'body': body,
            'audience': 'internal',
            'ownerId': tax_ids[(dept, sub)],
            'status': 'draft',
            'lastReviewed': '',
            'tags': [section] if section else [],
            'internal': True,
        })
    return articles


# -------------------------------------------------------------------- main

def main():
    if not os.path.exists(SOURCE):
        sys.exit(f'Cannot find {SOURCE}. Run this from the repository root.')

    sections, contexts = read_source()

    def load(name):
        with open(os.path.join(DATA_DIR, name), encoding='utf-8') as fh:
            return json.load(fh)

    processes_file = load('processes.json')
    library = load('library.json')
    variables_file = load('variables.json')

    # ---- taxonomy: add Works, then a sub-department per section
    taxonomy = processes_file['taxonomy']
    by_name = {n['name']: n for n in taxonomy if n['parentId'] is None}
    for name in EXTRA_DEPARTMENTS:
        if name not in by_name:
            node = {'id': 'tax_' + slugify(name), 'name': name, 'parentId': None,
                    'order': len(by_name) + 1, 'collapsed': False}
            taxonomy.append(node)
            by_name[name] = node

    wanted = {t for t in (set(SECTION_MAP.values()) | set(DISPUTE_OVERRIDES.values()))}
    wanted |= {(d, sb) for _, d, sb in HANDOFF_TARGETS if sb}
    wanted.add(('Customer Service', 'Customer Service'))
    tax_ids = {}
    for dept, sub in sorted(wanted):
        parent = by_name[dept]
        sub_id = 'tax_' + slugify(f'{dept} {sub}')
        if not any(n['id'] == sub_id for n in taxonomy):
            taxonomy.append({'id': sub_id, 'name': sub, 'parentId': parent['id'],
                             'order': len([n for n in taxonomy
                                           if n['parentId'] == parent['id']]) + 1,
                             'collapsed': False})
        tax_ids[(dept, sub)] = sub_id
    for name, node in by_name.items():
        tax_ids[(name, None)] = node['id']

    # ---- processes
    node_section = {}
    seen_proc, seen_step = set(), set()
    processes = []
    for section, body in sections.items():
        if section not in SECTION_MAP:
            print(f'  skipping unmapped section: {section}')
            continue
        for node in leaf_nodes(body):
            node_section[node['id']] = section
            processes.append(build_process(node, section, tax_ids, seen_proc, seen_step))

    # ---- articles
    articles = build_articles(contexts, node_section, tax_ids, set())

    # ---- resolve article references now that real ids exist
    valid = {a['id'] for a in articles}
    dangling = 0
    for p in processes:
        for s in p['steps']:
            kept = [r for r in s['articleRefs'] if r in valid]
            dangling += len(s['articleRefs']) - len(kept)
            s['articleRefs'] = kept

    # ---- internal system variables
    existing = {v['id'] for v in variables_file['variables']}
    cs_id = tax_ids[('Customer Service', 'Customer Service')]
    added = 0
    for var_id, value, question in SYSTEM_VARIABLES:
        if var_id in existing:
            continue
        variables_file['variables'].append({
            'id': var_id, 'question': question, 'value': value, 'type': 'system',
            'ownerId': cs_id, 'note': '', 'internal': True, 'status': 'pending',
            'lastVerified': '', 'verifiedBy': '',
        })
        added += 1

    # ---- FAQ questions inherit their tab's department
    tab_dept = {
        'rural': 'Building', 'urban': 'Building', 'removal': 'Building',
        'planning': 'Planning', 'animals': 'Local Laws', 'pests': 'Regulatory',
        'weeds': 'Regulatory', 'water': 'Water', 'waste': 'Waste',
        'roads': 'Works', 'disputes': 'Governance', 'payments': 'Revenue',
        'nppr': 'Revenue', 'tourism': 'Parks and Recreation',
    }
    owned = 0
    for f in library['faqs']:
        if f.get('ownerId'):
            continue
        dept = tab_dept.get((f.get('publish') or {}).get('tabId'))
        if dept and dept in by_name:
            f['ownerId'] = by_name[dept]['id']
            owned += 1

    # ---- write
    processes_file['taxonomy'] = taxonomy
    processes_file['processes'] = processes
    processes_file['version'] = processes_file.get('version', 1) + 1
    processes_file['updated'] = TODAY
    library['articles'] = articles
    library['version'] = library.get('version', 1) + 1
    library['updated'] = TODAY
    variables_file['version'] = variables_file.get('version', 1) + 1
    variables_file['updated'] = TODAY

    for name, payload in (('processes.json', processes_file),
                          ('library.json', library),
                          ('variables.json', variables_file)):
        path = os.path.join(DATA_DIR, name)
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        print(f'  wrote {path:<34} {os.path.getsize(path) / 1024:7.0f} KB')

    steps = sum(len(p['steps']) for p in processes)
    issues = sum(len(p['issues']) for p in processes)
    crossing = sum(1 for p in processes
                   if len({s['departmentId'] for s in p['steps']}) > 1)
    handoffs = sum(1 for p in processes for a, b in zip(p['steps'], p['steps'][1:])
                   if a['departmentId'] != b['departmentId'])
    print()
    print(f'  processes           {len(processes):>5}')
    print(f'  steps               {steps:>5}   (avg {steps / max(len(processes), 1):.1f})')
    print(f'  articles            {len(articles):>5}')
    print(f'  taxonomy nodes      {len(taxonomy):>5}')
    print(f'  system variables    {added:>5}   added')
    print(f'  FAQs given an owner {owned:>5}')
    print(f'  issues raised       {issues:>5}')
    print(f'  cross-department    {crossing:>5}   processes touching >1 department')
    print(f'  handoffs            {handoffs:>5}   department changes between steps')
    if dangling:
        print(f'  dropped article refs {dangling:>4}')


if __name__ == '__main__':
    main()
