#!/usr/bin/env python3
"""
Project the Process Hub data back into the legacy FAQ.json shape.

This is the file handed to IT. The published FAQ.html consumes it unchanged,
so the output must match the schema it already expects:

    { "variables": [...], "tabs": [...], "departments": [...] }

Run from the repository root:

    python3 processhub/tools/export-faq.py [--out PATH] [--check]

--check compares the result against the current FAQ.json and reports any
difference, which is how the import is verified as lossless.
"""

import argparse
import json
import os
import re
import sys

DATA_DIR = os.path.join('processhub', 'data')
DEFAULT_OUT = os.path.join('processhub', 'exports', 'FAQ.json')


def load(name):
    with open(os.path.join(DATA_DIR, name), encoding='utf-8') as fh:
        return json.load(fh)


def strip_prefix(html):
    """Return embedded references to their unprefixed published ids."""
    if not html:
        return html
    html = re.sub(r'(data-var=)"var_([^"]*)"', r'\1"\2"', html)
    html = re.sub(r'(data-var-href=)"var_([^"]*)"', r'\1"\2"', html)
    return html


def export_variables(variables, include_internal=False):
    out = []
    for v in variables:
        if v.get('internal') and not include_internal:
            continue
        item = {
            'id': v['id'][4:] if v['id'].startswith('var_') else v['id'],
            'question': v.get('question', ''),
            'value': v.get('value', ''),
        }
        owner = v.get('ownerId', '')
        if owner:
            item['owner'] = OWNER_NAMES.get(owner, owner)
        if v.get('type') and v['type'] != 'text':
            item['type'] = v['type']
        if v.get('note'):
            item['note'] = v['note']
        out.append(item)
    return out


def export_tabs(publish_tabs, faqs, processes):
    by_tab = {}
    for f in faqs:
        if f.get('internal'):
            continue
        tab_id = (f.get('publish') or {}).get('tabId')
        if tab_id:
            by_tab.setdefault(tab_id, []).append(f)

    tabs = []
    for tab in publish_tabs:
        out = {'id': tab['id'], 'label': tab['label']}
        if tab.get('new'):
            out['new'] = True
        if tab.get('intro'):
            out['intro'] = strip_prefix(tab['intro'])

        stepper = tab.get('stepper') or []
        if tab.get('stepperFrom'):
            stepper = stepper_from_process(tab['stepperFrom'], processes) or stepper
        if stepper:
            out['stepper'] = [{'label': s['label'], 'text': s['text']} for s in stepper]

        items = []
        current_group = None
        for f in sorted(by_tab.get(tab['id'], []), key=lambda x: x['publish'].get('order', 0)):
            group = f['publish'].get('groupTitle')
            if group and group != current_group:
                items.append({'type': 'group', 'title': group})
                current_group = group
            items.append({'type': 'faq', 'q': f['q'], 'a': strip_prefix(f['a'])})
        out['items'] = items

        if tab.get('footer'):
            out['footer'] = strip_prefix(tab['footer'])
        if tab.get('lastReviewed'):
            out['lastReviewed'] = tab['lastReviewed']
        tabs.append(out)
    return tabs


def stepper_from_process(process_id, processes):
    """Generate a public stepper from a process's steps, in connection order."""
    proc = next((p for p in processes if p['id'] == process_id), None)
    if not proc:
        return None
    steps = [s for s in proc.get('steps', []) if s.get('type') != 'decision']
    return [
        {'label': f'STEP {i + 1}', 'text': s.get('title', '')}
        for i, s in enumerate(steps)
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=DEFAULT_OUT)
    ap.add_argument('--check', metavar='PATH', nargs='?', const='FAQ.json',
                    help='compare the result against an existing FAQ.json')
    args = ap.parse_args()

    variables_file = load('variables.json')
    library = load('library.json')
    processes_file = load('processes.json')

    global OWNER_NAMES
    OWNER_NAMES = {n['id']: n['name'] for n in processes_file.get('taxonomy', [])}

    result = {
        'variables': export_variables(variables_file['variables']),
        'tabs': export_tabs(library['publishTabs'], library['faqs'],
                            processes_file.get('processes', [])),
        'departments': [n['name'] for n in processes_file.get('taxonomy', [])
                        if n.get('parentId') is None],
    }

    if args.check:
        with open(args.check, encoding='utf-8') as fh:
            original = json.load(fh)
        ok = compare(original, result)
        sys.exit(0 if ok else 1)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f'wrote {args.out} ({os.path.getsize(args.out) / 1024:.0f} KB)')


def compare(a, b):
    """Report any difference between the original and the round-tripped result."""
    problems = []
    notices = []

    # A department added since the original is an intended change, not a loss.
    # One that disappeared is a regression.
    was, now = a.get('departments', []), b.get('departments', [])
    dropped = [d for d in was if d not in now]
    added = [d for d in now if d not in was]
    if dropped:
        problems.append(f'departments lost: {dropped}')
    if [d for d in now if d in was] != [d for d in was if d in now]:
        problems.append(f'department order changed:\n  was {was}\n  now {now}')
    if added:
        notices.append(f'departments added since the original: {added}')

    va = {v['id']: v for v in a.get('variables', [])}
    vb = {v['id']: v for v in b.get('variables', [])}
    for missing in sorted(set(va) - set(vb)):
        problems.append(f'variable lost: {missing}')
    for added in sorted(set(vb) - set(va)):
        problems.append(f'variable added: {added}')
    for key in sorted(set(va) & set(vb)):
        if va[key] != vb[key]:
            problems.append(f'variable changed: {key}\n  was {va[key]}\n  now {vb[key]}')

    ta = {t['id']: t for t in a.get('tabs', [])}
    tb = {t['id']: t for t in b.get('tabs', [])}
    if list(ta) != list(tb):
        problems.append(f'tab order differs:\n  was {list(ta)}\n  now {list(tb)}')
    for key in [k for k in ta if k in tb]:
        for field in ('label', 'new', 'intro', 'footer', 'lastReviewed', 'stepper'):
            if ta[key].get(field) != tb[key].get(field):
                problems.append(f'tab {key}: field "{field}" differs')
        ia, ib = ta[key].get('items', []), tb[key].get('items', [])
        if len(ia) != len(ib):
            problems.append(f'tab {key}: {len(ia)} items became {len(ib)}')
            continue
        for i, (x, y) in enumerate(zip(ia, ib)):
            if x != y:
                label = x.get('q') or x.get('title') or ''
                problems.append(f'tab {key} item {i} differs: {label[:60]}')

    if problems:
        print(f'ROUND TRIP FAILED — {len(problems)} difference(s):\n')
        for p in problems[:40]:
            print('  ' + p.replace('\n', '\n  '))
        if len(problems) > 40:
            print(f'  … and {len(problems) - 40} more')
        return False

    print('ROUND TRIP CLEAN — no published content was lost')
    print(f'  {len(b["variables"])} variables, {len(b["tabs"])} tabs, '
          f'{sum(len(t["items"]) for t in b["tabs"])} items')
    for n in notices:
        print(f'  note: {n}')
    return True


if __name__ == '__main__':
    OWNER_NAMES = {}
    main()
