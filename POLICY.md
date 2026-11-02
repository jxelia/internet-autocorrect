# What Internet Autocorrect corrects, and what it never touches

This is the extension's linguistic foundation. The rules (`engine.js`), the shared policy code (`policy.js`), the
AI instructions (`ai.js`) and the final safety check (`background.js`) all follow it. When they disagree with this
document, the code is wrong.

## 0. Foundations: one model for every case

Individual cases (*would of*, *ive*, *is → its*) are instances of a small number of questions that several fields
have already worked out. The extension answers the same three questions about every proposed change, whoever
proposed it (rules, AI, spellchecker), so new cases are handled without new word lists.

**Where the model comes from**

| Field | What it contributes |
|---|---|
| Error analysis (Corder 1967) | *Mistakes* (performance slips the writer would fix) differ from *errors* (the writer's own system) and from *choices*. Only slips are corrected. |
| Typing and spelling-error research (Damerau 1964; Kukich 1992) | Slips have mechanical causes: a neighbouring key, two letters swapped, one letter dropped or added, a sound-alike word, a missing apostrophe or space. About 80% are a single such edit. |
| Noisy-channel spelling correction (Kernighan, Church & Gale 1990; Brill & Moore 2000) | Choose the intended word by *how likely the slip is* × *how likely that word is here*. The extension's channel is the list of slip mechanisms; "likely here" is the context rules and the AI comparing the two sentences. |
| Real-word error correction (Mays, Damerau & Mercer 1991; Golding & Roth 1999; Hirst & Budanitsky 2005) | Swapping one real word for another is only reliable within known **confusion sets** (their/there, then/than). Outside them, false alarms swamp real catches. |
| Grammatical error correction (CoNLL-2014, scored by F0.5) | The field weights precision twice as much as recall: a wrong edit is worse than a missed one. |
| Sociolinguistics: variation, register, computer-mediated language (Labov; Biber & Conrad 2009; Crystal 2001; Tagliamonte & Denis 2008) | Non-standard forms are systematic and meaningful. How someone writes depends on the setting (register), and online writing has its own stable conventions. |
| Lexical normalisation of social media (Han & Baldwin 2011; Eisenstein 2013, "What to do about bad language on the internet") | Most non-standard spellings online are deliberate. "Normalising" them erases meaning; separate ill-formed slips from intentional variants. |
| Morphology: blocking and words-and-rules (Aronoff 1976; Pinker 1999; Marcus et al. 1992); overgeneralisation in error analysis (Richards 1971) | Regular endings (-ed, -ly) are a rule; irregular forms (*went*, flat adverbs like *fast*) are stored words that block the rule. When the stored form isn't retrieved, the rule fills the gap: *goed*, *fastly*. That is a slip in how the word was built, not in how it was spelled. |
| Error gravity (Hairston 1981; James 1998) | Errors differ in how much they cost the reader: a wrong word that changes meaning matters; a dropped apostrophe barely does. |
| Use vs mention; the principle of charity (philosophy of language) | A word can be talked about rather than used, and the writer is assumed to have meant what they wrote unless that can't make sense. |

**The three questions** (`policy.js`, `judgeEdit`)

1. **Mechanism: how could this have happened by accident?** keyboard slip (adjacent key, swapped letters),
   sound-alike (a confusion set), apostrophe, spacing, doubled word, misspelling of a non-word, or **word form**
   (a regular ending on a word whose real form is irregular: *fastly → fast*, *goed → went*). If no slip
   mechanism connects the two forms, it is not a slip:
   - *grammar*: pronoun case (*they → them*), agreement (*is → are*), word endings (*walk → walks*). These
     vary by dialect and usage, so they are never changed. One exception, a **dropped *-ed*** where only the
     participle can stand: after *have* with an object following (*I have finish the report*), or after *be* or
     *get* with *by* following (*was kill by a car*). The AI must still agree both ways. What follows is what rules
     out a noun or bare verb that belongs there: *have work to do*, *the only constant is change*, *all I did was walk
     by the river*. *He been walk* is dialect and stays.
   - *unexplained*: two real words with nothing linking them (*is → its*). Not applied. If the AI thought the word
     was wrong, the words a real slip could have come from are tried instead (*is → us*: *u* is next to *i*).
2. **Gravity: what does it cost the reader?** *meaning* (a different real word), *legibility* (a non-word),
   *form* (the right word, wrongly built; the meaning is clear),
   *cosmetic* (apostrophes, spacing). Cosmetic fixes in casual writing are style, not slips (§4).
3. **Evidence: is it really a slip here?** The guards in §3–4 (mention, dialect, register, names,
   consistency), then the AI comparing the sentence with and without the change **in both orders**. A fix the AI
   proposes is only made when it agrees with itself both ways.

Verdicts: **apply** (mechanical slip, guards pass), **confirm** (plausible slip; AI must agree both ways),
**repair** (try the slip's real source instead), **block** (with the reason). Every verdict is written to the
decision log (Settings → Diagnostics), so a wrong call can be traced to the question that got it wrong.

**How the built-in checker answers (1.11.0, `scorer.js`).** It asks one thing: with the changed word masked out, how much
better does the replacement fit its sentence than the original? The answer is a log-likelihood margin over the changed
words and two neighbours each side, so a mask-language model gives the same number every time and needs no two-order
check. Thresholds (`policy.js`), set on real text and then checked on 1,500 unseen Hacker News paragraphs:

| Job | Rule | Measured |
|---|---|---|
| Veto a context rule's fix | margin below -3 (`SCORE_VETO`) | wrongly vetoes 2 of 80 test fixes and 0 of 112 real fires; catches 6 of 10 false fires (gemma3:4b: 3, 0, 3) |
| Confirm a proposed confusion-pair fix | margin above 6 (`SCORE_CONFIRM`) | 0 wrong of 120 items at margins 2 to 6, keeping 100 to 117 good (gemma3:4b: 5 wrong, 36 good) |
| Find a slip nobody proposed | margin above 10 (`SCORE_DETECT`), pairs from the confusion sets only (`slipCandidates`) | 3 flagged in 2,072 word pairs, all real; about 64% of planted slips |

The margin replaces the AI's vote only. Everything it proposes still passes `judgeEdit` and the guards in §3–4. It has
no opinion on anything outside a confusion pair, so spelling, dropped letters and restoring a broken comment stay with
the larger models.

**When a new kind of case appears**, place it with these three questions. Don't add a one-off exception. If
none of the answers fits it, the model needs a new mechanism, gravity level or signal, and that goes here first.

## 1. The job

People reading online text trip over **slips**: errors the writer would fix if they saw them. The extension
restores what the writer meant to write. It is **not** an editor imposing one standard of English on everyone.

> **Correct a word only when the writer was clearly *trying* to write the standard form and missed.**

Changing someone's words is worse than missing a slip: it puts words in their mouth, can erase their dialect or
voice, and can flip the meaning of a joke or quotation. So the design favours **precision over recall**. When in
doubt, leave it alone. A missed slip costs the reader a moment; a wrong "fix" costs the writer their voice.

## 2. What counts as a slip (corrected)

| Kind | Examples | Why it's a slip |
|---|---|---|
| Misspelling of a known word | definately, recieve, seperate, untill | Not a word in any variety of English; one obvious target |
| Keyboard typo | teh, adn, jsut, the the | Mechanical: transposition, doubling, adjacent key |
| Homophone or near-homophone swap | their/there/they're, your/you're, its/it's, then/than, were/where, lose/loose, could of | English spelling separates words that sound the same; the context shows which word was meant |
| Article by sound | a apple → an apple, an big → a big | *a/an* follows the next word's sound (*an hour, a university*). Decided by `articleFor` in `policy.js` for rules and AI alike: an edit that moves an article away from it (*an apple → a apple*) is blocked, and words whose sound the spelling doesn't settle (acronyms, *historic*) are left alone |
| Missing contraction apostrophe | dont, doesnt, im | The contraction is clearly meant |
| Word form in a fixed frame | on a weekly bases → basis | Phraseology: *on a … basis* only takes the singular, and *bases* sounds almost the same. With *the*, only adjectives that go with *basis* count (*on the naval bases* is the plural of *base*). The AI never changes singular/plural on its own (*the analyses show* is right) |
| Word form (over-regularisation) | fastly → fast, goed → went, has goed → has gone, eated → ate | The writer chose the right word and built it with the regular ending; the irregular form should have blocked it. Not a spelling mistake: *fastly* is spelt exactly as its parts say |
| Lost *-ed* before *to* | get use to → used, I'm not use to → used, am I suppose to → supposed, is oppose to → opposed, I use to play → used | The *d* runs into the *t* and can't be heard, so the spelling follows the ear. Only the participle can stand after *be* or *get* here, so the sentence settles it. Right as written: *didn't use to*, *of no use to me*, *its use to researchers*, *the app I use to edit*, *I suppose to some extent*. Not a casual form, so register doesn't protect it |
| Eggcorns (misheard phrases) | for all intensive purposes, case and point | The fixed phrase is well known; the misheard version isn't a deliberate variant |

### Word forms: how they are judged

*The rain started falling down fastly* has no spelling slip in it. The writer wanted the adverb of *fast* and
built it the way most adverbs are built (*quick → quickly*). English *fast* is a **flat adverb**: the adjective
is the adverb, so the stored form *fast* should block *-ly*. The same mechanism gives *goed*, *bringed*, *eated*
for irregular verbs. Internally this is its own mechanism (`wordform`), because the evidence differs from a spelling slip or a
sound-alike swap. **The reader sees it as a Wrong word** (blue), like *a apple* and *on a weekly bases*: categories
are named by what the reader notices, not by the level that explains it (GOALS.md §4).

- **Only non-words are touched.** *hardly, lately, highly* are real words with other meanings; *catched* or
  *learnt* are in the dictionary for some variety. The list (`REGULARISED`, `FLAT_ADVERBS` in `policy.js`) is
  checked against the dictionary by `test/dictcheck.cjs`.
- **Past or participle comes from the words before it**: after *have/has/had/be/was/get* the participle
  (*has goed → has gone*, *was eated → was eaten*); otherwise the past (*goed → went*).
- **Deliberate uses stay**: regularised pasts that are dialect grammar (*knowed, growed, throwed, catched* in
  Southern US, Appalachian, AAE and many British dialects), jokes and child voice (*badder, funner, bestest,
  thanks muchly*), anything quoted or talked about, and a form used twice by the same writer (a choice, not a
  slip). Forms a variant could plausibly be a typo of a different word (*rised* for *raised*, *sayed* for
  *stayed*) or that are established in a field (*casted* in programming, *grinded* in gaming, *creeped out*)
  are not listed.
- **Plurals are left to the AI** (*childs, mouses*): a regular plural on an irregular noun collides with a
  dropped possessive apostrophe (*the childs toy*) and with mass-noun plurals that are standard in Indian,
  Nigerian and other Englishes (*informations, advices*).
- Learners and some regional varieties use these forms systematically (Corder's *errors*, not *mistakes*); the
  guards above (consistency, dialect density, quotes) are what keep a writer's own system from being "fixed".

## 3. What is deliberate (never corrected)

Linguists treat these as **variation**, not error. Each is a consistent system or a conscious choice.

1. **Use vs mention.** A word being *talked about* rather than used: listed or compared
   (`the difference between "their" and "there"`, `their/there`, `than, then`), defined, or given as an example
   of a mistake. Quote marks and italics often mark a mention, but not always (§4, *What quote marks are doing*).
2. **Eye dialect and spoken forms.** Spelling that shows how something sounds, usually marked by an apostrophe
   where sounds are dropped: *readin', writin', 'rithmatic, goin', 'em, 'cause, ol', o', s'pose, c'mon, 'tis*.
   Also *gonna, wanna, gotta, kinda, dunno, lemme, gimme, coulda, betcha, whatcha*.
3. **Regional standards.** British, Irish, Canadian, Australian, NZ, South African, Indian, US and other spellings
   are all correct: *colour/color, organise/organize, centre/center, programme, tyre, kerb, cheque, mum,
   travelled, licence, grey, aluminium, whilst, amongst*.
4. **Dialects and sociolects.** Varieties with their own grammar and spelling, such as African American English
   (*finna, tryna, ain't*), Scots (*dinnae, cannae, wee, aye, ken*), Irish English (*ye, youse, eejit, feck*),
   Southern US (*y'all, fixin' to*), Singlish, Nigerian and Indian English. These are not errors, and the
   extension does not "standardise" them.
5. **Internet register.** Abbreviations and conventions with stable meanings (*u, ur, rn, tbh, ngl, imo, idk,
   lol, smh*), emphatic stretching (*sooooo, nooo*), stylised spellings (*smol, doggo, birb, heckin, boi, n00b,
   pwned, teh* as a joke), all-lowercase style, mocking caps (*sTuPiD*).
6. **Quotation, reported speech and titles.** Quoting someone else's slip back at them, or keeping it (*sic*); song
   lyrics, poems, book titles, slogans and brand names (*Lyft, Flickr, Froot Loops*).
7. **Archaic and literary language.** *thou, thee, thy, hath, doth, 'twas, ye olde, whilst, betwixt*.
8. **Names and non-words by design.** A name refers to one particular thing and its spelling is its owner's
   choice (onomastics; named-entity recognition). People, usernames and handles; companies, brands and shops,
   often spelt on purpose (*sensational spelling*: Lyft, Fiverr, Krispy Kreme) or made of ordinary words (Apple,
   Fastly); products, apps, AI models and versions (Fable 5.5); titles of books, songs, films and shows (*Lose
   Yourself*, *Loose Women*); places, events, teams. Also code, URLs, hashtags, chemical or technical terms, words
   from other languages and code-switching (*pero, ja, schadenfreude*). No word in a name is corrected, and a
   name is never a wrong word. How names are recognised: GOALS.md §4a (`nameReason` in policy.js).
9. **Wordplay.** Puns, portmanteaus (*hangry, chillax*), deliberate malapropisms, and sarcasm that quotes a
   mistake (*"their is no problem here" lol*).
10. **New words and slang.** *rizz, yeet, doomscroll, sus*. Dictionaries lag behind use; absence from a word
    list doesn't make a word wrong.
11. **Usage disputes that aren't slips.** Split infinitives, ending on a preposition, singular *they*,
    *less/fewer*, *irregardless*, *anyways*, *alright*, *could care less*, *on accident*. These are word choices
    some style guides dislike, not mistakes.

11. **Other languages.** The rules and the AI know English only, and a word that is a slip in English may be correct
    in the paragraph's own language. A paragraph that isn't in English is left alone whole (§4, *What language is
    this*); a foreign word inside an English paragraph is covered by point 8.

## 4. How the extension tells the difference

Signals that a form is **deliberate** (each one alone is enough to leave a word alone):

- **Marked elision**: an apostrophe at the start or end of the word (*readin'*, *'rithmatic*).
- **A mention or an echo** (*What quote marks are doing*, below). Code is never touched.
- **Metalinguistic context**: the paragraph lists or compares variants of the same word, or talks about words,
  spelling or grammar.
- **Known deliberate form**: the word is in the list of dialect, informal, archaic and internet forms.
- **Dialect density**: the paragraph contains two or more deliberate forms. Then it's written in a voice, so
  only homophone swaps are corrected, not spelling.
- **Consistency**: the writer uses the same non-standard form more than once. Slips are rarely repeated
  exactly; choices are.
- **Shape**: stretched letters (*sooo*), internal capitals, all caps, digits or symbols.
- **A name** (§3.8, *How names are recognised*, below).

**Surface marks are clues, not verdicts** (the user, 2026-10-27). Quote marks, italics and capitals each do several
jobs, so none of them decides a case by itself; what is around them says which job they're doing. This holds for
every kind of change (rules, AI, spellchecker, Your spelling).

**What quote marks are doing** (and `*asterisks*`, `_underscores_`, italics, `<q>`, a short bold run). Linguists
separate several uses (Gutzmann & Stei 2011, *How quotation marks what people do with words*):
- *Mention* (pure quotation): the word itself is the topic. **Left alone.** Evidence: a word about language in the
  sentence (*word, spelling, grammar, means, typo, instead of, vs*…); a defining or comparing frame
  (`the word "X"`, `say/write/spell "X"`, `"X" is/means/vs/or…`, `not "X"`); a determiner before a quoted
  function word that can't be used there (*the "their"*).
- *Echo*: someone else's form quoted back, often to mock it. **Left alone.** Evidence: the quote is the whole
  sentence (`"definately" lol`); *sic*; the writer spells the word the standard way elsewhere in the paragraph.
- *Scare quotes and emphasis*: the writer's own word, used, with distance or stress (`my "freind" came over`,
  `the *definately* best`). **Treated like any other word**: a slip in it is still fixed.
- *Longer quotations* (more than three words): someone's words reported. Treated as used, unless the evidence
  above says it's a mention or an echo.

**How names are recognised.** Capital letters are one clue among several (named-entity recognition uses word
shape, context words, gazetteers and "one sense per discourse"):
- *Capitals*, only where the writer uses capitals normally: a capitalised word that doesn't start a sentence, a run
  of capitalised words, a company ending (*Acme Inc*, also lowercase *acme inc*). In a Title Case line or from a
  writer who capitalises nothing, case says nothing either way.
- *The page*: a word the page writes as a name anywhere counts as a name everywhere on it, lowercase included
  (*Fastly* in one comment → *fastly* in another); the site's own name and domain; short link text.
- *Frames*: *called, named, nicknamed, aka, username, user, handle, follow, shoutout to, feat.*, and `@`, `#`, `u/`, `r/`.
- *Neighbours*: where case says nothing, a word next to a recognised name is part of it (*the kennedy center*
  on a page that names Kennedy). Writers who use capitals capitalise every word of a name, so there a capitalised
  run counts and a lowercase neighbour (*John recieved*) doesn't.
- *Known brands* (`KNOWN_NAMES`): capitalised, or lowercase from a writer who doesn't capitalise or in a frame. A
  lowercase *fastly* in careful writing is still the slip (*falling down fastly*).
So *my friend john doe* is protected only by evidence (the page writes *John Doe* elsewhere, *a user called john doe*), and a
capitalised *Definately* in a headline is still a slip.

Signals that a form is a **slip**:

- It is **not a word** in any major variety of English (SCOWL dictionary, US + UK + Canadian + Australian),
  and a real word is one or two keystrokes or sounds away.
- It **is** a real word but the wrong one for the sentence, and it's a known confusable pair. The rules check
  the surrounding words, and the AI compares the sentence with and without the change.

### What language is this

Judged per paragraph, because one page can hold many languages: a Spanish comment in an English thread, or an English
post on a page marked `lang="de"`. No single cue decides (GOALS.md §1). Evidence, read together:

- **Function words** (*the, of, is, you*; *der, und*; *les, dans*; *yang, dengan*). Every language's most common words
  are its own and few, so they're the best evidence. Plenty of English ones in a paragraph mean English, whatever else
  it holds, even with heavy slang or typos. Almost none across six or more words means it isn't, which also covers
  languages with no list here and languages written in Latin letters (*yaar tum kya kar rahe ho*).
- **Letters**: mostly another script, or many words carrying accents. A few accents prove nothing (*café, résumé*).
- **The page's stated language** (the nearest `lang` attribute): it can only count against English, and only when the
  paragraph has few English function words of its own. `lang="en"` proves nothing, since sites set it for their
  interface whatever people post.

When in doubt, English is assumed only if nothing points elsewhere. A headline-like fragment with no function words
may be left alone by this: a missed slip, the cheap kind of mistake. *Fix this comment* is the reader's explicit request
and isn't subject to this check.

### Casual spellings: same spelling, slip or style

Some spellings are conventional in casual internet writing: *would of, alot, everytime, dont, im*. The same
spelling can be a slip from a careful writer or a deliberate style from a casual one, so it is never judged by the
word alone. It is judged by the writing around it (its **register**), which means the writer's whole comment or
post where the site's markup shows where that starts and ends (Reddit so far), and otherwise the paragraph. Quoted
text is someone else's writing, so it doesn't count, and a paragraph inside a quote is judged on its own:

- **Casual signs**: lowercase sentence starts, a lowercase *i*, *lol/tbh/ngl*, emoji, `!!!`, no final full stop,
  several other missing apostrophes.
- **Careful signs**: capitalised sentences, apostrophes used correctly elsewhere, semicolons, longer words.
- **The writer knows the standard form**: *would've* or *would have*, *every time*, *a lot* or another correct
  apostrophe elsewhere in the same comment. Then the casual form here is a slip.

The default is to **leave it**. A casual form is corrected only with positive evidence: the writer shows they know
the standard form, or the text is clearly careful. A dropped apostrophe (*dont, ive, im*) needs careful writing on
its own: it is cosmetic, and phone keyboards add apostrophes to some words and not others, so one correct
apostrophe elsewhere proves nothing. (Setting: leave in casual writing / always fix / never fix. Undoing the same
change in two places adds it to the never-change list.)

This is a category, not a word list. New forms that behave the same way (a spelling that is both a known slip and
a common deliberate style) belong here, judged by the same evidence. Note that *its/it's, were/we're, well/we'll,
ill/I'll, lets/let's* are **not** casual forms: both spellings are real words, so they are wrong-word swaps judged
by the sentence.

## 5. How decisions are made (cheapest first)

1. **Policy guards** (instant, every word): anything protected by section 3 or 4 is skipped before any rule runs.
2. **Word-list rules** (instant): unambiguous misspellings and typos are fixed straight away.
3. **Context rules** (instant): homophone patterns. With an AI on, these are double-checked (step 5).
4. **AI proposals** (optional, local): the model reads each visible paragraph once, with this policy as its
   instructions, and must say for each proposal whether it could be deliberate and how sure it is. Each proposal
   is then judged by §0: grammar and unexplained swaps are never made, and every other non-mechanical proposal
   must be confirmed by the AI in both orders.
5. **AI double-check of context rules**: "which of these two sentences is correct?", asked in both orders. A rule
   fix is held back only if both answers agree.
6. **Offline spellchecker, confirmed by the AI**: a non-word (not protected by sections 3–4) with exactly one
   dictionary word a single keystroke away (*peple → people*) is suggested to the AI with the same two-sentence
   question. Here the burden is reversed: the fix is kept only if **both** answers prefer it. Non-words with
   several near neighbours (*realy*) or none (*doomscroll*) are left to the AI's own reading.
7. **Final safety check** (always, even on AI output), in `background.js`:
   - The policy guards again.
   - A *spelling* fix must turn a non-word into dictionary words.
   - A *wrong word* fix must swap one real word for another that sounds or looks alike.
   - Regional variants are never "fixed".
   - Anything the AI marked as possibly deliberate, or not highly confident, is dropped.

### The reader's choice, per comment

Only the reader can really tell a joke from a slip: the post and replies around a comment often settle it, and the
extension sees one comment at a time. So the reader can overrule it for one comment, from the right-click menu:

- **Leave this comment as written** takes back every change in the comment, including rule fixes, and keeps it that
  way on later visits. It doesn't count towards never-change: it says nothing about those words elsewhere.
- **Fix this comment** asks the AI to correct each paragraph. The reader has looked and wants it fixed, so the
  guards for deliberate language (§3–4) step aside. `restoredEdits` still checks the answer: aligned word by word
  with the original, each changed run must stay close in letters and end in real words, an added or removed word
  alone is ignored, and a different text altogether is dropped. Every change is marked and can be undone as usual.

Each undoes the other. Only the changed words are kept, under a hash of the paragraph. Without the reader asking,
jokes stay protected (§3.9).

## 6. Learning, and staying honest

- A spelling fix the AI proposes and you never undo becomes an instant rule after 3 sightings. Undoing a fix
  counts against it, and so does the AI vetoing it.
- Context fixes are never turned into context-free rules, because their correctness depends on the sentence.
- Every change is visible: marked on the page, listed in the popup, undoable, and blockable forever.
- Reports from **Missed one?** are the test cases for improving these rules.

## 7. Your spelling (optional, off by default)

Regional spellings are never mistakes (§3.3), so this isn't a fix: it's a reader's choice to see other regions'
correct spellings in their own (*canceled → cancelled*, *color → colour* for a UK reader). It is marked in teal and
can be undone and is kept in History, but it isn't counted on the badge or sent to the AI. Because the original isn't
wrong, it is never struck through: the hover card shows a globe and the change, nothing more, and the word-only hover
shows just the globe (not the original); the popup lists the original plainly and says which spelling it was
(*US spelling*), in History too.

**What converts.** Spelling only, never word choice (*mom/mum*, *whilst/while*, *learnt/learned* stay). The table
(`data/regional.txt`) comes from SCOWL's per-region word lists: the systematic families (*-ize/-ise*, *-yze/-yse*,
*-or/-our*, *-er/-re*, *-l/-ll*, *ae/oe*, *-ense/-ence*, *-og/-ogue*) plus a few listed pairs (*tyre/tire*,
*cheque/check*, *plough/plow*, *jewellery/jewelry*…). A word is changed only when **the reader's region's
dictionary lacks it and exactly one form in its group is theirs**. That is what keeps meanings safe: UK English has
both *meter* (a gas meter) and *metre*, both *program* (software) and *programme*, both *check* and *cheque*, so a
UK reader sees all of them as written. A US reader sees *metre → meter*, *programme → program*, *tyre → tire*.
UK means the common *-ise* spelling; Canada keeps *-ize* with *-our* and *-re*; Australia is like the UK.

**Never converted** (on top of the shared guards: names by every clue in §4, mentions and echoes, handles):
- any word in a Title Case line: capitals can't show which words are names there (*Lincoln Center Reopens*), and a
  conversion isn't worth that risk;
- words in capitals (*COLOR*);
- a paragraph that talks about spelling (*spell*, *spelling*, *-ise*, *-our*…);
- a paragraph that already uses the reader's form of the same word (it's comparing them: *color or colour?*);
- SCOWL quirks where the other form is also another word (*prized → prised*, *reprised → reprized*), excluded in
  the generator.

Fixes for real slips follow the setting too: *nieghbor* becomes *neighbour* for a UK reader.
