#!/usr/bin/env python3
"""
Import FAQ.json into the Process Hub three-file data model.

Reads the published FAQ content and writes:

    processhub/data/variables.json   variables + the department register
    processhub/data/library.json     FAQ questions + publish tabs (+ empty article list)
    processhub/data/processes.json   taxonomy only; processes come from the flowchart import

Run from the repository root:

    python3 processhub/tools/import-faq.py

The script is a one-off migration, but it is written to be re-runnable: it
reads only from FAQ.json and overwrites its outputs completely.
"""

import json
import os
import re
import sys
from datetime import date

SOURCE = 'FAQ.json'
OUT_DIR = os.path.join('processhub', 'data')
TODAY = date.today().isoformat()
SCHEMA = 1
VERSION = 1


def slugify(text, limit=48):
    s = re.sub(r'<[^>]+>', ' ', str(text or ''))
    s = s.lower().strip()
    s = re.sub(r'[^a-z0-9]+', '_', s)
    s = re.sub(r'^_+|_+$', '', s)
    return s[:limit] or 'item'


def unique(base, seen):
    """Return base, or base_2 / base_3 … if base is already taken."""
    if base not in seen:
        seen.add(base)
        return base
    n = 2
    while f'{base}_{n}' in seen:
        n += 1
    out = f'{base}_{n}'
    seen.add(out)
    return out


# ---------------------------------------------------------------- taxonomy

def build_taxonomy(departments):
    """The FAQ department list becomes the top level of the taxonomy.

    Sub-departments are deliberately not created here. They belong with the
    flowchart import, where each one arrives attached to real processes.
    """
    nodes = []
    for i, name in enumerate(departments):
        nodes.append({
            'id': 'tax_' + slugify(name),
            'name': name,
            'parentId': None,
            'order': i + 1,
            'collapsed': False,
        })
    return nodes


# --------------------------------------------------------------- variables

def build_variables(raw):
    """Prefix every variable id with var_ and fill in the new fields."""
    out = []
    id_map = {}
    for v in raw:
        old = v.get('id')
        if not old:
            continue
        new = 'var_' + old
        id_map[old] = new
        out.append({
            'id': new,
            'question': v.get('question', ''),
            'value': '' if v.get('value') is None else str(v['value']),
            'type': v.get('type', 'text'),
            'ownerId': 'tax_' + slugify(v['owner']) if v.get('owner') else '',
            'note': v.get('note', ''),
            # Everything in FAQ.json is published to the public site, so none
            # of it is internal. Internal system names arrive with the
            # flowchart import.
            'internal': False,
            'status': 'pending',
            'lastVerified': '',
            'verifiedBy': '',
        })
    return out, id_map


def rewrite_refs(html, id_map, stats):
    """Point data-var / data-var-href at the new prefixed ids."""
    if not html:
        return html

    def sub_attr(attr):
        def repl(m):
            old = m.group(2)
            if old in id_map:
                stats['rewritten'] += 1
                return f'{m.group(1)}"{id_map[old]}"'
            stats['orphans'].append(old)
            return m.group(0)
        return re.sub(r'(' + attr + r'=)"([^"]*)"', repl, html)

    html = sub_attr('data-var')
    html = sub_attr('data-var-href')
    return html


# ----------------------------------------------------------------- library

def build_library(tabs, id_map, stats):
    """Split each tab into a publish tab plus a flat list of FAQ questions."""
    faqs = []
    publish_tabs = []
    seen_ids = set()

    for tab in tabs:
        tab_id = tab.get('id') or slugify(tab.get('label'))
        publish_tabs.append({
            'id': tab_id,
            'label': tab.get('label', tab_id),
            'new': bool(tab.get('new')),
            'intro': rewrite_refs(tab.get('intro', ''), id_map, stats),
            'footer': rewrite_refs(tab.get('footer', ''), id_map, stats),
            'lastReviewed': tab.get('lastReviewed', ''),
            # Once the matching process exists, set stepperFrom to its id and
            # this literal stepper stops being used.
            'stepperFrom': None,
            'stepper': [
                {'label': s.get('label', ''), 'text': s.get('text', '')}
                for s in tab.get('stepper', []) or []
            ],
        })

        current_group = None
        order = 0
        for item in tab.get('items', []) or []:
            if item.get('type') == 'group':
                current_group = item.get('title', '') or None
                continue

            order += 1
            question = item.get('q', '')
            faqs.append({
                'id': unique('faq_' + slugify(question), seen_ids),
                'q': question,
                'a': rewrite_refs(item.get('a', ''), id_map, stats),
                'publish': {
                    'tabId': tab_id,
                    'order': order,
                    'groupTitle': current_group,
                },
                # The FAQ list carries no owner of its own, so it inherits the
                # tab's subject area at review time rather than being guessed
                # at here.
                'ownerId': '',
                'status': 'published',
                'lastReviewed': tab.get('lastReviewed', ''),
                'internal': False,
            })

    return faqs, publish_tabs


# -------------------------------------------------------------------- main

def main():
    if not os.path.exists(SOURCE):
        sys.exit(f'Cannot find {SOURCE}. Run this from the repository root.')

    with open(SOURCE, encoding='utf-8') as fh:
        data = json.load(fh)

    stats = {'rewritten': 0, 'orphans': []}

    taxonomy = build_taxonomy(data.get('departments', []))
    variables, id_map = build_variables(data.get('variables', []))
    faqs, publish_tabs = build_library(data.get('tabs', []), id_map, stats)

    header = {'schema': SCHEMA, 'version': VERSION, 'updated': TODAY}

    files = {
        'variables.json': dict(header, variables=variables),
        'library.json': dict(header, articles=[], faqs=faqs, publishTabs=publish_tabs),
        'processes.json': dict(header, taxonomy=taxonomy, processes=[]),
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    for name, payload in files.items():
        path = os.path.join(OUT_DIR, name)
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        size = os.path.getsize(path) / 1024
        print(f'  wrote {path:<34} {size:7.0f} KB')

    print()
    print(f'  taxonomy nodes  {len(taxonomy):>5}')
    print(f'  variables       {len(variables):>5}')
    print(f'  FAQ questions   {len(faqs):>5}')
    print(f'  publish tabs    {len(publish_tabs):>5}')
    print(f'  refs rewritten  {stats["rewritten"]:>5}')

    orphans = sorted(set(stats['orphans']))
    if orphans:
        print(f'\n  WARNING: {len(orphans)} reference(s) point at variables that do not exist:')
        for o in orphans:
            print(f'    {o}')
    else:
        print('  orphan refs         0')


if __name__ == '__main__':
    main()
