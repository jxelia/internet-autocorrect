/*
 * Internet Autocorrect — correction engine.
 * Pure function of text -> list of fixes. No DOM access, so it can be unit-tested in Node.
 *
 * Three categories, each with its own colour on the page:
 *   wrongword  — a real word used in the wrong place (their/there/they're, your/you're, then/than, could of...)
 *   spelling   — a word that isn't a word (definately, recieve, seperate...)
 *   typo       — slips of the fingers (missing apostrophes, spaces, doubled words)
 */
(function (root) {
  'use strict';

  const S = (str) => new Set(str.trim().split(/\s+/));
  const P = root.IAC_Policy || (() => {
    try { return require('./policy.cjs'); } catch (_) { return require('./policy.js'); }
  })();

  // What the reader sees (GOALS.md §4): plain names, ordered as the popup lists them.
  const CATEGORIES = {
    wrongword: { label: 'Wrong word', color: '#2563eb' },
    spelling: { label: 'Misspelling', color: '#e11d48' },
    typo: { label: 'Typo', color: '#d97706' },
    // Not a slip: another region's correct spelling shown in the reader's own, only when they turn it on (POLICY.md §7)
    regional: { label: 'Your spelling', color: '#0d9488' },
  };
  // Older entries and the policy's internal kinds may name a kind the reader doesn't see as its own category:
  // a wrong word form (fastly, a apple, on a weekly bases) is shown as a wrong word (GOALS.md §4).
  const categoryOf = (c) => (CATEGORIES[c] ? c : c === 'wordform' ? 'wrongword' : 'spelling');

  // ---------------------------------------------------------------- word sets

  const BE = S(`is was are were be been being isn't wasn't aren't weren't am will would could should can
    might may must shall won't wouldn't couldn't shouldn't can't`);
  const PLACE = S(`in out over up down back here get got go goes went gone stay stayed staying stuck sitting
    standing from near live lives lived living move moved drive drove walk walked put left be been there
    is was are were isn't wasn't aren't weren't`);
  const PLACE_END = S(`over out up down back get go went been stay stayed here in from sitting standing right`);
  const THERE_VERB = S(`is are was were isn't aren't wasn't weren't`);
  const MODAL_HAVE = S(`will would could should might must may has have had can`);
  const ING_THEY = S(`going doing trying getting making saying coming playing using taking looking talking
    working running gonna wanting asking telling thinking acting pretending lying`);
  const ADV_THEY = S(`always never probably definitely literally actually already basically totally
    completely clearly obviously`);
  const POSS_NOUNS = S(`own car cars kids children child parents money job jobs life lives fault minds mind
    opinion opinions phone phones wife wives husband husbands mom moms dad dads mother father son sons
    daughter daughters website account accounts names name heads head eyes hands behalf house houses
    dog dogs cat cats boss bodies body business problem problems choice decision faces pockets`);
  const THERE_POSS_EXTRA = S(`family friends team home best way`);

  const YOU_RE_ALWAYS = S(`a an the not so too very gonna going welcome just really probably literally still
    always never kidding joking talking saying trying getting making missing thinking looking supposed
    allowed both already absolutely totally completely actually definitely basically clearly obviously
    simply doing asking telling confusing describing assuming using overthinking such quite almost`);
  const YOU_RE_PRED = S(`right wrong correct sure crazy stupid insane done here there better worse on in at
    ok okay fine safe good bad old young smart dumb cute awesome amazing beautiful gorgeous hilarious funny
    ridiculous delusional mistaken confused entitled lying`);
  const PRED_FOLLOW = S(`about that though lol and but i it haha lmao man dude bro mate too for if when
    because now`);
  const YOUR_NOUNS = S(`own car mom dad mother father wife husband girlfriend boyfriend kids children life
    phone account money job fault opinion name comment post house problem choice turn dog cat parents
    brain head eyes argument point`);

  const ITS_ALWAYS = S(`a an the not been going gonna just really so very too always never still all like
    also actually literally pretty probably definitely kinda almost what because my your his our called
    getting gotten no`);
  const ITS_PRED = S(`true fine okay ok hard easy worth funny weird crazy sad nice cool insane possible
    impossible better worse over here there now time about obvious clear`);
  const ITS_FOLLOW = S(`to that for and but though lol i if when because how being as enough haha just you
    now`);
  // Possessive "its" is always followed by what it owns. These can't be owned, so "its" was "it's":
  // other determiners, pronouns, prepositions (POLICY.md §0: word class decides the confusion set).
  const ITS_NOT_OWNED = S(`this these those every each some any another such her their what which whose
    me him them us he she we they who about for at from with without after before under into`);

  // What's before the word tells a possessive from a contraction. After a preposition only a possessive fits ("ahead of
  // its time", "of your very own"). "They're/you're" starts a clause, so before a verb or adverb form it needs a clause
  // to be starting: "I think their going" yes, "align their thinking", "getting their actually good" no.
  const BARE_VERB = S(`want need have think know like love mean do get go see care feel believe say`);
  const PREPOSITION = S(`of on in at by for from with without into onto over under about after before through across
    against between during within upon per via toward towards among around near off up down`);
  const CLAUSE_OPENER = S(`and but because cause cuz cos so if when while since though although that think thinks thought
    know knew knows hope guess believe say says said sure maybe as yet or unless until once yeah yes no honestly well ok
    okay oh now then man dude bro lol haha actually sorry wow hey see`);
  const COMPARATIVE = S(`more less better worse rather other bigger smaller larger higher lower faster slower
    easier harder longer shorter older younger cheaper greater stronger weaker smarter fewer louder quicker
    richer poorer safer further farther heavier lighter happier nicer cooler hotter colder warmer`);
  const THEN_PREV = S(`and since until till back`);
  const MODAL_OF = S(`could would should must might couldn't wouldn't shouldn't mustn't`);
  const NOT_PARTICIPLE = S(`course which them those these the a an my your his her our their it us me you
    all both`);
  const LOSE_PREV = S(`to will gonna wanna might could would can cant can't don't dont didn't didnt never
    not i'll you'll we'll they'll he'll she'll should must may wont won't`);
  const LOOSE_PREV = S(`too very came come comes coming broke cut let hang set pretty got getting slightly
    kinda bit`);
  const LOOSE_NEXT = S(`and but on in at around fit ends end change cannon screw screws`);
  const AFFECT_PREV = S(`an the no side any positive negative big huge great little opposite butterfly
    placebo domino desired into lasting`);
  const EFFECT_PREV = S(`will would could can doesn't didn't don't won't not might may negatively
    positively directly really greatly seriously severely`);
  // The -ed lost where its /d/ runs into "to": it can't be heard, so the spelling follows the ear (POLICY.md §2).
  const ED_BEFORE_TO = { use: 'used', suppose: 'supposed', oppose: 'opposed', expose: 'exposed', accustom: 'accustomed' };
  const BE_FORM = S(`am is are was were be been being isn't aren't wasn't weren't ain't isnt arent wasnt werent
    i'm you're we're they're he's she's that's who's im youre theyre hes shes thats`);
  const GET_FORM = S(`get gets got gotten getting become becomes became becoming grow grows grew grown growing`);
  const ED_DEGREE = S(`not never so really pretty very quite already still just always finally slowly gradually
    kinda sorta totally completely all`);
  const BE_INVERTED = S(`what's whats how's hows where's why's`);
  const SUBJECT_PRONOUN = S(`i you he she it we they this that these those`);
  const TOO_NEXT = S(`much many late early long big small hard easy far bad expensive cheap hot cold young
    old soon busy tired lazy slow fast good`);
  const TOO_PREV = S(`way far much is was it's its are were be been not getting that's thats i'm im
    you're they're we're he's she's seems looks sounds feel feels felt just`);
  const TO_NEXT = S(`the a my your be go do get see make have him them us`);
  const WHERE_NOUNS = S(`issues issue cases case places place situations situation times areas area parts part
    spots spot point points instances instance countries country states state cities city town towns house
    home room rooms thread threads post posts sub subs site sites app apps games game scenes scene videos
    video episodes episode moments moment jobs job schools school stores store restaurants restaurant
    world office offices areas level levels stage stages`);
  const SUBJECTS = S(`i you he she we they it people someone everyone nobody`);
  const CHOOSE_AUX = S(`to doesn't don't didn't can't cannot won't will would could should can might must
    wouldn't couldn't shouldn't dont doesnt didnt cant wont`);
  const WHOS_NEXT = S(`going gonna the a an not coming been there doing that this`);
  const WHOSE_NEXT = S(`car house fault turn job idea side name phone kid kids dog`);
  // Not "in", "on" or "it": doubled, they're usually two jobs ("type that in in order", "sees it it is").
  const REPEATABLE = S(`the a an to of and for with at this be from by as my your we they are was
    but that is`);
  const REPEAT_OK = S(`that is had`); // "I know that that's...", "what it is is...", "he had had"
  // A verb's particle, then a preposition that happens to match: "got in in 1999", "where you go to to fight".
  const PARTICLE_VERB = S(`go goes going went gone come comes coming came get gets getting got log logs logged check checks
    checked turn turns turned hand hands handed move moves moved put puts sign signs signed step steps stepped tune tuned
    chip chips run runs ran hold holds held walk walks walked want wants wanted`);
  const DOUBLED_PARTICLE = S(`to by`);
  // After a/an, words that can't begin what it introduces: another slip ("comes in an says" is "and"), not the article.
  const NOT_AFTER_ARTICLE = S(`says said was is are were has have had will would should can could then when where which who
    that this these those the a an my his her their our your of in on at to for from with by and or but if because so not
    indeed you i we they he she it him me us them`);
  // Contractions people type without the apostrophe.
  const CONTRACTIONS = {
    dont: "don't", doesnt: "doesn't", dosnt: "doesn't", didnt: "didn't", isnt: "isn't", wasnt: "wasn't",
    werent: "weren't", arent: "aren't", couldnt: "couldn't", wouldnt: "wouldn't", shouldnt: "shouldn't",
    havent: "haven't", hasnt: "hasn't", hadnt: "hadn't", cant: "can't", wont: "won't", im: "I'm",
    ive: "I've", youre: "you're", theyre: "they're", thats: "that's", whats: "what's", wouldve: "would've",
    couldve: "could've", shouldve: "should've", youve: "you've", theyve: "they've", aint: "ain't",
    theres: "there's", youll: "you'll", theyll: "they'll", itll: "it'll", hes: "he's", shes: "she's",
    doesn: "doesn't", mustve: "must've", mightve: "might've", wasnt: "wasn't",
  };

  // Words that aren't words. Map misspelling -> correction.
  const SPELLING = {};
  `accomodate:accommodate acomodate:accommodate accomodation:accommodation acheive:achieve acheived:achieved
  acheivement:achievement accross:across accidently:accidentally acceptible:acceptable adress:address
  agressive:aggressive alcohal:alcohol allready:already alredy:already allways:always alwasy:always
  alwyas:always alot:a_lot amature:amateur anually:annually apparantly:apparently apparrently:apparently
  arguement:argument arguements:arguments aswell:as_well atleast:at_least athiest:atheist
  assasination:assassination beautifull:beautiful becuase:because becasue:because beacuse:because
  becuse:because begining:beginning beggining:beginning beleive:believe beleived:believed belive:believe
  beleif:belief basicly:basically bizzare:bizarre buisness:business camoflage:camouflage
  carreer:career catagory:category cemetary:cemetery cheif:chief collegue:colleague colum:column
  comming:coming commited:committed comittee:committee comparision:comparison completly:completely
  concensus:consensus concious:conscious conciously:consciously critisism:criticism critisize:criticize
  curiousity:curiosity decieve:deceive definately:definitely definatly:definitely definetly:definitely
  definitley:definitely defintely:definitely deffinately:definitely definitly:definitely
  desparate:desperate desparately:desperately diffrent:different differnt:different diffrence:difference
  dilemna:dilemma disapear:disappear dissapear:disappear dissapoint:disappoint dissapointed:disappointed
  dissapointing:disappointing disipline:discipline eachother:each_other embarass:embarrass
  embarassed:embarrassed embarrased:embarrassed embarassing:embarrassing enviroment:environment
  enought:enough equiptment:equipment excatly:exactly exaclty:exactly exagerate:exaggerate
  exagerated:exaggerated excercise:exercise exellent:excellent existance:existence experiance:experience
  facinating:fascinating familar:familiar finaly:finally foriegn:foreign fourty:forty freind:friend
  freinds:friends frist:first fisrt:first fullfil:fulfill garantee:guarantee gaurantee:guarantee
  garentee:guarantee gaurd:guard goverment:government grammer:grammar greatful:grateful guage:gauge
  happend:happened happned:happened harrass:harass harrassment:harassment heirarchy:hierarchy
  hieght:height humerous:humorous hygene:hygiene hipocrit:hypocrite hypocrit:hypocrite
  hipocrite:hypocrite illegaly:illegally imediately:immediately immediatly:immediately
  importent:important improtant:important incidently:incidentally independant:independent
  infact:in_fact inspite:in_spite intelligance:intelligence inteligence:intelligence interupt:interrupt
  intrested:interested intresting:interesting interesing:interesting irresistable:irresistible
  jewelery:jewelry knowlege:knowledge knowlegde:knowledge lenght:length liason:liaison libary:library
  lisence:license litterally:literally literaly:literally mabye:maybe maintainance:maintenance
  manuever:maneuver millenium:millennium mispell:misspell mispelled:misspelled neccessary:necessary
  neccesary:necessary necesary:necessary necessery:necessary neice:niece nieghbor:neighbor
  noone:no_one noticable:noticeable occassion:occasion occassionally:occasionally occured:occurred
  occuring:occurring occurence:occurrence occurance:occurrence occurrance:occurrence ofcourse:of_course
  oppinion:opinion opinon:opinion oppurtunity:opportunity oportunity:opportunity orginal:original
  orignal:original outragous:outrageous paralell:parallel parliment:parliament peice:piece
  peopel:people poeple:people pepole:people percieve:perceive perfomance:performance perminent:permanent
  persue:pursue pharoah:pharaoh phenomenom:phenomenon plagerize:plagiarize politican:politician
  posession:possession posible:possible prefered:preferred prescence:presence presense:presence
  privelege:privilege priviledge:privilege proabably:probably probabaly:probably probaly:probably
  probly:probably probelm:problem porblem:problem problme:problem pronounciation:pronunciation
  publically:publicly quesiton:question questionaire:questionnaire realy:really relaly:really
  rediculous:ridiculous ridiculus:ridiculous reccomend:recommend recomend:recommend reccommend:recommend
  recomended:recommended reccommended:recommended reccomended:recommended recieve:receive
  recieved:received recieving:receiving refered:referred refrence:reference religous:religious
  relevent:relevant rember:remember remeber:remember repitition:repetition responsibilty:responsibility
  restaraunt:restaurant restraunt:restaurant resturant:restaurant rythm:rhythm saftey:safety
  scedule:schedule shedule:schedule secratary:secretary sentance:sentence seperate:separate
  seperated:separated seperately:separately sergant:sergeant serously:seriously sieze:seize
  similiar:similar similer:similar simliar:similar sincerly:sincerely somthing:something
  somehting:something soemthing:something sophmore:sophomore speach:speech stoped:stopped
  strenght:strength suceed:succeed succesful:successful successfull:successful sucessful:successful
  sucess:success suposed:supposed supose:suppose suprise:surprise suprised:surprised
  suprising:surprising tatoo:tattoo tendancy:tendency thankyou:thank_you thier:their thoguht:thought
  threatning:threatening threshhold:threshold thrid:third togehter:together togather:together
  tommorow:tomorrow tommorrow:tomorrow tomorow:tomorrow tounge:tongue truely:truly truley:truly
  twelth:twelfth unforseen:unforeseen unfortunatly:unfortunately unfortunatley:unfortunately
  unneccessary:unnecessary unecessary:unnecessary untill:until usefull:useful usualy:usually
  usally:usually vaccum:vacuum vacum:vacuum vehical:vehicle vengance:vengeance villian:villain
  visable:visible wendsday:Wednesday wensday:Wednesday febuary:February wich:which
  wierd:weird withold:withhold writting:writing writen:written yatch:yacht yeild:yield
  yesturday:yesterday yeasterday:yesterday youself:yourself teh:the hte:the adn:and taht:that waht:what
  wehn:when jsut:just konw:know knwo:know liek:like shoudl:should woudl:would coudl:could
  dosent:doesn't dosen't:doesn't evrything:everything everthing:everything anythign:anything
  nothign:nothing thign:thing whcih:which wiht:with tihs:this thsi:this yoru:your goign:going
  doign:doing agian:again aginst:against everytime:every_time alittle:a_little ect:etc
  suppossed:supposed`
    .split(/\s+/).filter(Boolean).forEach((pair) => {
      const [bad, good] = pair.split(':');
      SPELLING[bad] = good.replace(/_/g, ' ');
    });
  // "loosing" is technically a word but almost never what people mean.
  const SPELLING_AS_WRONGWORD = S(`thier`);

  // Whole-phrase mix-ups (eggcorns). [pattern, replacement]
  const PHRASES = [
    ['for all intensive purposes', 'for all intents and purposes'],
    ['case and point', 'case in point'],
    ['nip it in the butt', 'nip it in the bud'],
    ['per say', 'per se'],
    ['one in the same', 'one and the same'],
    ['sneak peak', 'sneak peek'],
    ['sneak peaks', 'sneak peeks'],
    ['peaked my interest', 'piqued my interest'],
    ['peaked my curiosity', 'piqued my curiosity'],
    ['peaked his interest', 'piqued his interest'],
    ['peaked her interest', 'piqued her interest'],
    ['free reign', 'free rein'],
    ['baited breath', 'bated breath'],
    ['deep seeded', 'deep-seated'],
    ['mute point', 'moot point'],
    ['tow the line', 'toe the line'],
    ['bare with me', 'bear with me'],
    ['weather or not', 'whether or not'],
    ['wreck havoc', 'wreak havoc'],
    ['wet your appetite', 'whet your appetite'],
    ['statue of limitations', 'statute of limitations'],
    ['make due', 'make do'],
    ['piece of mind', 'peace of mind'],
    ['slight of hand', 'sleight of hand'],
    ['chalk full', 'chock-full'],
    ['doggy dog world', 'dog-eat-dog world'],
    ['escape goat', 'scapegoat'],
    ['all of the sudden', 'all of a sudden'],
    ['by in large', 'by and large'],
    ['hunger pains', 'hunger pangs'],
    ['pass mustard', 'pass muster'],
    ['tongue and cheek', 'tongue-in-cheek'],
    ['lose cannon', 'loose cannon'],
    ['shoe in', 'shoo-in'],
    ['take a breathe', 'take a breath'],
    ['quiet a few', 'quite a few'],
    ['quiet a bit', 'quite a bit'],
    ['quiet a lot', 'quite a lot'],
    ['should of known', 'should have known'],
    ['in the mist of', 'in the midst of'],
    ['on the same token', 'by the same token'],
  ].map(([from, to]) => ({
    re: new RegExp('(?<![\\w\'’-])' + from.replace(/ /g, '\\s+') + '(?![\\w’-])', 'gi'),
    to,
  }));

  // ---------------------------------------------------------------- context rules
  // Each rule: (i, c) => replacement string | null. `c` is the context helper.

  // Is a clause starting at token i? The sentence's start, a comma or similar, or a word that opens a clause.
  const clauseStarts = (i, c) => {
    const p = c.prev(i);
    return !p || CLAUSE_OPENER.has(p) || /^\s*[,;:(—–]/.test(c.after(i - 1));
  };

  // "get use to it", "I'm not suppose to", "am I suppose to": only the participle can stand there.
  // "didn't use to", "of no use to me", "all you do is use to..." are right, and a sentence's "I use X to" has no gap.
  const edBeforeTo = (i, c) => {
    const w = c.w(i);
    if (c.next(i) !== 'to' || c.hyphenAfter(i + 1) || c.isAttachedAt(i + 1)) return null;
    let j = i - 1, steps = 0;
    while (steps < 3 && ED_DEGREE.has(c.prev(j + 1))) { j--; steps++; }
    const p = c.prev(j + 1), p2 = c.prev(j + 1, 2);
    const fixed = ED_BEFORE_TO[w];
    const getTakesIt = w !== 'suppose' && w !== 'oppose'; // nobody "gets suppose to"
    if (getTakesIt && GET_FORM.has(p)) return fixed;
    if (BE_FORM.has(p) && p2 !== 'there' && !/^(do|did|does|doing)$/.test(p2)) return fixed;
    if (w === 'suppose' && (p === "it's" || p === 'its')) return fixed; // not for "use": "its use to researchers"
    if ((w === 'use' || w === 'suppose') && SUBJECT_PRONOUN.has(p) && (BE_FORM.has(p2) || BE_INVERTED.has(p2))) return fixed;
    // "I use to play": with no earlier word for "use" to act on ("the app I use to play"), it can only be the habit
    if (w === 'use' && steps === 0 && /^(i|we|they|he|she)$/.test(p) && c.next(i, 2) &&
        (c.startBefore(i - 1) || /^(and|but|so|because|when)$/.test(c.prev(i - 1)))) return fixed;
    return null;
  };

  const RULES = {
    use: edBeforeTo, suppose: edBeforeTo, oppose: edBeforeTo, expose: edBeforeTo, accustom: edBeforeTo,
    their(i, c) {
      const n = c.next(i), n2 = c.next(i, 2), p = c.prev(i);
      if (n && THERE_VERB.has(n)) return 'there';
      if (n && MODAL_HAVE.has(n) && (n2 === 'be' || n2 === 'been')) return 'there';
      if (n && (ING_THEY.has(n) || (ADV_THEY.has(n) && !BARE_VERB.has(n2)))) {
        if (n === 'doing' && c.endAfter(i + 1)) return null; // "it was their doing."
        return clauseStarts(i, c) ? "they're" : null;
      }
      if (n === 'not' && !(n2 && /ing$/.test(n2) && n2 !== 'going') && !PREPOSITION.has(p)) return "they're";
      if (!n && c.endAfter(i) && p && PLACE_END.has(p)) return 'there'; // "over their."
      return null;
    },
    "their's"(i, c) {
      const n = c.next(i);
      if (c.endAfter(i)) return 'theirs';
      return n ? "there's" : null;
    },
    there(i, c) {
      const n = c.next(i), n2 = c.next(i, 2), p = c.prev(i);
      if (!n || c.hyphenAfter(i + 1)) return null;
      if (p && (PLACE.has(p) || BE.has(p))) return null; // "is there going", "out there doing"
      if (POSS_NOUNS.has(n) || THERE_POSS_EXTRA.has(n)) {
        if (n === 'way' && n2 !== 'of' && n2 !== 'to') return null;
        if (n === 'best' && !(n2 && /^(to|at|friend|friends)$/.test(n2))) return null;
        return 'their';
      }
      if (ING_THEY.has(n)) {
        if (n2 === 'to' && c.next(i, 3) === 'be') return null; // "there going to be" — leave it
        return clauseStarts(i, c) ? "they're" : null;
      }
      if (n === 'not' && n2 && !/ing$/.test(n2) && !c.startBefore(i)) return "they're";
      return null;
    },
    "they're"(i, c) {
      const n = c.next(i);
      if (!n || c.hyphenAfter(i + 1)) return null;
      if (POSS_NOUNS.has(n)) return 'their';
      if (THERE_VERB.has(n)) return 'there';
      return null;
    },
    your(i, c) {
      const n = c.next(i), n2 = c.next(i, 2);
      if (!n || c.hyphenAfter(i + 1)) return null;
      if (n === 'were' || n === 'are') return 'you'; // "as your were learning"
      if (PREPOSITION.has(c.prev(i)) || (n === 'very' && n2 === 'own')) return null;
      if ((ADV_THEY.has(n) || /^(really|just|still|simply|almost)$/.test(n)) && BARE_VERB.has(n2)) return null; // "if your really want": you, not you're
      if (n === 'right' && !c.startBefore(i) && !CLAUSE_OPENER.has(c.prev(i))) return null; // "in the EU, your right, for example, to"
      // "love your thinking", "getting your actually good one": a verb or adverb form needs a clause to be starting
      if ((/ing$/.test(n) || ADV_THEY.has(n)) && !clauseStarts(i, c)) return null;
      if (YOU_RE_ALWAYS.has(n)) {
        if (n === 'welcome' && n2 && /^(message|mat|email|page|screen|packet|gift|kit|letter|speech)s?$/.test(n2)) return null;
        return "you're";
      }
      if (YOU_RE_PRED.has(n) && (c.endAfter(i + 1) || (n2 && PRED_FOLLOW.has(n2)))) return "you're";
      return null;
    },
    "you're"(i, c) {
      const n = c.next(i);
      if (!n || c.hyphenAfter(i + 1)) return null;
      return YOUR_NOUNS.has(n) ? 'your' : null;
    },
    its(i, c) {
      const n = c.next(i), n2 = c.next(i, 2);
      if (!n) return null;
      if (c.hyphenAfter(i + 1)) return null;
      const p = c.prev(i);
      if (n === 'very' && n2 === 'own') return null;
      if (PREPOSITION.has(p) || (n === 'time' && /^(takes?|took|taking|taken|bides?|biding)$/.test(p))) return null;
      if (ITS_ALWAYS.has(n) || ITS_NOT_OWNED.has(n)) return "it's";
      // "its OpenAI's fault": a name in the possessive can't follow possessive "its"
      if (/^[A-Z][\w-]*['’]s$/.test(c.raw(i + 1))) return "it's";
      if ((n === 'kind' || n === 'sort') && n2 === 'of') return "it's";
      if (n === 'way' && n2 && (/^(too|more|less|better|worse|easier|harder)$/.test(n2) || (n2 === 'to' && TOO_NEXT.has(c.next(i, 3))))) return "it's";
      if (ITS_PRED.has(n) && (c.endAfter(i + 1) || (n2 && ITS_FOLLOW.has(n2)))) return "it's";
      return null;
    },
    "it's"(i, c) {
      return c.next(i) === 'own' ? 'its' : null;
    },
    then(i, c) {
      const p = c.prev(i), n = c.next(i);
      if (p && COMPARATIVE.has(p) && n && !c.endAfter(i)) {
        if (p === 'other' && c.prev(i, 2) === 'the') return null; // "one, the other then..."
        return 'than';
      }
      return null;
    },
    than(i, c) {
      const p = c.prev(i), n = c.next(i);
      if (p && THEN_PREV.has(p)) return 'then';
      if (!p && c.startBefore(i) && n && /^T/.test(c.raw(i))) return 'then'; // "Than I realised...", not "(or better!) than"
      return null;
    },
    of(i, c) {
      const p = c.prev(i), n = c.next(i);
      if (p && MODAL_OF.has(p) && n && !NOT_PARTICIPLE.has(n)) return 'have';
      return null;
    },
    loose(i, c) {
      const p = c.prev(i), n = c.next(i);
      if (p && LOSE_PREV.has(p)) {
        if (n && /^(the|my|your|his|her|their|our|a|an|it|this|that|weight|money|everything|all|interest|track|hope|sleep|control|focus|sight|touch|them|him|me|us)$/.test(n)) return 'lose';
        if (c.endAfter(i)) return 'lose';
      }
      return null;
    },
    lose(i, c) {
      const p = c.prev(i), n = c.next(i);
      if (p && LOOSE_PREV.has(p) && (c.endAfter(i) || (n && LOOSE_NEXT.has(n)))) return 'loose';
      return null;
    },
    affect(i, c) {
      const p = c.prev(i), n = c.next(i);
      if (p && AFFECT_PREV.has(p)) {
        if (p === 'the' && n !== 'of' && n !== 'on') return null;
        return 'effect';
      }
      return null;
    },
    effect(i, c) {
      const p = c.prev(i), n = c.next(i);
      // "effect a change" is right: to bring it about
      if (p && EFFECT_PREV.has(p) && n && !/^(changes?|real)$/.test(n) && !/^(changes?|reforms?)$/.test(c.next(i, 2) || '')) return 'affect';
      return null;
    },
    where(i, c) {
      const p = c.prev(i);
      if (p === 'we' || p === 'they') return 'were';
      return null;
    },
    were(i, c) {
      const n = c.next(i), p = c.prev(i);
      if (!p && c.startBefore(i) && (n === 'going' || n === 'gonna')) return "we're";
      if (n && /^(is|are|did|does|do)$/.test(n) && !p) return 'where';
      if (n && /^(is|are)$/.test(n) && p && /^(know|see|wonder|that's|thats|exactly|from)$/.test(p)) return 'where';
      // "for issues were Sam says no", "the place were I grew up": a noun, then a new clause
      const n2 = c.next(i, 2);
      if (p && n && n2 && WHERE_NOUNS.has(p)) {
        const subject = SUBJECTS.has(n) || (/^[A-Z][a-z]+$/.test(c.raw(i + 1)) && /(s|ed)$/.test(n2));
        if (subject && !/^(the|a|an|not|that|to|being|so|very|all|also|just|still|only|never)$/.test(n2)) return 'where';
      }
      return null;
    },
    to(i, c) {
      const n = c.next(i), p = c.prev(i);
      if (n && p && TOO_NEXT.has(n) && TOO_PREV.has(p)) {
        // "what we need is to slow things down": also a verb, so only where it can't be one
        const n2 = c.next(i, 2);
        if ((n === 'slow' || n === 'long') && n2 && !c.endAfter(i + 1) && !/^(for|to|and|but|lol)$/.test(n2)) return null;
        return 'too';
      }
      if (!n && p && /^(me|you|us|them)$/.test(p) && c.endAfter(i) && /^[\s]*([.!]|$)/.test(c.after(i))) {
        const p2 = c.prev(i, 2);
        if (!p2 || /^(and|love|miss|same|lol|haha)$/.test(p2) || c.startBefore(i - 1)) return 'too';
      }
      return null;
    },
    too(i, c) {
      const n = c.next(i), p = c.prev(i);
      if (n && TO_NEXT.has(n) && p !== 'me' && !/^(i|we|you|they|he|she|it)$/.test(p) && !c.endAfter(i)) { // "I too have"
        if (n === 'good' || n === 'much') return null;
        return 'to';
      }
      return null;
    },
    whose(i, c) {
      const n = c.next(i);
      return n && WHOS_NEXT.has(n) ? "who's" : null;
    },
    "who's"(i, c) {
      const n = c.next(i);
      return n && WHOSE_NEXT.has(n) ? 'whose' : null;
    },
    breath(i, c) {
      const p = c.prev(i);
      return p && /^(to|can't|cant|can|couldn't|could|cannot|just|and)$/.test(p) && !c.next(i)?.match(/^(of|away|test)$/) &&
        p !== 'and' ? 'breathe' : null;
    },
    chose(i, c) {
      const p = c.prev(i), p2 = c.prev(i, 2);
      if (p && CHOOSE_AUX.has(p)) return 'choose'; // "doesn't chose", "to chose"
      if (p && /^(always|never|just|really|even|not|ever|still|usually)$/.test(p) && p2 && CHOOSE_AUX.has(p2)) return 'choose';
      return null;
    },
    wether(i, c) {
      const n = c.next(i);
      return n && /^(rams?|sheep|lambs?|goats?)$/.test(n) ? null : 'whether'; // a wether is a castrated ram
    },
    loosing(i, c) {
      const n = c.next(i);
      return n && /^(arrows?|an|the|hounds|dogs)$/.test(n) ? null : 'losing';
    },
    quite(i, c) {
      const p = c.prev(i);
      if (p && /^(very|so|too|stay|keep|kept|stayed|be|been|was|is|real|pretty)$/.test(p) && c.endAfter(i)) return 'quiet';
      return null;
    },
    quiet(i, c) {
      const n = c.next(i);
      if (n && /^(sure|right|frankly|honestly|literally|possibly|likely|similar|different|good|bad|nice|hard|easy|often|well)$/.test(n)) return 'quite';
      return null;
    },
  };

  // ---------------------------------------------------------------- talking *about* words
  // On a thread about grammar ("their/there are homophones", "it's correct to use 'their'"),
  // the words are being mentioned, not used, and must be left alone.

  const GROUPS = {
    there: S(`their there they're theyre theirs there's their's`),
    your: S(`your you're youre yours yore`),
    its: S(`its it's`),
    then: S(`then than`),
    lose: S(`lose loose losing loosing`),
    affect: S(`affect effect affects effects`),
    where: S(`where were we're`),
    whose: S(`whose who's`),
    quiet: S(`quiet quite`),
    breath: S(`breath breathe`),
    to: S(`to too two`),
    choose: S(`chose choose`),
    used: S(`use used suppose supposed`),
  };
  const RULE_GROUP = {
    their: 'there', "their's": 'there', there: 'there', "they're": 'there', your: 'your', "you're": 'your',
    its: 'its', "it's": 'its', then: 'then', than: 'then', loose: 'lose', lose: 'lose', affect: 'affect',
    effect: 'affect', where: 'where', were: 'where', whose: 'whose', "who's": 'whose', quite: 'quiet',
    quiet: 'quiet', breath: 'breath', to: 'to', too: 'to', of: 'of', chose: 'choose',
    use: 'used', suppose: 'used',
  };
  const { META_WORDS, isQuoted } = P; // what quote marks are doing is decided in policy.js (POLICY.md §4)
  const LIST_SEP = /^\s*(\/|,|&|-|\bor\b|\band\b|\bvs\.?|\bversus\b)\s*$/i;

  // Which confusable groups does this block of text discuss rather than use?
  function metaGroups(block) {
    const out = new Set();
    const toks = tokenize(block);
    const hasMetaWord = META_WORDS.test(block);
    for (const [name, words] of Object.entries(GROUPS)) {
      const seen = new Set();
      let flagged = false;
      for (let i = 0; i < toks.length; i++) {
        const w = toks[i].w;
        if (!words.has(w) || (name === 'to' && w === 'to')) continue;
        seen.add(w);
        if (isQuoted(block, toks[i].s, toks[i].e) && P.mentionReason(block, toks[i].s, toks[i].e, { block })) flagged = true;
        const n = toks[i + 1];
        if (n && words.has(n.w) && n.w !== w && LIST_SEP.test(block.slice(toks[i].e, n.s))) flagged = true;
      }
      if (flagged || (seen.size >= 2 && hasMetaWord)) out.add(name);
    }
    // "could of / should of instead of would've"
    const ofUse = /\b(could|would|should|must|might)\s+of\b/i.test(block);
    const haveUse = /\b(could|would|should|must|might)(?:['\u2019]ve|\s+have)\b/i.test(block);
    const ofQuoted = /["\u201c'\u2018*_](could|would|should|must|might)\s+of["\u201d'\u2019*_]/i.test(block);
    const ofListed = /\b(could|would|should|must|might)\s+of\s*(,|\/|\bor\b|\band\b)\s*(could|would|should|must|might|and)\b/i.test(block);
    if (ofQuoted || ofListed || (ofUse && haveUse && hasMetaWord)) out.add('of');
    return out;
  }

  // ---------------------------------------------------------------- engine

  function tokenize(text) {
    const tokens = [];
    const re = /\p{L}+(?:['’]\p{L}+)*/gu; // every letter, or "Debían" would look like "Deb" and "an"
    let m;
    while ((m = re.exec(text))) {
      tokens.push({ raw: m[0], w: m[0].toLowerCase().replace(/’/g, "'"), s: m.index, e: m.index + m[0].length });
    }
    return tokens;
  }

  function makeContext(text, tokens) {
    const gap = (i) => text.slice(tokens[i].e, tokens[i + 1].s);
    const joined = (i) => i >= 0 && i < tokens.length - 1 && /^[ \t ]+$/.test(gap(i));
    return {
      w: (i) => tokens[i] && tokens[i].w,
      isAttachedAt: (i) => !!tokens[i] && isAttached(text, tokens[i]),
      raw: (i) => tokens[i] && tokens[i].raw,
      next(i, k = 1) {
        let j = i;
        for (let n = 0; n < k; n++) { if (!joined(j)) return null; j++; }
        return tokens[j].w;
      },
      prev(i, k = 1) {
        let j = i;
        for (let n = 0; n < k; n++) { if (!joined(j - 1)) return null; j--; }
        return tokens[j].w;
      },
      after(i) {
        return i < tokens.length - 1 ? gap(i) : text.slice(tokens[i].e);
      },
      // Does a clause end right after token i?
      endAfter(i) {
        if (i >= tokens.length - 1) return /^[\s]*([.!?,;:)\]"'”’]|$)/.test(text.slice(tokens[i].e));
        return /[.!?,;:\n)]/.test(gap(i));
      },
      // Does a sentence start at token i?
      startBefore(i) {
        if (i <= 0) return /(^|[.!?\n])[\s"'“(*_]*$/.test(text.slice(0, tokens[0] ? tokens[0].s : 0));
        return /[.!?\n]/.test(gap(i - 1));
      },
      hyphenAfter(i) {
        return !!tokens[i] && /^[-‐‑]/.test(text.slice(tokens[i].e));
      },
    };
  }

  // Token glued to a username, URL, hashtag, code-ish identifier, or number: leave it alone.
  function isAttached(text, t) {
    const before = text[t.s - 1] || ' ';
    const after = text[t.e] || ' ';
    return /[\/@#_\\$=<>{}`\d]/.test(before) || /[\/@_\\=<>{}`\d]/.test(after) ||
      (before === '.' && /\w/.test(text[t.s - 2] || '')) || (after === '.' && /\w/.test(text[t.e + 1] || ''));
  }

  function matchCase(orig, repl) {
    if (orig.length > 1 && orig === orig.toUpperCase() && /[A-Z]/.test(orig)) return repl.toUpperCase();
    if (/^[A-Z]/.test(orig)) return repl.charAt(0).toUpperCase() + repl.slice(1);
    return repl;
  }

  /**
   * opts.blockText    — the whole paragraph this text sits in (for meta-discussion detection)
   * opts.emphasized   — the text is short link text: usually a name, a username or a title, so left alone
   * opts.marked       — the text is a short <em>/<b>/<q> run starting at this offset in blockText: judged like
   *                      quoted text (a mention or echo is left alone, emphasis on a used word is not)
   * opts.extraSpelling — learned / imported misspelling -> correction map
   * opts.registerText — the surrounding comment, to judge casual vs careful writing (POLICY.md §4)
   * opts.casualMode   — 'auto' | 'fix' | 'never' for casual spellings like "would of", "alot", "dont"
   * opts.names        — words written as names elsewhere on the page (lowercase Set)
   * opts.regional     — the reader's region spelling table { to, from } (policy.js regionalTable), when that setting is on
   * opts.onDecision   — called with every candidate fix and its verdict ('apply' | 'check' | 'block') and why
   */
  function findCorrections(text, opts = {}) {
    const fixes = [];
    if (!text || text.length < 2 || !/[A-Za-z]/.test(text)) return fixes;
    if (opts.emphasized) return fixes;
    const blockText = opts.blockText || text;
    // A paragraph in another language: nothing in it is an English slip (POLICY.md §3.11)
    if (P.notEnglishReason(blockText, opts.pageLang)) return fixes;
    const meta = metaGroups(blockText);
    const extra = opts.extraSpelling || null;
    const curly = text.includes('’') && !text.includes("'");
    const apos = (s) => (curly ? s.replace(/'/g, '’') : s);
    const taken = []; // [s,e] ranges already claimed

    const overlaps = (s, e) => taken.some(([a, b]) => s < b && e > a);
    // opts.onDecision(d) hears every candidate fix and what happened to it (the decision trace)
    const tell = (s, e, replacement, category, rule, verdict, why) => opts.onDecision &&
      opts.onDecision({ start: s, end: e, original: text.slice(s, e), replacement, category, rule, verdict, why });
    const region = (opts.regional && opts.regional.to) || null;
    const marked = Number.isInteger(opts.marked) ? opts.marked : null;
    const add = (s, e, replacement, category, rule) => {
      if (overlaps(s, e)) return;
      // A fix's own spelling follows the reader's region too: nieghbor -> neighbour for a UK reader
      if (region && rule !== 'regional') replacement = replacement.replace(/[A-Za-z]+/g, (w) => {
        const to = region[w.toLowerCase()];
        return to ? matchCase(w, to) : w;
      });
      const original = text.slice(s, e);
      const block = (why) => tell(s, e, replacement, category, rule, 'block', why);
      if (original === replacement) return;
      // Quoted or emphasised: left alone only for a mention or an echo, not scare quotes or emphasis (POLICY.md §4)
      const mention = isQuoted(text, s, e) ? P.mentionReason(text, s, e, { block: blockText, replacement })
        : marked === null ? null
          : marked < 0 ? 'emphasised, and its paragraph could not be read'
            : P.mentionReason(blockText, marked + s, marked + e, { block: blockText, replacement });
      if (mention) return block(mention);
      const known = rule === 'dict' || rule === 'learned' || rule === 'phrase' || rule === 'frame' || rule === 'apostrophe' ||
        rule === 'regional';
      // Guarded by what the original is, not where it's shown: "fastly" is a non-word (names, dialect density and
      // repetition apply, so "we use Fastly" stays), a/an keeps the mechanical-slip guards.
      // A regional spelling is a real word used on purpose, so it takes the wrong-word guards (no "used
      // consistently" or dialect-density checks: writers use their own spelling consistently) plus its own.
      const guardAs = { wordform: 'spelling', article: 'typo', regional: 'wrongword' }[rule] || category;
      const why = P.protectedReason(text, s, e, { block: blockText, category: guardAs, known, names: opts.names }) || // deliberate language (POLICY.md)
        (rule === 'regional' ? P.regionalReason(text, s, e, blockText, region) : null);
      if (why) return block(why);
      const casual = P.casualForm(original, replacement, rule);
      if (casual && !P.allowCasualFix(opts.registerText || blockText, casual, original, opts.casualMode)) {
        return block('casual spelling in casual writing (' + P.registerOf(opts.registerText || blockText) + ' register)');
      }
      const group = RULE_GROUP[rule] || (rule === 'phrase' && /\bof\b/i.test(text.slice(s, e)) ? 'of' : null);
      if (group && meta.has(group)) return block('the paragraph is talking about these words');
      taken.push([s, e]);
      // Context rules can be wrong about meaning; word lists and mechanical fixes are not.
      const needsCheck = Object.prototype.hasOwnProperty.call(RULES, rule) || rule === 'article' || rule === 'frame';
      tell(s, e, replacement, category, rule, needsCheck ? 'check' : 'apply', '');
      const fix = { start: s, end: e, original, replacement: apos(replacement), category, rule, needsCheck };
      if (rule === 'regional') fix.variety = opts.regional.from[original.toLowerCase()] || '';
      fixes.push(fix);
    };

    for (const { re, to } of PHRASES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) add(m.index, m.index + m[0].length, matchCase(m[0], to), 'wrongword', 'phrase');
    }

    const tokens = tokenize(text);
    const c = makeContext(text, tokens);

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (isAttached(text, t)) continue;
      const w = t.w;

      // Doubled word: "the the"
      if (REPEATABLE.has(w) && !REPEAT_OK.has(w) && c.next(i) === w && !isAttached(text, tokens[i + 1]) &&
          !(DOUBLED_PARTICLE.has(w) && PARTICLE_VERB.has(c.prev(i)))) {
        add(t.s, tokens[i + 1].e, t.raw, 'typo', 'repeat');
        i++;
        continue;
      }

      // A number form inside a fixed frame: "on a weekly bases" -> basis (POLICY.md §2, Word form)
      const framed = P.frameForm(w, text, t.s, t.e);
      if (framed) {
        add(t.s, t.e, matchCase(t.raw, framed), 'wrongword', 'frame');
        continue;
      }

      const rule = RULES[w];
      if (rule) {
        const r = rule(i, c);
        if (r) { add(t.s, t.e, matchCase(t.raw, r), 'wrongword', w); continue; }
      }

      if (Object.prototype.hasOwnProperty.call(SPELLING, w) && !/[A-Z].*[A-Z]/.test(t.raw.slice(1))) {
        add(t.s, t.e, matchCase(t.raw, SPELLING[w]), SPELLING_AS_WRONGWORD.has(w) ? 'wrongword' : 'spelling', 'dict');
        continue;
      }
      if (extra && Object.prototype.hasOwnProperty.call(extra, w) && !/[A-Z].*[A-Z]/.test(t.raw.slice(1))) {
        add(t.s, t.e, matchCase(t.raw, extra[w]), 'spelling', 'learned');
        continue;
      }

      // Over-regularised word forms: fastly -> fast, goed -> went (POLICY.md §2)
      const form = !/[A-Z].*[A-Z]/.test(t.raw.slice(1)) && P.wordForm(w, text, t.s);
      if (form) {
        add(t.s, t.e, matchCase(t.raw, form), 'wrongword', 'wordform');
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(CONTRACTIONS, w)) {
        if (w === 'cant' && c.prev(i) === 'the') continue; // "the cant of..."
        if (w === 'wont' && /^(the|his|her|my|their|as)$/.test(c.prev(i) || '')) continue; // "as is his wont"
        if (w === 'hes' || w === 'shes' || w === 'ive') {
          if (t.raw === t.raw.toUpperCase()) continue; // acronyms
        }
        const r = CONTRACTIONS[w];
        add(t.s, t.e, w === 'im' || w === 'ive' ? (t.raw === 'IM' ? "I'M" : r) : matchCase(t.raw, r), 'typo', 'apostrophe');
        continue;
      }

      // Another region's spelling, shown in the reader's (POLICY.md §7)
      if (region && Object.prototype.hasOwnProperty.call(region, w)) {
        add(t.s, t.e, matchCase(t.raw, region[w]), 'regional', 'regional');
        continue;
      }

      // a / an
      if ((t.raw === 'a' || t.raw === 'an' || ((t.raw === 'A' || t.raw === 'An') && c.startBefore(i)))) {
        const n = tokens[i + 1];
        const nw = c.next(i);
        if (!nw || n.raw.length < 2 || n.raw === n.raw.toUpperCase() || c.hyphenAfter(i + 1) || isAttached(text, n)) continue;
        if (NOT_AFTER_ARTICLE.has(nw)) continue;
        const want = P.articleFor(n.raw); // by sound, not letter: an hour, a university (policy.js)
        if (w === 'a' && want === 'an') add(t.s, t.e, matchCase(t.raw, 'an'), 'wrongword', 'article');
        else if (w === 'an' && want === 'a') add(t.s, t.e, matchCase(t.raw, 'a'), 'wrongword', 'article');
      }
    }

    fixes.sort((a, b) => a.start - b.start);
    return fixes;
  }

  // Is this word one of a set of look-alikes that the paragraph is talking about rather than using?
  function isMentioned(block, word) {
    const w = word.toLowerCase().replace(/\u2019/g, "'");
    const groups = metaGroups(block);
    if (/^(could|would|should|must|might) of$/.test(w)) return groups.has('of');
    return Object.entries(GROUPS).some(([name, set]) => set.has(w) && groups.has(name));
  }
  const isKnownMisspelling = (w) => Object.prototype.hasOwnProperty.call(SPELLING, w) ||
    Object.prototype.hasOwnProperty.call(CONTRACTIONS, w);
  const api = { findCorrections, CATEGORIES, categoryOf, isQuoted, metaGroups, isKnownMisspelling, isMentioned };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IAC_Engine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
