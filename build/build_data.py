#!/usr/bin/env python3
"""Build the Spelling Coach data files from open datasets plus the hand-curated files.

Outputs (in ../data): words.js (core vocabulary), lessons.js (units + lists), lexicon.js (big
dictionary for adding words and real-word detection). Downloads are cached in build/raw.

Usage:  build\\.venv\\Scripts\\python build\\build_data.py [--select-only] [--no-fetch]
"""
import bz2
import collections
import csv
import datetime
import functools
import glob
import heapq
import html
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import openpyxl
import pyphen
from wordfreq import zipf_frequency

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(HERE, 'raw')
CUR = os.path.join(HERE, 'curated')
OUT = os.path.join(ROOT, 'data')
WIKT = os.path.join(RAW, 'wikt')
UA = 'SpellingCoachBuilder/1.0 (offline personal IELTS spelling trainer; non-commercial)'


@functools.lru_cache(maxsize=None)
def z(word):
    return zipf_frequency(word, 'en')


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def read_json(name, base=CUR):
    with open(os.path.join(base, name), encoding='utf-8') as f:
        return json.load(f)


def read_lines(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as f:
        return [ln.rstrip('\n') for ln in f if ln.strip() and not ln.startswith('#')]


# ----------------------------------------------------------------------------- sources

def load_wordnet():
    syn, ent = {}, {}
    for f in glob.glob(os.path.join(RAW, 'wn', '*.json')):
        base = os.path.basename(f)
        if base.split('.')[0] in ('noun', 'verb', 'adj', 'adv'):
            with open(f, encoding='utf-8') as fh:
                syn.update(json.load(fh))
        elif base.startswith('entries-'):
            with open(f, encoding='utf-8') as fh:
                ent.update(json.load(fh))
    return ent, syn


WN_POS = {'n': 'noun', 'v': 'verb', 'a': 'adjective', 's': 'adjective', 'r': 'adverb'}


def wn_text(x):
    return x if isinstance(x, str) else (x.get('text') or '')


def wn_info(lemma, ent, syn):
    e = ent.get(lemma)
    if not e:
        return None
    best_pos = max(e.keys(), key=lambda p: len(e[p].get('sense', [])))
    order = [best_pos] + [p for p in e if p != best_pos]
    senses, ipa_gb, ipa_any = [], None, None
    for p in order:
        for pr in e[p].get('pronunciation', []):
            if pr.get('variety') == 'GB' and not ipa_gb:
                ipa_gb = pr['value']
            elif not ipa_any:
                ipa_any = pr['value']
        for s in e[p].get('sense', []):
            ss = syn.get(s['synset'])
            if ss:
                senses.append((WN_POS.get(p, p), ss['definition'][0], [wn_text(x) for x in ss.get('example', [])]))
    return {'senses': senses, 'pos': WN_POS.get(best_pos, best_pos), 'ipa': ipa_gb or ipa_any, 'ipa_gb': bool(ipa_gb)}


def load_morpholex():
    cache = os.path.join(RAW, 'morpholex.json')
    if os.path.exists(cache):
        with open(cache, encoding='utf-8') as f:
            return json.load(f)
    log('reading MorphoLex workbook (one-off, slow)...')
    wb = openpyxl.load_workbook(os.path.join(RAW, 'morpholex.xlsx'), read_only=True)
    ml = {}
    for name in wb.sheetnames:
        if not re.match(r'^\d-\d-\d$', name):
            continue
        p, _, s = map(int, name.split('-'))
        hdr = None
        for r in wb[name].iter_rows(values_only=True):
            if hdr is None:
                if r and 'Word' in r:
                    hdr, seg = r.index('Word'), r.index('MorphoLexSegm')
                continue
            w, sg = r[hdr], r[seg]
            if isinstance(w, str) and isinstance(sg, str):
                ml[w.lower()] = [p, s, re.findall(r'\(([^()]+)\)', sg), sg]
    with open(cache, 'w', encoding='utf-8') as f:
        json.dump(ml, f)
    return ml


def load_birkbeck():
    targets, cur = collections.defaultdict(set), None
    for path in (os.path.join(RAW, 'birkbeck.dat'), os.path.join(RAW, 'wikipedia_missp.dat')):
        with open(path, encoding='latin-1') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                if line.startswith('$'):
                    cur = line[1:].replace('_', ' ')
                elif cur:
                    targets[cur].add(line.replace('_', ' '))
    with open(os.path.join(RAW, 'wiki_for_machines.txt'), encoding='utf-8') as f:
        for m in re.finditer(r'^([^\s>]+)->(.+)$', f.read(), re.M):
            for corr in m.group(2).split(','):
                targets[corr.strip()].add(m.group(1).strip())
    return targets


def load_wiki_common():
    with open(os.path.join(RAW, 'wiki_commonly_misspelled.txt'), encoding='utf-8') as f:
        txt = f.read()
    return [w.strip() for w in re.findall(r'^\*\s*([A-Za-z][A-Za-z\-\']+)\s*[–-]', txt, re.M)]


def load_awl():
    with open(os.path.join(RAW, 'awl_simplewikt.txt'), encoding='utf-8') as f:
        txt = f.read()
    out, sub = [], 0
    for line in txt.splitlines():
        m = re.match(r'=== Sublist (\d+) ===', line)
        if m:
            sub = int(m.group(1))
            continue
        if line.startswith('=='):
            sub = 0 if 'Other' in line else sub
        if sub:
            for w in re.findall(r'\[\[([^\]|]+)', line):
                out.append((w.strip().lower(), sub))
    return out


def load_nawl():
    defs, forms = {}, {}
    with open(os.path.join(RAW, 'nawl_defs.csv'), encoding='utf-8-sig', errors='replace') as f:
        for row in csv.reader(f):
            if row and row[0] and row[0] != 'Meanings' and len(row) > 1:
                defs[row[0].strip().lower()] = (row[1].strip().rstrip(';').strip(), row[2].strip() if len(row) > 2 else '')
    with open(os.path.join(RAW, 'nawl_lemmas.csv'), encoding='utf-8-sig', errors='replace') as f:
        for row in csv.reader(f):
            row = [c.strip().lower() for c in row if c.strip()]
            if row:
                forms[row[0]] = row[1:]
    return defs, forms


def load_cmu_stress():
    stress = {}
    with open(os.path.join(RAW, 'cmudict.dict'), encoding='utf-8') as f:
        for line in f:
            parts = line.split()
            if not parts or '(' in parts[0]:
                continue
            vowels = [p for p in parts[1:] if p[-1].isdigit()]
            if vowels:
                stress[parts[0]] = [int(v[-1]) for v in vowels]
    return stress


# ----------------------------------------------------------------------------- Wiktionary

def wikt_path(word):
    return os.path.join(WIKT, urllib.parse.quote(word.lower(), safe='') + ('__C' if word != word.lower() else '') + '.json')


def fetch_wiktionary(words):
    os.makedirs(WIKT, exist_ok=True)
    todo = [w for w in dict.fromkeys(words) if not os.path.exists(wikt_path(w))]
    if not todo:
        return
    log(f'fetching {len(todo)} Wiktionary entries (cached afterwards)...')

    def get(word):
        url = 'https://en.wiktionary.org/api/rest_v1/page/definition/' + urllib.parse.quote(word.replace(' ', '_'), safe='')
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = r.read()
                with open(wikt_path(word), 'wb') as fh:
                    fh.write(data)
                return 'ok'
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    with open(wikt_path(word), 'w', encoding='utf-8') as fh:
                        json.dump({'_missing': True}, fh)
                    return 'missing'
                time.sleep(3 * (attempt + 1))
            except Exception:
                time.sleep(3 * (attempt + 1))
        return 'fail'

    done = collections.Counter()
    with ThreadPoolExecutor(max_workers=8) as ex:
        for i, res in enumerate(ex.map(get, todo), 1):
            done[res] += 1
            if i % 500 == 0:
                log(f'  {i}/{len(todo)} {dict(done)}')
    log(f'  Wiktionary done: {dict(done)}')


TAG_RX = re.compile(r'<[^>]+>')
NESTED_RX = re.compile(r'<(ol|ul|dl)\b.*?</\1>', re.S)
BAD_LABEL = re.compile(r'\b(obsolete|archaic|dated|rare|dialect|dialectal|slang|vulgar|offensive|nonstandard|derogatory|'
                       r'euphemistic|historical|uncommon|Internet|nautical|heraldry|poetic|eye dialect|ethnic slur|'
                       r'humorous|chiefly US|US|Canada|Australia|New Zealand|Scotland|Ireland|South Africa|India|'
                       r'Philippines|Jamaica|Singapore|Hong Kong|Malaysia|Nigeria|Caribbean)\b')
FORM_OF = re.compile(r'^(simple past|past participle|present participle|plural|third-person singular|comparative|'
                     r'superlative|alternative spelling|alternative form|standard spelling|british spelling|'
                     r'non-oxford british spelling|oxford british spelling|american spelling|uk spelling|us spelling|'
                     r'commonwealth spelling|alternative letter-case form|nonstandard spelling|misspelling)'
                     r'(?:[^.;]*?)\bof ([A-Za-z][A-Za-z\'\-]*)', re.I)


def clean_html(s):
    s = NESTED_RX.sub(' ', s or '')
    s = TAG_RX.sub('', s)
    s = html.unescape(s)
    return re.sub(r'\s+', ' ', s).strip()


def strip_labels(s):
    labels = []
    while s.startswith('('):
        m = re.match(r'^\(([^()]*)\)\s*', s)
        if not m:
            break
        labels.append(m.group(1))
        s = s[m.end():]
    return s, ' '.join(labels)


def wikt_entries(word):
    p = wikt_path(word)
    if not os.path.exists(p):
        return []
    try:
        with open(p, encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return []
    out = []
    for pos_block in data.get('en', []) or []:
        pos = (pos_block.get('partOfSpeech') or '').lower()
        if pos in ('proper noun', 'letter', 'symbol', 'prefix', 'suffix', 'abbreviation', 'initialism', 'contraction') and word.islower():
            continue
        for d in pos_block.get('definitions', []):
            raw = clean_html(d.get('definition', ''))
            if not raw:
                continue
            text, labels = strip_labels(raw)
            if not text or BAD_LABEL.search(labels):
                continue
            exs = [clean_html(x) for x in (d.get('examples') or [])]
            out.append({'pos': pos, 'd': text, 'labels': labels, 'ex': [e for e in exs if e]})
    return out


def form_of(defn):
    m = FORM_OF.match(defn)
    if not m:
        return None
    return m.group(1).lower(), m.group(2)


# ----------------------------------------------------------------------------- kaikki.org (Wiktextract)
# The same Wiktionary content as structured JSON, served as static files (the Wiktionary REST API
# rate-limits bulk use). One .jsonl file per word, one line per part of speech.

KAIKKI = os.path.join(RAW, 'kaikki')
K_POS = {'adj': 'adjective', 'adv': 'adverb', 'prep': 'preposition', 'conj': 'conjunction', 'det': 'determiner',
         'pron': 'pronoun', 'num': 'number', 'intj': 'interjection', 'name': 'proper noun'}
K_SKIP_POS = {'prefix', 'suffix', 'abbrev', 'symbol', 'character', 'phrase', 'proverb', 'contraction', 'infix', 'affix'}
K_BAD_TAGS = {'obsolete', 'archaic', 'dated', 'rare', 'dialectal', 'slang', 'vulgar', 'offensive', 'nonstandard',
              'derogatory', 'euphemistic', 'historical', 'uncommon', 'humorous', 'Internet', 'poetic', 'misspelling'}
# "UK standard spelling of analyze", "simple past and past participle of occur", ...
GLOSS_FORM_OF = re.compile(r"^[^.;:()]{0,70}?\b(spelling|form|participle|tense|plural|comparative|superlative)"
                           r"(?: form)? of ([A-Za-z][A-Za-z'\-]*)\s*\.?$", re.I)


def kaikki_path(word):
    return os.path.join(KAIKKI, urllib.parse.quote(word.lower(), safe='') + ('__C' if word != word.lower() else '') + '.jsonl')


def fetch_kaikki(words):
    os.makedirs(KAIKKI, exist_ok=True)
    todo = [w for w in dict.fromkeys(words) if w and not os.path.exists(kaikki_path(w))]
    if not todo:
        return
    log(f'fetching {len(todo)} entries from kaikki.org (cached afterwards)...')

    def get(word):
        url = ('https://kaikki.org/dictionary/English/meaning/' + urllib.parse.quote(word[0], safe='') + '/' +
               urllib.parse.quote(word[:2], safe='') + '/' + urllib.parse.quote(word, safe='') + '.jsonl')
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=40) as r:
                    data = r.read()
                with open(kaikki_path(word), 'wb') as fh:
                    fh.write(data)
                return 'ok'
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    with open(kaikki_path(word), 'w', encoding='utf-8') as fh:
                        fh.write('')
                    return 'missing'
                time.sleep(2 * (attempt + 1))
            except Exception:
                time.sleep(2 * (attempt + 1))
        return 'fail'

    done = collections.Counter()
    with ThreadPoolExecutor(max_workers=8) as ex:
        for i, res in enumerate(ex.map(get, todo), 1):
            done[res] += 1
            if i % 500 == 0:
                log(f'  {i}/{len(todo)} {dict(done)}')
    log(f'  kaikki done: {dict(done)}')


def _kaikki_lines(word):
    p = kaikki_path(word)
    if not os.path.exists(p):
        return []
    out = []
    with open(p, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    return out


@functools.lru_cache(maxsize=None)
def kaikki_greek(word):
    """True when the cached Wiktionary etymology traces the word to (Ancient) Greek."""
    for d in _kaikki_lines(word):
        if 'Greek' in (d.get('etymology_text') or ''):
            return True
        for tp in d.get('etymology_templates') or []:
            a = tp.get('args') or {}
            if a.get('2') == 'grc' or str(a.get('3', '')).startswith('grc:'):
                return True
    return False


AFFIX_TEMPLATES = ('af', 'affix', 'surf', 'suffix', 'prefix', 'confix', 'compound', 'com')


def kaikki_parts(word):
    """Parts named by the etymology's affix analysis: misinterpret -> ['mis-', 'interpret'].
    Covers the classic templates (af, surf, ...) and the newer ety/etymon form ({'2': ':af', '3': 'mis-', ...})."""
    out = []
    for d in _kaikki_lines(word):
        for tp in d.get('etymology_templates') or []:
            a = tp.get('args') or {}
            name, kind = tp.get('name'), str(a.get('2', ''))
            if name in AFFIX_TEMPLATES:
                keys = [k for k in a if k.isdigit() and k != '1']
            elif name in ('ety', 'etymon') and kind.lstrip(':') in AFFIX_TEMPLATES:
                keys = [k for k in a if k.isdigit() and int(k) >= 3]
            else:
                continue
            for k in keys:
                v = re.sub(r'<[^>]*>', '', str(a[k])).strip().lower()
                if re.fullmatch(r'-?[a-z]+-?', v):
                    out.append(v)
    return out


def kaikki_bases(word):
    """Base words named by the etymology's affix templates: sympathetic -> sympathy + -etic."""
    return [v for v in kaikki_parts(word) if v.isalpha() and len(v) >= 4]


@functools.lru_cache(maxsize=None)
def kaikki_latin(word, depth=0):
    """Latin etymons named by the cached etymology, accents removed: transport -> 'transporto transportare'.
    Inflected forms use their lemma (producing -> produce) and derived words their bases (transportation -> transport)."""
    out = []
    for d in _kaikki_lines(word):
        for tp in d.get('etymology_templates') or []:
            a = tp.get('args') or {}
            w3 = str(a.get('3', ''))
            if str(a.get('2', '')).startswith('la'):
                out += [w3, str(a.get('4', ''))]
            elif w3.startswith('la:') or w3.startswith('la-'):
                out.append(w3.split(':', 1)[-1])
        if depth == 0:
            for s in d.get('senses') or []:
                for f in s.get('form_of') or []:
                    if f.get('word') and f['word'] != word:
                        out.append(kaikki_latin(f['word'], 1))
    if depth == 0:
        out += [kaikki_latin(b, 1) for b in kaikki_bases(word) if b != word]
    text = re.sub(r'<[^>]*>', '', ' '.join(x for x in out if x))
    return ''.join(c for c in unicodedata.normalize('NFD', text) if not unicodedata.combining(c)).lower()


def form_label(tags, is_alt):
    if is_alt:
        return 'spelling'
    if 'plural' in tags:
        return 'plural of'
    if 'comparative' in tags:
        return 'comparative of'
    if 'superlative' in tags:
        return 'superlative of'
    if 'present' in tags and 'participle' in tags:
        return 'present participle of'
    if 'past' in tags:
        return 'past tense of'
    if 'third-person' in tags or 'singular' in tags:
        return '-s form of'
    return 'form of'


def kaikki_entries(word):
    out = []
    block = 0
    for d in _kaikki_lines(word):
        if d.get('word') != word and d.get('word', '').lower() != word.lower():
            continue
        pos = K_POS.get(d.get('pos'), d.get('pos') or '')
        if pos in K_SKIP_POS or (pos == 'proper noun' and word.islower()):
            continue
        added = False
        for s in d.get('senses', []):
            gl = s.get('glosses') or []
            if not gl:
                continue
            text = gl[-1].strip()          # the most specific gloss (glosses[0] repeats the parent sense)
            tags = set(s.get('tags') or [])
            fo_list = s.get('form_of') or s.get('alt_of') or []
            fo = fo_list[0].get('word') if fo_list else None
            is_alt = bool(s.get('alt_of')) or 'alternative' in tags
            if not fo:
                m = GLOSS_FORM_OF.match(text)
                if m:
                    fo = m.group(2)
                    is_alt = m.group(1).lower() in ('spelling', 'form')
            if (tags & K_BAD_TAGS) and not fo:
                continue
            if fo and ('obsolete' in tags or 'archaic' in tags or 'misspelling' in tags):
                continue
            exs = [e.get('text', '').strip() for e in (s.get('examples') or [])
                   if e.get('text') and e.get('type', 'example') == 'example']
            out.append({'pos': pos, 'd': text, 'ex': exs, 'fo': fo, 'block': block,
                        'label': form_label(tags, is_alt) if fo else ''})
            added = True
        if added:
            block += 1
    return out


def kaikki_ipa(word):
    for d in _kaikki_lines(word):
        for snd in d.get('sounds') or []:
            tg = set(snd.get('tags') or [])
            if snd.get('ipa') and tg & {'Received-Pronunciation', 'UK', 'British'}:
                return snd['ipa'].strip('/[]')
    return None


def unified_entries(word):
    """Definitions from kaikki (preferred) or the cached Wiktionary REST responses."""
    ents = kaikki_entries(word)
    if ents:
        return ents
    out = []
    last_pos, block = None, -1
    for e in wikt_entries(word):
        fo = form_of(e['d'])
        if e['pos'] != last_pos:
            last_pos, block = e['pos'], block + 1
        out.append({'pos': e['pos'], 'd': e['d'], 'ex': e['ex'], 'fo': fo[1] if fo else None, 'block': block,
                    'label': ('spelling' if fo and ('spelling' in fo[0] or 'form' in fo[0]) else (fo[0] + ' of' if fo else ''))})
    return out


# ----------------------------------------------------------------------------- helpers

IRREGULAR = {'children': 'child', 'women': 'woman', 'men': 'man', 'knives': 'knife', 'shelves': 'shelf',
             'criteria': 'criterion', 'phenomena': 'phenomenon', 'bacteria': 'bacterium', 'led': 'lead',
             'paid': 'pay', 'said': 'say', 'laid': 'lay', 'written': 'write', 'forbidden': 'forbid',
             'analyses': 'analysis', 'media': 'medium', 'better': 'good', 'thought': 'think', 'built': 'build',
             'brought': 'bring', 'bought': 'buy', 'taught': 'teach', 'caught': 'catch', 'fought': 'fight', 'sought': 'seek'}


def lemma_candidates(w):
    yield w
    if w in IRREGULAR:
        yield IRREGULAR[w]
    for sfx in ('ing', 'ed', 'es', 's', 'er', 'est', 'ly'):
        if w.endswith(sfx) and len(w) > len(sfx) + 2:
            st = w[:-len(sfx)]
            if st.endswith('i'):
                yield st[:-1] + 'y'
            if len(st) > 2 and st[-1] == st[-2]:
                yield st[:-1]
            yield st + 'e'
            yield st


FORM_LABEL = {'ing': 'present participle of', 'ed': 'past tense of', 'es': 'plural / -s form of', 's': 'plural / -s form of',
              'er': 'comparative of', 'est': 'superlative of', 'ly': 'adverb from'}


# Example sentences on these topics are skipped: a study tool should not carry opinions or upsetting content.
SENSITIVE = re.compile(r"\b(kill\w*|murder\w*|suicide|dead|death|die[sd]?|dying|gun\w*|shoot\w*|sex\w*|drunk\w*|"
                       r"hate\w*|stupid|idiot\w*|fat|ugly|god|jesus|allah|religio\w*|pray\w*|church|mosque|war|wars|"
                       r"hitler|nazi\w*|terror\w*|racis\w*|gay|lesbian|muslim\w*|christian\w*|jews?|jewish|arab|arabs|arabic|arabian|israel\w*|"
                       r"palestin\w*|trump|obama|putin|communis\w*|conservative\w*|liberal\w*|progressive\w*|propaganda|"
                       r"vote[sd]?|voting|election\w*|politician\w*|beer|wine|vodka|cigarette\w*|drug\w*|blood\w*|"
                       r"naked|kiss\w*|girlfriend|boyfriend|divorce\w*|chinglish|labour party)\b", re.I)


def sentence_ok(s, word):
    if not s or len(s) > 180 or not re.match(r'^[A-Z"\']', s) or s[-1] not in '.?!':
        return False
    if re.search(r'citations:|for quotations|see also|see.*:', s, re.I):
        return False
    if SENSITIVE.search(re.sub(r'' + re.escape(word) + r'', ' ', s, flags=re.I)):
        return False
    return re.search(r'\b' + re.escape(word) + r'\b', s, re.I) is not None


def leaks(sentence, word):
    """True if the sentence contains another form of the word that would reveal its spelling."""
    w = word.lower()
    for tok in re.findall(r"[a-z]+", sentence.lower()):
        if tok != w and len(w) >= 5 and tok[:5] == w[:5]:
            return True
    return False


def ipa_syllables(ipa):
    if not ipa or '.' not in ipa:
        return None, None
    syl = [s for s in ipa.split('.') if s]
    st = next((i for i, s in enumerate(syl) if s.startswith('ˈ')), None)
    return len(syl), st


# ----------------------------------------------------------------------------- main

def main():
    select_only = '--select-only' in sys.argv
    no_fetch = '--no-fetch' in sys.argv
    t0 = time.time()

    lessons = read_json('lessons.json')
    confus = read_json('confusables.json')
    silent = read_json('silent_letters.json')
    spellspeak = read_json('spellspeak.json')
    roots = read_json('roots.json')
    insights = {}
    for ln in read_lines(os.path.join(CUR, 'insights.tsv')):
        if '\t' in ln:
            k, v = ln.split('\t', 1)
            insights[k.strip().lower()] = v.strip()
    curated_sent = collections.defaultdict(list)
    for ln in read_lines(os.path.join(CUR, 'sentences.tsv')):
        if '\t' in ln:
            k, v = ln.split('\t', 1)
            curated_sent[k.strip().lower()].append(v.strip())
    curated_def = {}
    for ln in read_lines(os.path.join(CUR, 'definitions.tsv')):
        parts = ln.split('\t')
        if len(parts) >= 3:
            curated_def[parts[0].strip().lower()] = (parts[1].strip(), parts[2].strip())
    topics = collections.OrderedDict()
    for ln in read_lines(os.path.join(CUR, 'ielts_topics.tsv')):
        t, w = ln.split('\t')
        topics.setdefault(t.strip(), []).append(w.strip())
    core = [w.strip() for w in read_lines(os.path.join(CUR, 'core_trouble.txt'))]

    with open(os.path.join(RAW, 'american_spellings.json'), encoding='utf-8') as f:
        us2uk = {k.lower(): v.lower() for k, v in json.load(f).items()}
    with open(os.path.join(RAW, 'british_spellings.json'), encoding='utf-8') as f:
        uk2us = {k.lower(): v.lower() for k, v in json.load(f).items()}
    protect = set()
    for grp in confus['groups']:
        protect.update(x.lower() for x in grp)
    protect.update(['practise', 'practice', 'licence', 'license', 'program', 'programme', 'check', 'cheque',
                    'tire', 'tyre', 'meter', 'metre', 'draft', 'draught', 'disk', 'disc', 'story', 'storey'])
    # Both forms are standard in British English; the second is accepted silently.
    alternatives = {'judgement': ['judgment'], 'acknowledgement': ['acknowledgment'], 'focused': ['focussed'],
                    'benefited': ['benefitted'], 'likeable': ['likable'], 'sizeable': ['sizable'], 'usable': ['useable'],
                    'movable': ['moveable'], 'lovable': ['loveable'], 'cooperate': ['co-operate'],
                    'coordinate': ['co-ordinate'], 'enquiry': ['inquiry'], 'learnt': ['learned'], 'spelt': ['spelled'],
                    'email': ['e-mail'], 'ageing': ['aging'], 'okay': ['ok'], 'alright': ['all right'],
                    'encyclopaedia': ['encyclopedia'], 'archaeology': ['archeology'], 'mediaeval': ['medieval'],
                    'medieval': ['mediaeval'], 'dependant': [], 'focusing': ['focussing']}

    def to_uk(w):
        lw = w.lower()
        if lw in protect:
            return w, None
        if lw in us2uk:
            uk = us2uk[lw]
            return (uk if w.islower() else uk.capitalize()), lw
        return w, (uk2us.get(lw) if lw in uk2us and uk2us[lw] != lw else None)

    # ------------------------------------------------------------------ selection
    log('loading sources...')
    ent, syn = load_wordnet()
    ml = load_morpholex()
    miss = load_birkbeck()
    wiki_common = load_wiki_common()
    awl = load_awl()
    nawl_defs, nawl_forms = load_nawl()
    log(f'wordnet {len(ent)} lemmas, morpholex {len(ml)}, misspelling targets {len(miss)}, awl {len(awl)}, nawl {len(nawl_forms)}')

    words = collections.OrderedDict()   # id -> record

    def add(w, tier, lst=None):
        w = w.strip()
        if not w or not re.match(r"^[A-Za-z][A-Za-z'\-]*$", w):
            return None
        display, usv = to_uk(w)
        wid = display.lower()
        rec = words.get(wid)
        if rec is None:
            rec = words[wid] = {'id': wid, 'w': display, 'us': usv, 'tiers': set(), 'lists': set(), 'units': set()}
        rec['tiers'].add(tier)
        if lst:
            rec['lists'].add(lst)
        if usv and not rec.get('us'):
            rec['us'] = usv
        if display != display.lower() and rec['w'] == rec['w'].lower():
            rec['w'] = display
        return rec

    for u in lessons:
        for w in u['words']:
            r = add(w, 'D')
            if r:
                r['units'].add(u['id'])
        for w in u.get('diagnostic', []):
            add(w, 'D')
    # Corpus targets that are themselves rare or confusing variants (aweful, loosing) are left out.
    exclude = {'artic', 'aweful', 'loosing', 'lightening', 'alright', 'thier', 'untill', 'wether', 'drunkenness'}
    for w in core + wiki_common:
        if w.lower() not in exclude:
            add(w, 'A', 'trouble')
    birk = [t for t, m in miss.items() if t.isalpha() and t.islower() and len(t) >= 7 and 3.0 <= z(t) <= 5.6
            and len(m) >= 5 and t not in exclude and (t in ent or t in ml)]
    for w in birk:
        add(w, 'A', 'trouble')
    for t, ws in topics.items():
        for w in ws:
            add(w, 'B', 'ielts:' + t)
    for w in lessons[19]['words']:
        add(w, 'B', 'ielts:Essentials')

    # Academic: AWL headwords + MorphoLex family members; NAWL lemmas + forms with a spelling change.
    root_index = collections.defaultdict(set)
    for mw, (p, s, rts, sg) in ml.items():
        if mw.isalpha() and z(mw) >= 3.2:
            for r in rts:
                root_index[r].add(mw)
    for head, sub in awl:
        add(head, 'C', f'awl{sub}')
        mlk = uk2us.get(head, head)
        if mlk in ml:
            seg0 = ml[mlk][3]
            # Tie-break on the word: set order changes between runs, which made the selection vary.
            fam = sorted((x for r in ml[mlk][2] for x in root_index.get(r, ())), key=lambda x: (-z(x), x))
            kept = 0
            seen_seg = {seg0}
            for x in fam:
                if kept >= 5:
                    break
                if x == mlk or ml[x][3] in seen_seg:
                    continue
                seen_seg.add(ml[x][3])
                add(x, 'C', f'awl{sub}')
                kept += 1
    for lem, forms in nawl_forms.items():
        add(lem, 'C', 'nawl')
        for fm in forms:
            plain = any(fm == lem + s for s in ('s', 'es', 'ed', 'ing', 'd'))
            if not plain and fm.isalpha() and z(fm) >= 2.5:
                add(fm, 'C', 'nawl')
    log(f'selected {len(words)} words')

    # Bases of inflected/variant forms are fetched too, so "form of X" definitions can be resolved.
    fetch_list = [r['w'] for r in words.values()]
    for r in list(words.values()):
        for cand in list(lemma_candidates(r['id']))[1:]:
            if cand in ent or cand in ml:
                fetch_list.append(cand)
                break
        if r['us']:
            fetch_list.append(r['us'])
    with open(os.path.join(RAW, 'candidates.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(dict.fromkeys(fetch_list)))
    if select_only:
        log('wrote candidates.txt')
        return
    if not no_fetch:
        fetch_kaikki(fetch_list)
        if '--wiktionary' in sys.argv:   # optional extra source; its REST API rate-limits bulk downloads
            fetch_wiktionary(fetch_list)

    # ------------------------------------------------------------------ Tatoeba sentences
    log('scanning Tatoeba sentences...')
    targets = {r['id'] for r in words.values() if "'" not in r['id']}
    NAMES = {'tom', 'mary', 'john', 'sami', 'layla', 'ken', 'jim', 'jack', 'alice', 'bob', 'dan', 'linda', 'yanni',
             'skura', 'ziri', 'rima', 'mennad', 'baya', 'mike', 'emily', 'emma', 'muiriel', 'ben', 'bill', 'george',
             'jane', 'maria', 'nancy', 'tony', 'betty', 'lucy', 'kate', 'fadil', 'dania', 'salima', 'nuja', 'taninna'}
    best_tat = collections.defaultdict(list)
    with bz2.open(os.path.join(RAW, 'eng_sentences.tsv.bz2'), 'rt', encoding='utf-8') as f:
        for line in f:
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 3:
                continue
            s = parts[2].strip()
            if len(s) < 25 or len(s) > 150 or not s[0].isupper() or s[-1] not in '.?!' or re.search(r'[\d"“”()\[\]:;/]', s):
                continue
            toks = re.findall(r"[a-z]+", s.lower())
            n = len(toks)
            if n < 6 or n > 22:
                continue
            hits = targets.intersection(toks)
            if not hits:
                continue
            names = len(NAMES.intersection(toks))
            for w in hits:
                if leaks(s, w) or SENSITIVE.search(re.sub(r'' + w + r'', ' ', s.lower())):
                    continue
                rare = sum(1 for t in toks if t != w and z(t) < 2.8)
                score = -abs(n - 12) * 0.5 - names * 6 - rare * 3 + (2 if s.endswith('.') else 0) - (s.count(',') * 0.5)
                heap = best_tat[w]
                if len(heap) < 3:
                    heapq.heappush(heap, (score, s))
                elif score > heap[0][0]:
                    heapq.heapreplace(heap, (score, s))
    log(f'tatoeba sentences for {len(best_tat)} words')

    # ------------------------------------------------------------------ enrichment
    log('enriching...')
    stress_cmu = load_cmu_stress()
    hyph = pyphen.Pyphen(lang='en_US', left=2, right=2)
    birk_counts = {k.lower(): len(v) for k, v in miss.items()}

    def definitions_for(r):
        wid, display = r['id'], r['w']
        if wid in confus['words']:
            c = confus['words'][wid]
            return c['pos'], [c['d']], [c['ex']]
        if wid in curated_def:
            pos, d = curated_def[wid]
            return pos, [d], []
        defs, exs, pos = [], [], ''
        note = ''
        entries = unified_entries(display) or unified_entries(wid)
        exs = [x for e in entries for x in e['ex']]
        # Resolve "past tense of X" / "UK spelling of X" through the base word (up to three hops:
        # travelled -> traveled -> travel), but only when the word has no meaning of its own.
        # Dictionary order puts the main use first. When that is "past tense of X" (occurred, stopped,
        # biggest), the meaning comes from X; an adjective use of the word itself (limited, interested)
        # is added as the second definition.
        resolved, extra_adj = False, None
        for hop in range(3):
            if not entries:
                break
            first = [e for e in entries if e.get('block', 0) == entries[0].get('block', 0)]
            if not all(e['fo'] for e in first):
                break
            if hop == 0:
                adj = [e for e in entries if not e['fo'] and e['pos'] == 'adjective']
                extra_adj = adj[0]['d'] if adj else None
            label, base = first[0]['label'], first[0]['fo']
            base_entries = unified_entries(base)
            if not base_entries:
                break
            # Match the grammar of the form: "past tense of limit" needs the verb sense of limit.
            want = {'past tense of': 'verb', 'present participle of': 'verb', '-s form of': 'verb',
                    'plural of': 'noun', 'comparative of': 'adjective', 'superlative of': 'adjective'}.get(label)
            pref = [e for e in base_entries if want and e['pos'] == want and not e['fo']]
            if pref:
                base_entries = pref + [e for e in base_entries if e not in pref]
            if label != 'spelling' and not note:
                note = f'{label} {base}: '
            entries = base_entries
            resolved = True
            exs += [x for e in entries for x in e['ex']]

        def tidy(d):
            d = d.strip().rstrip('.')
            # "to give in trust; to put into charge or keeping; ..." -> keep the first clause.
            if len(d) > 90 and ';' in d and d.index(';') >= 12:
                d = d[:d.index(';')]
            return d + '.'
        if entries:
            entries = [e for e in entries if not e['fo']] or entries
            pos = entries[0]['pos']
            first_block = entries[0].get('block', 0)
            limit = 1 if resolved and note else 2
            for e in entries:
                if e['fo'] or len(defs) >= limit or e.get('block', 0) != first_block:
                    continue
                d = tidy(e['d'])
                d = (note + d[0].lower() + d[1:]) if note else d
                if d.lower() not in [x.lower() for x in defs]:
                    defs.append(d)
            if resolved and extra_adj:
                defs = defs[:1] + ['(adjective) ' + tidy(extra_adj)]
                pos = pos or 'adjective'
        if not defs:
            for cand in lemma_candidates(wid):
                info = wn_info(cand, ent, syn)
                if info and info['senses']:
                    lab = ''
                    if cand != wid:
                        sfx = next((s for s in FORM_LABEL if wid.endswith(s)), '')
                        lab = (FORM_LABEL.get(sfx, 'form of') + ' ' + cand + ': ') if sfx else ''
                    pos = info['pos']
                    for p, d, ex in info['senses'][:2]:
                        defs.append(lab + d + '.')
                        exs += ex
                    break
        if wid in nawl_defs and nawl_defs[wid][0]:
            easy = nawl_defs[wid][0].rstrip('.') + '.'
            easy = easy[0].upper() + easy[1:]
            defs = [easy] + [d for d in defs if d.lower() != easy.lower()][:1]
        defs = [d[0].upper() + d[1:] for d in defs if d]
        return pos, defs[:2], exs

    # Greek etymology evidence for the root matcher (app/morphology.js findRoots, run by segment.js):
    # the word itself, a base named in its etymology, or a Greek word it extends (psychology -> psychological).
    greek_direct = {r['id'] for r in words.values() if kaikki_greek(r['w']) or kaikki_greek(r['id'])}
    greek_by_start = collections.defaultdict(list)
    for g in greek_direct:
        greek_by_start[g[:5]].append(g)

    def greek_word(r):
        wid = r['id']
        if wid in greek_direct or any(kaikki_greek(b) for b in kaikki_bases(r['w'])):
            return True
        return any(wid.startswith(g[:max(5, len(g) - 2)]) for g in greek_by_start.get(wid[:5], ()))

    # Latin roots confirmed by the Latin source word itself: transport <- transporto (port = carry),
    # but opportunity <- opportunitas (portus, harbour) gets no port.
    latin_src = {k: re.compile(v['src']) for k, v in roots.items() if v.get('src')}
    by_start = collections.defaultdict(list)
    for w2 in words:
        by_start[w2[:5]].append(w2)

    def latin_roots(r):
        wid = r['id']
        ety = (kaikki_latin(r['w']) + ' ' + kaikki_latin(wid)).strip()
        if not ety:   # no etymology (aggressive): use a listed word it extends (aggression)
            ety = ' '.join(kaikki_latin(g) for g in by_start.get(wid[:5], ())
                           if g != wid and wid.startswith(g[:max(5, len(g) - 2)]))
        found = [k for k, rx in latin_src.items() if k in wid and rx.search(ety)]
        # An English prefix named by the etymology (inter- + view, multi- + national) confirms a Latin prefix.
        lemmas = [wid] + [f['word'] for d in _kaikki_lines(r['w']) for s in (d.get('senses') or [])
                          for f in (s.get('form_of') or []) if f.get('word')]
        for p in {p.rstrip('-') for lm in lemmas for p in kaikki_parts(lm) if p.endswith('-')}:
            if roots.get(p, {}).get('o') == 'Latin' and roots[p].get('k') == 'prefix' and p in wid and p not in found:
                found.append(p)
        return found

    tiers_rank = {'A': 0, 'B': 1, 'D': 2, 'C': 3}
    out_words = []
    seg_input = []
    for r in words.values():
        wid, display = r['id'], r['w']
        pos, defs, wexs = definitions_for(r)
        # Example sentences: curated > Wiktionary usage examples > Tatoeba > WordNet.
        cands = []
        for s in curated_sent.get(wid, []):
            cands.append((100, s))
        for s in wexs:
            if sentence_ok(s, display) and not leaks(s, display) and 5 <= len(s.split()) <= 24:
                cands.append((3 - abs(len(s.split()) - 12) * 0.1, s))
        for sc, s in sorted(best_tat.get(wid, []), reverse=True):
            cands.append((sc * 0.1, s))
        info = None
        for cand in lemma_candidates(wid):
            info = wn_info(cand, ent, syn)
            if info:
                break
        if info and info['senses']:
            for _, _, ex in info['senses'][:3]:
                for s in ex:
                    s2 = s[0].upper() + s[1:] + ('' if s[-1] in '.?!' else '.')
                    if sentence_ok(s2, display) and not leaks(s2, display):
                        cands.append((-2, s2))
        cands.sort(key=lambda x: -x[0])
        exs = []
        for _, s in cands:
            if s not in exs:
                exs.append(s)
            if len(exs) == 2:
                break

        # Pronunciation, syllables and stress.
        winfo = wn_info(wid, ent, syn) or wn_info(r['us'] or '', ent, syn)
        ipa = winfo['ipa'] if winfo and winfo['ipa_gb'] else None
        if not ipa:
            ipa = kaikki_ipa(display) or (winfo['ipa'] if winfo else None)
        if wid in spellspeak:
            syl = spellspeak[wid]
        else:
            syl = hyph.inserted(display, hyphen='·') if len(display) > 4 else display
        nsyl, st = ipa_syllables(ipa)
        if nsyl is None or nsyl != len(syl.split('·')):
            st = None
            cmu = stress_cmu.get((r['us'] or wid).lower())
            if cmu and len(cmu) == len(syl.split('·')) and 1 in cmu:
                st = cmu.index(1)
        ipa_disp = ipa.replace('.', '').strip() if ipa else None

        mlk = (r['us'] or wid)
        mrec = ml.get(mlk) or ml.get(wid)
        # Roots are matched in segment.js; MorphoLex roots (psycho) and prefixes (<sym<) are evidence.
        morphs = (mrec[2] + re.findall(r'<([a-z]+)<', mrec[3])) if mrec else []
        ctx = {'variant': bool(r['us']), 'confusable': wid in protect and wid in confus['words'],
               'silent': wid in silent}
        seg_input.append({'w': wid, 'maxP': mrec[0] if mrec else None, 'maxS': mrec[1] if mrec else None, 'ctx': ctx,
                          'greek': greek_word(r), 'ml': morphs, 'lat': latin_roots(r)})

        # Family from MorphoLex roots.
        fam = []
        if mrec and mrec[2]:
            # Use the main (longest) root only: psychology -> psych-, not the -log- of technology.
            main_root = max(mrec[2], key=len)
            pool = set(root_index.get(main_root, set()))
            seen = {mrec[3]}
            for x in sorted(pool, key=lambda x: (-(to_uk(x)[0].lower() in words), -z(x), x)):
                if x == mlk or ml[x][3] in seen:
                    continue
                seen.add(ml[x][3])
                fam.append(to_uk(x)[0])
                if len(fam) >= 8:
                    break

        nmiss = birk_counts.get(wid, 0) + birk_counts.get(display, 0)
        zf = z(wid)
        k = 0.18 * math.log2(1 + nmiss) + 0.035 * (len(wid) - 6) + 0.06 * (5 - zf)
        rec = {
            'id': wid, 'w': display, 'pos': pos, 'd': defs, 'ex': exs,
            'f': round(zf, 1), 'k': round(max(0.0, min(1.0, k)), 2),
            'l': sorted(r['lists']), 't': min(tiers_rank[t] for t in r['tiers']), 'u': sorted(r['units']),
        }
        if r['us']:
            rec['us'] = r['us']
        alts = alternatives.get(wid)
        if alts:
            rec['alt'] = alts
        if ipa_disp:
            rec['ipa'] = ipa_disp
        if '·' in syl:
            rec['syl'] = syl
            if st is not None:
                rec['st'] = st
        if fam:
            rec['fam'] = fam
        tip = insights.get(wid)
        if tip:
            rec['tip'] = tip
        if wid in silent:
            rec['sil'] = silent[wid]
        if wid in confus['words']:
            rec['cue'] = confus['words'][wid]['cue']
        out_words.append(rec)

    # ------------------------------------------------------------------ morphology via Node
    log('segmenting with app/morphology.js ...')
    lexicon_words = set()
    for lem in ent:
        if re.match(r'^[a-z]+$', lem):
            lexicon_words.add(lem)
    for mw in ml:
        if re.match(r'^[a-z]+$', mw):
            lexicon_words.add(mw)
    for k2, v in us2uk.items():
        if re.match(r'^[a-z]+$', v):
            lexicon_words.add(v)
    lexicon_words.update(r['id'] for r in out_words if re.match(r'^[a-z]+$', r['id']))
    us_set = set(us2uk.keys()) - protect
    freq = {w: round(z(w), 1) for w in lexicon_words}
    seg_in = os.path.join(RAW, 'seg_in.json')
    seg_out = os.path.join(RAW, 'seg_out.json')
    with open(seg_in, 'w', encoding='utf-8') as f:
        json.dump({'words': seg_input, 'lexicon': sorted(lexicon_words), 'freq': freq, 'us': sorted(us_set),
                   'roots': roots}, f)
    subprocess.run(['node', os.path.join(HERE, 'segment.js'), seg_in, seg_out], check=True)
    with open(seg_out, encoding='utf-8') as f:
        segs = json.load(f)

    elision = set(lessons[1]['words']) | set(spellspeak)
    curated_tag = {2: 'vowel-letter', 3: 'consonant-pair', 15: 'schwa', 1: 'elision', 19: 'ielts-listening'}
    for rec in out_words:
        sg = segs.get(rec['id'], {})
        if sg.get('sum'):
            rec['sum'] = sg['sum']
        if sg.get('root'):
            rec['root'] = sg['root']
        tags = list(sg.get('tags', []))
        for uid, tg in curated_tag.items():
            if uid in rec['u'] and tg not in tags:
                tags.append(tg)
        if rec['id'] in elision and 'elision' not in tags:
            tags.append('elision')
        if rec['t'] == 1 and 'ielts-listening' not in tags:
            tags.append('ielts-listening')
        rec['tags'] = tags

    # ------------------------------------------------------------------ units, lists, meta
    by_id = {r['id']: r for r in out_words}
    tag_unit = {}
    for u in lessons:
        for tg in u.get('tags', []):
            tag_unit[tg] = u['id']
    unit_pools = {}
    for u in lessons:
        if u['id'] == 0:
            continue
        cur_ids = [w.lower() for w in u['words'] if w.lower() in by_id]
        cur_ids = list(dict.fromkeys(cur_ids))
        # Keep the authored order: each unit lists its core examples first, contrasts and exceptions last.
        extra = [r['id'] for r in out_words if r['id'] not in cur_ids and set(r['tags']) & set(u.get('tags', []))]
        extra.sort(key=lambda i: (by_id[i]['t'], -by_id[i]['f']))
        unit_pools[u['id']] = {'core': cur_ids, 'more': extra[:250]}

    lists = [{'id': 'trouble', 'name': 'Commonly misspelled words', 'group': 'Core',
              'ids': sorted([r['id'] for r in out_words if 'trouble' in r['l']], key=lambda i: -by_id[i]['k'])}]
    for t in list(topics.keys()) + ['Essentials']:
        ids = [r['id'] for r in out_words if 'ielts:' + t in r['l']]
        if ids:
            lists.append({'id': 'ielts-' + t.lower().replace(' ', '-'), 'name': 'IELTS Listening: ' + t, 'group': 'IELTS Listening', 'ids': ids})
    for sub in range(1, 11):
        ids = sorted([r['id'] for r in out_words if f'awl{sub}' in r['l']], key=lambda i: -by_id[i]['f'])
        lists.append({'id': f'awl{sub}', 'name': f'Academic Word List - Sublist {sub}', 'group': 'Academic', 'ids': ids})
    lists.append({'id': 'nawl', 'name': 'New Academic Word List (NAWL)', 'group': 'Academic',
                  'ids': sorted([r['id'] for r in out_words if 'nawl' in r['l']], key=lambda i: -by_id[i]['f'])})
    for u in lessons[1:]:
        lists.append({'id': f'unit{u["id"]}', 'name': f'Unit {u["id"]}: {u["title"]}', 'group': 'Units',
                      'ids': unit_pools[u['id']]['core']})

    for rec in out_words:
        del rec['l']   # list membership lives in SC_META.lists; keep the per-word record small
    meta = {
        'built': datetime.date.today().isoformat(),
        'count': len(out_words),
        'lists': lists,
        'unitPools': unit_pools,
        'tagUnit': tag_unit,
        'diagnostic': [w.lower() for w in lessons[0]['diagnostic']],
        'diagnosticUnits': lessons[0]['diagnosticUnits'],
        'roots': roots,
        'confusableGroups': confus['groups'],
        'sources': [
            'Open English WordNet 2025 (CC BY 4.0)', 'Wiktionary via its REST API (CC BY-SA 4.0)',
            'Tatoeba example sentences (CC BY 2.0 FR)', 'MorphoLex-en, Sanchez-Gutierrez et al. 2018 (CC BY-NC-SA 4.0)',
            'New Academic Word List 1.2, Browne, Culligan & Phillips (CC BY-SA 4.0)', 'Academic Word List, Coxhead 2000',
            'Birkbeck spelling error corpus, R. Mitton (used only for difficulty ranking)', 'CMU Pronouncing Dictionary (BSD)',
            'wordfreq word frequencies, Robyn Speer (MIT / CC BY-SA)', 'American-British spelling pairs, hyperreality (MIT)']
    }

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'words.js'), 'w', encoding='utf-8') as f:
        f.write('/* Generated by build/build_data.py - do not edit by hand. */\n')
        f.write('window.SC_WORDS=' + json.dumps(out_words, ensure_ascii=False, separators=(',', ':')) + ';\n')
        f.write('window.SC_META=' + json.dumps(meta, ensure_ascii=False, separators=(',', ':')) + ';\n')
    with open(os.path.join(OUT, 'lessons.js'), 'w', encoding='utf-8') as f:
        f.write('/* Generated from build/curated/lessons.json - edit that file and rebuild. */\n')
        f.write('window.SC_LESSONS=' + json.dumps(lessons, ensure_ascii=False, separators=(',', ':')) + ';\n')

    # ------------------------------------------------------------------ lexicon
    log('writing lexicon...')
    lex_defs = {}
    for lem in ent:
        if not re.match(r'^[a-z]+$', lem) or z(lem) < 2.0:
            continue
        info = wn_info(lem, ent, syn)
        if info and info['senses']:
            p, d, ex = info['senses'][0]
            lex_defs[lem] = p[0] + '|' + d[:140] + ('|' + ex[0][:120] if ex else '')
    for k2, v in us2uk.items():
        if k2 in lex_defs and v not in lex_defs and re.match(r'^[a-z]+$', v):
            lex_defs[v] = lex_defs[k2]
    all_words = sorted(lexicon_words | set(lex_defs))
    fq = ''.join(chr(48 + max(0, min(40, int(round(z(w) * 5))))) for w in all_words)
    with open(os.path.join(OUT, 'lexicon.js'), 'w', encoding='utf-8') as f:
        f.write('/* Generated by build/build_data.py from Open English WordNet + MorphoLex (+ UK spellings). */\n')
        f.write('window.SC_LEX={words:' + json.dumps('|'.join(all_words)) + ',fq:' + json.dumps(fq, ensure_ascii=False) +
                ',defs:' + json.dumps(lex_defs, ensure_ascii=False, separators=(',', ':')) +
                ',us:' + json.dumps('|'.join(sorted(us_set))) + '};\n')

    # ------------------------------------------------------------------ report
    def pct(xs, cond):
        return f'{100 * sum(1 for x in xs if cond(x)) / max(1, len(xs)):.0f}%'
    log(f'WORDS: {len(out_words)}  (built in {time.time() - t0:.0f}s)')
    for tname, tv in (('A trouble', 0), ('B ielts', 1), ('D units', 2), ('C academic', 3)):
        xs = [r for r in out_words if r['t'] == tv]
        log(f'  tier {tname:11s} n={len(xs):5d} def={pct(xs, lambda r: r["d"])} ex={pct(xs, lambda r: r["ex"])} '
            f'ipa={pct(xs, lambda r: r.get("ipa"))} sum={pct(xs, lambda r: r.get("sum"))} syl-stress={pct(xs, lambda r: "st" in r)}')
    missing = [r['id'] for r in out_words if r['t'] <= 2 and (not r['d'] or not r['ex'])]
    with open(os.path.join(RAW, 'missing_core.txt'), 'w', encoding='utf-8') as f:
        for r in out_words:
            if r['t'] <= 2 and (not r['d'] or not r['ex']):
                f.write(f"{r['id']}\t{'nodef' if not r['d'] else ''}\t{'noex' if not r['ex'] else ''}\n")
    log(f'core words missing a definition or example: {len(missing)} (see build/raw/missing_core.txt)')
    for name in ('words.js', 'lessons.js', 'lexicon.js'):
        log(f'  data/{name}: {os.path.getsize(os.path.join(OUT, name)) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
