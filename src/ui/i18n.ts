/**
 * UI translations. Keys are shared by all languages; anything missing falls
 * back to English. Plural forms use `key.one` / `key.other` etc. as chosen by
 * Intl.PluralRules. Board coordinates (D4, Q16…) are never translated.
 */

export type Lang = "en" | "ja";

export const LANGS: { code: Lang; name: string }[] = [
  { code: "en", name: "English" },
  { code: "ja", name: "日本語" },
];

export type Dict = Record<string, string>;

const en: Dict = {
  "meta.title": "Go — the game of surrounding stones",
  "meta.description":
    "Play go (igo, weiqi, baduk) against the computer in your browser. 9×9, 13×13 and 19×19 boards, five opponents from Japanese folklore.",
  "brand.primary": "Go",
  "brand.secondary": "囲碁",
  "header.tagline": "The game of surrounding territory",
  "header.rules": "Rules",
  "header.library": "Records",
  "header.theme": "Toggle dark mode",
  "header.language": "Language",
  "board.aria":
    "Go board. Use the arrow keys to move the cursor and Enter to place a stone.",
  "board.reviewing": "Reviewing",
  "board.counting": "Counting",
  "point.empty": "{point}, empty",
  "point.stone": "{point}, {side} stone",

  "side.black": "Black",
  "side.white": "White",
  "side.black.lower": "black",
  "side.white.lower": "white",

  "btn.pass": "Pass",
  "btn.pass.title": "Pass your turn (P)",
  "btn.undo": "Undo",
  "btn.undo.title": "Take back your last move (U)",
  "btn.hint": "Hint",
  "btn.hint.title": "Suggest a move (H)",
  "btn.resign": "Resign",
  "btn.resign.title": "Resign this game",
  "btn.newGame": "New game",
  "btn.playAgain": "Play again",
  "btn.cancel": "Cancel",
  "btn.begin": "Begin",
  "btn.close": "Close dialog",
  "btn.returnToBoard": "Return to the board",
  "btn.viewBoard": "View the board",
  "btn.changeOpponent": "Change opponent",
  "btn.reviewGame": "Review game",
  "btn.accept": "Accept the count",
  "btn.resume": "Resume play",

  "status.yourMove": "Your move",
  "status.yourMove.detail":
    "You play {side}. Tap an intersection to place a stone.",
  "status.yourMove.detail.mouse":
    "You play {side}. Click an intersection to place a stone.",
  "status.confirm": "Tap again to place at {point}",
  "status.confirm.detail": "Or tap another intersection.",
  "status.aiPassed": "{name} passed",
  "status.aiPassed.detail":
    "Pass as well to end the game and count, or keep playing.",
  "status.thinking": "{name} is thinking…",
  "status.hintThinking": "Looking for a good move…",
  "status.hintThinking.detail": "Reading the board for you.",
  "status.hint": "Try {point}",
  "status.hint.pass": "Passing looks best",
  "status.hint.detail": "The marked point is the engine's suggestion.",
  "status.hint.pass.detail":
    "There is nothing big left to play. Pass to end the game.",
  "status.victory": "Victory",
  "status.defeat": "Defeat",
  "status.draw": "A draw (jigo)",
  "status.counting": "Counting the score",
  "status.counting.estimating": "Estimating which stones are dead…",
  "status.counting.detail":
    "Stones marked × are dead and count for the other side. Tap a group to change it.",
  "status.reviewStart": "Start of the game",
  "status.reviewMove": "Move {n} · {move}",
  "status.reviewHelp": "Use ← → to step through the game.",
  "status.illegal.ko":
    "Ko: you cannot retake straight away. Play elsewhere first.",
  "status.illegal.suicide": "That stone would have no liberties.",
  "status.illegal.occupied": "That point is taken.",
  "status.newcomer": "New to go? Read the rules",

  "score.black": "Black",
  "score.white": "White",
  "score.stones": "Stones",
  "score.territory": "Territory",
  "score.komi": "Komi",
  "score.total": "Total",

  "reason.score": "{winner} wins by {margin} points",
  "reason.score.half": "{winner} wins by {margin} points",
  "reason.draw": "Both sides have the same score",
  "reason.resign": "{winner} wins by resignation",
  "result.win": "You win!",
  "result.lose": "{name} wins",
  "result.draw": "A draw",
  "result.detail.one": "{text}, after {n} move.",
  "result.detail.other": "{text}, after {n} moves.",
  "result.resigned": "{name} resigns",

  "player.you": "You",
  "player.level": "Lv {n}",
  "player.thinking": "thinking",
  "player.toMove": "{side} to move",
  "player.captures.one": "{n} capture",
  "player.captures.other": "{n} captures",
  "player.komi": "+{komi} komi",
  "player.passed": "passed",

  "moves.title": "Moves",
  "moves.empty": "No moves yet.",
  "moves.count.one": "{n} move",
  "moves.count.other": "{n} moves",
  "moves.aria": "Go to move {n}, {move}",
  "moves.pass": "Pass",

  "nav.first": "First position (Home)",
  "nav.prev": "Previous move (←)",
  "nav.next": "Next move (→)",
  "nav.last": "Latest move (End)",
  "nav.live": "Back to game",
  "nav.review": "Review",
  "nav.review.title": "Analyse the game so far",

  "opponent.label": "Opponent",
  "opponent.levelOf": "Level {n} of {total}",
  "opponent.board": "{size}×{size}",
  "opponent.handicap.one": "{n} handicap stone",
  "opponent.handicap.other": "{n} handicap stones",

  "newGame.title": "A new game",
  "newGame.desc": "Choose a board and an opponent from Japanese folklore.",
  "newGame.size": "Board",
  "newGame.size.9": "Quick games: the computer is at its strongest here.",
  "newGame.size.13": "A middle size, with room for real frameworks.",
  "newGame.size.19":
    "The full board. Long games; the computer plays loosely here.",
  "newGame.playAs": "Play as",
  "newGame.random": "Random",
  "newGame.blackFirst": "Black plays first.",
  "newGame.handicap": "Handicap",
  "newGame.handicap.none": "None (even game)",
  "newGame.handicap.n.other": "{n} stones for Black",
  "newGame.komi": "White receives {komi} points of komi.",
  "newGame.komi.handicap":
    "Black starts with stones on the board, White plays first and receives {komi} points of komi.",
  "newGame.opponent": "Opponent",

  "level.strength": "Strength {n} of {total}",
  "level.1.name": "Tanuki",
  "level.1.title": "The shape-shifting raccoon dog",
  "level.1.desc": "Plays on a whim and is easily fooled. A gentle first game.",
  "level.2.name": "Kappa",
  "level.2.title": "The river imp",
  "level.2.desc": "Knows how to capture, and not much more.",
  "level.3.name": "Kitsune",
  "level.3.title": "The fox spirit",
  "level.3.desc": "Quick and cunning; reads simple fights.",
  "level.4.name": "Tengu",
  "level.4.title": "The mountain goblin",
  "level.4.desc": "A stern teacher who punishes careless shapes.",
  "level.5.name": "Ryūjin",
  "level.5.title": "The dragon king of the sea",
  "level.5.desc": "Thinks long and deep before every stone.",

  "rules.title": "The rules of go",
  "rules.subtitle": "囲碁のルール",
  "rules.desc": "A few simple rules, and a game of endless depth.",
  "rules.place.title": "Placing stones",
  "rules.place":
    "Black and White take turns placing one stone on an empty intersection. Stones never move once placed. Black plays first.",
  "rules.liberty.title": "Liberties",
  "rules.liberty":
    "The empty points next to a stone (up, down, left, right) are its <em>liberties</em>. Stones of one colour that touch share their liberties as a group.",
  "rules.capture.title": "Capturing",
  "rules.capture":
    "A group whose last liberty is filled is captured and taken off the board. You may not play where your own stones would have no liberties, unless the move captures.",
  "rules.ko.title": "Ko",
  "rules.ko":
    "If a single stone captures a single stone, the other side may not recapture at once: the board would repeat. Play elsewhere first. No earlier position may ever be repeated.",
  "rules.end.title": "The end and the count",
  "rules.end":
    "When neither side has a useful move, both pass. Dead stones are removed, and each side scores its stones plus the empty points it surrounds. White receives komi for moving second. The higher score wins.",
  "rules.tips":
    "<li>Corners are easiest to claim, then the sides, then the centre.</li><li>A group with two separate eyes can never be captured.</li><li>Here, scoring follows the Chinese (area) rules with 7.5 points of komi.</li>",

  "footer.html":
    'Go is over 2,500 years old: <span lang="ja">囲碁</span> in Japan, <span lang="zh">围棋</span> in China, <span lang="ko">바둑</span> in Korea. An old tale tells of a woodcutter who stopped to watch two immortals play; when the game ended, his axe handle had rotted away (<span lang="ja">爛柯</span>). The engine runs entirely in your browser.',

  "confirm.resign": "Resign this game?",
  "confirm.resign.ok": "Resign",
  "confirm.newGame": "Abandon the current game and start a new one?",
  "confirm.newGame.ok": "New game",

  "toast.illegal": "That move is not allowed.",

  "sr.played": "{side} played {move}",
  "sr.captured.one": "{n} stone captured",
  "sr.captured.other": "{n} stones captured",

  "library.title": "Game records",
  "library.desc":
    "Your games are saved in this browser. Open one to replay or review it, or share it as a link.",
  "library.filter": "Filter games",
  "library.filter.all": "All",
  "library.filter.win": "Wins",
  "library.filter.loss": "Losses",
  "library.filter.draw": "Draws",
  "library.noStorage":
    "This browser is not keeping data: records last only until the page is closed.",
  "library.empty": "No games yet. Finished and unfinished games appear here.",
  "library.emptyFilter": "No games match this filter.",
  "library.import": "Import SGF",
  "library.paste": "Paste SGF",
  "library.paste.submit": "Import",
  "library.exportAll": "Download all",
  "library.share": "Copy link",
  "library.download": "Download SGF",
  "library.delete": "Delete",
  "library.confirmDelete": "Delete this game record?",
  "library.copied": "Link copied",
  "library.badLink": "That game link could not be read.",
  "library.broken": "This record could not be opened.",
  "library.imported.one": "Imported {n} game",
  "library.imported.other": "Imported {n} games",
  "library.importPartial.other": "Imported {n}; {failed} could not be read",
  "library.importFailed": "No games could be read from that SGF.",
  "library.importDuplicate": "Those games are already in your records.",
  "library.current": "current",
  "library.open": "open",
  "library.vs": "{black} vs {white}",
  "library.outcome.win": "Win",
  "library.outcome.loss": "Loss",
  "library.outcome.draw": "Draw",
  "library.outcome.unfinished": "Unfinished",
  "library.outcome.abandoned": "Abandoned",

  "viewer.title": "Game record",
  "viewer.back": "My game",
  "viewer.kind.played": "Your game",
  "viewer.kind.imported": "Imported game",
  "viewer.kind.shared": "Shared game",
  "viewer.unfinished": "Unfinished game",
  "viewer.help": "Step through the moves with ← → or the move list.",

  "review.title": "Game review",
  "review.graph": "Black's winning chances over the game",
  "review.blackWinrate": "Black's win rate",
  "review.progress": "Analysing… {done} / {total}",
  "review.counts": "{blunders} blunders · {mistakes} mistakes",
  "review.turning": "Turning points",
  "review.winrate": "{side}'s chances: {before}% → {after}%.",
  "review.better": "Better: {move} (green ring).",
};

const ja: Dict = {
  "meta.title": "囲碁 — 石を囲むゲーム",
  "meta.description":
    "ブラウザでコンピューターと囲碁を打とう。9路・13路・19路盤、日本の妖怪たち5人の相手。",
  "brand.primary": "Go",
  "brand.secondary": "囲碁",
  "header.tagline": "地を囲む、二千五百年のゲーム",
  "header.rules": "ルール",
  "header.library": "棋譜",
  "header.theme": "ダークモード切替",
  "header.language": "言語",
  "board.aria": "碁盤。矢印キーでカーソルを動かし、Enter キーで石を置きます。",
  "board.reviewing": "検討中",
  "board.counting": "整地",
  "point.empty": "{point}、空点",
  "point.stone": "{point}、{side}石",

  "side.black": "黒",
  "side.white": "白",
  "side.black.lower": "黒",
  "side.white.lower": "白",

  "btn.pass": "パス",
  "btn.pass.title": "パスする (P)",
  "btn.undo": "待った",
  "btn.undo.title": "直前の自分の手を戻す (U)",
  "btn.hint": "ヒント",
  "btn.hint.title": "次の一手を提案 (H)",
  "btn.resign": "投了",
  "btn.resign.title": "この対局を投了する",
  "btn.newGame": "新しい対局",
  "btn.playAgain": "もう一局",
  "btn.cancel": "キャンセル",
  "btn.begin": "対局開始",
  "btn.close": "閉じる",
  "btn.returnToBoard": "盤に戻る",
  "btn.viewBoard": "盤面を見る",
  "btn.changeOpponent": "相手を変える",
  "btn.reviewGame": "対局を振り返る",
  "btn.accept": "この結果で終局",
  "btn.resume": "対局を再開",

  "status.yourMove": "あなたの番です",
  "status.yourMove.detail":
    "あなたは{side}番です。交点をタップして石を置きます。",
  "status.yourMove.detail.mouse":
    "あなたは{side}番です。交点をクリックして石を置きます。",
  "status.confirm": "もう一度タップで {point} に着手",
  "status.confirm.detail": "別の交点をタップして選び直せます。",
  "status.aiPassed": "{name}がパスしました",
  "status.aiPassed.detail":
    "あなたもパスすると終局して整地します。打ち続けても構いません。",
  "status.thinking": "{name}が考えています…",
  "status.hintThinking": "良い手を探しています…",
  "status.hintThinking.detail": "盤面を読んでいます。",
  "status.hint": "{point} はいかが",
  "status.hint.pass": "パスが良さそうです",
  "status.hint.detail": "印のついた点がエンジンの提案です。",
  "status.hint.pass.detail":
    "大きな手は残っていません。パスして終局しましょう。",
  "status.victory": "勝ち",
  "status.defeat": "負け",
  "status.draw": "持碁（引き分け）",
  "status.counting": "整地しています",
  "status.counting.estimating": "死に石を判定しています…",
  "status.counting.detail":
    "× の石は死に石として相手の地になります。石をタップすると切り替えられます。",
  "status.reviewStart": "対局開始時",
  "status.reviewMove": "{n}手目 · {move}",
  "status.reviewHelp": "← → キーで一手ずつ進められます。",
  "status.illegal.ko": "コウです。すぐには取り返せません。他に一手打ってから。",
  "status.illegal.suicide":
    "その石は呼吸点がなくなるので打てません（着手禁止点）。",
  "status.illegal.occupied": "そこにはすでに石があります。",
  "status.newcomer": "囲碁は初めて？ ルールを読む",

  "score.black": "黒",
  "score.white": "白",
  "score.stones": "石",
  "score.territory": "地",
  "score.komi": "コミ",
  "score.total": "合計",

  "reason.score": "{winner}の{margin}目勝ち",
  "reason.score.half": "{winner}の{margin}目勝ち",
  "reason.draw": "同じ点数です",
  "reason.resign": "{winner}の中押し勝ち",
  "result.win": "あなたの勝ちです！",
  "result.lose": "{name}の勝ち",
  "result.draw": "持碁",
  "result.detail.other": "{text}（{n}手）",
  "result.resigned": "{name}が投了しました",

  "player.you": "あなた",
  "player.level": "Lv {n}",
  "player.thinking": "思考中",
  "player.toMove": "{side}の手番",
  "player.captures.other": "アゲハマ {n}",
  "player.komi": "コミ {komi}",
  "player.passed": "パス",

  "moves.title": "棋譜",
  "moves.empty": "まだ着手はありません。",
  "moves.count.other": "{n}手",
  "moves.aria": "{n}手目 {move} へ",
  "moves.pass": "パス",

  "nav.first": "最初の局面 (Home)",
  "nav.prev": "一手戻る (←)",
  "nav.next": "一手進む (→)",
  "nav.last": "最新の局面 (End)",
  "nav.live": "対局に戻る",
  "nav.review": "検討",
  "nav.review.title": "ここまでの対局を分析",

  "opponent.label": "対局相手",
  "opponent.levelOf": "レベル {n} / {total}",
  "opponent.board": "{size}路盤",
  "opponent.handicap.other": "{n}子局",

  "newGame.title": "新しい対局",
  "newGame.desc": "碁盤と、日本の妖怪から相手を選びましょう。",
  "newGame.size": "碁盤",
  "newGame.size.9":
    "短時間で打てます。コンピューターが一番強いのはこの盤です。",
  "newGame.size.13": "中くらいの盤。布石の楽しみもあります。",
  "newGame.size.19":
    "本格的な19路盤。対局は長め、コンピューターはやや大味です。",
  "newGame.playAs": "手番",
  "newGame.random": "ランダム",
  "newGame.blackFirst": "黒が先に打ちます。",
  "newGame.handicap": "置き石",
  "newGame.handicap.none": "なし（互先）",
  "newGame.handicap.n.other": "黒 {n}子",
  "newGame.komi": "白にコミ {komi} 目が入ります。",
  "newGame.komi.handicap":
    "黒は置き石を置いた状態から始め、白が先に打ちます。コミは {komi} 目です。",
  "newGame.opponent": "対局相手",

  "level.strength": "強さ {n} / {total}",
  "level.1.name": "狸",
  "level.1.title": "化け上手の狸",
  "level.1.desc": "気まぐれに打ち、すぐに化かされます。最初の一局に。",
  "level.2.name": "河童",
  "level.2.title": "川に棲む河童",
  "level.2.desc": "石を取ることは知っています。それ以上はあまり。",
  "level.3.name": "狐",
  "level.3.title": "賢い狐",
  "level.3.desc": "素早く狡猾。簡単な戦いは読んできます。",
  "level.4.name": "天狗",
  "level.4.title": "山の天狗",
  "level.4.desc": "悪い形を見逃さない、厳しい師匠です。",
  "level.5.name": "龍神",
  "level.5.title": "海の龍神",
  "level.5.desc": "一手一手、深く長く考えます。",

  "rules.title": "囲碁のルール",
  "rules.subtitle": "The rules of go",
  "rules.desc": "ルールはわずか。奥深さは無限です。",
  "rules.place.title": "石を置く",
  "rules.place":
    "黒と白が交互に、空いている交点に石を一つずつ置きます。置いた石は動きません。黒が先に打ちます。",
  "rules.liberty.title": "呼吸点（ダメ）",
  "rules.liberty":
    "石の上下左右の空いた点を<em>呼吸点</em>といいます。隣り合った同じ色の石はひとつながりとなり、呼吸点を共有します。",
  "rules.capture.title": "石を取る",
  "rules.capture":
    "最後の呼吸点をふさがれた石は取られ、盤から取り除かれます。相手の石を取れる場合を除き、自分の石の呼吸点がなくなる点には打てません。",
  "rules.ko.title": "コウ",
  "rules.ko":
    "1子を取り返すと同じ形が繰り返される場合、すぐには取り返せません。他の場所に一手打ってからなら取り返せます。以前と同じ局面は二度と作れません。",
  "rules.end.title": "終局と整地",
  "rules.end":
    "お互いに打つ手がなくなったら、両者がパスして終局です。死に石を取り除き、自分の石と囲んだ空点を数えます。後手の白にはコミが加わります。点数の多い方が勝ちです。",
  "rules.tips":
    "<li>隅が一番地を作りやすく、次に辺、最後に中央です。</li><li>二つの独立した眼を持つ石は決して取られません。</li><li>このサイトでは中国ルール（面積計算）、コミ 7.5 目で数えます。</li>",

  "footer.html":
    '囲碁は2500年以上の歴史をもつゲームです（中国では<span lang="zh">围棋</span>、韓国では<span lang="ko">바둑</span>）。仙人の碁を眺めていた木こりが、一局が終わると斧の柄が腐っていた——という「爛柯」の故事があります。エンジンはすべてブラウザ内で動作します。',

  "confirm.resign": "この対局を投了しますか？",
  "confirm.resign.ok": "投了する",
  "confirm.newGame": "現在の対局をやめて、新しい対局を始めますか？",
  "confirm.newGame.ok": "新しい対局",

  "toast.illegal": "そこには打てません。",

  "sr.played": "{side}が{move}に打ちました",
  "sr.captured.other": "{n}子取りました",

  "library.title": "棋譜",
  "library.desc":
    "対局はこのブラウザに保存されます。開いて並べ直したり検討したり、リンクで共有できます。",
  "library.filter": "絞り込み",
  "library.filter.all": "すべて",
  "library.filter.win": "勝ち",
  "library.filter.loss": "負け",
  "library.filter.draw": "持碁",
  "library.noStorage":
    "このブラウザはデータを保存しません。棋譜はページを閉じるまでしか残りません。",
  "library.empty":
    "まだ対局はありません。終局した対局も途中の対局もここに並びます。",
  "library.emptyFilter": "条件に合う対局はありません。",
  "library.import": "SGF 読み込み",
  "library.paste": "SGF 貼り付け",
  "library.paste.submit": "読み込む",
  "library.exportAll": "すべてダウンロード",
  "library.share": "リンクをコピー",
  "library.download": "SGF をダウンロード",
  "library.delete": "削除",
  "library.confirmDelete": "この棋譜を削除しますか？",
  "library.copied": "リンクをコピーしました",
  "library.badLink": "対局リンクを読み取れませんでした。",
  "library.broken": "この棋譜は開けませんでした。",
  "library.imported.other": "{n}局を読み込みました",
  "library.importPartial.other":
    "{n}局を読み込みました（{failed}局は読めませんでした）",
  "library.importFailed": "SGF から対局を読み取れませんでした。",
  "library.importDuplicate": "それらの対局はすでに棋譜にあります。",
  "library.current": "対局中",
  "library.open": "表示中",
  "library.vs": "{black} 対 {white}",
  "library.outcome.win": "勝ち",
  "library.outcome.loss": "負け",
  "library.outcome.draw": "持碁",
  "library.outcome.unfinished": "途中",
  "library.outcome.abandoned": "中断",

  "viewer.title": "棋譜",
  "viewer.back": "対局に戻る",
  "viewer.kind.played": "あなたの対局",
  "viewer.kind.imported": "読み込んだ棋譜",
  "viewer.kind.shared": "共有された棋譜",
  "viewer.unfinished": "未完の対局",
  "viewer.help": "← → キーや棋譜の手をクリックして並べ直せます。",

  "review.title": "対局の検討",
  "review.graph": "対局中の黒の勝率",
  "review.blackWinrate": "黒の勝率",
  "review.progress": "分析中… {done} / {total}",
  "review.counts": "悪手 {blunders} · 疑問手 {mistakes}",
  "review.turning": "勝負どころ",
  "review.winrate": "{side}の勝率 {before}% → {after}%。",
  "review.better": "{move} が良かった（緑の円）。",
};

const DICTS: Record<Lang, Dict> = { en, ja };

let lang: Lang = "en";
let plural = new Intl.PluralRules("en");
let numFmt = new Intl.NumberFormat("en");

export const currentLang = () => lang;
export const intlLocale = () => lang;

export function setLang(l: Lang) {
  lang = l;
  plural = new Intl.PluralRules(l);
  numFmt = new Intl.NumberFormat(l);
}

/** Localised number. */
export const num = (n: number) => numFmt.format(n);

export function percent(x: number) {
  return new Intl.NumberFormat(lang, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(x);
}

/** Translates `key`, substituting `{param}` placeholders. */
export function t(key: string, params: Record<string, string | number> = {}) {
  let s: string | undefined;
  if (typeof params.n === "number") {
    const form = plural.select(params.n);
    s = DICTS[lang][`${key}.${form}`] ?? DICTS[lang][`${key}.other`] ??
      en[`${key}.${new Intl.PluralRules("en").select(params.n)}`] ??
      en[`${key}.other`];
  }
  s ??= DICTS[lang][key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    if (v === undefined) return `{${k}}`;
    return typeof v === "number" ? num(v) : v;
  });
}

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem("go:lang");
    if (saved && saved in DICTS) return saved as Lang;
  } catch {
    // ignore
  }
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = l.split("-")[0].toLowerCase();
    if (code in DICTS) return code as Lang;
  }
  return "en";
}

export function saveLang(l: Lang) {
  try {
    localStorage.setItem("go:lang", l);
  } catch {
    // ignore
  }
}

/** Applies translations to static markup carrying data-i18n* attributes. */
export function applyStatic(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n!);
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-html]")) {
    el.innerHTML = t(el.dataset.i18nHtml!);
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-aria]")) {
    el.setAttribute("aria-label", t(el.dataset.i18nAria!));
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    el.title = t(el.dataset.i18nTitle!);
  }
}

export const allKeys = () => Object.keys(en);
export const dictFor = (l: Lang) => DICTS[l];
