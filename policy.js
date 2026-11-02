/*
 * Internet Autocorrect — linguistic policy (see POLICY.md).
 *
 * One place that decides what is deliberate language and must never be "corrected". Used by:
 *   engine.js      — before any rule fires
 *   content.js     — before an AI edit is placed on the page
 *   background.js  — final check on AI output, with the dictionary
 *   ai.js          — the same policy, in words, for the model
 */
(function (root) {
  'use strict';

  const S = (str) => new Set(str.trim().split(/\s+/));

  // Forms people choose on purpose: spoken/eye-dialect, regional dialect, internet register, archaic.
  const DELIBERATE = S(`
    gonna wanna gotta kinda sorta outta lotta dunno lemme gimme gotcha betcha whatcha wassup sup whaddya
    dontcha didja wouldja coulda shoulda woulda musta mighta oughta hafta hasta useta tryna finna boutta bouta
    ya yer yah yea yeah yep yup yuh nope nah naw nay ye yeh youse yous yinz y'all yall
    cuz coz cos tho thru nite lite til till ol ole em
    u ur r ppl pls plz thx tx ty np smh imo imho tbh ngl rn idk idc ikr lol lel lmao lmfao rofl omg omfg wtf
    afaik iirc fwiw tldr btw fyi irl ofc bc jk ftw fr frfr af asf istg ffs
    smol doggo pupper floof birb heckin boi bruh bro brah fam sus yeet rizz noob n00b nub pwned pwn kewl lulz
    teh pr0n pron hawt gud mah ma da dat dis dem dey wif wit fing nuffin nuthin sumthin summat
    innit init oi blimey guv mate wot gaff bloke howay hinny eejit feck craic shite arse bollocks
    wee aye ken dinnae cannae didnae wouldnae couldnae isnae wasnae disnae och lass lassie bairn ken
    thou thee thy thine hath doth shalt wilt dost art 'tis 'twas twas tis olde whilst amongst betwixt anon
    gal fella feller missus ma'am sir pa ma granma gramma grandpappy
    knowed growed throwed drawed blowed catched badder baddest funner funnest bestest muchly
    ain't aint'nt prolly probs def obvi smth sth srsly totes whatev whatevs bc
  `);

  // Contractions are real words even though word lists skip them.
  const CONTRACTIONS = S(`don't doesn't didn't isn't wasn't weren't aren't couldn't wouldn't shouldn't haven't
    hasn't hadn't can't won't i'm i've i'd i'll you're you've you'd you'll they're they've they'd they'll
    we're we've we'd we'll he's he'd he'll she's she'd she'll it's it'd it'll that's that'd that'll what's
    what'd what'll who's who'd who'll where's where'd when's why's how's there's there'd there'll here's
    let's would've could've should've must've might've ain't y'all ma'am o'clock mustn't needn't shan't
    daren't oughtn't`);

  const BARE_CONTRACTIONS = new Set();
  const BE_DO_HAVE = S(`is are was were be been am do does did don't doesn't didn't have has had`);

  for (const c of CONTRACTIONS) BARE_CONTRACTIONS.add(c.replace(/'/g, ''));

  // ---------------------------------------------------------------- regional spelling

  const REGIONAL_PAIRS = [
    ['grey', 'gray'], ['tyre', 'tire'], ['kerb', 'curb'], ['programme', 'program'], ['cheque', 'check'],
    ['plough', 'plow'], ['aluminium', 'aluminum'], ['mould', 'mold'], ['sceptic', 'skeptic'],
    ['draught', 'draft'], ['pyjamas', 'pajamas'], ['storey', 'story'], ['ageing', 'aging'],
    ['judgement', 'judgment'], ['acknowledgement', 'acknowledgment'], ['whisky', 'whiskey'],
    ['doughnut', 'donut'], ['mum', 'mom'], ['arse', 'ass'], ['gaol', 'jail'], ['whilst', 'while'],
    ['amongst', 'among'], ['learnt', 'learned'], ['spelt', 'spelled'], ['dreamt', 'dreamed'],
    ['burnt', 'burned'], ['smelt', 'smelled'], ['spilt', 'spilled'], ['leapt', 'leaped'],
    ['jewellery', 'jewelry'], ['manoeuvre', 'maneuver'], ['moustache', 'mustache'], ['sulphur', 'sulfur'],
    ['cosy', 'cozy'], ['artefact', 'artifact'], ['enrol', 'enroll'], ['fulfil', 'fulfill'], ['skilful', 'skillful'],
    ['practise', 'practice'], ['towards', 'toward'], ['afterwards', 'afterward'], ['anyways', 'anyway'],
  ];
  const REGIONAL = new Map();
  for (const [a, b] of REGIONAL_PAIRS) { REGIONAL.set(a, b); REGIONAL.set(b, a); }

  // Collapse British/American/Commonwealth spelling differences to one key.
  function variantKey(w) {
    return w.toLowerCase()
      .replace(/our(s|ed|ing|ite|ites|able|ful|less)?\b/g, 'or$1')
      .replace(/is(e|es|ed|ing|er|ers|ation|ations|able)\b/g, 'iz$1')
      .replace(/ys(e|es|ed|ing|is)\b/g, 'yz$1')
      .replace(/([^aeiou])re(s|d)?\b/g, '$1er$2')
      .replace(/ogue(s)?\b/g, 'og$1')
      .replace(/ence(s)?\b/g, 'ense$1')
      .replace(/ae|oe/g, 'e')
      .replace(/ll(ed|ing|er|ers|ery)\b/g, 'l$1');
  }

  function isRegionalVariant(a, b) {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return REGIONAL.get(x) === y || (x !== y && variantKey(x) === variantKey(y));
  }

  // ---------------------------------------------------------------- your region's spelling (POLICY.md §7)
  // Optional, and not a slip fix: shows a correct spelling from another region in the reader's own
  // (color → colour). data/regional.txt holds groups like `color:u colour:bca` (test/regional-gen.cjs).

  const REGION_CODE = { us: 'u', uk: 'b', ca: 'c', au: 'a' };
  const REGION_NAME = { us: 'US', uk: 'UK', ca: 'Canadian', au: 'Australian' };

  // { to: word -> the reader's spelling, from: word -> the regions that spell it so ('uc') }. A word is changed only
  // if the reader's dictionary lacks it and exactly one form in its group is theirs: with both "meter" and "metre"
  // in UK English, neither is touched there.
  function regionalTable(txt, region) {
    const code = REGION_CODE[region];
    const out = {}, from = {};
    if (!code) return { to: out, from };
    const clash = new Set();
    for (const line of txt.split('\n')) {
      const forms = line.split(' ').filter(Boolean).map((f) => f.split(':'));
      const mine = forms.filter(([, t]) => t === '*' || t.includes(code));
      if (mine.length !== 1) continue;
      for (const [w, t] of forms) {
        if (w === mine[0][0] || mine.some(([m]) => m === w)) continue;
        if (out[w] && out[w] !== mine[0][0]) clash.add(w);
        out[w] = mine[0][0];
        from[w] = t;
      }
    }
    for (const w of clash) delete out[w];
    return { to: out, from };
  }

  // "US spelling", "US and Canadian spelling": which regions write a converted word the way the page did.
  const REGION_OF = { u: 'US', b: 'UK', c: 'Canadian', a: 'Australian' };
  function varietyName(tags) {
    const names = [...(tags || '')].map((t) => REGION_OF[t]).filter(Boolean);
    if (!names.length) return '';
    return (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]) + ' spelling';
  }

  const SPELLING_TALK = /\b(spell|spelt|spelled|spelling|spellings|spells|misspelt|misspelled)\b|(^|\s)-(ise|ize|yse|yze|our|or|re|er)\b/i;

  // Why must this other-region spelling stay as written? (The shared guards run first: names, mentions, handles.)
  function regionalReason(text, s, e, block, table) {
    const raw = text.slice(s, e);
    if (isAllCaps(raw)) return 'written in capitals';
    // In a Title Case line capitals can't show which words are names (Lincoln Center Reopens), and a conversion
    // isn't worth the risk
    if (isTitleCase(block)) return 'a headline, where capitals can\'t show names';
    if (SPELLING_TALK.test(block)) return 'the paragraph is talking about spelling';
    // Both spellings in one paragraph: it is comparing them, or quoting someone
    const mine = table[raw.toLowerCase()];
    if (mine && new RegExp('(?<![A-Za-z])' + mine + '(?![A-Za-z])', 'i').test(block)) return 'the paragraph uses both spellings';
    return null;
  }

  // ---------------------------------------------------------------- signals

  const APOS = /['’]/;
  const isLetter = (ch) => !!ch && /[A-Za-z]/.test(ch);
  const norm = (w) => w.toLowerCase().replace(/’/g, "'");

  // Dropped sounds marked with an apostrophe: readin', 'rithmatic, goin', 'em, ol'
  function isElided(text, s, e) {
    const before = text[s - 1], after = text[e];
    if (APOS.test(before || '') && !isLetter(text[s - 2])) return true;
    if (APOS.test(after || '') && !isLetter(text[e + 1])) return true;
    const w = text.slice(s, e);
    return /^['’]|['’]$/.test(w);
  }

  const isStretched = (w) => /([a-z])\1\1/i.test(w); // sooo, nooo, yesss
  const hasInnerCaps = (w) => /[a-z][A-Z]|[A-Z]{2,}[a-z]/.test(w); // sTuPiD, iPhone, YouTube
  const isAllCaps = (w) => w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w);

  function sentenceStart(text, s) {
    return /(^|[.!?:\n]["'“”‘’)\]]*)\s*$/.test(text.slice(Math.max(0, s - 40), s));
  }

  // Count words in a paragraph that show it is written in a voice (dialect, eye dialect, internet speak).
  function dialectDensity(block) {
    let n = 0;
    const re = /['’]?[A-Za-z]+(?:['’][A-Za-z]+)*['’]?/g;
    let m;
    while ((m = re.exec(block))) {
      const raw = m[0];
      const w = norm(raw.replace(/^['’]|['’]$/g, ''));
      if (DELIBERATE.has(w) || DELIBERATE.has(norm(raw)) || isStretched(w)) n++;
      else if (/^['’]|['’]$/.test(raw) && w.length > 1 && !/s$/.test(w)) n++; // readin', 'em (not plural possessives)
    }
    return n;
  }

  // ---------------------------------------------------------------- names (POLICY.md §3.8, GOALS.md §4a)
  // A name's spelling belongs to its owner (onomastics), so no word in a name is a slip. Recognised by shape,
  // name phrases, the page's own names (opts.names, gathered by content.js) and a few known brand spellings.

  // Brand and product names spelt like slips or ordinary words that a fix list would touch ("sensational
  // spelling"). Only collisions need listing: every other name is caught by its shape or the page.
  const KNOWN_NAMES = S(`fastly lyft flickr tumblr fiverr grindr scribd digg imgur etsy zappos krispy kreme froot
    kwik playskool kool xbox korn outkast phish monkees bizkit boyz dunkin lowes kmart qdoba tylenol reddit
    gooey kleenex chex cheez trix kix wheaties nite`);
  const NAME_SUFFIX = /^\s+(Inc|Ltd|LLC|Corp|Corporation|Co|GmbH|PLC|plc|AG|SA|Labs|Technologies|Studios|Group|Games|Records|Foundation)\b/;
  const isCapitalised = (w) => /^[A-Z][a-z]/.test(w);

  // A headline in Title Case capitalises most words, so there capitals aren't evidence of a name.
  function isTitleCase(block) {
    const words = (block.match(/[A-Za-z][A-Za-z'’]{3,}/g) || []);
    return words.length >= 3 && words.filter(isCapitalised).length / words.length >= 0.6;
  }

  // Words this paragraph writes as names: capitalised where a sentence doesn't start. Common words that only get a
  // capital by accident or in a quote (Their, Your, Then) are left out; the occurrence itself is still protected.
  function namesIn(block) {
    const out = new Set();
    if (isTitleCase(block)) return out;
    const re = /[A-Za-z][A-Za-z'’-]+/g;
    let m;
    while ((m = re.exec(block))) {
      const w = m[0];
      if (!isCapitalised(w) || sentenceStart(block, m.index) || /['"“‘(]$/.test(block.slice(0, m.index).trimEnd())) continue;
      const low = norm(w);
      if (low.length < 3 || FUNCTION_WORDS.has(low) || CONFUSABLE.has(low)) continue;
      out.add(low);
    }
    return out;
  }

  // How this writer uses capitals: 'normal' (capitals carry meaning, so a mid-sentence capital suggests a name),
  // 'title' (a Title Case line) or 'none' (a writer who doesn't capitalise: case says nothing about names).
  function capsStyle(block) {
    if (isTitleCase(block)) return 'title';
    const starts = [...block.matchAll(/(?:^|[.!?]\s+)([A-Za-z])/g)].map((m) => m[1]);
    const lowerI = /(^|\s)i(\s|'|’)/.test(block);
    if (!/[A-Z]/.test(block) || (starts.length >= 2 && starts.every((c) => c === c.toLowerCase())) || (lowerI && starts[0] === starts[0]?.toLowerCase())) return 'none';
    return 'normal';
  }

  // Words that introduce a name, whatever its case: "a user called john doe", "follow fastly", "shoutout to color theory"
  const NAME_FRAME = /(?:\b(?:called|named|nicknamed|aka|a\.k\.a\.|username|user|handle|follow|shoutout to|shout out to|feat\.|ft\.)|[@#]|\b[ur]\/)\s*$/i;

  // Why is [s,e) a name? Returns a reason or null. Capitals are one clue among several (POLICY.md §4, How names are
  // recognised): names are often lowercase, and capitals don't always mark names.
  function nameReason(text, s, e, opts = {}) {
    const raw = text.slice(s, e);
    const block = opts.block || text;
    const words = raw.split(/\s+/);
    const style = capsStyle(block);
    const isName = (w) => (opts.names && opts.names.has(norm(w))) || namesIn(block).has(norm(w));
    const before = text.slice(Math.max(0, s - 24), s);
    // the page or paragraph writes it as a name somewhere (one sense per discourse), in any case
    if (opts.names && words.some((w) => opts.names.has(norm(w)))) return 'written as a name on this page';
    if (words.some((w) => namesIn(block).has(norm(w)))) return 'written as a name in this paragraph';
    if (/[@#]$|\b[ur]\/$/.test(text.slice(Math.max(0, s - 2), s))) return 'a handle or tag';
    if (NAME_FRAME.test(before)) return 'introduced as a name';
    if (NAME_SUFFIX.test(text.slice(e, e + 16))) return 'a company name';
    // known brand spellings: capitalised, or lowercase where case can't tell ("falling down fastly" is the slip)
    if (words.some((w) => KNOWN_NAMES.has(norm(w)) && (!/^[a-z]/.test(w) || style === 'none'))) return 'a brand or product name';
    const common = (w) => FUNCTION_WORDS.has(norm(w)) || CONFUSABLE.has(norm(w));
    const next = /^\s+([A-Za-z][\w'’-]*)/.exec(text.slice(e, e + 30));
    if (style === 'normal') {
      // a run of capitalised words going on past the sentence start: "Loose Women is on" (not "Their Netflix
      // account": words that start sentences all the time)
      if (isCapitalised(raw) && next && isCapitalised(next[1]) && !common(raw)) return 'part of a name';
    } else if (!common(raw)) {
      // where case says nothing, a word next to a known name is part of it ("the kennedy center" on a page that
      // names Kennedy). Writers who use capitals capitalise every word of a name, so this is only for them.
      const prev = /([A-Za-z][\w'’-]*)\s+$/.exec(before);
      for (const m of [prev, next]) {
        if (m && !common(m[1]) && (isName(m[1]) || KNOWN_NAMES.has(norm(m[1])))) return 'part of a name';
      }
    }
    // capitals, only where this writer's capitals mean something
    if (isCapitalised(raw) && style === 'normal' && !sentenceStart(text, s)) return 'probably a name';
    return null;
  }

  // ---------------------------------------------------------------- use vs mention (POLICY.md §3.1, §4)
  // Quote marks and emphasis do several jobs: a mention (the word "definately"), an echo of someone else's form
  // ("definately" lol), scare quotes or emphasis on the writer's own word (my "freind"). Only the first two are left
  // alone, and only the words around the quote tell them apart.

  const QUOTE_OPEN = '"\u201c\'\u2018*_';
  const QUOTE_CLOSE = '"\u201d\'\u2019*_';
  // Words about language: in the same sentence as a quoted word, they show it is being talked about.
  const META_WORDS = new RegExp('\\b(words?|homophones?|spell(?:ing|ed|s)?|spelt|grammar|grammatical|pronounc\\w*|' +
    'contractions?|apostrophes?|instead of|difference|differ\\w*|confus\\w*|mistakes?|misus\\w*|' +
    'incorrect\\w*|correct(?:ly)?|wrong(?:ly)?|vs\\.?|versus|meaning|means|sentences?|examples?|e\\.g\\.|' +
    'typos?|autocorrect\\w*|possessive|plural|english|use|using|used|write|writes|writing|wrote|typing|mix(?:ed|ing)? up)\\b', 'i');

  // Is the span [s,e) wrapped in quotes / *emphasis* / _underscores_ (with up to 3 words inside)?
  function isQuoted(text, s, e) {
    let b = s - 1, a = e;
    while (b >= 0 && text[b] === ' ') b--;
    if (/[,.?!:;]/.test(text[a] || '')) a++;
    if (!QUOTE_OPEN.includes(text[b] || 'x') || !QUOTE_CLOSE.includes(text[a] || 'x')) return false;
    // an apostrophe right before is part of a word ("people's"), not a quote
    if ((text[b] === "'" || text[b] === '\u2019') && /[A-Za-z]/.test(text[b - 1] || '')) return false;
    return text.slice(s, e).split(/\s+/).length <= 3;
  }

  const MENTION_BEFORE = /\b(?:the|a|this|that)\s+(?:word|term|phrase|spelling|form)s?\s*[:,]?\s*$|\b(?:say|says|said|saying|type|typed|typing|write|writes|wrote|writing|spell|spells|spelled|spelt|use|used|using|not|than|instead of)\s*[:,]?\s*$/i;
  const MENTION_AFTER = /^\s*[,:]?\s*(?:is|isn['’]t|was|wasn['’]t|means|meant|vs\.?|versus|or|and|nor|instead|\/|has\s+(?:an?|no|two)\b)/i;
  const INTERJECTION = /^(?:lol|lmao|lmfao|smh|ugh|bruh|ok|okay|yeah|yes|no|sure|wow|oh|right|really|seriously|sic|haha+|[^A-Za-z]+)$/i;

  // Why is the quoted or emphasised word at [s,e) a mention or an echo (leave it), rather than a used word (fix it
  // like any other)? opts.block is the paragraph; opts.replacement the proposed fix.
  function mentionReason(text, s, e, opts = {}) {
    const block = opts.block || text;
    // the quote's own edges (the marks right around the span)
    let qs = s, qe = e;
    while (qs > 0 && (text[qs - 1] === ' ' || QUOTE_OPEN.includes(text[qs - 1]))) qs--;
    while (qe < text.length && (/[,.?!:;]/.test(text[qe]) || QUOTE_CLOSE.includes(text[qe]))) qe++;
    const before = text.slice(Math.max(0, qs - 40), qs), after = text.slice(qe, qe + 40);
    if (/\bsic\b/i.test(text.slice(e, e + 12)) || /\[sic\]/i.test(after)) return 'quoted as written (sic)';
    if (MENTION_BEFORE.test(before)) return 'the sentence talks about this word';
    if (MENTION_AFTER.test(after) && !/^\s*(?:and|or)\s+(?:the|a|an|my|i|we|it)\b/i.test(after)) return 'the word itself is the topic';
    const raw = norm(text.slice(s, e));
    if (/\b(?:the|a|an|this|that)\s*$/i.test(before) && (FUNCTION_WORDS.has(raw) || CONFUSABLE.has(raw))) return 'a word quoted as a word';
    const { sentence } = sentenceAround(text, s, e, '');
    // the quote is the whole sentence: someone's form echoed back ("definately" lol)
    const rest = sentence.replace(text.slice(s, e), ' ').split(/\s+/).filter(Boolean);
    if (rest.every((w) => INTERJECTION.test(w.replace(/[^\w]/g, '') || '.'))) return 'quoted on its own, an echo';
    if (META_WORDS.test(sentence) && /\b(word|spell|spelt|grammar|typo|mean|instead|vs|versus|correct|wrong|misspel)/i.test(sentence)) return 'the sentence talks about words';
    // the writer spells it the standard way elsewhere: this one is someone else's, quoted
    if (opts.replacement && /^[A-Za-z' ]+$/.test(opts.replacement)) {
      const re = new RegExp('(?<![A-Za-z])' + opts.replacement.replace(/'/g, "['’]") + '(?![A-Za-z])', 'gi');
      let m;
      while ((m = re.exec(block))) if (m.index < s - 1 || m.index > e) return 'the writer spells it the standard way elsewhere, so this is quoted';
    }
    return null;
  }

  /**
   * Why must the text at [s,e) be left alone? Returns a reason, or null if it may be corrected.
   * opts.block    — the whole paragraph (for voice and repetition)
   * opts.category — 'wrongword' | 'spelling' | 'typo'
   * opts.known    — true when the original is a well-known misspelling from the curated lists
   * opts.names    — words written as names elsewhere on the page (lowercase), from content.js
   */
  function protectedReason(text, s, e, opts = {}) {
    const raw = text.slice(s, e);
    const words = raw.split(/\s+/);
    const block = opts.block || text;
    const cat = opts.category || 'spelling';

    if (isElided(text, s, e)) return 'eye dialect (apostrophe marks dropped sounds)';
    for (const w of words) {
      const bare = norm(w.replace(/^['’]|['’]$/g, ''));
      if (DELIBERATE.has(bare) || DELIBERATE.has(norm(w))) return 'deliberate informal or dialect form';
      if (isStretched(bare)) return 'emphatic stretching';
      if (hasInnerCaps(w)) return 'stylised capitals or a name';
    }
    const name = nameReason(text, s, e, { block, names: opts.names });
    if (name) return name;
    if (cat !== 'wrongword') {
      if (words.some(isAllCaps) && raw.length <= 5) return 'acronym';
      if (dialectDensity(block) >= 2) return 'paragraph is written in a dialect or informal voice';
      if (!opts.known) {
        const re = new RegExp('(?<![A-Za-z])' + raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])', 'gi');
        if ((block.match(re) || []).length >= 2) return 'used consistently, so probably on purpose';
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- register (POLICY.md §4)
  // Some spellings are conventional in casual writing: "would of", "alot", "dont", "im", "everytime".
  // The same spelling is a slip in careful writing and a style in casual writing, so it is judged by
  // the register of the text and by whether the writer shows they know the standard form.

  const JOINED = { everytime: 'every time', aswell: 'as well', atleast: 'at least', eachother: 'each other',
    infact: 'in fact', inspite: 'in spite', alittle: 'a little', abit: 'a bit', ofcourse: 'of course',
    noone: 'no one', thankyou: 'thank you', incase: 'in case', alot: 'a lot' };

  // Which kind of casual form is this fix, if any?
  function casualForm(original, replacement, rule) {
    const o = norm(original).trim();
    if (rule === 'of' || /\b(could|would|should|must|might|may)\s+of\b/.test(o)) return 'of';
    if (Object.prototype.hasOwnProperty.call(JOINED, o)) return 'joined';
    const letters = (str) => str.toLowerCase().replace(/[^a-z]/g, '');
    // "its"/"it's", "were"/"we're", "well"/"we'll": both are real words, so it's a wrong-word swap, not style
    if (/^(its|were|well|ill|hell|shell|wed|id|lets|shed|whos|hed)$/.test(o)) return null;
    if (BARE_CONTRACTIONS.has(o) && letters(original) === letters(replacement)) return 'apostrophe';
    return null;
  }

  // Does the writer use the standard form elsewhere? Then the casual form here is a slip.
  function knowsStandard(text, kind, original) {
    if (kind === 'of') return /\b(could|would|should|must|might|may)(['\u2019]ve|\s+have)\b/i.test(text);
    if (kind === 'joined') {
      const std = JOINED[norm(original).trim()];
      return !!std && new RegExp('\\b' + std.replace(' ', '\\s+') + '\\b', 'i').test(text);
    }
    if (kind === 'apostrophe') return /\b[A-Za-z]+['\u2019](t|re|ve|ll|m|d)\b/i.test(text);
    return false;
  }

  const INTERNET_ABBR = /\b(lol|lmao|lmfao|rofl|tbh|ngl|imo|imho|idk|idc|ikr|smh|fr|rn|omg|wtf|btw|bruh|af|ofc|jk|u|ur|pls|plz|thx)\b/i;

  // 'casual' | 'careful' | 'neutral' for a stretch of text (a comment or paragraph).
  function registerOf(text) {
    const t = text.trim();
    const sentences = t.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => /[A-Za-z]/.test(x));
    let casual = 0, careful = 0;
    const lowerStarts = sentences.filter((x) => /^[a-z]/.test(x)).length;
    if (lowerStarts) casual += lowerStarts >= 2 ? 2 : 1;
    else if (sentences.length >= 2) careful++;
    if (/(^|[\s(])i(?=[\s'\u2019,.!?]|$)/.test(t)) casual++; // lowercase "i"
    if (INTERNET_ABBR.test(t)) casual++;
    if (/\p{Extended_Pictographic}/u.test(t)) casual++;
    if (/[!?]{2,}|\.{4,}/.test(t)) casual++;
    if (t.length > 40 && !/[.!?)"'\u201d\u2019]$/.test(t)) casual++;
    const bare = (t.match(/[A-Za-z]+/g) || []).filter((w) => BARE_CONTRACTIONS.has(w.toLowerCase()) && !/^(cant|wont|hes|shes|whats|were|well|ill|id|its|lets|shell|hell|wed|weve|youll)$/i.test(w)).length;
    if (bare >= 2) casual++;
    if (/\b[A-Za-z]+['\u2019](t|re|ve|ll|m|d)\b/.test(t)) careful++;
    if (/[;:]\s/.test(t)) careful++;
    const words = t.match(/[A-Za-z]+/g) || [];
    if (words.length >= 15 && words.join('').length / words.length > 4.6) careful++;
    if (careful - casual >= 2 && casual === 0) return 'careful';
    if (casual >= 2 || casual > careful) return 'casual';
    return 'neutral';
  }

  // Should a casual form be corrected? mode: 'auto' (default) | 'fix' | 'never'
  function allowCasualFix(text, kind, original, mode = 'auto') {
    if (mode === 'fix') return true;
    if (mode === 'never') return false;
    // A dropped apostrophe (dont, ive, im) is cosmetic: readers don't trip over it, and phone keyboards add
    // apostrophes to some words and not others, so a correct one elsewhere proves nothing. Careful writing only.
    if (kind === 'apostrophe') return registerOf(text) === 'careful';
    return knowsStandard(text, kind, original) || registerOf(text) === 'careful';
  }

  // ---------------------------------------------------------------- AI edits

  function levenshtein(a, b) {
    const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[b.length];
  }

  function soundex(w) {
    const codes = { b: 1, f: 1, p: 1, v: 1, c: 2, g: 2, j: 2, k: 2, q: 2, s: 2, x: 2, z: 2, d: 3, t: 3, l: 4, m: 5, n: 5, r: 6 };
    const s = w.toLowerCase().replace(/[^a-z]/g, '');
    if (!s) return '';
    let out = s[0].toUpperCase(), last = codes[s[0]] || 0;
    for (const ch of s.slice(1)) {
      const c = codes[ch] || 0;
      if (c && c !== last) out += c;
      if (ch !== 'h' && ch !== 'w') last = c;
      if (out.length === 4) break;
    }
    return out.padEnd(4, '0');
  }

  // "yore, your and you're", "their/there": the two words appear side by side, so they are being compared.
  function listedTogether(text, a, b) {
    const esc = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sep = '\\s*(?:,|\\/|&|\\bor\\b|\\band\\b|\\bvs\\.?|\\bversus\\b)\\s*["\'\u2018\u201c*_]?';
    const q = '["\'\u2018\u2019\u201c\u201d*_]?';
    const re = new RegExp(`(?<![A-Za-z])${esc(a)}${q}${sep}${esc(b)}(?![A-Za-z])|(?<![A-Za-z])${esc(b)}${q}${sep}${esc(a)}(?![A-Za-z])`, 'i');
    return re.test(text);
  }

  // Find where an AI edit sits in the paragraph: its context first, then the only occurrence.
  function locate(text, edit) {
    const original = edit.original.trim();
    const esc = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRe = () => new RegExp('(?<![A-Za-z\'’])' + esc(original) + '(?![A-Za-z\'’])', 'g');
    const ctx = typeof edit.context === 'string' ? edit.context.trim() : '';
    const ci = ctx ? text.indexOf(ctx) : -1;
    if (ci >= 0) {
      const m = wordRe().exec(ctx);
      if (m) return { start: ci + m.index, end: ci + m.index + original.length };
    }
    const all = [...text.matchAll(wordRe())];
    return all.length === 1 ? { start: all[0].index, end: all[0].index + original.length } : null;
  }

  /**
   * Is this AI edit allowed? Returns null if yes, otherwise the reason it was dropped.
   * ctx.text   — the paragraph
   * ctx.at     — { start, end } from locate()
   * ctx.isWord — dictionary lookup (only in background.js); when absent, dictionary checks are skipped
   * ctx.known  — (word) => true for curated misspellings
   */
  function checkAiEdit(edit, ctx) {
    if (!edit || typeof edit.original !== 'string' || typeof edit.replacement !== 'string') return 'malformed';
    const original = edit.original.trim();
    const replacement = edit.replacement.trim();
    const cat = ['wrongword', 'spelling', 'typo', 'wordform'].includes(edit.type) ? edit.type : 'spelling';
    if (edit.deliberate === true) return 'the AI thinks it may be deliberate';
    if (edit.confidence && edit.confidence !== 'high') return 'the AI is not sure';
    if (!original || !replacement || original.length > 40 || replacement.length > 40) return 'too long';
    if (original.split(/\s+/).length > 3 || replacement.split(/\s+/).length > 4) return 'rewrite, not a fix';
    if (original.toLowerCase() === replacement.toLowerCase()) return 'capitalisation is style';
    if (/[\d@#/\\_<>{}=]/.test(original)) return 'code, number or handle';
    const letters = (str) => str.toLowerCase().replace(/[^a-z]/g, '');
    if (letters(original) === letters(replacement) && !/['’]/.test(replacement)) return 'punctuation only';
    if (isRegionalVariant(original, replacement)) return 'regional spelling';

    const ow = original.toLowerCase().replace(/’/g, "'").split(/\s+/);
    const rw = replacement.toLowerCase().replace(/’/g, "'").split(/\s+/);
    if (ow.length === 1 && rw.length === 1 && BE_DO_HAVE.has(ow[0]) && BE_DO_HAVE.has(rw[0])) {
      return 'verb agreement varies by dialect';
    }
    if (ow.length === 1 && rw.length === 1 && pronounCase(ow[0], rw[0]) && !confusionPair(ow[0], rw[0])) {
      return 'pronoun case varies by dialect and usage';
    }
    if (ow.length === 1 && rw.length === 1 && /^an?$/.test(ow[0]) && /^an?$/.test(rw[0])) {
      const next = ctx.at ? /^[\s"'“‘(]*([A-Za-z][\w'’-]*)/.exec(ctx.text.slice(ctx.at.end)) : null;
      if (!next || articleFor(next[1]) !== rw[0]) return 'a/an follows the sound of the next word';
    }
    if (cat !== 'wrongword' && cat !== 'wordform' && levenshtein(letters(original), letters(replacement)) > Math.max(2, Math.ceil(original.length * 0.4))) {
      return 'too different to be a typo';
    }

    if (ctx.mentioned && ctx.mentioned(original)) return 'the paragraph is talking about this word';
    const casual = casualForm(original, replacement);
    if (casual && !allowCasualFix(ctx.registerText || ctx.text, casual, original, ctx.casualMode)) {
      return 'casual internet spelling in casual writing';
    }
    if (listedTogether(ctx.text, original, replacement)) return 'listed next to the "correct" word, so being compared';
    if (ctx.at) {
      const known = !!(ctx.known && ctx.known(ow.join(' ')));
      const why = protectedReason(ctx.text, ctx.at.start, ctx.at.end, { block: ctx.text, category: cat, known, names: ctx.names });
      if (why) return why;
    }

    if (ctx.isWord) {
      const isWordish = (w) => {
        const b = w.replace(/^['"]+|['"]+$/g, '');
        return !b || ctx.isWord(b) || CONTRACTIONS.has(b) || ctx.isWord(b.replace(/'s$/, ''));
      };
      if (!rw.every(isWordish)) return 'the suggested word is not a word';
      if (cat === 'wrongword') {
        if (!ow.every(isWordish)) return 'not a real word, so not a wrong-word swap';
        const close = ow.length === rw.length && ow.every((w, i) =>
          levenshtein(w, rw[i]) <= 2 || soundex(w) === soundex(rw[i]));
        const ofHave = /\b(could|would|should|must|might) of\b/.test(ow.join(' '));
        if (!close && !ofHave) return 'not a sound-alike or look-alike swap';
      } else {
        const apostropheOnly = letters(original) === letters(replacement);
        const doubled = /^(\w+)\s+\1$/i.test(original);
        if (!apostropheOnly && !doubled && ow.every(isWordish)) return 'already a real word';
      }
    }
    return null;
  }

  // Models often answer with a whole phrase ("I seen the new peple" -> "I saw the new people").
  // Break that into the word-level changes inside it, so each one is judged on its own.
  function splitEdit(edit) {
    if (!edit || typeof edit.original !== 'string' || typeof edit.replacement !== 'string') return [];
    const tok = (str) => str.trim().split(/\s+/).filter(Boolean);
    const strip = (w) => w.replace(/^[^A-Za-z'\u2019]+|[^A-Za-z'\u2019]+$/g, '');
    const o = tok(edit.original), r = tok(edit.replacement);
    if (o.length <= 1 && r.length <= 1) return [edit];
    // word-level LCS alignment
    const L = Array.from({ length: o.length + 1 }, () => new Array(r.length + 1).fill(0));
    for (let i = o.length - 1; i >= 0; i--) {
      for (let j = r.length - 1; j >= 0; j--) {
        L[i][j] = strip(o[i]).toLowerCase() === strip(r[j]).toLowerCase() ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0, co = [], cr = [];
    const flush = () => {
      if (co.length || cr.length) {
        const a = strip(co.join(' ')), b = strip(cr.join(' '));
        if (a && b && co.length <= 2 && cr.length <= 3) out.push({ ...edit, original: a, replacement: b, context: edit.original });
      }
      co = []; cr = [];
    };
    while (i < o.length || j < r.length) {
      if (i < o.length && j < r.length && strip(o[i]).toLowerCase() === strip(r[j]).toLowerCase()) {
        flush();
        // same word with only a spelling change inside punctuation, e.g. "realy," -> "really,"
        i++; j++;
      } else if (j < r.length && (i >= o.length || L[i][j + 1] >= L[i + 1][j])) { cr.push(r[j++]); } else { co.push(o[i++]); }
    }
    flush();
    // "could of" -> "could have": keep the auxiliary so the of/have rule is recognisable
    return out.map((e) => {
      const m = /\b(could|would|should|must|might)\s+of\b/i.exec(edit.original);
      return m && /^of$/i.test(e.original) ? { ...e, original: m[0], replacement: m[0].replace(/of$/i, 'have') } : e;
    });
  }

  // Decide the kind of change ourselves rather than trusting the model's label.
  function classify(edit, isWord) {
    const letters = (str) => str.toLowerCase().replace(/[^a-z]/g, '');
    const words = (str) => str.toLowerCase().replace(/\u2019/g, "'").split(/\s+/);
    const known = (w) => isWord(w) || CONTRACTIONS.has(w);
    if (letters(edit.original) === letters(edit.replacement)) return { ...edit, type: 'typo' }; // dont -> don't
    if (/^(\w+)\s+\1$/i.test(edit.original.trim())) return { ...edit, type: 'typo' }; // the the
    if (isWordForm(edit.original, edit.replacement, isWord)) return { ...edit, type: 'wordform' }; // fastly -> fast
    return { ...edit, type: words(edit.original).every(known) ? 'wrongword' : 'spelling' };
  }

  // Confusion sets (POLICY.md §0): the real-word slips people actually make, words that sound or look alike.
  // A real word is only ever swapped for another member of its own set, or for a keyboard slip (below).
  const CONFUSION_SETS = `their/there/they're/theyre your/you're/youre/yore its/it's then/than were/where/we're/wear
    whose/who's lose/loose losing/loosing affect/effect affects/effects accept/except advice/advise
    breath/breathe quiet/quite past/passed weather/whether/wether principal/principle compliment/complement
    stationary/stationery led/lead lightning/lightening peak/peek/pique rein/reign discreet/discrete
    brake/break bare/bear aloud/allowed council/counsel desert/dessert farther/further hear/here knew/new
    piece/peace plain/plane write/rite/right sight/site/cite threw/through/thorough though/thought/tough
    wait/weight weak/week which/witch whole/hole wood/would buy/by/bye die/dye fair/fare flour/flower
    heal/heel mail/male meat/meet won/one pair/pear rode/road sail/sale tail/tale role/roll seen/scene
    chose/choose cloths/clothes dose/does everyday alot/allot apart awhile anyway sense/since
    definite/defiant emigrate/immigrate eminent/imminent ensure/insure/assure envelop/envelope later/latter
    moral/morale personal/personnel precede/proceed prophecy/prophesy prostate/prostrate shudder/shutter
    suit/suite tenet/tenant vain/vein/vane waist/waste wreck/reck yoke/yolk boarder/border bored/board
    course/coarse due/dew to/too/two of/off a/an`.trim().split(/\s+/).map((g) => g.split('/'));
  const PARTNERS = new Map();
  for (const g of CONFUSION_SETS) for (const w of g) PARTNERS.set(w, new Set([...(PARTNERS.get(w) || []), ...g.filter((x) => x !== w)]));
  const confusionPair = (a, b) => !!PARTNERS.get(norm(a))?.has(norm(b));
  // Commonly confused words: the only real words a slip can turn into that a reader would trip over.
  const CONFUSABLE = new Set([...PARTNERS.keys()].filter((w) => !/^(to|of|a|an|by|one|right|off|two)$/.test(w)));

  // Is a paragraph worth asking the AI about? Only if it holds a non-word or a commonly confused word.
  // Every slip shows up as one or the other, so nothing is hidden by skipping the rest.
  function worthChecking(text, isWord) {
    const re = /[A-Za-z]+(?:['\u2019][A-Za-z]+)*/g;
    let m;
    while ((m = re.exec(text))) {
      const w = m[0].toLowerCase().replace(/\u2019/g, "'");
      if (CONFUSABLE.has(w)) return true;
      if (w.length > 2 && !isWord(w) && !CONTRACTIONS.has(w) && !DELIBERATE.has(w) && !/^[A-Z]/.test(m[0])) return true;
      if (BARE_CONTRACTIONS.has(w)) return true; // dont, youre
    }
    return /\b(\w+)\s+\1\b/i.test(text); // the the
  }

  // The sentence around [s,e), as written and with the fix applied.
  function sentenceAround(text, s, e, replacement) {
    let a = s, b = e;
    while (a > 0 && !/[.!?\n]/.test(text[a - 1]) && s - a < 200) a--;
    while (b < text.length && !/[.!?\n]/.test(text[b]) && b - e < 200) b++;
    if (b < text.length && /[.!?]/.test(text[b])) b++;
    const clean = (t) => t.replace(/\s+/g, ' ').trim();
    return {
      sentence: clean(text.slice(a, b)),
      fixedSentence: clean(text.slice(a, s) + replacement + text.slice(e, b)),
    };
  }

  // ---------------------------------------------------------------- offline spellchecker
  // A non-word with exactly ONE dictionary word a single keystroke away (a letter dropped, added, changed,
  // or two letters swapped) is very likely a slip for that word: peple -> people, freind -> friend.
  // With several neighbours (realy: really, rely, relay…) or none (doomscroll) nothing is suggested, which
  // also keeps most brand names out (flickr: flick, flicker, flicks). A suggestion is never applied on its
  // own: the AI must prefer the corrected sentence in both orders, then the final check runs as usual.

  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

  function oneEditNeighbours(w, isWord) {
    const out = new Set();
    for (let i = 0; i <= w.length; i++) {
      const a = w.slice(0, i), b = w.slice(i);
      if (b) out.add(a + b.slice(1));
      if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));
      for (const c of ALPHABET) {
        if (b) out.add(a + c + b.slice(1));
        out.add(a + c + b);
      }
    }
    out.delete(w);
    return [...out].filter(isWord);
  }

  /**
   * Spelling suggestions for the AI to confirm: [{ original, replacement, context, sentence, fixedSentence }].
   * opts.known     — (word) => true for misspellings the rules already fix (no need to ask)
   * opts.mentioned — (word) => true when the paragraph is talking about the word
   * opts.max       — at most this many per paragraph (each costs two AI questions)
   */
  function spellSuggestions(text, isWord, opts = {}) {
    const out = [];
    const re = /(?<![\w'’@#/\\.-])[A-Za-z]{4,}(?![\w'’@#/\\-]|\.\w)/g;
    let m;
    while ((m = re.exec(text)) && out.length < (opts.max || 3)) {
      const raw = m[0], w = raw.toLowerCase();
      if (isWord(w) || CONTRACTIONS.has(w) || BARE_CONTRACTIONS.has(w) || DELIBERATE.has(w)) continue;
      if (opts.known && opts.known(w)) continue;
      if (opts.mentioned && opts.mentioned(raw)) continue;
      const s = m.index, e = s + raw.length;
      // quoted or emphasised: skipped only for a mention or an echo (POLICY.md §4); the candidate isn't known yet,
      // so the echo test uses the nearest dictionary word below
      const marked = /["“”‘*_]/.test(text[s - 1] || '') || /["“”’*_]/.test(text[e] || '');
      if (protectedReason(text, s, e, { block: text, category: 'spelling' })) continue;
      const near = oneEditNeighbours(w, isWord);
      if (near.length !== 1 || isRegionalVariant(w, near[0])) continue;
      if (marked && mentionReason(text, s, e, { block: text, replacement: near[0] })) continue;
      const replacement = /^[A-Z]/.test(raw) ? near[0][0].toUpperCase() + near[0].slice(1) : near[0];
      out.push({
        original: raw, replacement,
        context: text.slice(Math.max(0, s - 25), Math.min(text.length, e + 25)),
        ...sentenceAround(text, s, e, replacement),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- a / an (POLICY.md §2)
  // The article follows the SOUND of the next word, not its first letter: an hour, a university, a one-off.
  // 'a', 'an', or null when the spelling doesn't settle the sound (acronyms, numbers, h-words like "historic"
  // that careful writers split on). Nothing may move an article away from this, whoever proposes it.
  function articleFor(word) {
    if (!word || word.length < 2 || !/^[A-Za-z]/.test(word) || word === word.toUpperCase()) return null;
    const w = norm(word);
    if (/^(hour|honest|honor|honour|heir)/.test(w)) return 'an';
    if (/^(uni|use|usu|eu|one|once|ewe|ur)/.test(w)) return 'a';
    if (/^[aio]/.test(w) || /^e/.test(w) ||
      (/^u(n|m|p|s(?!e|u|ur)|t(?!il|ensil|opi)|gl|lt|nder)/.test(w) && !/^unan/.test(w))) return 'an';
    if (/^h/.test(w)) return null;
    return /^[bcdfgjklmnpqrstvwxyz]/.test(w) ? 'a' : null;
  }

  // ---------------------------------------------------------------- word forms (POLICY.md §2, "Word forms")
  // Over-regularisation: the regular ending put on a word whose real form is irregular or has no ending at all.
  // fast + -ly -> "fastly" (the adverb is just "fast"), go + -ed -> "goed" (went). In the words-and-rules model
  // of morphology, a stored irregular form blocks the regular rule (Aronoff 1976; Pinker 1999); when it isn't
  // retrieved in time, the rule fills the gap. Only forms that are words in no variety the dictionary covers are
  // listed (test/dictcheck.cjs checks). Regularised pasts that belong to dialect grammar (knowed, growed,
  // throwed, catched) are deliberate, and so are jokey ones (badder, funner, bestest, thanks muchly).

  // Flat adverbs with no -ly form: the adjective is the adverb (run fast, come soon).
  const FLAT_ADVERBS = S('fast often soon seldom');
  // regularised:past[:participle]
  const REGULARISED = new Map(`goed:went:gone bringed:brought buyed:bought thinked:thought teached:taught
    seeked:sought fighted:fought runned:ran:run swimmed:swam:swum eated:ate:eaten drinked:drank:drunk
    writed:wrote:written speaked:spoke:spoken breaked:broke:broken choosed:chose:chosen taked:took:taken
    gived:gave:given falled:fell:fallen feeled:felt keeped:kept sleeped:slept meeted:met sitted:sat standed:stood
    understanded:understood telled:told selled:sold finded:found holded:held winned:won beginned:began:begun
    drived:drove:driven rided:rode:ridden weared:wore:worn stealed:stole:stolen freezed:froze:frozen
    forgetted:forgot:forgotten forgived:forgave:forgiven getted:got maked:made hitted:hit cutted:cut letted:let
    hurted:hurt shutted:shut spreaded:spread sended:sent spended:spent lended:lent meaned:meant
    comed:came:come becomed:became:become flyed:flew:flown bited:bit:bitten shaked:shook:shaken feeded:fed
    bleeded:bled fleed:fled sticked:stuck striked:struck shooted:shot slided:slid sinked:sank:sunk
    shrinked:shrank:shrunk spinned:spun dealed:dealt sweeped:swept weeped:wept sweared:swore:sworn
    stinged:stung clinged:clung flinged:flung forbidded:forbade:forbidden arised:arose:arisen
    undertaked:undertook:undertaken overcomed:overcame:overcome withdrawed:withdrew:withdrawn
    mistaked:mistook:mistaken beated:beat:beaten splitted:split upsetted:upset bursted:burst`
    .trim().split(/\s+/).map((x) => { const [f, past, part] = x.split(':'); return [f, [past, part || past]]; }));

  // After have/be (and a few adverbs in between) the participle is wanted: "has goed" -> "has gone".
  const PERFECT_OR_PASSIVE = /\b(have|has|had|having|'ve|’ve|'d|’d|be|been|being|is|are|was|were|am|'s|’s|'re|’re|get|gets|got|getting)\s+((just|already|never|not|ever|also|really|n't|finally|all)\s+){0,2}$/i;

  /**
   * The standard form of an over-regularised word, or null. text/s: where it sits (to choose past or
   * participle from the words before it).
   */
  function wordForm(word, text = '', s = 0) {
    const w = norm(word);
    if (w.endsWith('ly') && FLAT_ADVERBS.has(w.slice(0, -2))) return w.slice(0, -2);
    const forms = REGULARISED.get(w);
    if (!forms) return null;
    return PERFECT_OR_PASSIVE.test(text.slice(Math.max(0, s - 40), s)) ? forms[1] : forms[0];
  }

  // Fixed frames (phraseology): some phrases only take one form of a word in their slot. "on a/every … basis"
  // is singular, so "bases" there is the plural slipped in (sounds almost the same). With "the" it could be
  // the plural of base (on the naval bases), so only the adjectives that go with "basis" count.
  const BASIS_COLLOCATES = S(`daily weekly monthly yearly annual quarterly hourly nightly regular routine
    permanent temporary full-time part-time voluntary ongoing consistent individual one-off trial ad-hoc ad
    hoc case-by-case need-to-know first-come first-name pro-rata rolling continuous constant frequent
    occasional casual contract freelance per-project as-needed day-to-day long-term short-term`);
  function frameForm(word, text, s, e) {
    if (norm(word) !== 'bases') return null;
    const m = /\bon\s+(a|an|every|each|one|this|that|the)\s+((?:[\w-]+\s+){1,2})$/i.exec(text.slice(Math.max(0, s - 60), s));
    if (!m) return null;
    const mods = m[2].trim().toLowerCase().split(/\s+/);
    if (/^the$/i.test(m[1]) && !mods.some((x) => BASIS_COLLOCATES.has(x))) return null;
    if (/^\s*of\b/i.test(text.slice(e, e + 8)) && /^the$/i.test(m[1])) return null; // "on the weekly bases of …"? leave it
    return 'basis';
  }
  // Greek -is/-es pairs: singular vs plural is grammar (the analyses show), so the AI never swaps them on its own.
  const IS_ES = S('basis crisis thesis analysis hypothesis axis diagnosis emphasis oasis synopsis parenthesis');
  const numberPair = (a, b) => (IS_ES.has(a) && b === a.slice(0, -2) + 'es') || (IS_ES.has(b) && a === b.slice(0, -2) + 'es');

  // Is b the standard form of over-regularised a? (For proposals from the AI, which may know forms we don't list.)
  function isWordForm(a, b, isWord) {
    a = norm(a).trim(); b = norm(b).trim();
    const forms = REGULARISED.get(a);
    if (forms) return forms.includes(b);
    if (FLAT_ADVERBS.has(b) && a === b + 'ly') return true;
    // any non-word "<adverb>ly" whose stem is the adverb: the flat-adverb pattern itself
    return !!isWord && a === b + 'ly' && isWord(b) && !isWord(a);
  }

  // ---------------------------------------------------------------- decision model (POLICY.md §0)
  // Every proposed change is judged the same way, whoever proposed it:
  //   1. mechanism — HOW could the writer have produced the original by accident? (keyboard slip, sound-alike,
  //      apostrophe or space, misspelling, word form: a regular ending on an irregular word). A change with no slip mechanism isn't a slip: it's grammar,
  //      dialect or a rewrite, and is never made.
  //   2. gravity   — how much does it matter to the reader? meaning (a different real word), legibility
  //      (a non-word), form (the right word, wrongly built: fastly), cosmetic (apostrophes, spacing). Cosmetic changes need the most evidence.
  //   3. evidence  — guards (POLICY.md §3–4), register, and the AI agreeing with itself in both orders.

  const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const NEAR_KEYS = {};
  ROWS.forEach((row, r) => [...row].forEach((ch, i) => {
    NEAR_KEYS[ch] = new Set([row[i - 1], row[i + 1], ROWS[r - 1]?.[i], ROWS[r - 1]?.[i + 1], ROWS[r + 1]?.[i - 1], ROWS[r + 1]?.[i]].filter(Boolean));
  }));

  // One adjacent key hit instead of another, or two neighbouring letters swapped: is -> us, form -> from.
  function keyboardSlip(a, b) {
    if (a.length !== b.length || a === b) return false;
    const diff = [...a].map((ch, i) => i).filter((i) => a[i] !== b[i]);
    if (diff.length === 1) return !!NEAR_KEYS[a[diff[0]]]?.has(b[diff[0]]);
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }

  function keyboardNeighbours(w) {
    const out = new Set();
    for (let i = 0; i < w.length; i++) {
      for (const k of NEAR_KEYS[w[i]] || []) out.add(w.slice(0, i) + k + w.slice(i + 1));
      if (i < w.length - 1) out.add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
    }
    out.delete(w);
    return [...out];
  }

  // Grammar, not slips: the case of a pronoun (they/them), agreement (is/are), inflection (walk/walks).
  // Dialects and usage differ on all of these (POLICY.md §3.4, §3.11).
  const PRONOUN_SETS = [S('i me my mine myself'), S('we us our ours ourselves'), S('they them their theirs themselves'),
    S('he him his himself'), S('she her hers herself'), S('who whom whose'), S('you your yours yourself')];
  const pronounCase = (a, b) => PRONOUN_SETS.some((set) => set.has(a) && set.has(b));
  const stem = (w) => w.replace(/(ing|ed|es|s|d|ly)$/, '');

  // Short words are only swapped for other common short words (the closed class), never rare dictionary entries.
  const FUNCTION_WORDS = S(`a an the of to in on at by for from with as is am are was be it its us we me my he him
    his her she they them you i if or and but so no not do did has had can may will this that who what when how
    there here than then up out off all any one too two our your their were where why which`);

  function mechanism(original, replacement, isWord) {
    const o = norm(original).trim(), r = norm(replacement).trim();
    const letters = (s) => s.replace(/[^a-z]/g, '');
    if (/^(\w+)\s+\1$/.test(o)) return 'doubled';
    if (letters(o) === letters(r)) return /'/.test(r) && !/\s/.test(o) && !/'/.test(o) ? 'apostrophe' : 'spacing';
    if (/\b(could|would|should|must|might|may)\s+of\b/.test(o)) return 'soundalike';
    const ow = o.split(/\s+/), rw = r.split(/\s+/);
    if (ow.length !== 1 || rw.length !== 1) return 'rewrite';
    const [a, b] = [ow[0], rw[0]];
    if (confusionPair(a, b)) return 'soundalike';
    if (isWordForm(a, b, isWord)) return 'wordform'; // before grammar: fastly -> fast is a built form, not a choice
    if (pronounCase(a, b) || (BE_DO_HAVE.has(a) && BE_DO_HAVE.has(b)) || numberPair(a, b) || (stem(a) === stem(b) && a !== b)) return 'grammar';
    if (!isWord) return 'unknown'; // no dictionary here (content script): background.js has already judged it
    if (!(isWord(a) || CONTRACTIONS.has(a))) return 'misspelling';
    if (keyboardSlip(a, b)) return 'keyboard';
    return 'unexplained';
  }

  const GRAVITY = { soundalike: 'meaning', keyboard: 'meaning', unexplained: 'meaning', grammar: 'meaning',
    misspelling: 'legibility', wordform: 'form', apostrophe: 'cosmetic', spacing: 'cosmetic', doubled: 'cosmetic' };

  /**
   * Judge one proposed edit (from the AI or the spellchecker).
   * Returns { verdict, why, mechanism, gravity, register }, verdict one of:
   *   'apply'   — mechanical slip, guards passed
   *   'confirm' — plausible slip: the AI must prefer the fix in both orders
   *   'repair'  — the word looks wrong to the AI but its suggestion has no slip mechanism (is -> its);
   *               try the words a slip could have come from instead (is -> us), see alternatives()
   *   'block'   — not a slip, with the reason
   * ctx is checkAiEdit's ctx (text, at, isWord, known, mentioned, casualMode, registerText).
   */
  function judgeEdit(edit, ctx) {
    const mech = mechanism(edit.original, edit.replacement, ctx.isWord);
    const out = { mechanism: mech, gravity: GRAVITY[mech] || 'meaning', register: registerOf(ctx.registerText || ctx.text) };
    const why = checkAiEdit(edit, ctx);
    if (why) return { ...out, verdict: 'block', why };
    if (mech === 'grammar') return { ...out, verdict: 'block', why: 'grammar or dialect (pronoun case, agreement, word ending), not a slip' };
    if (mech === 'rewrite') return { ...out, verdict: 'block', why: 'rewrite, not a fix' };
    if (mech === 'unexplained') return { ...out, verdict: 'repair', why: 'no slip turns one of these words into the other' };
    if (mech === 'apostrophe' || mech === 'spacing' || mech === 'doubled') return { ...out, verdict: 'apply', why: '' };
    return { ...out, verdict: 'confirm', why: '' };
  }

  // Real words a slip of this word could have come from: its confusion set and keyboard neighbours.
  function alternatives(word, isWord) {
    const w = norm(word);
    const pool = w.length <= 3 ? (x) => FUNCTION_WORDS.has(x) : (x) => isWord(x);
    const out = new Set([...(PARTNERS.get(w) || [])]);
    for (const x of keyboardNeighbours(w)) if (pool(x)) out.add(x);
    return [...out].filter((x) => x !== w && !pronounCase(w, x) && !(BE_DO_HAVE.has(w) && BE_DO_HAVE.has(x))).slice(0, 3);
  }

  // ---------------------------------------------------------------- a fix the reader asked for (POLICY.md §5)
  // "Fix this comment": the reader has looked and wants it fixed, joke or not, so the guards that protect the writer's
  // style step aside. What's left is proof that the model corrected the text instead of rewriting it: its version is
  // aligned with the original word by word, and each changed run must stay close in letters and end in real words.
  // Runs split by a space (orre t -> correct) are fine here. Returns [{ start, end, original, replacement, type }].
  function restoredEdits(text, corrected, isWord) {
    const toks = (t) => [...String(t).matchAll(/\S+/g)].map((m) => ({ w: m[0], s: m.index, e: m.index + m[0].length }));
    const o = toks(text), r = toks(corrected);
    const letters = (t) => t.toLowerCase().replace(/[^a-z]/g, '');
    // a different text altogether (an answer, a summary), not the same words corrected
    const a = letters(text), b = letters(corrected);
    if (!a || !b || levenshtein(a, b) > Math.max(4, a.length * 0.35)) return [];
    const same = (x, y) => x.w === y.w;
    const L = Array.from({ length: o.length + 1 }, () => new Array(r.length + 1).fill(0));
    for (let i = o.length - 1; i >= 0; i--) {
      for (let j = r.length - 1; j >= 0; j--) {
        L[i][j] = same(o[i], r[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    const out = [];
    const flush = (co, cr) => {
      if (!co.length || !cr.length) return; // a word only added or only removed is a rewrite
      const start = co[0].s, end = co[co.length - 1].e;
      const original = text.slice(start, end), replacement = cr.map((x) => x.w).join(' ');
      const x = letters(original), y = letters(replacement);
      if (x === y && co.length === cr.length) return; // punctuation or capitals: style
      if (levenshtein(x, y) > Math.max(2, Math.ceil(Math.max(x.length, y.length) * 0.5))) return;
      const bare = (w) => norm(w).replace(/^[^a-z']+|[^a-z']+$/g, '');
      const compound = (w) => [...w].some((_, n) => n >= 3 && w.length - n >= 3 && isWord(w.slice(0, n)) && isWord(w.slice(n))); // autocorrect
      const real = (w) => !bare(w) || isWord(bare(w)) || CONTRACTIONS.has(bare(w)) || isWord(bare(w).replace(/'s$/, '')) || compound(bare(w));
      if (!cr.every((t) => real(t.w))) return;
      out.push({ start, end, original, replacement, type: co.every((t) => real(t.w)) ? 'wrongword' : 'spelling' });
    };
    let i = 0, j = 0, co = [], cr = [];
    while (i < o.length || j < r.length) {
      if (i < o.length && j < r.length && same(o[i], r[j])) { flush(co, cr); co = []; cr = []; i++; j++; }
      else if (i < o.length && (j >= r.length || L[i + 1][j] >= L[i][j + 1])) co.push(o[i++]); // ties: "at brake at" -> "a break at"
      else cr.push(r[j++]);
    }
    flush(co, cr);
    return out;
  }

  // Common letters a long paragraph (almost) never uses, when there are several: they are probably what went missing
  // (a stuck key, or the space bar hit instead of the bottom row). Only a hint for the model when the reader asks for a fix.
  function missingLetters(text) {
    const all = text.toLowerCase().replace(/[^a-z]/g, '');
    if (all.length < 100) return [];
    const count = (ch) => all.split(ch).length - 1;
    // less common letters must be absent; common ones may survive once ("spelling" kept its n)
    const lost = [...'abcdefghilmnoprstuwy'].filter((ch) => count(ch) <= ('bfgpwy'.includes(ch) ? 0 : 1));
    return lost.length >= 2 ? lost : [];
  }

  // ---------------------------------------------------------------- the policy, in words, for the AI

  const PROMPT_POLICY = `Your job is to restore what the writer MEANT to write when they slipped. You are not an editor
imposing one standard of English. A wrong correction is much worse than a missed one.

Correct ONLY clear slips:
- misspellings of ordinary words that are not words in any variety of English ("definately", "recieve")
- keyboard typos ("teh", "jsut") and accidentally doubled words ("the the")
- the wrong one of two words that sound alike, when the sentence shows which was meant
  ("their" for "there", "your" for "you're", "then" for "than", "were" for "where", "could of" for "could have")
- missing apostrophes in contractions ("dont")

These are DELIBERATE and must be left alone:
- words being talked about rather than used: quoted, listed, compared, or given as examples of mistakes
- eye dialect and spoken forms, especially with apostrophes for dropped sounds: readin', writin', 'rithmatic,
  goin', 'em, ol', gonna, wanna, kinda, dunno, coulda
- British, Irish, Canadian, Australian, Indian and other regional spellings (colour, organise, centre, tyre, mum)
- dialects with their own grammar and words: African American English (finna, tryna, ain't, "they was"),
  Scots (dinnae, wee, aye), Irish (ye, youse), Southern US (y'all, fixin' to) and others
- internet style: u, ur, rn, tbh, lol, sooo, smol, doggo, lowercase, mocking caps
- quotations, lyrics, titles, slogans, brand names, archaic words (thou, 'tis, whilst)
- names, usernames, products, code, URLs, hashtags, foreign words, new slang, puns and portmanteaus
- usage some style guides dislike but which is not a slip (irregardless, anyways, alright, singular they)`;

  const api = {
    DELIBERATE, CONTRACTIONS, PROMPT_POLICY,
    protectedReason, dialectDensity, isElided, isRegionalVariant, checkAiEdit, locate, levenshtein, soundex,
    splitEdit, classify, worthChecking, CONFUSABLE, casualForm, knowsStandard, registerOf, allowCasualFix,
    sentenceAround, spellSuggestions, mechanism, judgeEdit, alternatives, keyboardSlip, confusionPair,
    articleFor, wordForm, isWordForm, frameForm, nameReason, namesIn, isTitleCase, KNOWN_NAMES, REGULARISED, FLAT_ADVERBS,
    restoredEdits, missingLetters, regionalTable, regionalReason, REGION_NAME, varietyName, isQuoted, mentionReason, META_WORDS, capsStyle,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IAC_Policy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
