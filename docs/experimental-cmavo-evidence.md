# Corpus evidence for experimental cmavo

A cmavo is a Lojban particle. A selma'o is its word class. This summary records a review of 140 experimental cmavo found in real text. The review considers words below score three and words without an English definition.

The definitions and scores come from the [Lensisku dictionary snapshot](https://github.com/int19h/jbocirvei/tree/8c1579254e73c72d20d202557e42d4d92346f6bc/dict) dated September 13, 2026. Each definition number links to its file in that snapshot. `Reviewed lines` records the original judgment's matching-line count. `Real uses` separates deliberate uses from mentions and mistakes where the evidence permits. `IRC/mail lines` gives the separate search total below. The class column records the reviewer's classification.

For `iu'e` and `iu'i`, the reviewer infers UI from the attitudinal definitions. Neither definition records a selma'o. Neither word enters the lexicon.

The review labels 95 words CONSISTENT, twelve INCONSISTENT, 27 UNCLEAR and six NOT-THE-WORD. These labels record the reviewer's assessment of corpus evidence. The [experimental lexicon](../grammars/lojban/experimental/lexicon.md#additions-from-real-text) states the admission policy and the maintainer's class corrections. [#257](https://github.com/int19h/gencmu/issues/257) tracks the missing constructions.

## Sources and searches

The original procedure searches IRC, Discord and mail for each candidate spelling. When a line contains the word several times, the search still counts that line once. The reviewer then reads the lines against the highest-scored dictionary definition. For words below three votes, admission requires use that agrees with that definition. Mentions, questions about a word and spelling mistakes do not establish such use.

The review also consults literary and wiki excerpts, including illustrative examples. A [song lyric](https://suzypavlis.neocities.org/lojban/zgike-valsi/zeljinxanrahe.html) supplies the `pau'ai` example. The [gadri-proof text](https://mw.lojban.org/papri/lapoi_pelxu_ku%27o_trajynobli) supplies the `zi'u` example. A judgment records the word, verdict, class, selected definition, reviewed line count and reason. All 140 rows agree with these judgments on class and verdict.

The IRC and mail sources are in [jbocirvei](https://github.com/int19h/jbocirvei/tree/8c1579254e73c72d20d202557e42d4d92346f6bc), at commit `8c1579254e73c72d20d202557e42d4d92346f6bc`. The `irc/` sources are `ckule`, `jbosnu` and `lojban`. The `mail/` sources include each list's raw `cur/` messages and rendered `threads/` files.

Some Discord exchanges appear through a bridge in `irc/lojban/`. A [November 22, 2016 message](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/lojban/2016/2016-11-22.txt#L54) explicitly names that bridge. This does not cover all Discord material in the review. The separate [roljbogu'e Discord archive](https://github.com/lojbo/roljboguhe-discord/tree/c215dba93685150deaacd94ca20672b49160993f) supplies newer messages. Its commit is `c215dba93685150deaacd94ca20672b49160993f`.

The command below searches only the pinned corpus's IRC and mail trees, including bridged messages already there. It excludes the separate Discord archive, dictionary files, wiki pages and other literary sources. Run the command from the root of a corpus checkout at the stated commit. Each row's word replaces `bi'ai`:

```sh
rg -n -i "(^|[^a-z'])bi'ai([^a-z']|$)" irc mail | wc -l
```

The search uses case-insensitive literal spellings with ASCII letter and apostrophe boundaries. It uses ripgrep's default file filtering. It does not normalize apostrophe variants or joined word forms. Each matching physical line counts once.

These totals include mentions, bot replies, quoted text and repeated messages. When nicknames or mail headers match, their lines also count. Raw mail and rendered threads can repeat the same message. They are counts of matching lines, not independent speakers or confirmed uses.

The original review combines matching lines with extracted passages and additional context. Overlapping passages, repeated quotations and edited messages can contribute several records for one use. Its line counts therefore differ from the command's totals in 132 of 140 rows. For `bi'ai`, the judgment records forty reviewed lines. The IRC/mail command finds 829. The command measures its stated scope, rather than reproducing the original selection.

## Lines and real uses

`Real uses` counts distinct deliberate use contexts where the judgment or the excerpts separate them. A constructed example counts as a use, even inside a quotation. A quoted fragment alone does not establish a complete construction. A mention with `zo`, a word list or a word question does not. A corrected mistake does not count as an intended use of the original spelling. Conflicting uses count here too, so a positive count does not imply admission.

An exact number means that the evidence separates that many contexts. When the review does not separate every context or repeated record, `≥` gives a lower bound. `0 confirmed` leaves an uncertain spelling or meaning unresolved. Counts concern the reviewed evidence, not every match in the larger IRC/mail search. The notes below explain mixed evidence and repeated contexts. Rows without a separate note rely on their judgment or the reason in their table.

The `bi'au` judgment records twelve lines, one bee-buzz use and eleven word-question lines. The use is [an October 8, 2026 Discord message](https://github.com/lojbo/roljboguhe-discord/blob/c215dba93685150deaacd94ca20672b49160993f/raw/2026/10/08/1304486402418937931.jsonl#L1). It says `bi'au bi'au .i mi remna na ku je cu bifce po'o bi'au~~`. The word question appears in [an October 10 message](https://discord.com/channels/771781383361921024/1304486402418937931/1558529370849804381), with several edited versions. The excerpts overlap, so twelve records do not mean twelve messages.

The pinned IRC/mail trees predate these Discord messages. Their sole `bi'au` match is [a different, older message](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/lojban/2016/2016-06-16.txt#L125).

The ten `zei'i` records repeat five IRC passages through two source views. Three passages construct compounds, including one under `zo`, and two only mention the brackets. The uses occur at [lines 25, 34 and 53](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2015/2015-02-23.txt#L24-L53). The six `ui'a` records repeat [three messages](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2015/2015-05-25.txt#L119-L121) through two source views. They contain a word question, an example and its correction to `ui'e`. They establish zero intended uses of `ui'a`.

The source scope and repeated records explain all three cases where reviewed lines exceed the IRC/mail total. These distinctions change no judgment or lexicon entry.

| Word | Separation in the reviewed evidence |
|---|---|
| `ba'oi` | Four uses, including a quoted example, and one mention. |
| `bi'au` | One bee-buzz context. The judgment describes eleven other records as word questions, with overlapping excerpts and edits. |
| `bo'a` | Definition variables predominate. The judgment also identifies two predicate-variable uses, a rafsi match and a mention. |
| `bo'ai` | One definition-variable example and two mentions. |
| `bo'oi` | Two uses and one mention. |
| `da'au` | Two use contexts include one sentence and its corrected version. |
| `dau'u` | Article uses alternate with discussion of the word. |
| `de'a'ai` | Seven uses and three mentions. |
| `dei'ei` | One possessive use and one explanatory gloss. |
| `di'a'ai` | Four uses and two mentions. |
| `do'ei` | One passage appears both as a quotation and as plain text. |
| `du'ai` | Two conversion contexts. One appears in two versions of the same sentence. |
| `gai'o` | One joke greeting and one mention. |
| `iu'e` | One context coins a stronger-love meaning. Another leaves the intent of Iu'e unclear. |
| `jei'u` | Uses alternate with a mention and a word list. |
| `jo'ai` | Three uses and one mention. |
| `kai'e` | Three uses and one word list. |
| `kai'i` | One live article use. Other records discuss the word or quote a fragment. |
| `ki'au` | Two use contexts include one sentence and its corrected version. |
| `ku'ai'i` | One names-list use, one bare use and one use under leka. |
| `ku'au` | Terminator uses alternate with mentions. The judgment gives no separate total for uses. |
| `le'ei` | One mail example, repeated in quotations, and one mention. |
| `loi'e` | One full article use and one fragment, .ja loi'e. |
| `lu'ei` | Quotation constructions alternate with mentions and overlapping examples. The evidence does not separate every context. |
| `mau'u` | Four uses and one mention. |
| `ne'au` | One bare reply. Other records mention the word or contain a related lujvo. |
| `pau'ai` | The full lyric and its extracted line contain the same rhetorical question. |
| `po'au` | Most contexts use a clause marker. Two records explicitly equate the word with xu'u. |
| `poi'o'a` | Five uses and four mentions or list entries. |
| `pu'ei` | Two clause examples and one mention, each repeated through two source views. |
| `ra'ei` | One appended 'and so on' use and two discussions. |
| `rei'e` | Five uses and one mention. |
| `ru'oi` | One quantifier use and one comparison with ru'o. |
| `sai'e` | Three contexts include one sentence and its corrected version, plus a quoted phrase under discussion. |
| `se'o'e` | One sentence appears before and after a correction of another word. |
| `si'oi` | One erasure-restoration use and one table of proposed articles. |
| `soi'i` | A table proposes an article with this spelling. It gives no live use of the relativizer. |
| `so'oi` | Six clause uses and one question, so'oi ki'a. |
| `ta'ei` | Uses alternate with a mention. Overlapping excerpts prevent an exact count here. |
| `ta'oi` | One clear continuation use and one playful, unclear context. |
| `te'oi` | Abstraction examples alternate with mentions and definition text. |
| `ti'oi` | All five records use the article. Two contain almost identical versions of the same example. |
| `ui'a` | Three messages appear twice. A word question leads to an example and its correction to ui'e. |
| `va'ai` | One modal use. Other contexts discuss word shapes. |
| `va'ei` | Degree uses alternate with mentions. |
| `xau` | Beneficiary uses alternate with lists of word forms. |
| `xu'u` | Uses alternate with mentions. The judgment gives no separate total for uses. |
| `xy'y` | One excerpt mentions zo xy'y. Other excerpts use the interjection, including one compound example. |
| `za'oi` | Two uses and one mention. |
| `zei'a` | One tense use fits the definition. Other contexts construct compounds or discuss the proposed joiner. |
| `zei'i` | Three compound examples and two mentions, each repeated through two source views. |

## Consistent use

CONSISTENT records the reviewer's judgment that use matches the selected definition. The 95 words comprise 94 words with the selected base class and `ni'au` with a corrected class. The maintainer assigns `ni'au` COI from its greeting meaning and vocative use, despite its CAI filing. The baseline already includes `ku'au`. Thus 95 qualifying words minus one baseline word add 94 spellings.

| Word | Class in judgment | Definition | Reviewed lines | Real uses | IRC/mail lines |
|---|---|---|---:|---:|---:|
| `au'o` | UI | [71431](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/au%27o/en-71431.md) | 2 | 2 | 6 |
| `au'y` | BY | [67686](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/au%27y/en-67686.md) | 2 | 2 | 2 |
| `ba'oi` | ROI | [16212](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ba%27oi/en-16212.md) | 5 | 4 | 376 |
| `bi'ai` | CAhA | [60530](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/bi%27ai/en-60530.md) | 40 | ≥1 | 829 |
| `bi'au` | UI | [73212](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/bi%27au/en-73212.md) | 12 | 1 | 1 |
| `bo'a` | KOhA | [67080](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/bo%27a/en-67080.md) | 20 | ≥1 | 167 |
| `bo'ai` | LI | [67093](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/bo%27ai/en-67093.md) | 3 | 1 | 22 |
| `bo'e` | KOhA | [67081](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/bo%27e/en-67081.md) | 5 | 5 | 172 |
| `bo'i` | KOhA | [67082](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/bo%27i/en-67082.md) | 2 | 2 | 116 |
| `bo'oi` | UI | [66712](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/bo%27oi/en-66712.md) | 3 | 2 | 26 |
| `bu'oi` | COI | [37899](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/bu%27oi/en-37899.md) | 2 | 2 | 42 |
| `ca'au` | KOhA | [67633](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ca%27au/en-67633.md) | 3 | 3 | 33 |
| `ca'e'ei` | UI | [71760](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ca%27e%27ei/en-71760.md) | 1 | 1 | 3 |
| `cai'e` | NAhE | [66527](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/cai%27e/en-66527.md) | 1 | 1 | 12 |
| `ci'ai` | UI | [66072](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ci%27ai/en-66072.md) | 2 | 2 | 37 |
| `cu'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u` | UI | [71332](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/cu%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u%27u/en-71332.md) | 1 | 1 | 7 |
| `da'ai` | KOhA | [41433](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/da%27ai/en-41433.md) | 4 | 4 | 265 |
| `da'au` | KOhA | [56927](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/da%27au/en-56927.md) | 3 | 2 | 191 |
| `dau'u` | LE | [72076](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/dau%27u/en-72076.md) | 9 | ≥5 | 15 |
| `de'a'ai` | COI | [68996](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/de%27a%27ai/en-68996.md) | 10 | 7 | 37 |
| `dei'a` | TAhE | [66121](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/dei%27a/en-66121.md) | 2 | 2 | 44 |
| `dei'ei` | KOhA | [66540](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/dei%27ei/en-66540.md) | 2 | 1 | 23 |
| `di'a'ai` | COI | [68997](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/di%27a%27ai/en-68997.md) | 6 | 4 | 27 |
| `di'ei'o'au` | VUhU | [57179](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/di%27ei%27o%27au/en-57179.md) | 1 | 1 | 10 |
| `do'ei` | KOhA | [66465](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/do%27ei/en-66465.md) | 2 | 1 | 42 |
| `do'oi` | DOhOI | [56527](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/do%27oi/en-56527.md) | 6 | 6 | 117 |
| `du'ai` | ME | [72090](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/du%27ai/en-72090.md) | 3 | 2 | 3 |
| `du'au` | LAhE | [35324](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/du%27au/en-35324.md) | 1 | 1 | 349 |
| `fa'u'u'u'u'u'u'u'u` | FAhO | [71952](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/fa%27u%27u%27u%27u%27u%27u%27u%27u/en-71952.md) | 1 | 1 | 5 |
| `fai'i` | FA | [73176](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/fai%27i/en-73176.md) | 2 | 2 | 29 |
| `fi'ai` | ZOhU | [72755](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/fi%27ai/en-72755.md) | 1 | 1 | 9 |
| `gai'o` | GOhA | [56826](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/gai%27o/en-56826.md) | 2 | 1 | 21 |
| `iau` | IhAU | [66255](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/iau/en-66255.md) | 50 | ≥1 | 1098 |
| `ie'o` | Y | [69454](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ie%27o/en-69454.md) | 12 | 12 | 128 |
| `iy'y` | BY | [66824](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/iy%27y/en-66824.md) | 1 | 1 | 5 |
| `jei'u` | UI | [66532](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/jei%27u/en-66532.md) | 6 | ≥3 | 46 |
| `jo'ai` | JAI | [68999](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/jo%27ai/en-68999.md) | 4 | 3 | 30 |
| `kai'e` | UI | [66372](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/kai%27e/en-66372.md) | 4 | 3 | 20 |
| `kai'ei` | NU | [67362](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/kai%27ei/en-67362.md) | 2 | ≥1 | 9 |
| `kai'i` | LE | [68926](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/kai%27i/en-68926.md) | 5 | 1 | 92 |
| `ke'o'a` | COI | [72402](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ke%27o%27a/en-72402.md) | 1 | 1 | 5 |
| `ki'au` | UI | [72346](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ki%27au/en-72346.md) | 3 | 2 | 4 |
| `ko'ai` | LOhOI | [68964](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ko%27ai/en-68964.md) | 45 | ≥1 | 125 |
| `koi'i` | LOhOI | [72077](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/koi%27i/en-72077.md) | 1 | 1 | 13 |
| `ku'ai'i` | GOhA | [69522](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ku%27ai%27i/en-69522.md) | 3 | 3 | 25 |
| `ku'au` | KUhAU | [60527](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ku%27au/en-60527.md) | 27 | ≥1 | 255 |
| `ku'au'i` | COI | [68934](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ku%27au%27i/en-68934.md) | 2 | 2 | 7 |
| `lai'u` | LA | [70393](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/lai%27u/en-70393.md) | 1 | 1 | 25 |
| `li'au` | LIhAU | [67730](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/li%27au/en-67730.md) | 8 | ≥6 | 134 |
| `lo'o'o` | LE | [69562](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/lo%27o%27o/en-69562.md) | 1 | 1 | 22 |
| `loi'e` | LE | [67138](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/loi%27e/en-67138.md) | 2 | 1 (+1 fragment) | 557 |
| `lu'au` | LAhE | [35325](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/lu%27au/en-35325.md) | 1 | 1 | 221 |
| `lu'ei` | LUhEI | [67731](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/lu%27ei/en-67731.md) | 10 | ≥6 | 156 |
| `mau'u` | UI | [64013](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/mau%27u/en-64013.md) | 5 | 4 | 59 |
| `ne'au` | UI | [56616](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ne%27au/en-56616.md) | 6 | 1 | 34 |
| `ne'e` | CAI | [37964](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ne%27e/en-37964.md) | 2 | 2 | 334 |
| `ni'au` | CAI | [57080](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ni%27au/en-57080.md) | 2 | 2 | 87 |
| `oi'o` | UI | [64079](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/oi%27o/en-64079.md) | 2 | 2 | 81 |
| `pau'ai` | UI | [67907](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/pau%27ai/en-67907.md) | 2 | 1 | 13 |
| `pe'ai` | UI | [44164](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/pe%27ai/en-44164.md) | 1 | 1 | 22 |
| `poi'o'a` | NOIhA | [68610](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/poi%27o%27a/en-68610.md) | 9 | 5 | 70 |
| `ra'ei` | UI | [63550](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ra%27ei/en-63550.md) | 3 | 1 | 7 |
| `rei'e` | NAhE | [66524](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/rei%27e/en-66524.md) | 6 | 5 | 22 |
| `ru'oi` | PA | [69429](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ru%27oi/en-69429.md) | 2 | 1 | 25 |
| `sai'e` | NAhE | [66526](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/sai%27e/en-66526.md) | 4 | 3 | 25 |
| `sau'ei` | COI | [64012](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/sau%27ei/en-64012.md) | 4 | 4 | 29 |
| `se'ai` | SE | [69017](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/se%27ai/en-69017.md) | 1 | 1 | 88 |
| `se'o'e` | SE | [63977](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/se%27o%27e/en-63977.md) | 2 | 1 | 10 |
| `sei'e` | SEI | [71040](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/sei%27e/en-71040.md) | 1 | 1 | 4 |
| `sei'u` | COI | [71039](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/sei%27u/en-71039.md) | 5 | ≥1 | 62 |
| `si'i'ei` | SIhIhEI | [70402](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/si%27i%27ei/en-70402.md) | 1 | 1 | 1 |
| `si'oi` | SIhOI | [71439](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/si%27oi/en-71439.md) | 2 | 1 | 30 |
| `so'oi` | SOhOI | [71817](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/so%27oi/en-71817.md) / [72780](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/so%27oi/en-72780.md) | 7 | 6 | 17 |
| `su'o'o` | PA | [71450](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/su%27o%27o/en-71450.md) | 1 | 1 | 1 |
| `su'u'u'u'u'u'u'u` | SUhUhUhUhUhUhUhU | [71464](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/su%27u%27u%27u%27u%27u%27u%27u/en-71464.md) | 1 | 1 | 8 |
| `ta'ei` | UI | [44191](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ta%27ei/en-44191.md) | 7 | ≥5 | 20 |
| `ta'oi` | TAhOI | [64751](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ta%27oi/en-64751.md) | 2 | 1 (+1 unclear) | 43 |
| `te'i` | BAI | [66299](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/te%27i/en-66299.md) | 2 | 2 | 426 |
| `te'oi` | NU | [72043](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/te%27oi/en-72043.md) | 6 | ≥3 | 13 |
| `ti'oi` | LE | [71816](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ti%27oi/en-71816.md) | 5 | ≥4 | 24 |
| `toi'o` | TOIhO | [56615](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/toi%27o/en-56615.md) | 1 | 1 | 53 |
| `toi'u` | UI | [74907](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/toi%27u/en-74907.md) | 1 | 1 | 3 |
| `uau'o` | UI | [70406](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/uau%27o/en-70406.md) | 1 | 1 | 1 |
| `ue'e` | UI | [72590](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ue%27e/en-72590.md) | 2 | 2 | 2 |
| `va'ei` | ROI | [66461](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/va%27ei/en-66461.md) | 18 | ≥1 | 149 |
| `va'u'ai` | UI | [68765](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/va%27u%27ai/en-68765.md) | 1 | 1 | 4 |
| `xa'oi` | UI | [68673](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/xa%27oi/en-68673.md) | 2 | 2 | 5 |
| `xai'i` | LE | [72058](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/xai%27i/en-72058.md) | 3 | ≥1 | 3 |
| `xau` | BAI | [66000](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/xau/en-66000.md) | 39 | ≥1 | 984 |
| `xe'e'e` | UI | [71243](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/xe%27e%27e/en-71243.md) | 4 | 4 | 185 |
| `xu'u` | LOhOI | [60528](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/xu%27u/en-60528.md) | 50 | ≥1 | 597 |
| `xy'y` | UI | [66157](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/xy%27y/en-66157.md) | 12 | ≥10 | 67 |
| `za'ai` | ZI | [18408](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/za%27ai/en-18408.md) | 3 | 3 | 32 |
| `za'oi` | UI | [68674](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/za%27oi/en-68674.md) | 3 | 2 | 12 |
| `ze'ai` | TAhE | [66154](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ze%27ai/en-66154.md) | 1 | 1 | 69 |

## Inconsistent use

INCONSISTENT means that the use conflicts with the selected definition or lacks an English definition that supports it. Eleven words have conflicting English meanings or classes. `pu'ei` has no English definition, and its use also differs from its Lojban definition. These twelve words stay outside the lexicon.

| Word | Class in judgment | Definition | Reviewed lines | Real uses | IRC/mail lines | Reason |
|---|---|---|---:|---:|---:|---|
| `iu'e` | UI | [72722](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/iu%27e/en-72722.md) | 3 | 1 (+1 unclear) | 13 | Stronger love use conflicts with sexual consent definition |
| `ja'oi` | JAhOI | [64002](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ja%27oi/en-64002.md) | 3 | ≥1 | 15 | Age predicate use conflicts with permutation opener definition |
| `le'ei` | LE | [72570](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/le%27ei/en-72570.md) | 4 | 1 | 125 | Intensional article use differs from Loglan article definition |
| `li'ai` | LI | [36743](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/li%27ai/en-36743.md) | 1 | 1 | 118 | Character string use fits a lower-scored definition |
| `po'au` | GOI | [88597](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/po%27au/en-88597.md) | 36 | ≥1 | 55 | LOhOI use conflicts with restrictive GOI definition |
| `pu'ei` | NAI | [68778](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/pu%27ei/jbo-68778.md) (Lojban) | 6 | 2 | 11 | No English definition, and before conjunction differs from Lojban NAI definition |
| `soi'i` | SOIhI | [72645](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/soi%27i/en-72645.md) | 1 | 0 | 7 | Article use conflicts with relativizer definition |
| `tei'u` | TEIhU | [64003](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/tei%27u/en-64003.md) | 6 | ≥1 | 23 | Quotation opener use conflicts with terminator definition |
| `zai'u` | ZAIhU | [68594](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/zai%27u/en-68594.md) | 1 | 1 | 10 | Again use conflicts with following quotation requirement |
| `zei'a` | TAhE | [66120](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/zei%27a/en-66120.md) | 14 | ≥1 | 149 | Word joining conflicts with TAhE tense definition |
| `zei'i` | UI | [71483](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/zei%27i/en-71483.md) | 10 | 3 | 9 | Compound brackets conflict with UI contour definition |
| `zi'u` | LAhE | [73556](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/zi%27u/en-73556.md) | 1 | 1 | 116 | Relative clause attachment conflicts with LAhE definition |

## Unclear use

UNCLEAR means that the excerpts give too little evidence to settle the use. They mainly contain mentions, sound play or uncertain meanings. This verdict grants no corpus exception. The baseline includes `fi'oi` in SOI, despite the FIhOI class recorded for its highest English definition.

| Word | Class in judgment | Definition | Reviewed lines | Real uses | IRC/mail lines | Reason |
|---|---|---|---:|---:|---:|---|
| `bo'au` | BAI | [44169](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/bo%27au/en-44169.md) | 2 | 0 | 5 | Only mentions, with no use to judge |
| `bo'ei` | GOhOI | [67041](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/bo%27ei/en-67041.md) | 1 | 0 | 15 | Only mentions, with no use to judge |
| `e'ei` | UI | [65506](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/e%27ei/en-65506.md) | 1 | 0 confirmed | 16 | Sound play gives no clear appeal meaning |
| `ei'e` | UI | [67724](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ei%27e/en-67724.md) | 1 | 0 | 16 | Only mentions, with no use to judge |
| `fi'i'e` | COI | [65113](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/fi%27i%27e/en-65113.md) | 1 | 0 | 14 | Only mentions, with no use to judge |
| `fi'oi` | FIhOI | [53170](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/fi%27oi/en-53170.md) | 2 | 0 | 132 | Only mentions, with no use to judge |
| `go'ai` | GOhA | [70654](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/go%27ai/en-70654.md) | 1 | 0 | 20 | Only mentions, with no use to judge |
| `iu'i` | UI | [72723](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/iu%27i/en-72723.md) | 1 | 0 confirmed | 1 | Context does not establish the intended word |
| `je'ai` | NAhE | [36696](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/je%27ai/en-36696.md) | 1 | 0 | 47 | Only mentions, with no use to judge |
| `ju'ei` | JUhEI | [42359](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ju%27ei/en-42359.md) / [69030](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ju%27ei/en-69030.md) | 1 | 0 confirmed | 163 | Tied JUhEI and BAI definitions, with neither clear in context |
| `lai'i` | UI | [66373](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/lai%27i/en-66373.md) | 1 | 0 | 12 | Only mentions, with no use to judge |
| `noi'a'u` | NOIhAhU | [68962](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/noi%27a%27u/en-68962.md) | 1 | 0 | 6 | Only mentions, with no use to judge |
| `noi'au` | NOIhAU | [68960](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/noi%27au/en-68960.md) | 1 | 0 | 5 | Only mentions, with no use to judge |
| `noi'i` | NOIhI | [63972](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/noi%27i/en-63972.md) | 1 | 0 | 14 | Only a mention, with another role suggested |
| `pei'e` | UI | [66848](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/pei%27e/en-66848.md) | 1 | 0 | 8 | Only mentions, with no use to judge |
| `poi'a'u` | NOIhAhU | [68961](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/poi%27a%27u/en-68961.md) | 1 | 0 | 6 | Only mentions, with no use to judge |
| `poi'au` | NOIhAU | [68892](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/poi%27au/en-68892.md) | 1 | 0 | 6 | Only mentions, with no use to judge |
| `to'au` | FAhO | [71774](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/to%27au/en-71774.md) | 1 | 0 | 10 | Only mentions, with no use to judge |
| `tu'ei` | SE | [67984](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/tu%27ei/en-67984.md) | 2 | 0 | 8 | Only mentions, with no use to judge |
| `va'ai` | BAI | [19605](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/va%27ai/en-19605.md) | 22 | 1 | 78 | One modal use amid mentions with another role |
| `voi'i` | NOI | [66420](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/voi%27i/en-66420.md) | 1 | 0 | 107 | Only mentions, with no use to judge |
| `za'ei` | VUhU | [66170](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/za%27ei/en-66170.md) | 2 | 0 | 42 | Only mentions, with a different operation suggested |
| `zei'e` | BAhE | [71471](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/zei%27e/en-71471.md) | 1 | 0 | 3 | Only mentions, with no use to judge |
| `zei'ei` | ZEIhEI | [64197](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/zei%27ei/en-64197.md) | 1 | 0 | 32 | Only mentions, with no use to judge |
| `zei'o` | ZIhOI | [72641](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/zei%27o/en-72641.md) | 1 | 0 | 4 | Only mentions, with no use to judge |
| `zoi'e` | ZO | [74775](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/zoi%27e/en-74775.md) | 1 | 0 | 23 | Only mentions, with no use to judge |
| `zoi'o` | ZOIhO | [74892](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/zoi%27o/en-74892.md) | 1 | 0 | 4 | Only mentions, with no use to judge |

## A different word

NOT-THE-WORD means that the context points to a mistake for another word. These six judgments grant no corpus exception.

| Word | Class in judgment | Definition | Reviewed lines | Real uses | IRC/mail lines | Reason |
|---|---|---|---:|---:|---:|---|
| `be'oi` | BEhOI | [66888](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/be%27oi/en-66888.md) | 1 | 0 | 6 | Clause boundary needs be'o |
| `ce'ei` | MOI | [75017](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ce%27ei/en-75017.md) | 3 | 0 | 7 | Speaker corrects it to ca'ei |
| `le'au` | SEI | [65567](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/le%27au/en-65567.md) | 1 | 0 | 18 | Speaker corrects it to le'ai |
| `sa'oi` | SAhOI | [70487](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/sa%27oi/en-70487.md) | 1 | 0 | 15 | Correction frame needs sa'ai |
| `ui'a` | UI | [69887](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ui%27a/en-69887.md) | 6 | 0 | 3 | Speaker corrects it to ui'e |
| `xo'oi` | NOI | [73373](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/xo%27oi/en-73373.md) | 2 | 0 | 13 | Speaker identifies a mistake for xa'i |

## Locations for contested judgments

The `bi'ai` search includes modal uses at [irc/jbosnu/2015/2015-03-14.txt:174–177](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2015/2015-03-14.txt#L174-L177), [irc/jbosnu/2015/2015-04-16.txt:17–20](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2015/2015-04-16.txt#L17-L20) and [irc/jbosnu/2015/2015-10-21.txt:1–4](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2015/2015-10-21.txt#L1-L4). The original judgment describes forty modal examples with this meaning.

The twelve INCONSISTENT rows concern conflicting meanings or classes. They are not twelve recorded speaker corrections. These locations expose the context behind each contested judgment:

| Word | Corpus location | What the context supplies |
|---|---|---|
| `iu'e` | [irc/jbosnu/2018/2018-05-23.txt:31–35](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2018/2018-05-23.txt#L31-L35) | The speaker describes a stronger love meaning. |
| `ja'oi` | [irc/jbosnu/2012/2012-06-14.txt:1–4](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2012/2012-06-14.txt#L1-L4) | The speaker uses an age predicate and repairs its surrounding phrase. |
| `le'ei` | [mail/jboske/cur/1035474869.cdd9851978df9cfe.lojban:2,S:10–21](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/mail/jboske/cur/1035474869.cdd9851978df9cfe.lojban%3A2%2CS#L10-L21) | The discussion places the article beside lo'ei and contrasts their meanings with official articles. |
| `li'ai` | [irc/jbosnu/2015/2015-01-15.txt:1–5](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2015/2015-01-15.txt#L1-L5) | The word introduces a date format as a character string. |
| `po'au` | [irc/jbosnu/2020/2020-10-05.txt:38–60](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2020/2020-10-05.txt#L38-L60) | The word introduces predicate and sentence content. |
| `pu'ei` | [irc/jbosnu/2021/2021-12-11.txt:12–17](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2021/2021-12-11.txt#L12-L17) | The word precedes a clause, with a temporal reading. |
| `soi'i` | [mail/jboske/threads/2003/bcfa67915d2c-ks_kinds.txt:27–58](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/mail/jboske/threads/2003/bcfa67915d2c-ks_kinds.txt#L27-L58) | The proposal lists NU and LE forms. This is a proposal, not clear evidence of ordinary article use. |
| `tei'u` | [irc/jbosnu/2015/2015-01-19.txt:34–39](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2015/2015-01-19.txt#L34-L39) | The word opens a quoted expression. |
| `zai'u` | [irc/jbosnu/2015/2015-04-14.txt:23–26](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2015/2015-04-14.txt#L23-L26) | The speaker supplies an explicit again paraphrase. |
| `zei'a` | [irc/jbosnu/2015/2015-02-23.txt:41–46](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2015/2015-02-23.txt#L41-L46) | The speaker explains the word as a compound joiner. |
| `zei'i` | [irc/jbosnu/2015/2015-02-23.txt:24–34](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2015/2015-02-23.txt#L24-L34) | The speakers discuss and use compound brackets. |
| `zi'u` | [mail/lojban-list/threads/1999/f36aa5d72359-mela_senva_tcadu_bimo'o.txt:15–22](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/mail/lojban-list/threads/1999/f36aa5d72359-mela_senva_tcadu_bimo%27o.txt#L15-L22) | The word stands before a relative clause in song text. |

## Corrections and mistaken-word contexts

Four of the six NOT-THE-WORD judgments explicitly claim speaker corrections. The locations below show these corrections. The two other judgments infer a mistake from grammatical context.

| Word | Corpus location | Evidence |
|---|---|---|
| `ce'ei` | [irc/jbosnu/2023/2023-02-08.txt:29–32](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2023/2023-02-08.txt#L29-L32) | The speaker replaces ce'ei with ca'ei in an explicit correction frame. |
| `le'au` | [irc/jbosnu/2020/2020-09-30.txt:38–39](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2020/2020-09-30.txt#L38-L39) | The same speaker follows le'au with si le'ai. |
| `le'au` | [irc/lojban/2011/2011-11-04.txt:156–157](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/lojban/2011/2011-11-04.txt#L156-L157) | A second speaker also follows le'au with si le'ai. |
| `ui'a` | [irc/jbosnu/2015/2015-05-25.txt:119–122](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2015/2015-05-25.txt#L119-L122) | The speaker explicitly replaces ui'a with ui'e. |
| `xo'oi` | [irc/jbosnu/2021/2021-12-09.txt:114–119](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2021/2021-12-09.txt#L114-L119) | The speaker says that xa'i was intended. |
| `be'oi` | [irc/lojban/2015/2015-08-01.txt:125–129](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/lojban/2015/2015-08-01.txt#L125-L129) | The sentence has a BE group before the following relative clause. No explicit self-correction appears here. |
| `sa'oi` | [irc/jbosnu/2012/2012-06-14.txt:1–4](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/irc/jbosnu/2012/2012-06-14.txt#L1-L4) | The word occupies the replacement separator's position. No explicit correction of that spelling appears here. |
