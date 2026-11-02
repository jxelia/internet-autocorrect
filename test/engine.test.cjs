const { findCorrections } = require('./engine.cjs');
const apply = (t) => { let out = '', last = 0; for (const f of findCorrections(t)) { out += t.slice(last, f.start) + f.replacement; last = f.end; } return out + t.slice(last); };
const cases = [
  // [input, expected]
  // From the first precision run on real comments (2026-11-03): each of these was changed wrongly.
  ["You must first type that in in order to get it.", null],
  ["We go all-in in CLIs now.", null],
  ["The tools they want to to get the job done.", null],
  ["If your company uses it it uses it.", null],
  ["Both in the US and in the EU, your right, for example, to sue.", null],
  ["The groups didn't effect any change whatsoever.", null],
  ["I'd rather bet on Opus 4.6 than Astra right now.", null],
  ["It made it much worse (or better!) than the actual reality.", null],
  ["But if your really want control over it.", null],
  ["Netrunning is its very own world there.", null],
  ["It runs in 12GiB an you have 4GiB extra.", null],
  ["The concept was far ahead of its time.", null],
  ["It just presses approve on its every judgement.", null],
  ["It takes its time to load.", null],
  ["A reminder of your very own words.", null],
  ["I relate less and less with their thinking.", null],
  ["The studios could align their thinking at the same time.", null],
  ["They had trouble raising capital to meet their already huge debts.", null],
  ["It is getting their actually good products in front of people.", null],
  ["I think their going to lose.", "I think they're going to lose."],
  ["Honestly, their always late.", "Honestly, they're always late."],
  ["I love your thinking on this.", null],
  ["I too have been unable to list it.", null],
  ["What we need is to slow the whole thing down.", null],
  ["This is to slow for me.", "This is too slow for me."],
  ["Most investors who got in in 1999 held on.", null],
  ["We built gyms where you go to to fight that.", null],
  ["Really trying to to avoid features.", "Really trying to avoid features."],
  ["We would have sent an urgent message to them.", null],
  ["That was an unimportant detail of it all.", null],
  ["He bought a unit for it.", null],
  ["I would send it like an sms to them.", null],
  ["What an llm knows is not the point.", null],
  ["I can't do that with an LLM's output.", null],
  ["I'm on an nvidia jetson these days.", null],
  ["Plug in a usb drive first.", null],
  ["Open a url in the app.", null],
  ["Why use Debían when you can use Rocky?", null],
  ["Someone comes in an says what they want.", null],
  ["There was a urinal on the wall.", null],
  ["I ate a apple today.", "I ate an apple today."],
  ["It was an secret order.", "It was a secret order."],
  ["Their is no way that works.", "There is no way that works."],
  ["I think their going to lose.", "I think they're going to lose."],
  ["They parked there car over their.", "They parked their car over there."],
  ["They're kids are loud.", "Their kids are loud."],
  ["Is there going to be a sequel?", null],
  ["People out there doing good work.", null],
  ["There own fault honestly.", "Their own fault honestly."],
  ["It was their doing.", null],
  ["Their's a reason for that.", "There's a reason for that."],
  ["The choice is their's.", "The choice is theirs."],
  ["Your the best, your welcome.", "You're the best, you're welcome."],
  ["Your right about that.", "You're right about that."],
  ["Raise your right hand.", null],
  ["I respect your right to vote.", null],
  ["You're car is blocking me.", "Your car is blocking me."],
  ["Its not that hard, its a phone.", "It's not that hard, it's a phone."],
  ["The dog wagged its tail.", null],
  ["The company and its own people.", null],
  ["It's own worst enemy.", "Its own worst enemy."],
  ["This is better then that.", "This is better than that."],
  ["I'd rather die then go.", "I'd rather die then go."],
  ["I'd rather then go.", "I'd rather than go."],
  ["We ate and than we left.", "We ate and then we left."],
  ["Than I realized it.", "Then I realized it."],
  ["I could of told you.", null],
  ["He should of known better.", null],
  ["Could of course work.", null],
  ["Don't loose your keys.", "Don't lose your keys."],
  ["You're going to loose.", "You're going to lose."],
  ["The screw came lose.", "The screw came loose."],
  ["I will definately recieve it.", "I will definitely receive it."],
  ["dont do that, im tired", null],
  ["I went to the the store.", "I went to the store."],
  ["I know that that is fine.", null],
  ["It was a amazing day and an big deal.", "It was an amazing day and a big deal."],
  ["a university, an hour, a one-time thing, a European", null],
  ["Plan A is good.", null],
  ["I ate an apple and an orange, then an honest meal.", null],
  ["It was an Apple product, an MRI and an hotel.", null],
  ["The rain started falling down fastly.", "The rain started falling down fast."],
  ["Number of users = people who are actually using it on the weekly bases", "Number of users = people who are actually using it on the weekly basis"],
  ["We meet on a regular bases, on an ad hoc bases too.", "We meet on a regular basis, on an ad hoc basis too."],
  ["We use Fastly for caching and it works.", null],
  ["Fastly is a CDN. We moved to Fastly last year.", null],
  ["Fastly Inc reported earnings.", null],
  ["I ordered a Lyft and some Krispy Kreme.", null],
  ["Its not Fastly's fault, its OpenAI's fault.", "It's not Fastly's fault, it's OpenAI's fault."],
  ["For issues were Claude says no, I have another model start off the work.", "For issues where Claude says no, I have another model start off the work."],
  ["Their Is No Way This Is Real", "There Is No Way This Is Real"],
  ["Thanks u/definately and @recieve for this.", null],
  ["Troops stayed on the naval bases and the bases were full.", null],
  ["On the other bases, runners waited.", null],
  ["Yesterday I goed home and bringed snacks.", "Yesterday I went home and brought snacks."],
  ["She has goed already, and it was eated.", "She has gone already, and it was eaten."],
  ["He knowed it, they growed up there.", null],
  ["Thanks muchly, that was funner than I thought.", null],
  ["They say \"fastly\" is not a word.", null],
  ["For all intensive purposes it works.", "For all intents and purposes it works."],
  ["Its way to much effort.", "It's way too much effort."],
  ["Love you to!", "Love you too!"],
  ["I went to the park.", null],
  ["Who's fault is that?", "Whose fault is that?"],
  ["Whose going to win?", "Who's going to win?"],
  ["We where there.", "We were there."],
  ["The side affect was bad.", "The side effect was bad."],
  ["It will effect everyone.", "It will affect everyone."],
  ["Check u/their_name and r/dont", null],
  ["THEIR IS A PROBLEM", "THERE IS A PROBLEM"],
  ["Their’s a lot of them, dont you think", "There’s a lot of them, dont you think"],
  ["I can't breath in here.", "I can't breathe in here."],
  ["He was alot happier.", null],
  ["There best friends.", "Their best friends."],
  ["They're best friends.", null],
  ["I've been there, their family was nice.", null],
  ["I've been there and there family was nice.", "I've been there and their family was nice."],
  ["Get there kids now.", null],
  ["Their not happy.", "They're not happy."],
  ["it's quiet a few people, he is quiet sure.", "it's quite a few people, he is quite sure."],
  ["Please be quite.", "Please be quiet."],
  // From r/ENGLISH: words being talked about, not used
  ["As a Scot, only their/there are homophones. They’re is not pronounced the same in my accent.", null],
  ['there could be a complex sentence like this where it\'s correct to use "their": Their going to work is important for there to be food', null],
  ["Similar teeth-grinders are yore, your and you're. Also could of, would of, and should of instead of would've (would have) etc.", null],
  ["The most difficult for me was men-man/woman-women and than, then.", null],
  ["if youre not paying attention before sending", null],
  ["People dont understand apostrophe’s.", null],
  ['People write "definately" all the time.', null],
  ["The word *their* is possessive.", null],
  ["For issues were Claude says no, I have another model start.", "For issues where Claude says no, I have another model start."],
  ["That's the house were I grew up.", "That's the house where I grew up."],
  ["The issues were the same as before.", null],
  ["The places were they went were nice.", "The places where they went were nice."],
  ["The games were fun.", null],
  // Deliberate language (POLICY.md)
  ["I'm well over 50. Even in the old readin', writin', and 'rithmatic days, people still confused these words.", null],
  ["Ain't nobody got time for that, y'all dont know.", null],
  ["The colour of the centre was grey, I realised.", null],
  ["sooo definately", "sooo definitely"],
  ["Dat boi finna dont care tho", null],
  ["I definately recieved it, wether or not you believe me.", "I definitely received it, whether or not you believe me."],
  ["The wether sheep grazed.", null],
  ["Stop loosing arrows at me. Don't keep loosing your keys.", "Stop loosing arrows at me. Don't keep losing your keys."],
  ["I put it on the calender.", null],
  ["it doesn't always chose the right one", "it doesn't always choose the right one"],
  ["I chose the red one.", null],
  ["as your were learning the words", "as you were learning the words"],
  // "its" before something that can't be owned (Oct 27 2026 report)
  ['Everyone is going to tell you "their plan sucks and its OpenAI\'s fault."', 'Everyone is going to tell you "their plan sucks and it\'s OpenAI\'s fault."'],
  ["its about time they fixed it", "it's about time they fixed it"],
  ["Honestly its them again.", "Honestly it's them again."],
  ["its this or nothing", "it's this or nothing"],
  ["The car and its owner's manual.", null],
  ["Apple and its iPhone sales grew.", null],
  ["The dog and its John-like stare.", null],
  // Register: casual spellings are style in casual writing, slips in careful writing (POLICY.md §4)
  ["lol i would of done it but i was tired tbh", null],
  ["I could of told you, but you weren't listening; I'm sorry.", "I could have told you, but you weren't listening; I'm sorry."],
  ["I would've gone, and I would of stayed longer.", "I would've gone, and I would have stayed longer."],
  ["ngl everytime i try it breaks lol", null],
  ["Every time I visit, it rains. Everytime.", "Every time I visit, it rains. Every time."],
  ["It doesn't matter. People dont listen, and that's fine.", "It doesn't matter. People don't listen, and that's fine."],
  ["We ate alot. It was a lot of food.", "We ate a lot. It was a lot of food."],
  ["ive been there, that's what happened lol", null],
  ["I've said it before. ive got no time", null],
  ["Honestly, ive been there; I don't know how else to explain it.", "Honestly, I've been there; I don't know how else to explain it."],
  // real mistakes in the same thread must still be fixed
  ["I think their going to win.", "I think they're going to win."],
];
let pass = 0, fail = 0;
for (const [inp, exp] of cases) {
  const got = apply(inp); const want = exp === null ? inp : exp;
  if (got === want) pass++; else { fail++; console.log('FAIL\n  in:   ' + inp + '\n  got:  ' + got + '\n  want: ' + want); }
}
// Quotes and names by evidence, for every kind of fix (POLICY.md §4, 1.7.22)
{
  const fixWith = (t, opts) => { let out = '', last = 0; for (const f of findCorrections(t, opts)) { out += t.slice(last, f.start) + f.replacement; last = f.end; } return out + t.slice(last); };
  const evidenceCases = [
    // scare quotes and emphasis on the writer's own word: still a slip
    ['It was "definately" the best night.', 'It was "definitely" the best night.'],
    ['My *freind* came over.', 'My *friend* came over.'],
    // mentions and echoes: left alone
    ['The word "definately" is wrong.', null],
    ['He wrote "definately" again.', null],
    ['"definately" lol', null],
    ['I definitely agree, but "definately" is his favourite.', null],
    ['It was "definately" [sic] the best.', null],
    ['Nobody says "seperate" anymore.', null],
    // names without capitals, capitals without names
    ['i think fastly is great tbh', null],
    ['Falling down fastly is a bad idea.', 'Falling down fast is a bad idea.'],
    ['a user called definately posted it', null],
    ['John recieved the letter.', 'John received the letter.'],
    ['we met definately at the bar', null, ['definately']],
  ];
  // an <em> run is its own text node: judged in its paragraph
  const em = (block, word) => findCorrections(word, { blockText: block, marked: block.indexOf(word) }).length;
  if (em('The word definately is wrong.', 'definately') === 0) pass++; else { fail++; console.log('FAIL: mentioned <em> word was fixed'); }
  if (em('It was definately great.', 'definately') === 1) pass++; else { fail++; console.log('FAIL: emphasised used word was not fixed'); }
  for (const [inp, exp, names] of evidenceCases) {
    const got = fixWith(inp, { names: new Set(names || []) }); const want = exp === null ? inp : exp;
    if (got === want) pass++; else { fail++; console.log('FAIL (evidence)\n  in:   ' + inp + '\n  got:  ' + got + '\n  want: ' + want); }
  }
}

// Your spelling (POLICY.md §7): another region's correct spelling shown in the reader's, never names or mentions.
{
  const P = require('./policy.cjs');
  const txt = require('fs').readFileSync('../data/regional.txt', 'utf8');
  const tables = { uk: P.regionalTable(txt, 'uk'), us: P.regionalTable(txt, 'us'), ca: P.regionalTable(txt, 'ca') };
  const conv = (t, region, names) => { let out = '', last = 0; for (const f of findCorrections(t, { regional: tables[region], names: new Set(names || []) })) { out += t.slice(last, f.start) + f.replacement; last = f.end; } return out + t.slice(last); };
  const regionalCases = [
    ['uk', 'Remember when using the wrong pronoun got people canceled?', 'Remember when using the wrong pronoun got people cancelled?'],
    ['uk', 'The color of the center was gray, and we analyzed it.', 'The colour of the centre was grey, and we analysed it.'],
    ['uk', 'Color me surprised.', 'Colour me surprised.'],
    ['us', 'We realised the colour of the tyres was odd.', 'We realized the color of the tires was odd.'],
    ['us', 'It costs a metre of fabric and a programme fee.', 'It costs a meter of fabric and a program fee.'],
    ['ca', 'We analyzed the colors and the centers.', 'We analyzed the colours and the centres.'], // Canada: -ize, -our, -re
    // both forms are the reader's own: left alone
    ['uk', 'Read the gas meter and run the program.', null],
    ['uk', 'It was his prized possession.', null],
    // names, capitals, mentions, comparisons
    ['uk', 'We flew into Pearl Harbor and visited the Lincoln Center.', null],
    ['uk', 'The Labor Party won.', null],
    ['uk', 'The COLOR button.', null],
    ['uk', 'Americans spell it color, not colour.', null],
    ['uk', 'Is it color or colour in Canada?', null],
    ['uk', 'The word "color" is shorter.', null],
    ['uk', 'Follow @color for more.', null],
    // other fixes follow the reader's spelling too
    ['uk', 'My nieghbor has a red car.', 'My neighbour has a red car.'],
    // shared guards weigh evidence (1.7.22): scare quotes are used words; lowercase names; Title Case lines
    ['uk', 'I love the "color" of it.', 'I love the "colour" of it.'],
    ['uk', 'Lincoln Center Reopens After Renovation', null],
    ['uk', 'we went to the kennedy center lol', null, ['kennedy']],
    ['uk', 'we love color street lol', null, ['color']],
    ['uk', 'shoutout to color theory for the help', null],
  ];
  for (const [region, inp, exp, names] of regionalCases) {
    const got = conv(inp, region, names); const want = exp === null ? inp : exp;
    if (got === want) pass++; else { fail++; console.log('FAIL (' + region + ')\n  in:   ' + inp + '\n  got:  ' + got + '\n  want: ' + want); }
  }
  // off: nothing changes
  if (apply('The color of the center.') === 'The color of the center.') pass++; else { fail++; console.log('FAIL: region off changed text'); }
}
// Register from the whole comment, not the paragraph (POLICY.md §4)
{
  const conv = (t, registerText) => { let out = '', last = 0; for (const f of findCorrections(t, { registerText })) { out += t.slice(last, f.start) + f.replacement; last = f.end; } return out + t.slice(last); };
  const wholeCases = [
    // careful-looking paragraph, casual writer: left alone
    ["I dont know why. It's strange; nobody explained it.", "lol ngl i dont care tbh\nI dont know why. It's strange; nobody explained it.", null],
    // on its own the same paragraph is fixed
    ["I dont know why. It's strange; nobody explained it.", undefined, "I don't know why. It's strange; nobody explained it."],
    // the writer shows they know the standard form in another paragraph
    ["I would of stayed longer, honestly", "I would've gone, but it was late.\nI would of stayed longer, honestly", "I would have stayed longer, honestly"],
    ["I would of stayed longer, honestly", undefined, null],
    // ordinary slips don't depend on register
    ["i definately agree lol", "lol ngl i dont care tbh\ni definately agree lol", "i definitely agree lol"],
  ];
  for (const [inp, whole, exp] of wholeCases) {
    const got = conv(inp, whole); const want = exp === null ? inp : exp;
    if (got === want) pass++; else { fail++; console.log('FAIL (whole comment)\n  in:   ' + inp + '\n  got:  ' + got + '\n  want: ' + want); }
  }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
