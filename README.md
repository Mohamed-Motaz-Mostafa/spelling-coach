# Spelling Coach (IELTS)

An offline spelling trainer for IELTS. Open it, listen, type, and the app works out which spelling pattern caused each mistake.

## Start

1. Double-click **`Spelling Coach.html`**. Microsoft Edge is recommended because it has natural British voices.
2. Take the **placement test**: 40 words, about 10 minutes. It finds the patterns you need and sets your starting unit.
3. Every day, press **Start today's practice**. You get due reviews first, then new words from your current unit.

Keep the whole `spelling-coach` folder together: the HTML file needs the `app` and `data` folders next to it.

## What it does

- **About 4,300 words**, each with definitions, example sentences, British pronunciation (IPA), syllables with stress, a word sum (`dis + appear → disappear`), word family and root meanings. The words cover:
  - commonly misspelled words;
  - IELTS Listening topics;
  - the Academic Word List and the New Academic Word List.
- **20 lessons in a fixed order.** Each one teaches a single reliable pattern explicitly before you practise it:
  - hidden syllables and vowel letters (with an Arabic-speaker focus);
  - the suffix rules: doubling, silent e, y→i and no-change;
  - prefixes and hidden double letters;
  - suffix choices: -tion/-sion, -able/-ible, -ance/-ence;
  - ie/ei by word family;
  - silent letters and unstressed vowels;
  - homophones;
  - British vs American spelling;
  - Greek and Latin roots, including the Greek spelling code (ph = /f/, y, ch = /k/, ps-, British ae, -yse);
  - IELTS Listening essentials.
- **Practice is always recall, never copying:**
  - word dictation;
  - IELTS-style sentence dictation, where Exam mode plays the audio only once;
  - building words from their parts.
  - After a mistake you write the word again from memory, and it comes back later in the same session.
- **Roots with meanings.** About 130 Greek and 150 Latin roots, prefixes and endings (`build/curated/roots.json`); about a third of the words show at least one. The word card shows each root's meaning, origin and examples, plus spelling clues:
  - Greek letters: psych has a silent p, its y says /aɪ/ and its ch says /k/.
  - Latin family changes: maintain → maintenance, pronounce → pronunciation, permit → permission.
  - Endings: Latin roots that are not English words take -ible.

  A root is attached only when the evidence confirms it: the Wiktionary etymology, MorphoLex, or, for Latin, the actual Latin source word. So *company* never gets pan-, *apology* never gets -logy and *opportunity* (Latin portus, harbour) never gets port (carry).
- **It remembers your mistakes.** Each one is classified as a sound, letter-pattern or meaning-part error: doubling rule, silent e, suffix choice, silent letter, unstressed vowel, p/b, root spelling and so on. A mistake inside a root is explained by the root ("phon = sound (Greek). ph says /f/"). The **Mistakes** page shows your weakest patterns and lets you practise each pattern with your missed words plus similar words.
- **Spaced reviews.** Words return after 1, 3, 7, 14, 30, 60 and 120 days.
- **Your own words.** Go to Words → *Add a word* or *Add many*. Definitions and examples are filled in automatically, offline from the bundled dictionary or online from Wiktionary. You can edit any word.
- **British spelling is the target.** American spelling is accepted (IELTS accepts both) but flagged, so you stay consistent. You can switch the target in Settings.

## Writing (AI helper)

The **Writing** tab uses Google's Gemini API (free tier) and works in two ways:

- **Dictation from my mistakes.** Pick the words you misspelt, and the AI writes a short text that uses all of them. The app reads it aloud one sentence at a time and you type each whole sentence. Every word is then marked: misspelt (your version shown under it), missed, extra, or a capital-letter slip. Next, you write the missed words again from memory. Misspelt words go back into your reviews and the Mistakes page.
- **IELTS Writing model answers.** Task 1 (line graphs, bar charts, pie charts, tables, process diagrams) and Task 2 (opinion, discussion, advantages/disadvantages, problem/solution, two-part).
  - Each task has a band-9 model answer, notes on why it scores high, and useful phrases.
  - You rewrite the answer by dictation (listen and write) or from memory (read a sentence, hide it, write it), for the whole answer or one paragraph.
  - **New Task 1 / New Task 2** makes a fresh task.
  - **Use my own question** gives a model answer for a question from a book, including a photo of its chart.

Details:

- **Stored outputs.** Everything the AI writes is saved with your progress, so you can practise it again and it goes into your backups.
- **The task bank.** A bank of 20 tasks ships in `data/writing.js` and works offline.
- **Without internet or a key**, the dictation falls back to the example sentences of your words.
- **Free models only, and the daily limits are small.** For example, gemini-3.8-flash allows 20 requests a day per key.
  - Dictation texts start on gemini-3.6-flash (about 3 seconds).
  - Model answers start on gemini-3.8-flash. When it runs out or stops answering, gemini-3.6-flash takes over.
  - The order: try the same model on the second key, then the next model.
  - A model that has used its daily limit is skipped until the reset time Google gives. A model that does not answer is given up after 30 seconds (90 seconds for model answers) and rests for 3 hours.
  - While it works, the app shows which model it is trying. **Cancel** stops waiting.
  - Settings → AI writing helper lists the resting models and when they are back.
- **British spelling.** The AI is told to use British spelling, and any American spellings that slip through are converted. Words like *practice*, *program* and *license* are left alone, because they are also correct British words.
- **API keys** live in `app/ai-keys.local.js`, or in Settings → AI writing helper, which overrides the file. Keys are never put in backups. **Do not share `app/ai-keys.local.js`**: delete it before giving the folder to anyone.
- **Privacy.** On the free tier, Google may use requests to improve its products. The app sends only practice words and IELTS questions.
- **The questions are written in the official IELTS format.** They are not copied from Cambridge books. To practise a real past question, use *Use my own question*.

## Keyboard

| Key | Action |
|---|---|
| Enter | Check / next |
| Shift + Enter | Play the audio again |
| Esc | "I don't know" (shows the word) |

## Voices

Dictation uses your browser's built-in speech.

- **Edge** offers natural online voices such as "Microsoft Sonia Online (Natural) - English (United Kingdom)".
- **For an offline British voice in Windows:** Settings → Time & language → Speech → Manage voices → Add voices → *English (United Kingdom)*. Then restart the browser.
- **To pick a voice or speed:** use Settings → Voice. *Rotate accents* mimics the mix of accents in IELTS recordings.

## Your data and backups

Progress is saved in the browser (localStorage) on this computer. Clearing browser data erases it, so use **Settings → Export backup** regularly; the app reminds you weekly. *Import backup* restores it, including on another computer.

### Sync between phone and computer

The app is also online at its GitHub Pages address, so it opens on a phone. **Settings → Sync between devices** keeps one progress file (`progress.json.gz`) in a *private* GitHub repo:

1. Create a private repo, e.g. `spelling-coach-data`.
2. Create a fine-grained token: only that repo, permission *Contents: Read and write*.
3. On each device, enter your username, the repo and the token, then press *Save and sync now*.

The app syncs when it opens, after each session and when you switch away. Answers from both devices are merged (per word, daily counts added, mistakes combined), not overwritten. The token stays in that browser and is never written into backup files. While sync is on and recent, the weekly backup reminder is hidden.

## The research behind it

The app follows the 7 rules from the video *7 spelling mistakes to avoid*. **Settings → About & the science** shows how each rule maps to a feature, with citations. In short:

- retrieval practice beats copying (Jones et al., 2016);
- spaced practice beats cramming (Cepeda et al., 2006);
- explicit, pattern-based teaching works (Graham & Santangelo, 2014);
- morphology (meaning parts) helps spelling, especially for learners (Bowers, Kirby & Deacon, 2010);
- errors are best analysed as phonological, orthographic or morphological;
- Arabic speakers benefit from extra attention to vowel letters and p/b, f/v (Ryan & Meara, 1991; Deacon, 2017).

## Rebuilding the word database (optional)

The `data` folder is generated. To rebuild it, for example after editing `build/curated/*`, run:

```
build\.venv\Scripts\python build\build_data.py
```

Downloads are cached in `build/raw`, so a rebuild needs no network for cached words. Tests: `node --test tests/*.test.js`.

To add tasks to the IELTS Writing bank, run `node build/gen_writing.js --per-type 3`. The default is 2 tasks per chart type and per essay type. Each task is saved to `build/curated/writing_bank.json` as soon as it arrives, so a re-run only fills the gaps. The script then publishes the bank to `data/writing.js`.

## Folder layout

```
Spelling Coach.html   the app (open this)
app/                  app code (plain JavaScript, works offline)
app/ai-keys.local.js  your Gemini API keys (private, git-ignored - never published)
app/sync.js           phone/computer sync through a private GitHub repo
data/                 generated word database, lessons, dictionary and the IELTS Writing bank
build/                data build: build_data.py, gen_writing.js, curated content, cached downloads
tests/                automated tests (Node)
```

## Data sources and licences

Personal, non-commercial use:

- Open English WordNet 2025 (CC BY 4.0)
- Wiktionary (CC BY-SA 4.0)
- Tatoeba (CC BY 2.0 FR)
- MorphoLex-en (CC BY-NC-SA 4.0)
- New Academic Word List (CC BY-SA 4.0)
- Academic Word List (Coxhead, 2000)
- CMU Pronouncing Dictionary (BSD)
- wordfreq
- Birkbeck spelling error corpus (used only to rank difficulty)

The generated files in `data/` are shared under the same terms (attribution, share-alike, non-commercial).
