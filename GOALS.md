# Goal, scope and direction (living notes)

**For Claude: read this before any work on the extension, and keep it current.** After every session where the
user gives direction, reports a case, or corrects you, add the case to the casebook (§5), refine the sections it
touches, and note anything still open (§6). These notes are what the user is building towards; POLICY.md is the
spec that follows from them, and the code follows POLICY.md. If something here and the user's latest words
disagree, the user wins: update this file.

## 1. The goal, as the user puts it

- Fix the slips in text people **read** online, the way an attentive, well-read reader would: quietly, and
  showing every change.
- **Be intelligent with context.** Most wrong words aren't wrong on their own. *bases*, *a*, *fastly* are all
  fine words or well-formed shapes; only the words around them show the writer slipped (*on the weekly bases*,
  *a apple*, *falling down fastly*). The extension has to read the way a person does: by sound, by how words are
  built, by which words go together, by sentence, by meaning, by who is writing and where.
- **Don't add phrases; understand classes.** The internet is full of usage nobody has catalogued. Every case the
  user raises is an example of a class. Work out which field of study explains it (linguistics first, but also
  psycholinguistics, typing research, sociolinguistics, NLP), become expert in it, and build sound logic and a
  knowledge base from it, so the engine handles the cases nobody has seen yet.
- **Precision over recall.** A wrong fix is worse than a missed slip; dialect, slang and deliberate style are the
  writer's voice.
- **No single surface cue decides** (the user, 2026-10-27: "Names can be non-capitalised… It needs to be more
  context consideration than just the capitalisation. Further, words in quotes doesn't necessarily exempt. This
  applies to all criteria"). Capitals, quote marks and italics each do several jobs; a guard weighs them with what
  is around them (POLICY.md §4: *What quote marks are doing*, *How names are recognised*), for every kind of change.
- **Plain, friendly categories on the front end.** However technical the reason, the reader sees a short,
  everyday name and a one-line example (§4). Linguistics terms stay in POLICY.md and the code.

## 2. What "context" means: the levels a reader uses

Every case is decided at one (sometimes two) of these levels. Find the level first; it tells you the field, the
evidence to look for, and the category.

| Level | Field / theory | What it decides | Examples |
|---|---|---|---|
| Fingers and keys | Typing-error research (Damerau 1964; Kukich 1992) | Mechanical slips: neighbouring key, swapped or doubled letters, lost space or apostrophe | teh, the the, it s, dont |
| Spelling | Orthography; noisy-channel correction (Kernighan, Church & Gale 1990) | Non-words with one clear target | definately, recieve |
| Sound | Phonology; allomorphy (a form chosen by the next sound) | *a* vs *an* by the next word's first sound, not letter | a apple → an apple; an hour, a university |
| Word building | Morphology: blocking, words-and-rules (Aronoff 1976; Pinker 1999); over-regularisation | A regular ending on a word whose real form is irregular or has none | fastly → fast, goed → went |
| Words that go together | Phraseology and collocation (Firth 1957, "the company it keeps"; Sinclair 1991, the idiom principle) | Fixed frames fix a word's form or choice | on a weekly bases → basis; for all intensive purposes |
| Sentence | Syntax; real-word error correction with confusion sets (Golding & Roth 1999) | Which of two real words the sentence needs | their/there, then/than, could of |
| Reference: names | Onomastics (the study of names); named-entity recognition in NLP; *sensational spelling* in brand names | Whether a word is a name, whose spelling belongs to its owner and is never a slip | Fastly, Lyft, Krispy Kreme, Apple, *Loose Women* (TV show), Fable 5.5, u/some_username |
| Meaning and use | Semantics, pragmatics; use vs mention | Whether a word is being used or talked about, joked with, quoted | "their" is possessive; sarcasm quoting a mistake |
| Writer and setting | Sociolinguistics: register, dialect, online language (Labov; Biber & Conrad; Eisenstein 2013) | Whether a form is a slip or the writer's voice | ive in a lol-comment vs a careful post; y'all; knowed |
| Mind | Error analysis (Corder 1967): mistakes vs errors vs choices; speech-error research | Whether the writer would fix it if they saw it | slips get fixed; systematic choices don't |

## 3. The method for a new case

1. Say what the reader trips over, and why the word is *only* wrong here (if it's wrong everywhere it's a
   misspelling or typo, the easy case).
2. Find the level in §2 and the field behind it. Learn the field's account well enough to state the rule in a
   sentence (e.g. "a stored irregular form blocks the regular ending").
3. Turn that into a class with **evidence that separates slip from style** (frames, sound, dictionary, register,
   dialect, quotes, consistency). Write it into POLICY.md, then `policy.js`/`engine.js`, with tests that include
   the deliberate look-alikes the class must leave alone.
4. Map it to a user-facing category (§4). If none fits, propose a new plain-English one; don't invent jargon.
5. Add the case to the casebook (§5).

## 4. Categories the reader sees

Named by what the reader notices, not by linguistic theory. **The levels in §2 explain *why* a word is wrong and
drive the logic; they are not categories.** The user's correction (2026-10-27): *fastly* "is just a wrong word,
too". A reader doesn't care whether the word was mis-built, mis-chosen or chosen by the wrong sound; they see the
wrong word. So the test for a category is: what would the reader call it?

| Category (UI) | Means, as a reader would say it | Examples | Levels behind it |
|---|---|---|---|
| Wrong word (blue) | Not the word the sentence needs | their → there, then → than, could of → could have, a apple → an apple, fastly → fast, goed → went, on a weekly bases → basis | Sound, word building, words that go together, sentence |
| Misspelling (red) | The right word, spelt wrong | definately → definitely | Spelling |
| Typo (amber) | Slips of the fingers: apostrophes, spaces, doubled words | dont → don't, it s → it's, the the → the | Fingers and keys |
| Your spelling (teal, only when turned on) | Not a mistake: another region's spelling shown in mine. Hover card: a globe and the change, no explanation, nothing struck through; word-only hover: just the globe. Popup: the original plain, with which spelling it was (*US spelling*) | canceled → cancelled, color → colour (UK reader) | Regional standard (POLICY.md §7) |

Before adding a category, check whether a reader would really name it differently from these three. Internally the
finer kinds stay (`mechanism` = `wordform`, rules `article` / `frame` / `wordform`), so the decision trace still
shows which level decided it, and each keeps the guards that fit its original (a non-word like *fastly* is guarded
as a non-word: *we use Fastly* is a company).

### Left alone, with a reason the reader can see

Some classes are never changed. They aren't categories of fixes, but when the reader asks "why didn't it fix
this?", the decision trace gives a plain reason. The biggest is **names** (§4a).

### 4a. Names (scope)

A name refers to one particular thing; its spelling is its owner's choice, not a slip. So no word inside a name is
corrected, and a name is never "the wrong word". What counts as a name:

- people, usernames and handles (u/…, @…), pets and characters;
- companies, brands, shops and organisations, often spelt on purpose (Lyft, Fiverr, Krispy Kreme, Froot Loops)
  or made of ordinary words (Apple, Square, Shell, Fastly);
- products, apps, sites, games, AI models and versions (iPhone, Xbox, Claude, Fable 5.5, GPT-4o);
- titles of works: books, films, songs, shows, podcasts (*Lose Yourself*, *Loose Women*);
- places, buildings, events, teams, parties, ships.

How a name is recognised (layers; any one is enough). Capitals are only one clue: names are often written in
lowercase (casual writing, people's own style), and capitals don't always mark names (headlines, sentence starts).
1. **Shape**, only where the writer uses capitals normally: a capitalised word that doesn't start a sentence (not
   in a Title Case line, and not from a writer who capitalises nothing); capitals inside (iPhone), digits (Web3,
   5.5), ™/®.
2. **Name phrases**: a run of capitalised words; a company ending in any case (Inc, Ltd, LLC, Corp, Labs…).
3. **Frames**, in any case: a handle prefix (@, #, u/, r/); *called, named, nicknamed, aka, username, user,
   handle, follow, shoutout to, feat.* before it.
4. **Neighbours**, where case says nothing: next to a recognised name, it's part of the name (*the kennedy
   center* on a page that names Kennedy).
5. **Markup**: short link text (usernames, titles and brands are usually links).
6. **The page itself** (one sense per discourse): the site's own name and domain (fastly.com → Fastly), and any
   word the page writes as a name elsewhere, lowercase occurrences included.
7. **Known brand spellings** that collide with fix lists (`KNOWN_NAMES` in policy.js): capitalised; lowercase only
   from a writer who doesn't capitalise or in a frame (*we use fastly* in an all-lowercase post; *falling down
   fastly* in careful writing is still the slip).

## 5. Casebook (cases the user raised)

| Case | What was wrong | Level / field | Class and fix | Category |
|---|---|---|---|---|
| *would of* fixed in a casual comment | Same spelling is a slip for some writers, a style for others | Writer and setting (register) | Casual forms judged by register and whether the writer knows the standard (POLICY.md §4) | Wrong word |
| *ive been there… lol* | Dropped apostrophe in casual writing is style | Register | Dropped apostrophes fixed only in careful writing | Typo |
| *lol ngl i dont care* then a tidy paragraph with *dont* | One paragraph can look careful while the writer is casual, and *would've* in one paragraph shows they know the form in the next | Writer and setting (the whole comment) | Register and "knows the standard" read the whole comment, without quotes (Reddit; paragraph elsewhere) | Typo / Wrong word |
| *its OpenAI's fault* | *its* before something that can't be owned | Sentence | `ITS_NOT_OWNED` | Wrong word |
| *is → its* proposed by the AI | No slip turns one into the other | Mechanism (error analysis) | Unexplained swaps never made; repaired to a real slip source | — |
| *an apple → a apple* (AI) | Article must follow the next sound | Sound (allomorphy) | `articleFor`; any a/an edit against it is blocked | Wrong word |
| *falling down fastly* | Regular *-ly* on a flat adverb | Word building (blocking) | `FLAT_ADVERBS`, `REGULARISED` | Wrong word (the user: "just a wrong word"; first shipped as its own Word form category, then folded in) |
| *on the weekly bases* | Plural form inside the singular frame *on a … basis* | Words that go together (collocation) + number | Frame rule (`frameForm`); AI can't change number on its own | Wrong word |
| *For issues were Claude says no* (Reddit), fixed once, then not | The fix was found again after Reddit redrew the comment, then waited for an AI check that never came (paragraph already reviewed); waiting fixes were hidden from the menu | — (a bug, not a language case) | Re-found fixes take the earlier verdicts; nothing waits more than 20 s; waiting fixes show in the menu as "checking with the AI" | Wrong word |
| Fixes show "Checking with the AI" for ~20 s after every refresh, even when the AI already answered (Reddit, *a irony*) | The paragraph was off-screen (~6600 px down): paragraphs go to the AI only when they scroll into view, and the earlier answer wasn't looked up until then. Smaller causes found on the way: AI answers cached only in the worker's memory; text moved into a new element never re-queued; one shared 20 s timer that could stretch to ~41 s | — (a bug, not a language case) | Paragraphs with a waiting fix are checked at once, on screen or not: saved answer first (`peek`, `cacheOnly`), else the AI; answers kept in storage.local; moved text re-queued; timer per fix; timeouts saved, repeat requests share one, waiting fixes ahead of scans, stuck AI restarted (1.7.9–1.7.18; confirmed fixed in Chrome) | — |
| Redo and Apply didn't stay after a refresh; sometimes Apply showed, sometimes Redo | Only undos were saved. Apply and Redo weren't, so the AI (Chrome on-device) could veto the fix again on the next visit; an AI answer arriving after an Undo also overwrote it | — (a bug, not a language case) | The user's choice wins over the AI: Apply/Redo saved per paragraph (`applied`), never sent for an AI check, and a late AI answer never changes a fix the user touched | — |
| Word-only hover covered the fixed word | Reader should see both words at once | — (UI, not a language case) | The crossed-out original floats just above the fix instead of on top of it, its bottom border over the squiggle (1.7.5) | — |
| Company names (*Fastly*) shouldn't be corrected | A name's spelling is its owner's | Reference (onomastics, NER) | Names guard in policy.js: shape, phrases, links, page names, known brands (§4a) | — (left alone) |
| *canceled → cancelled* reported as missed (X, 2026-10-27) | *canceled* is the standard US spelling (single *l* before an unstressed ending: *traveled, labeled, modeled*), not a slip | Regional standard | Not a fix, so not a Misspelling. The user then asked for the opt-in conversion: Settings → **Your spelling** (US / UK / Canada / Australia). Changed only when the reader's dictionary lacks the word and exactly one form is theirs (POLICY.md §7, 1.7.20) | Your spelling (teal, when turned on) |
| Your spelling should consider more than capitals; quotes shouldn't exempt; for all criteria (2026-10-27) | Names can be lowercase (casual writing, people's own style); capitals aren't always names; quoted words are often used, not mentioned | Reference (NER: shape, context words, gazetteers, one sense per discourse); meaning and use (kinds of quotation: mention, echo, scare quotes, emphasis) | Shared guards weigh evidence: `nameReason` (capitals only where the writer uses them normally; page names, frames, neighbours, known brands for lowercase), `mentionReason` (frames, language words, echo, *sic*; scare quotes and emphasis are used words). Rules, AI, spellchecker and Your spelling all use them (1.7.22) | — (left alone when the evidence says so) |
| Your spelling hover card and menu (2026-10-27) | The card had a category label and an explanation; the original was struck through though it isn't wrong | — (UI) | Card: globe icon and the change only. Popup: original without strikethrough, plus which spelling it was (1.7.22) | Your spelling |
| Your spelling in History; icon on hover (2026-10-27) | The user wants these changes kept in History too, and in word-only hover saw no icon (the box showed the original word) | — (UI) | Logged to History with which spelling it was; word-only hover shows just a globe, not the original (1.7.23) | Your spelling |
| Switching This page → History → back showed This page's rows under History's chips (2026-10-27, seen once) | A fix logged while the menu was open replaced History without mapping old category names (*wordform*); drawing that entry failed after the chips were redrawn but before the list was | — (a bug, not a language case) | Every way the menu loads History maps old categories (1.7.25) | — |
| Laptop heat; had to pause the extension (2026-11-02) | The AI reading every paragraph kept Gemini Nano busy (2–3 calls a minute, many hitting the 45 s limit), and most of what it found was discarded | — (performance, not a language case) | AI reads every paragraph only if the reader turns it on (off by default); otherwise it only checks the rules' own fixes. Squiggles redrawn only when they move (1.8.0) | — |
| Reading pass off means the AI misses what it's for; saved answers are a privacy record and could grow forever (2026-11-02) | Heat fix had switched off the AI's main job; cache kept page snippets with no off switch | — (performance, privacy) | Reading on by default under a heat cap (~14% busy, 15 s limit, shorter answers); Remember the AI's answers setting, 1000 paragraphs / 30 days, no full sentences (1.8.1); it and the debug log are settings, both off by default (1.8.2) | — |
| Turning off Remember the AI's answers deletes them with one click (2026-11-03) | Destructive setting with no warning | — (privacy, performance) | Warning under the setting first: Turn off and delete / Keep on; stays on until answered (1.9.1) | — |
| Joke comment in a thread about spelling, r/CasualConversation (2026-11-03): *take at brake… apply the breaks and sloe down*; next paragraph has every c, b, m, n typed as a space (*u derst a d, orre t, spa e*) | Only *littel* was fixed. Plural swaps have no mechanism (*breaks → brakes* isn't in the confusion sets, only *brake/break*). *sloe → slow* fails the two-order vote. Words split by a space are always judged a rewrite, and each guard (token limit, "used consistently", "too different") blocks them; a paragraph needs ~20 repairs and the AI may return 8, inside a 15 s limit | Writer's slip pattern across the paragraph; meaning and use (it's a joke) | The whole comment is a joke (the post it replies to and the reply show it), so it stays as written by default. The reader decides per comment: right-click → **Fix this comment** or **Leave this comment as written**, remembered (1.9.0, POLICY.md §5). Not added: automatic lost-letter or phrase rules | Typo / Wrong word |
| Fix this comment: "The AI gave no answer (Failed to fetch)" (2026-11-03) | Chrome's AI checker was set to Ollama, which wasn't running. Every AI call failed, and the reading pass reported that as "nothing found" and could save it as the answer | — (a bug, not a language case) | A failed call is logged and never saved as an answer; the note names the cause (1.9.3) | — |
| Popup always opened on This page (2026-11-03) | The reader's place was lost on closing | — (UI) | Reopens on the tab it was closed on, as in Mute List for Reddit (1.9.4) | — |
| Fix this comment failed at first, then fixed only part: *take at brake* paragraph untouched, *at Instead*, *otto row* (2026-11-03) | A reading-pass timeout restarted the model in the middle of the asked call; asked fixes copied the original's capital; the model didn't work out *otto* or *space at* | Writer's slip pattern (which letters are missing) | Reading pauses while the reader's fix runs and can't restart the model; the model's capitals are kept; rare letters are passed as a hint; clicking Fix again asks again and adds to what's fixed (1.9.5) | Typo / Wrong word |
| Nano reading pass nearly always timed out (2026-11-03) | Each timeout closed the model, so the next call had to load it again within its 15 s | — (performance, not a language case) | Loading doesn't count against the limit; a timeout cancels only that call and keeps the model loaded; call times are logged (1.9.6) | — |
| *readin', writin', 'rithmatic* | Eye dialect | Writer and setting | Elision marks protect a word | — (left alone) |
| *definately* in quotes / italics | Word mentioned, not used | Meaning and use | Use-vs-mention guards; since 1.7.22 only when the evidence shows a mention or echo (`the word "definately"`, `"definately" lol`), not for scare quotes or emphasis | — (left alone) |

## 6. Open questions and ideas

- **To revisit with the user (raised 2026-10-27, late at night; remind them):** what to save from a first visit so
  later visits start better prepared. Asked: should an AI check started on a page finish and be saved even after
  the user scrolls away, leaves, or goes to a site the extension is off for? (Yes: the background already does
  this.) Save everything from a first visit, or only what Undo/Redo/Apply need? Criteria proposed: speed on
  revisit, AI work saved, storage size, staleness when pages or the rules change, privacy (stays on the device),
  and consistency (same answer each visit). Current answer: save the AI's answers (slow, varies run to run), not
  the rule fixes (instant and always the same, and saving them would freeze old rules); the user's own choices are
  saved separately and outrank both. Open: cache size (now 1000 paragraphs), whether to keep answers for
  paragraphs never seen, and whether a page's history should prefetch anything.
- **Nano heat vs. coverage (user notes, 2026-10-27; notes only, not to implement yet).** Gemini Nano running the
  find pass on every paragraph heats the Mac. The rules must not decide what the AI reads (the AI catches more than
  the rules). Proposed relief: read only what stays in view, skip hidden tabs, pause between calls, maybe batch
  short paragraphs.
  **Done in 1.7.26 as a heat fix, not on design or function grounds; remember it if heat becomes less of a
  priority.** (1) A paragraph goes to the AI only after 1 s within one window-height of the view (the user asked
  for a little look-ahead so fixes are in place before they're seen; was 800 px, no wait); (2) no AI reading in
  background tabs; (3) the queue rests as long as each call took (up to 10 s). Each is marked `HEAT FIX` in
  content.js / background.js with the old setting. Costs: This page lists only paragraphs that were near the
  reader, and AI fixes arrive later. Batching not done (needs an eval).
  **1.8.0 (2026-11-02):** the user still had to pause the extension for heat and asked for it to run "set and
  forget", like any other extension. The trace showed why 1.7.26 wasn't enough: 2–3 model calls a minute while
  browsing, 84 of them running the full 45 s limit, and ~900 of the find pass's edits thrown away by the checks
  (64 placed). So the find pass is now a setting, **Let the AI read every paragraph**, off by default; with it
  off, the AI only answers the rules' own two-sentence questions (paragraphs with a context fix waiting), which
  are short and few. This goes against "the rules must not decide what the AI reads" above, so it is the user's
  call whether the default stays off. Also: the squiggle layer is rebuilt only when a line moved, and its 1 s
  fallback redraw doesn't run in background tabs.
  **1.8.1 (same day):** the user: "isn't the point of the AI checker to be there for stuff the rules don't know?"
  So the reading pass is back on by default, with a heat cap instead: the chip is busy at most ~1/7 of the time
  (paragraphs read more slowly; a fix waiting skips the queue), answers are shorter (no explanation), and a call
  is given up after 15 s. Saving answers raised privacy and size concerns: it's now a setting (**Remember the AI's
  answers**; off deletes them), capped at 1000 paragraphs and 30 days, and stores no full sentences. The debug log
  (page text and addresses for reports) became a setting too. **1.8.2:** the user wants both **off by default**.
  The tension, in the user's words:
  - *Ideal: read ahead and fix everything,* so the This page list covers the whole page, not only what was
    scrolled past. That's the opposite of "read only what's in view"; the trade-off is heat and battery vs. a
    complete list. Unsettled.
  - *A database of pages, so reloads never ask about the same paragraph twice*, as long as the paragraph hasn't
    changed since it was saved. Partly there: `aiCache` (storage.local, 1000 paragraphs, keyed by a hash of the
    paragraph text and the logic files) already skips unchanged paragraphs, and any edit misses the cache.
    Open: telling "same paragraph" apart on every kind of site (re-rendered, edited, truncated or "read more"
    text, live counts and times inside it); how much AI work it really saves (repeat visits vs. one-off pages)
    against a whole-internet/historical store, which could need a lot of storage; where it lives (local vs.
    cloud) and its privacy implications (a cloud store sends page text off the device, against the "nothing
    leaves your device" promise). Local storage has a privacy cost too: even if nothing leaves the device, a store
    of page text is an extra browsing-history record (outlives clearing Chrome's history, readable by anyone with
    the machine or a backup). Measure the savings before choosing.
- More frames like *on a … basis*: *in a … manner*, *at the … level*, *for all intents and purposes* (eggcorns
  are the same level). A small, curated frame list with the slot's allowed forms, grown from real reports.
- Categories are for readers; levels are for logic. If Wrong word grows too broad to be useful in the popup
  filter, ask the user before splitting it, and name any split the way a reader would.
