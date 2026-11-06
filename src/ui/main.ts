/**
 * The go UI: board rendering and interaction, game flow against the engine
 * in a Web Worker, the count at the end of the game, dialogs and settings.
 */
import {
  BLACK,
  type Color,
  columnLetter,
  coordName,
  EMPTY,
  maxHandicap,
  opponent,
  PASS,
  starPoints,
  WHITE,
} from "../engine/board.ts";
import {
  defaultKomi,
  Game,
  type GameSetup,
  type Score,
  scoreBoard,
} from "../engine/game.ts";
import {
  applyStatic,
  currentLang,
  detectLang,
  type Lang,
  LANGS,
  num,
  saveLang,
  setLang,
  t,
} from "./i18n.ts";
import type { WorkerRequest, WorkerResponse } from "./worker.ts";
import {
  decodeShare,
  encodeShare,
  parseSGF,
  type RecordResult,
  resultToSGF,
  type SgfGame,
  toSGF,
} from "../engine/record.ts";
import {
  deleteRecord,
  type GameRecord,
  getRecord,
  isPersistent,
  listRecords,
  newId,
  putRecord,
} from "./library.ts";

// ---------------------------------------------------------------------------
// Opponents
// ---------------------------------------------------------------------------

export const LEVELS = [
  { id: 1, kanji: "玉兔", glyph: "兔" },
  { id: 2, kanji: "靈龜", glyph: "龜" },
  { id: 3, kanji: "狐仙", glyph: "狐" },
  { id: 4, kanji: "麒麟", glyph: "麟" },
  { id: 5, kanji: "青龍", glyph: "龍" },
];
const lname = (id: number) => t(`level.${id}.name`);
const ltitle = (id: number) => t(`level.${id}.title`);
const ldesc = (id: number) => t(`level.${id}.desc`);
/** The kanji name beside a translated one (not in Japanese, where it is the name). */
const kanjiAside = (id: number, extra = "") =>
  currentLang() === "ja"
    ? ""
    : `<span class="font-kanji text-shu ${extra}" lang="zh-Hant">${
      LEVELS[id - 1].kanji
    }</span>`;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Phase = "play" | "scoring" | "over";

type GameResult = RecordResult;

/** Review of a game: Black's win rate after each ply and the best move. */
interface Review {
  black: (number | null)[];
  best: (number | null)[];
  /** Win rate of the best move / the played move, for the side to move. */
  bestQ?: (number | null)[];
  playedQ?: (number | null)[];
}

/** The live game, put aside while a record is open in the viewer. */
interface Snapshot {
  setup: GameSetup;
  player: Color;
  level: number;
  game: Game;
  phase: Phase;
  result: GameResult | null;
  dead: Uint8Array | null;
  liveId: string;
  review: Review | null;
}

interface Saved {
  setup: GameSetup;
  player: Color;
  level: number;
  moves: number[];
  phase: Phase;
  dead?: number[];
  result?: GameResult | null;
  id?: string;
  review?: Review | null;
}

const STORAGE_KEY = "go:game";
const SETTINGS_KEY = "go:settings";

const state = {
  setup: { size: 9, komi: 7.5, handicap: 0 } as GameSetup,
  player: BLACK as Color,
  level: 2,
  /** Preferred colour in the new-game dialog ("random" allowed). */
  colorPref: "black" as "black" | "white" | "random",
  game: new Game({ size: 9, komi: 7.5, handicap: 0 }),
  phase: "play" as Phase,
  result: null as GameResult | null,
  /** Dead stones for the count (vertex flags). */
  dead: null as Uint8Array | null,
  deadPending: false,
  thinking: false,
  hint: null as number | null,
  hintPending: false,
  viewPly: null as number | null,
  cursor: -1,
  kbd: false,
  /** Point awaiting a confirming tap (touch on larger boards). */
  preview: null as number | null,
  hover: null as number | null,
  /** Stone that was just placed (for the drop animation). */
  placed: null as number | null,
  /** Library id of the live game. */
  liveId: newId(),
  /** A record open in the viewer (the live game is stashed). */
  viewer: null as { rec: GameRecord; live: Snapshot } | null,
  review: null as Review | null,
  reviewing: false,
  /** Show the engine's better move instead of the one played. */
  showBest: false,
};

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (!s.setup || !Array.isArray(s.moves)) return null;
    return s;
  } catch {
    return null;
  }
}

function save() {
  if (state.viewer) return;
  persistLive();
  const s: Saved = {
    setup: state.setup,
    player: state.player,
    level: state.level,
    moves: state.game.moves,
    phase: state.phase,
    dead: state.dead
      ? [...state.dead.keys()].filter((v) => state.dead![v])
      : undefined,
    result: state.result,
    id: state.liveId,
    review: state.review,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        size: state.setup.size,
        handicap: state.setup.handicap,
        level: state.level,
        color: state.colorPref,
      }),
    );
  } catch {
    // storage full or unavailable: the game simply is not kept
  }
}

const aiColor = () => opponent(state.player);
const isAITurn = () =>
  state.phase === "play" && !state.game.ended &&
  state.game.toPlay === aiColor();

// ---------------------------------------------------------------------------
// Engine worker
// ---------------------------------------------------------------------------

let worker: Worker;
let reqId = 0;
let thinkStart = 0;

function createWorker() {
  worker = new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => onWorker(e.data);
  worker.onerror = (e) => {
    console.error(e);
    state.thinking = false;
    state.hintPending = false;
    render();
  };
}

function send(req: WorkerRequest) {
  worker.postMessage(req);
}

/** Abandons any running search (the worker is restarted). */
function cancelThinking() {
  if (
    !state.thinking && !state.hintPending && !state.deadPending &&
    !state.reviewing
  ) return;
  worker.terminate();
  createWorker();
  state.thinking = false;
  state.reviewing = false;
  state.hintPending = false;
  state.deadPending = false;
  reqId++;
}

function onWorker(r: WorkerResponse) {
  if (r.id !== reqId) return;
  if (r.type === "move") {
    // Never answer instantly: a short pause reads as "thinking".
    const wait = Math.max(0, 450 - (performance.now() - thinkStart));
    setTimeout(() => {
      if (r.id !== reqId) return;
      state.thinking = false;
      if (r.move === "resign") {
        finish({ winner: state.player, reason: "resign" });
        return;
      }
      applyMove(r.move);
    }, wait);
  } else if (r.type === "hint") {
    state.hintPending = false;
    state.hint = r.move;
    render();
    announce(
      r.move === PASS
        ? t("status.hint.pass")
        : t("status.hint", { point: coordName(r.move, state.setup.size) }),
    );
  } else if (r.type === "analysis") {
    onAnalysis(r);
  } else if (r.type === "dead") {
    state.deadPending = false;
    const d = new Uint8Array(state.setup.size ** 2);
    for (const v of r.dead) d[v] = 1;
    state.dead = d;
    save();
    render();
  }
}

function requestAIMove() {
  state.thinking = true;
  thinkStart = performance.now();
  send({
    type: "move",
    id: ++reqId,
    setup: state.setup,
    moves: [...state.game.moves],
    level: state.level,
  });
  render();
}

function requestHint() {
  if (!canPlay() || state.hintPending) return;
  state.hint = null;
  state.hintPending = true;
  send({
    type: "hint",
    id: ++reqId,
    setup: state.setup,
    moves: [...state.game.moves],
  });
  render();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

/** Whether the human may play now (their turn, live position, no search). */
function canPlay() {
  return state.phase === "play" && !state.thinking &&
    state.viewPly === null && !state.game.ended &&
    state.game.toPlay === state.player;
}

function applyMove(v: number) {
  const g = state.game;
  const mover = g.toPlay;
  const captured = g.play(v);
  if (captured === false) return;
  state.hint = null;
  state.preview = null;
  state.placed = v === PASS ? null : v;
  const name = mover === state.player ? t("player.you") : lname(state.level);
  announce(
    t("sr.played", {
      side: mover === state.player ? name : sideName(mover),
      move: v === PASS ? t("moves.pass") : coordName(v, g.n),
    }) + (captured ? `. ${t("sr.captured", { n: captured })}` : ""),
  );
  if (g.ended) {
    enterScoring();
    return;
  }
  save();
  if (isAITurn()) requestAIMove();
  else render();
}

function enterScoring() {
  state.phase = "scoring";
  state.dead = null;
  state.deadPending = true;
  save();
  send({
    type: "dead",
    id: ++reqId,
    setup: state.setup,
    moves: [...state.game.moves],
  });
  render();
}

function currentScore(): Score {
  return scoreBoard(
    state.game.board,
    state.setup.komi,
    state.dead ?? undefined,
  );
}

function acceptScore() {
  if (state.deadPending) return;
  const s = currentScore();
  const winner: Color | 0 = s.margin > 0 ? BLACK : s.margin < 0 ? WHITE : 0;
  finish({ winner, reason: "score", margin: s.margin });
}

function finish(res: GameResult) {
  cancelThinking();
  state.phase = "over";
  state.result = res;
  state.hint = null;
  save();
  render();
  showResult();
}

/** Takes back moves until it is the human's turn again. */
function undo() {
  const g = state.game;
  if (state.phase === "over") return;
  if (!g.moves.some((_, i) => g.colorOf(i) === state.player)) return;
  cancelThinking();
  state.phase = "play";
  state.dead = null;
  state.hint = null;
  state.preview = null;
  state.viewPly = null;
  g.undo();
  while (g.moves.length && g.toPlay !== state.player) g.undo();
  save();
  render();
}

function pass() {
  if (!canPlay()) return;
  applyMove(PASS);
}

async function resign() {
  if (state.phase !== "play") return;
  if (!(await ask(t("confirm.resign"), t("confirm.resign.ok")))) return;
  finish({ winner: aiColor(), reason: "resign" });
}

/** Starts a new game with the current settings. */
function newGame() {
  if (state.viewer) closeViewer(false);
  cancelThinking();
  retireLive();
  const color = state.colorPref === "random"
    ? (Math.random() < 0.5 ? BLACK : WHITE)
    : state.colorPref === "white"
    ? WHITE
    : BLACK;
  state.player = color;
  state.setup = {
    size: state.setup.size,
    handicap: state.setup.handicap,
    komi: defaultKomi(state.setup.handicap),
  };
  state.game = new Game(state.setup);
  state.phase = "play";
  state.result = null;
  state.dead = null;
  state.hint = null;
  state.viewPly = null;
  state.preview = null;
  state.placed = null;
  state.cursor = -1;
  state.liveId = newId();
  state.review = null;
  state.showBest = false;
  save();
  if (isAITurn()) requestAIMove();
  else render();
}

function tryPlay(v: number) {
  if (!canPlay()) return;
  const g = state.game;
  if (!g.isLegal(v)) {
    const p = g.board.pt(v);
    const msg = g.board.color[p] !== EMPTY
      ? t("status.illegal.occupied")
      : p === g.board.ko
      ? t("status.illegal.ko")
      : g.board.isLegal(p, g.toPlay)
      ? t("status.illegal.ko")
      : t("status.illegal.suicide");
    toast(msg);
    return;
  }
  applyMove(v);
}

// ---------------------------------------------------------------------------
// Reviewing past positions
// ---------------------------------------------------------------------------

const currentPly = () => state.viewPly ?? state.game.moves.length;

function viewAt(ply: number) {
  const total = state.game.moves.length;
  ply = Math.max(0, Math.min(total, ply));
  state.viewPly = ply === total ? null : ply;
  state.preview = null;
  render();
}

function goLive() {
  state.viewPly = null;
  render();
}

// ---------------------------------------------------------------------------
// Board rendering
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const CELL = 40;
const margin = () => CELL * 0.95;
const boardPx = (n: number) => 2 * margin() + (n - 1) * CELL;
const cx = (x: number) => margin() + x * CELL;

/** Deterministic wood-grain lines for the board background. */
function grain(size: number): string {
  let s = 7;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const lines: string[] = [];
  for (let i = 0; i < 26; i++) {
    const y0 = rnd() * size;
    const amp = 4 + rnd() * 10;
    const k = 1 + rnd() * 2;
    let d = `M0 ${y0.toFixed(1)}`;
    for (let x = 0; x <= size; x += size / 8) {
      const y = y0 + Math.sin((x / size) * Math.PI * k + i) * amp;
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    lines.push(
      `<path class="grain" d="${d}" stroke-width="${
        (0.6 + rnd() * 1.6).toFixed(2)
      }"/>`,
    );
  }
  return lines.join("");
}

const STONE_DEFS = `
<defs>
  <radialGradient id="g-black" cx="0.36" cy="0.32" r="0.75">
    <stop offset="0" stop-color="oklch(0.5 0.025 165)"/>
    <stop offset="0.45" stop-color="oklch(0.23 0.012 165)"/>
    <stop offset="1" stop-color="oklch(0.11 0.008 165)"/>
  </radialGradient>
  <radialGradient id="g-white" cx="0.36" cy="0.32" r="0.8">
    <stop offset="0" stop-color="oklch(0.995 0.006 95)"/>
    <stop offset="0.6" stop-color="oklch(0.94 0.014 95)"/>
    <stop offset="1" stop-color="oklch(0.8 0.02 90)"/>
  </radialGradient>
</defs>`;

let staticKey = "";
let staticSVG = "";

/** Wood, grid, star points and coordinates (cached per board size). */
function boardBase(n: number): string {
  const key = `${n}`;
  if (key === staticKey) return staticSVG;
  const size = boardPx(n);
  const a = cx(0), b = cx(n - 1);
  const parts: string[] = [STONE_DEFS];
  parts.push(`<rect class="wood" width="${size}" height="${size}"/>`);
  parts.push(grain(size));
  for (let i = 0; i < n; i++) {
    const p = cx(i);
    parts.push(
      `<line class="grid-line" x1="${a}" y1="${p}" x2="${b}" y2="${p}"/>`,
      `<line class="grid-line" x1="${p}" y1="${a}" x2="${p}" y2="${b}"/>`,
    );
  }
  parts.push(
    `<rect class="grid-edge" x="${a}" y="${a}" width="${b - a}" height="${
      b - a
    }"/>`,
  );
  for (const v of starPoints(n)) {
    parts.push(
      `<circle class="hoshi" cx="${cx(v % n)}" cy="${cx((v / n) | 0)}" r="${
        n >= 19 ? 3.6 : 4.2
      }"/>`,
    );
  }
  const fs = 7.5 + n * 0.28;
  const off = margin() * 0.45;
  for (let i = 0; i < n; i++) {
    const p = cx(i);
    const L = columnLetter(i), R = String(n - i);
    parts.push(
      `<text class="coord" x="${p}" y="${off}" font-size="${fs}">${L}</text>`,
      `<text class="coord" x="${p}" y="${
        size - off
      }" font-size="${fs}">${L}</text>`,
      `<text class="coord" x="${off}" y="${p}" font-size="${fs}">${R}</text>`,
      `<text class="coord" x="${
        size - off
      }" y="${p}" font-size="${fs}">${R}</text>`,
    );
  }
  staticKey = key;
  staticSVG = parts.join("");
  return staticSVG;
}

function stoneSVG(x: number, y: number, c: number, cls = ""): string {
  const r = CELL * 0.475;
  return `<circle class="stone ${cls}" cx="${cx(x)}" cy="${
    cx(y)
  }" r="${r}" fill="url(#g-${c === BLACK ? "black" : "white"})"${
    c === WHITE ? ` stroke="oklch(0.6 0.01 85 / 0.6)" stroke-width="0.6"` : ""
  }/>`;
}

function renderBoard() {
  const svg = $("board");
  const n = state.setup.size;
  const size = boardPx(n);
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  const ply = currentPly();
  const b = state.game.boardAt(ply);
  const scoring = state.phase !== "play" && state.viewPly === null &&
    state.result?.reason !== "resign";
  const parts: string[] = [boardBase(n)];

  let score: Score | null = null;
  if (scoring && state.dead) score = currentScore();

  // Territory markers (under the stones, so dead stones show them through).
  if (score) {
    const sq = CELL * 0.26;
    for (let v = 0; v < n * n; v++) {
      const own = score.owner[v];
      if (own === EMPTY) continue;
      const c = b.at(v);
      if (c !== EMPTY && !state.dead![v]) continue;
      const x = cx(v % n) - sq / 2, y = cx((v / n) | 0) - sq / 2;
      parts.push(
        `<rect class="terr t-${
          own === BLACK ? "black" : "white"
        }" x="${x}" y="${y}" width="${sq}" height="${sq}" rx="1.5"/>`,
      );
    }
  }

  const last = ply > 0 ? state.game.moves[ply - 1] : -2;
  for (let v = 0; v < n * n; v++) {
    const c = b.at(v);
    if (c === EMPTY) continue;
    const x = v % n, y = (v / n) | 0;
    const dead = !!(scoring && state.dead && state.dead[v]);
    const anim = v === state.placed && state.viewPly === null ? "place" : "";
    parts.push(stoneSVG(x, y, c, dead ? "dead" : anim));
    if (dead) {
      const d = CELL * 0.2;
      parts.push(
        `<path class="dead-x" d="M${cx(x) - d} ${cx(y) - d}L${cx(x) + d} ${
          cx(y) + d
        }M${cx(x) + d} ${cx(y) - d}L${cx(x) - d} ${cx(y) + d}"/>`,
      );
    } else if (v === last) {
      parts.push(
        `<circle class="last-mark on-${c === BLACK ? "black" : "white"}" cx="${
          cx(x)
        }" cy="${cx(y)}" r="${CELL * 0.22}"/>`,
      );
    }
  }
  state.placed = null;

  // Ko point for the side to move.
  if (!scoring && b.ko >= 0) {
    const v = b.vertex(b.ko);
    const s = CELL * 0.36;
    parts.push(
      `<rect class="ko-mark" x="${cx(v % n) - s / 2}" y="${
        cx((v / n) | 0) - s / 2
      }" width="${s}" height="${s}"/>`,
    );
  }

  // Review: the engine's better move for the move being viewed.
  if (state.viewPly !== null && state.viewPly > 0 && state.review) {
    const i = state.viewPly - 1;
    const best = state.review.best[i];
    if (
      moveMark(i) && best !== null && best !== PASS &&
      best !== state.game.moves[i]
    ) {
      parts.push(
        `<circle class="best-ring" cx="${cx(best % n)}" cy="${
          cx((best / n) | 0)
        }" r="${CELL * 0.4}"/>`,
      );
    }
  }

  if (state.hint !== null && state.hint !== PASS && state.viewPly === null) {
    const v = state.hint;
    parts.push(
      `<circle class="hint-ring" cx="${cx(v % n)}" cy="${cx((v / n) | 0)}" r="${
        CELL * 0.47
      }"/>`,
    );
  }

  // Ghost stone: touch preview, or mouse hover.
  const ghost = state.preview ?? (state.kbd ? state.cursor : state.hover);
  if (ghost !== null && ghost >= 0 && canPlay() && state.game.isLegal(ghost)) {
    parts.push(stoneSVG(ghost % n, (ghost / n) | 0, state.player, "ghost"));
  }
  if (state.kbd && state.cursor >= 0) {
    const v = state.cursor;
    const s = CELL * 0.9;
    parts.push(
      `<rect class="cursor" x="${cx(v % n) - s / 2}" y="${
        cx((v / n) | 0) - s / 2
      }" width="${s}" height="${s}" rx="4"/>`,
    );
  }
  svg.innerHTML = parts.join("");

  const frame = $("board-frame");
  const reviewing = state.viewPly !== null;
  frame.classList.toggle(
    "reviewing",
    reviewing || (scoring && state.phase === "scoring"),
  );
  frame.dataset.label = reviewing ? t("board.reviewing") : t("board.counting");
}

/** Vertex under a pointer position, or -1. */
function vertexAt(clientX: number, clientY: number): number {
  const svg = $("board") as unknown as SVGSVGElement;
  const ctm = svg.getScreenCTM();
  if (!ctm) return -1;
  const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  const n = state.setup.size;
  const x = Math.round((pt.x - margin()) / CELL);
  const y = Math.round((pt.y - margin()) / CELL);
  if (x < 0 || y < 0 || x >= n || y >= n) return -1;
  return y * n + x;
}

const coarse = () => matchMedia("(pointer: coarse)").matches;

function onBoardPointer(e: PointerEvent) {
  const v = vertexAt(e.clientX, e.clientY);
  if (v < 0) return;
  state.kbd = false;
  $("board").classList.remove("kbd-nav");
  if (state.phase === "scoring" && state.viewPly === null) {
    toggleDead(v);
    return;
  }
  if (!canPlay()) return;
  // On touch screens with small points, the first tap previews the move.
  const confirm = e.pointerType !== "mouse" && state.setup.size >= 13;
  if (confirm && state.preview !== v) {
    if (!state.game.isLegal(v)) {
      tryPlay(v);
      return;
    }
    state.preview = v;
    render();
    return;
  }
  tryPlay(v);
}

function onBoardHover(e: PointerEvent) {
  if (e.pointerType !== "mouse") return;
  const v = vertexAt(e.clientX, e.clientY);
  const h = v < 0 ? null : v;
  if (h !== state.hover) {
    state.hover = h;
    if (canPlay()) renderBoard();
  }
}

function toggleDead(v: number) {
  if (!state.dead || state.deadPending) return;
  const b = state.game.board;
  const p = b.pt(v);
  const c = b.color[p];
  if (c !== BLACK && c !== WHITE) return;
  // Toggle the whole group, together with same-coloured groups that share
  // its surrounded area (as players mark dead stones by region).
  const flag = state.dead[v] ? 0 : 1;
  for (const s of b.chain(p)) state.dead[b.vertex(s)] = flag;
  save();
  render();
}

function onBoardKey(e: KeyboardEvent) {
  const n = state.setup.size;
  const keys: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  if (e.key in keys) {
    e.preventDefault();
    e.stopPropagation();
    state.kbd = true;
    $("board").classList.add("kbd-nav");
    if (state.cursor < 0) state.cursor = ((n * n) / 2) | 0;
    const [dx, dy] = keys[e.key];
    const x = Math.max(0, Math.min(n - 1, (state.cursor % n) + dx));
    const y = Math.max(0, Math.min(n - 1, ((state.cursor / n) | 0) + dy));
    state.cursor = y * n + x;
    renderBoard();
    const b = state.game.boardAt(currentPly());
    const c = b.at(state.cursor);
    announce(
      c === EMPTY
        ? t("point.empty", { point: coordName(state.cursor, n) })
        : t("point.stone", {
          point: coordName(state.cursor, n),
          side: t(c === BLACK ? "side.black.lower" : "side.white.lower"),
        }),
    );
  } else if ((e.key === "Enter" || e.key === " ") && state.cursor >= 0) {
    e.preventDefault();
    if (state.phase === "scoring") toggleDead(state.cursor);
    else tryPlay(state.cursor);
  }
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function stoneIcon(c: Color, cls = "") {
  return `<span class="stone-icon ${cls} s-${
    c === BLACK ? "black" : "white"
  }" aria-hidden="true"></span>`;
}

const sideName = (c: Color) => t(c === BLACK ? "side.black" : "side.white");

const fmtPoints = (x: number) => num(Math.abs(x));

function resultText(res: GameResult): string {
  if (res.winner === 0) return t("reason.draw");
  const winner = sideName(res.winner);
  if (res.reason === "resign") return t("reason.resign", { winner });
  return t("reason.score", { winner, margin: fmtPoints(res.margin ?? 0) });
}

function renderStatus() {
  const icon = $("status-icon");
  const title = $("status-title");
  const detail = $("status-detail");
  const g = state.game;
  let extra = "";
  const level = state.level;
  const spinner = `<span class="thinking-dot" aria-hidden="true"></span>`;
  const rec = state.viewer?.rec;
  if (
    rec && state.viewPly === null && (!state.result || !isPlayed(rec))
  ) {
    icon.innerHTML =
      `<svg class="size-5 text-shu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
    title.textContent = state.result
      ? resultText(state.result)
      : t("viewer.unfinished");
    detail.textContent = t("viewer.help");
  } else if (
    state.phase === "over" && state.viewPly === null && state.result
  ) {
    const res = state.result;
    icon.innerHTML = res.winner === state.player
      ? `<span class="seal size-6 text-sm">勝</span>`
      : stoneIcon(state.player);
    title.textContent = res.winner === 0
      ? t("status.draw")
      : res.winner === state.player
      ? t("status.victory")
      : t("status.defeat");
    detail.textContent = resultText(res);
  } else if (state.phase === "scoring" && state.viewPly === null) {
    icon.innerHTML = state.deadPending
      ? spinner
      : `<span class="seal size-6 text-xs">計</span>`;
    title.textContent = t("status.counting");
    if (state.deadPending) {
      detail.textContent = t("status.counting.estimating");
    } else {
      detail.textContent = t("status.counting.detail");
      const s = currentScore();
      const cell = (x: number) => `<span class="v">${num(x)}</span>`;
      extra = `
        <div class="score-table">
          <span></span>
          <span class="h">${stoneIcon(BLACK, "size-3")}${
        t("score.black")
      }</span>
          <span class="h">${stoneIcon(WHITE, "size-3")}${
        t("score.white")
      }</span>
          <span class="l">${t("score.stones")}</span>${cell(s.stones.black)}${
        cell(s.stones.white)
      }
          <span class="l">${t("score.territory")}</span>${
        cell(s.territory.black)
      }${cell(s.territory.white)}
          <span class="l">${t("score.komi")}</span><span class="v">–</span>${
        cell(state.setup.komi)
      }
          <span class="l total">${
        t("score.total")
      }</span><span class="v total">${
        num(s.black)
      }</span><span class="v total">${num(s.white)}</span>
        </div>
        <p class="text-sm font-medium">${
        resultText({
          winner: s.margin > 0 ? BLACK : s.margin < 0 ? WHITE : 0,
          reason: "score",
          margin: s.margin,
        })
      }</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn flex-1" data-size="sm" id="accept-btn">${
        t("btn.accept")
      }</button>
          <button type="button" class="btn flex-1" data-variant="outline" data-size="sm" id="resume-btn">${
        t("btn.resume")
      }</button>
        </div>`;
    }
  } else if (state.thinking) {
    icon.innerHTML = spinner;
    title.textContent = t("status.thinking", { name: lname(level) });
    detail.textContent = ldesc(level);
  } else if (state.hintPending) {
    icon.innerHTML = spinner;
    title.textContent = t("status.hintThinking");
    detail.textContent = t("status.hintThinking.detail");
  } else if (state.viewPly !== null) {
    const ply = state.viewPly;
    icon.innerHTML =
      `<svg class="size-5 text-shu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`;
    title.textContent = ply === 0
      ? t("status.reviewStart")
      : t("status.reviewMove", { n: ply, move: moveText(ply - 1) });
    detail.textContent = coarse() ? "" : t("status.reviewHelp");
    const m = ply > 0 ? moveLoss(ply - 1) : null;
    if (m) {
      const mark = moveMark(ply - 1);
      const c = g.colorOf(ply - 1);
      title.textContent += mark ? ` ${MARK_SYMBOL[mark]}` : "";
      const best = state.review!.best[ply - 1];
      const played = g.moves[ply - 1];
      detail.textContent = t("review.winrate", {
        side: sideName(c),
        before: Math.round(m.before * 100),
        after: Math.round(m.after * 100),
      }) + (best !== null && best !== played && mark
        ? " " + t("review.better", {
          move: best === PASS ? t("moves.pass") : coordName(best, g.n),
        })
        : "");
    }
  } else if (state.preview !== null) {
    icon.innerHTML = stoneIcon(state.player);
    title.textContent = t("status.confirm", {
      point: coordName(state.preview, g.n),
    });
    detail.textContent = t("status.confirm.detail");
  } else if (state.hint !== null) {
    icon.innerHTML = stoneIcon(state.player);
    if (state.hint === PASS) {
      title.textContent = t("status.hint.pass");
      detail.textContent = t("status.hint.pass.detail");
    } else {
      title.textContent = t("status.hint", {
        point: coordName(state.hint, g.n),
      });
      detail.textContent = t("status.hint.detail");
    }
  } else {
    icon.innerHTML = stoneIcon(state.player);
    const aiPassed = g.moves.length > 0 && g.moves[g.moves.length - 1] === PASS;
    if (aiPassed) {
      title.textContent = t("status.aiPassed", { name: lname(level) });
      detail.textContent = t("status.aiPassed.detail");
    } else {
      title.textContent = t("status.yourMove");
      detail.textContent = t(
        coarse() ? "status.yourMove.detail" : "status.yourMove.detail.mouse",
        { side: sideName(state.player) },
      );
    }
    if (g.moves.length < 2) {
      extra = `<button type="button" class="newcomer-link" id="newcomer-btn">${
        t("status.newcomer")
      }</button>`;
    }
  }
  $("status-extra").innerHTML = extra;
  $("status-extra").hidden = extra === "";

  const playing = state.phase === "play";
  $("play-actions").hidden = state.phase !== "play";
  $<HTMLButtonElement>("pass-btn").disabled = !canPlay();
  $<HTMLButtonElement>("hint-btn").disabled = !canPlay() || state.hintPending;
  $<HTMLButtonElement>("undo-btn").disabled = state.phase === "over" ||
    !g.moves.some((_, i) => g.colorOf(i) === state.player);
  $<HTMLButtonElement>("resign-btn").disabled = !playing;
  const newBtn = $("new-game-btn");
  $("new-game-label").textContent = state.phase === "over" && !state.viewer
    ? t("btn.playAgain")
    : t("btn.newGame");
  if (state.phase === "over" && !state.viewer) delete newBtn.dataset.variant;
  else newBtn.dataset.variant = "secondary";
}

function moveText(i: number): string {
  const v = state.game.moves[i];
  return v === PASS ? t("moves.pass") : coordName(v, state.setup.size);
}

function renderPlayers() {
  const g = state.game;
  const b = g.boardAt(currentPly());
  const ai = aiColor();
  const row = (c: Color) => {
    const isAI = c === ai;
    const toMove = state.phase === "play" && b.toPlay === c;
    const foreign = state.viewer &&
      !(isPlayed(state.viewer.rec) && state.level);
    const name = foreign
      ? `<span class="font-medium truncate">${esc(sideLabel(c))}</span>`
      : isAI
      ? `<span class="font-medium">${lname(state.level)}</span>
         ${kanjiAside(state.level, "max-sm:hidden")}
         <span class="badge shrink-0" data-variant="outline">${
        t("player.level", { n: state.level })
      }</span>
         ${
        state.thinking
          ? `<span class="flex items-center gap-1 text-xs text-muted-foreground"><span class="thinking-dot size-3" aria-hidden="true"></span>${
            t("player.thinking")
          }</span>`
          : ""
      }`
      : `<span class="font-medium">${t("player.you")}</span>`;
    const caps = b.prisoners[c];
    const lastPass = currentPly() > 0 &&
      g.moves[currentPly() - 1] === PASS && g.colorOf(currentPly() - 1) === c;
    return `
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <span class="turn-icon${toMove ? " to-move" : ""}" title="${
      toMove ? t("player.toMove", { side: sideName(c) }) : sideName(c)
    }">${stoneIcon(c)}</span>
        ${name}
        ${
      lastPass
        ? `<span class="badge" data-variant="secondary">${
          t("player.passed")
        }</span>`
        : ""
    }
      </div>
      <div class="prisoners">
        <span>${t("player.captures", { n: caps })}</span>
        ${
      c === WHITE
        ? `<span>· ${t("player.komi", { komi: num(state.setup.komi) })}</span>`
        : ""
    }
      </div>`;
  };
  $("top-player").innerHTML = row(ai);
  $("bottom-player").innerHTML = row(state.player);
}

function renderOpponent() {
  const l = state.level;
  $("opponent-card").hidden = !LEVELS[l - 1];
  if (!LEVELS[l - 1]) return;
  const hc = state.setup.handicap;
  $("opponent-card").innerHTML = `
    <header class="px-5">
      <span class="text-xs uppercase tracking-wider text-muted-foreground">${
    t("opponent.label")
  }</span>
    </header>
    <section class="px-5 flex items-start gap-3">
      <span class="seal-badge size-11" lang="zh-Hant">${
    LEVELS[l - 1].glyph
  }</span>
      <div class="min-w-0">
        <div class="flex items-baseline gap-2 flex-wrap">
          <span class="font-display text-lg leading-tight">${lname(l)}</span>
          ${kanjiAside(l)}
        </div>
        <div class="text-xs text-muted-foreground">${ltitle(l)} · ${
    t("opponent.levelOf", { n: l, total: LEVELS.length })
  }</div>
        <p class="text-sm mt-1.5 text-pretty">${ldesc(l)}</p>
        <div class="flex flex-wrap gap-1.5 mt-2">
          <span class="badge" data-variant="outline">${
    t("opponent.board", { size: state.setup.size })
  }</span>
          ${
    hc >= 2
      ? `<span class="badge" data-variant="outline">${
        t("opponent.handicap", { n: hc })
      }</span>`
      : ""
  }
        </div>
      </div>
    </section>
    <footer class="px-5">
      <button type="button" class="btn w-full" data-variant="outline" data-size="sm" id="change-opponent-btn">${
    t("btn.changeOpponent")
  }</button>
    </footer>`;
}

function renderMoves() {
  const el = $("moves");
  const g = state.game;
  const total = g.moves.length;
  $("move-count").textContent = total === 0
    ? ""
    : t("moves.count", { n: total });
  if (total === 0) {
    el.innerHTML =
      `<div class="col-span-3 text-muted-foreground py-2 text-center">${
        t("moves.empty")
      }</div>`;
    renderMoveNav();
    return;
  }
  const shown = currentPly() - 1;
  const html: string[] = [];
  // Rows of two moves; with handicap, White's move opens each row.
  for (let i = 0; i < total; i += 2) {
    html.push(`<div class="num">${i + 1}</div>`);
    for (const j of [i, i + 1]) {
      if (j >= total) {
        html.push(`<div></div>`);
        continue;
      }
      const c = g.colorOf(j);
      const before = g.boardAt(j).prisoners[c];
      const after = g.boardAt(j + 1).prisoners[c];
      const cap = after - before;
      const cur = j === shown;
      html.push(
        `<button type="button" class="mv${cur ? " current" : ""}" data-ply="${
          j + 1
        }" aria-label="${t("moves.aria", { n: j + 1, move: moveText(j) })}"${
          cur ? ' aria-current="step"' : ""
        } tabindex="${cur ? 0 : -1}">${stoneIcon(c, "size-3")}<span>${
          moveText(j)
        }</span>${cap ? `<span class="cap">×${cap}</span>` : ""}${
          moveMark(j)
            ? `<span class="mv-mark mark-${moveMark(j)}">${
              MARK_SYMBOL[moveMark(j)!]
            }</span>`
            : ""
        }</button>`,
      );
    }
  }
  const hadFocus = el.contains(document.activeElement);
  el.innerHTML = html.join("");
  const cur = el.querySelector<HTMLElement>(".mv.current");
  if (hadFocus) cur?.focus({ preventScroll: true });
  if (state.viewPly === null) el.scrollTop = el.scrollHeight;
  else if (cur) {
    const top = cur.offsetTop - el.offsetTop;
    if (
      top < el.scrollTop ||
      top + cur.offsetHeight > el.scrollTop + el.clientHeight
    ) {
      el.scrollTop = top - el.clientHeight / 2 + cur.offsetHeight / 2;
    }
  }
  renderMoveNav();
}

function renderMoveNav() {
  const ply = currentPly();
  const total = state.game.moves.length;
  $("moves-nav").style.display = total === 0 ? "none" : "";
  $<HTMLButtonElement>("nav-first").disabled = ply === 0;
  $<HTMLButtonElement>("nav-prev").disabled = ply === 0;
  $<HTMLButtonElement>("nav-next").disabled = ply >= total;
  $<HTMLButtonElement>("nav-last").disabled = ply >= total;
  $("nav-live").hidden = state.viewPly === null;
  $("analyse-btn").hidden = state.phase !== "over" || state.reviewing ||
    total < 2 ||
    (!!state.review && state.review.black.every((x) => x !== null));
}

/** Compact move navigation under the board (phones). */
function renderReviewStrip() {
  const el = $("review-strip");
  if (state.viewPly === null || !coarse()) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const ply = state.viewPly;
  const label = ply === 0
    ? t("status.reviewStart")
    : t("status.reviewMove", { n: ply, move: moveText(ply - 1) });
  el.innerHTML = `
    <button type="button" class="btn" data-variant="outline" data-size="icon" data-step="-1" aria-label="${
    t("nav.prev")
  }" ${
    ply === 0 ? "disabled" : ""
  }><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
    <span class="flex-1 min-w-0 truncate text-center text-sm font-medium">${label}</span>
    <button type="button" class="btn" data-variant="outline" data-size="icon" data-step="1" aria-label="${
    t("nav.next")
  }"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>
    <button type="button" class="btn" data-size="sm" data-live>${
    t("nav.live")
  }</button>`;
}

function render() {
  renderViewer();
  renderReview();
  renderBoard();
  renderStatus();
  renderPlayers();
  renderOpponent();
  renderMoves();
  renderReviewStrip();
}

function showResult() {
  const res = state.result;
  if (!res) return;
  const won = res.winner === state.player;
  $("result-seal").textContent = res.winner === 0 ? "和" : won ? "勝" : "負";
  $("result-title").textContent = res.winner === 0
    ? t("result.draw")
    : won
    ? t("result.win")
    : t("result.lose", { name: lname(state.level) });
  let text = resultText(res);
  if (res.reason === "resign" && won) {
    text = t("result.resigned", { name: lname(state.level) });
  }
  $("result-detail").textContent = t("result.detail", {
    text,
    n: state.game.moves.length,
  });
  $("result-review-btn").hidden = state.game.moves.length < 2 ||
    !!state.review;
  openDialog($<HTMLDialogElement>("result-dialog"));
}

// ---------------------------------------------------------------------------
// New game dialog
// ---------------------------------------------------------------------------

function renderLevels() {
  const el = $("level-list");
  el.querySelectorAll(".level-option").forEach((n) => n.remove());
  el.insertAdjacentHTML(
    "beforeend",
    LEVELS.map((l) => `
    <label class="level-option">
      <input type="radio" name="level" value="${l.id}" ${
      l.id === state.level ? "checked" : ""
    } />
      <span class="seal-badge" lang="zh-Hant">${l.glyph}</span>
      <span class="flex flex-col min-w-0 flex-1">
        <span class="text-sm font-medium flex items-baseline gap-2 flex-wrap">
          ${lname(l.id)}
          ${kanjiAside(l.id, "text-sm")}
        </span>
        <span class="text-xs text-muted-foreground"><span class="text-foreground/80">${
      ltitle(l.id)
    }</span> · ${ldesc(l.id)}</span>
      </span>
      <span class="ms-auto flex gap-0.5 shrink-0" aria-label="${
      t("level.strength", { n: l.id, total: LEVELS.length })
    }">${
      Array.from(
        { length: 5 },
        (_, i) =>
          `<span class="size-1.5 rounded-full ${
            i < l.id ? "bg-shu" : "bg-border"
          }"></span>`,
      ).join("")
    }</span>
    </label>`).join(""),
  );
}

function dialogSize(): number {
  const el = document.querySelector<HTMLInputElement>(
    'input[name="size"]:checked',
  );
  return Number(el?.value ?? 9);
}

function renderHandicapOptions() {
  const size = dialogSize();
  const sel = $<HTMLSelectElement>("handicap-select");
  const prev = Number(sel.value || state.setup.handicap);
  const max = maxHandicap(size);
  const opts = [`<option value="0">${t("newGame.handicap.none")}</option>`];
  for (let k = 2; k <= max; k++) {
    opts.push(
      `<option value="${k}">${t("newGame.handicap.n", { n: k })}</option>`,
    );
  }
  sel.innerHTML = opts.join("");
  sel.value = String(Math.min(prev, max));
  if (sel.value === "1") sel.value = "0";
  updateDialogNotes();
}

function updateDialogNotes() {
  const size = dialogSize();
  const hc = Number($<HTMLSelectElement>("handicap-select").value);
  $("size-note").textContent = t(`newGame.size.${size}`);
  $("komi-note").textContent = hc >= 2
    ? t("newGame.komi.handicap", { komi: num(defaultKomi(hc)) })
    : t("newGame.komi", { komi: num(defaultKomi(0)) });
}

function syncSetupInputs() {
  for (
    const el of document.querySelectorAll<HTMLInputElement>(
      'input[name="size"]',
    )
  ) el.checked = Number(el.value) === state.setup.size;
  for (
    const el of document.querySelectorAll<HTMLInputElement>(
      'input[name="color"]',
    )
  ) el.checked = el.value === state.colorPref;
  renderLevels();
  $<HTMLSelectElement>("handicap-select").value = String(
    state.setup.handicap,
  );
  renderHandicapOptions();
  $<HTMLSelectElement>("handicap-select").value = String(
    Math.min(state.setup.handicap, maxHandicap(state.setup.size)),
  );
  updateDialogNotes();
}

function openNewGameDialog() {
  syncSetupInputs();
  openDialog($<HTMLDialogElement>("new-game-dialog"));
}

function startFromDialog() {
  const color = document.querySelector<HTMLInputElement>(
    'input[name="color"]:checked',
  )?.value as typeof state.colorPref | undefined;
  const level = document.querySelector<HTMLInputElement>(
    'input[name="level"]:checked',
  )?.value;
  state.colorPref = color ?? "black";
  state.level = Number(level ?? state.level);
  state.setup = {
    size: dialogSize(),
    handicap: Number($<HTMLSelectElement>("handicap-select").value),
    komi: 0,
  };
  $<HTMLDialogElement>("new-game-dialog").close();
  newGame();
}

// ---------------------------------------------------------------------------
// Rules dialog
// ---------------------------------------------------------------------------

/**
 * A small diagram from rows of characters: X black, O white, . empty,
 * x/o marked (e.g. captured) black/white, * a marked empty point.
 */
function diagram(rows: string[]): string {
  const n = rows.length, m = rows[0].length;
  const s = 20, pad = 12;
  const w = pad * 2 + (m - 1) * s, h = pad * 2 + (n - 1) * s;
  const parts = [
    `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true" class="board">`,
    `<rect class="wood" width="${w}" height="${h}"/>`,
  ];
  for (let i = 0; i < n; i++) {
    parts.push(
      `<line class="grid-line" x1="${pad}" y1="${pad + i * s}" x2="${
        pad + (m - 1) * s
      }" y2="${pad + i * s}"/>`,
    );
  }
  for (let j = 0; j < m; j++) {
    parts.push(
      `<line class="grid-line" x1="${pad + j * s}" y1="${pad}" x2="${
        pad + j * s
      }" y2="${pad + (n - 1) * s}"/>`,
    );
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const ch = rows[i][j];
      const x = pad + j * s, y = pad + i * s;
      if ("XOxo".includes(ch)) {
        const black = ch === "X" || ch === "x";
        parts.push(
          `<circle cx="${x}" cy="${y}" r="9.3" fill="url(#g-${
            black ? "black" : "white"
          })" ${
            !black ? 'stroke="oklch(0.6 0.01 85 / 0.7)" stroke-width="0.5"' : ""
          } ${ch === "x" || ch === "o" ? 'opacity="0.45"' : ""}/>`,
        );
        if (ch === "x" || ch === "o") {
          parts.push(
            `<path class="dead-x" style="stroke-width:2" d="M${x - 4} ${
              y - 4
            }L${x + 4} ${y + 4}M${x + 4} ${y - 4}L${x - 4} ${y + 4}"/>`,
          );
        }
      } else if (ch === "*") {
        parts.push(
          `<circle cx="${x}" cy="${y}" r="4" fill="var(--shu)" opacity="0.85"/>`,
        );
      } else if (ch === "t") {
        parts.push(
          `<rect x="${x - 4}" y="${
            y - 4
          }" width="8" height="8" fill="var(--stone-black)"/>`,
        );
      }
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

function renderRules() {
  const fig = (key: string, rows: string[]) => `
    <div class="rule-fig">
      ${diagram(rows)}
      <div>
        <h3 class="font-display text-base mb-1">${t(`rules.${key}.title`)}</h3>
        <p class="text-pretty">${t(`rules.${key}`)}</p>
      </div>
    </div>`;
  $("rules-body").innerHTML = [
    STONE_DEFS.replace(
      "<defs>",
      '<svg width="0" height="0" class="absolute"><defs>',
    )
      .replace("</defs>", "</defs></svg>"),
    fig("place", ["....", ".X..", "..O.", "...."]),
    fig("liberty", ["..*..", ".*X*.", "..*..", "....."]),
    fig("capture", [".....", "..O..", ".OxO.", "..*.."]),
    fig("ko", ["..XO.", ".X.*O", "..XO.", "....."]),
    fig("end", ["tX.O.", "tX.O.", "XX.OO", "....."]),
    `<div class="ornament"></div>`,
    `<ul class="list-disc ps-5 space-y-1.5">${t("rules.tips")}</ul>`,
  ].join("");
}

// ---------------------------------------------------------------------------
// Dialogs, toasts, announcements
// ---------------------------------------------------------------------------

function openDialog(d: HTMLDialogElement) {
  if (!d.open) d.showModal();
}

function ask(message: string, okLabel: string): Promise<boolean> {
  const d = $<HTMLDialogElement>("confirm-dialog");
  $("confirm-dialog-text").textContent = message;
  $("confirm-dialog-ok").textContent = okLabel;
  d.returnValue = "";
  openDialog(d);
  return new Promise((resolve) => {
    d.addEventListener("close", () => resolve(d.returnValue === "ok"), {
      once: true,
    });
  });
}

function wireDialogs() {
  for (const d of document.querySelectorAll<HTMLDialogElement>("dialog")) {
    d.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-close]")) d.close();
      else if (target === d && d.hasAttribute("data-backdrop-close")) d.close();
    });
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  try {
    el.hidePopover?.();
    el.showPopover?.();
  } catch {
    // popover unsupported: shown in place
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    try {
      el.hidePopover?.();
    } catch {
      // ignore
    }
    el.hidden = true;
  }, 2600);
}

function announce(text: string) {
  const el = $("sr-live");
  el.textContent = "";
  setTimeout(() => (el.textContent = text), 30);
}

// ---------------------------------------------------------------------------
// Records: auto-save, the library, the viewer, SGF files and share links
// ---------------------------------------------------------------------------

/** Escapes text from outside (SGF names) for use in HTML. */
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

const deadList = (d: Uint8Array | null) =>
  d ? [...d.keys()].filter((v) => d[v]) : undefined;

function liveRecord(): GameRecord {
  const now = Date.now();
  return {
    id: state.liveId,
    createdAt: now,
    updatedAt: now,
    setup: state.setup,
    moves: [...state.game.moves],
    source: "played",
    player: state.player,
    level: state.level,
    result: state.result,
    dead: deadList(state.dead),
    review: state.review ?? undefined,
  };
}

/** Upserts the live game into the library (from the second move on). */
async function persistLive(abandoned = false) {
  if (state.game.moves.length < 2) return;
  const rec = liveRecord();
  if (abandoned) rec.abandoned = true;
  const old = await getRecord(rec.id);
  if (old) rec.createdAt = old.createdAt;
  await putRecord(rec);
}

/** Before the live game is replaced: keep it, marked if unfinished. */
function retireLive() {
  if (state.phase === "play") persistLive(true);
}

function snapshot(): Snapshot {
  return {
    setup: state.setup,
    player: state.player,
    level: state.level,
    game: state.game,
    phase: state.phase,
    result: state.result,
    dead: state.dead,
    liveId: state.liveId,
    review: state.review,
  };
}

function applySnapshot(s: Snapshot) {
  state.setup = s.setup;
  state.player = s.player;
  state.level = s.level;
  state.game = s.game;
  state.phase = s.phase;
  state.result = s.result;
  state.dead = s.dead;
  state.liveId = s.liveId;
  state.review = s.review;
}

/** Opens a record in the viewer, stashing the live game. */
function openRecord(rec: GameRecord) {
  for (
    const d of document.querySelectorAll<HTMLDialogElement>("dialog[open]")
  ) {
    d.close();
  }
  if (!state.viewer && rec.id === state.liveId) {
    goLive();
    return;
  }
  const g = Game.fromMoves(rec.setup, rec.moves);
  if (!g) {
    toast(t("library.broken"));
    return;
  }
  cancelThinking();
  const live = state.viewer ? state.viewer.live : snapshot();
  state.viewer = { rec, live };
  state.setup = rec.setup;
  state.game = g;
  state.player = rec.player ?? BLACK;
  state.level = rec.level ?? 0;
  state.phase = "over";
  state.result = rec.result ?? null;
  state.dead = null;
  if (rec.dead) {
    state.dead = new Uint8Array(rec.setup.size ** 2);
    for (const v of rec.dead) state.dead[v] = 1;
  }
  state.review = rec.review ?? null;
  state.viewPly = null;
  state.hint = null;
  state.preview = null;
  render();
  $("viewer-card").focus({ preventScroll: true });
}

/** Leaves the viewer and returns to the live game. */
function closeViewer(resume = true) {
  if (!state.viewer) return;
  cancelThinking();
  const live = state.viewer.live;
  state.viewer = null;
  applySnapshot(live);
  state.viewPly = null;
  if (location.hash.startsWith("#g=")) {
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (!resume) return;
  render();
  if (state.phase === "scoring" && !state.dead) enterScoring();
  else if (isAITurn()) requestAIMove();
}

const isPlayed = (rec: GameRecord) => rec.source === "played";

/** Display name of one side of a record. */
function recordSide(rec: GameRecord, c: Color): string {
  if (isPlayed(rec) && rec.level) {
    return c === rec.player ? t("player.you") : lname(rec.level);
  }
  const name = c === BLACK ? rec.black : rec.white;
  return name?.trim() ? name : sideName(c);
}

function recordTitle(rec: GameRecord): string {
  return t("library.vs", {
    black: esc(recordSide(rec, BLACK)),
    white: esc(recordSide(rec, WHITE)),
  });
}

type Outcome = "win" | "loss" | "draw" | "unfinished" | "abandoned" | "other";

function outcome(rec: GameRecord): Outcome {
  if (!isPlayed(rec)) return "other";
  if (!rec.result) return rec.abandoned ? "abandoned" : "unfinished";
  if (rec.result.winner === 0) return "draw";
  return rec.result.winner === rec.player ? "win" : "loss";
}

function sgfOf(rec: GameRecord): SgfGame {
  const d = new Date(rec.createdAt);
  const pad = (x: number) => String(x).padStart(2, "0");
  return {
    setup: rec.setup,
    moves: rec.moves,
    black: recordSide(rec, BLACK),
    white: recordSide(rec, WHITE),
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    result: rec.result ?? undefined,
  };
}

function fileStamp(ms: number) {
  const d = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${
    pad(d.getHours())
  }${pad(d.getMinutes())}`;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/x-go-sgf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadRecord(rec: GameRecord) {
  download(`go-${fileStamp(rec.createdAt)}.sgf`, toSGF(sgfOf(rec)));
}

function shareURL(rec: GameRecord) {
  return `${location.origin}${location.pathname}#g=${encodeShare(sgfOf(rec))}`;
}

async function copyLink(rec: GameRecord) {
  const url = shareURL(rec);
  try {
    await navigator.clipboard.writeText(url);
    toast(t("library.copied"));
  } catch {
    prompt(t("library.share"), url);
  }
}

/** Same game (setup and moves), for de-duplicating imports. */
const gameKey = (setup: GameSetup, moves: number[]) =>
  JSON.stringify([
    setup.size,
    setup.komi,
    setup.handicap,
    setup.ab ?? null,
    moves,
  ]);

/** Opens a game from a share link in the URL hash, if any. */
async function openFromHash() {
  const m = /^#g=(.+)$/.exec(location.hash);
  if (!m) return;
  const g = decodeShare(m[1]);
  if (!g) {
    toast(t("library.badLink"));
    history.replaceState(null, "", location.pathname + location.search);
    return;
  }
  const key = gameKey(g.setup, g.moves);
  let rec = (await listRecords()).find((r) =>
    gameKey(r.setup, r.moves) === key
  );
  if (!rec) {
    const now = Date.now();
    rec = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      setup: g.setup,
      moves: g.moves,
      source: "shared",
      result: g.result ?? null,
    };
    await putRecord(rec);
  }
  openRecord(rec);
}

// --- Library dialog -------------------------------------------------------

let libraryCache: GameRecord[] = [];

async function openLibrary() {
  if (state.phase !== "over" || !state.viewer) await persistLive();
  await renderLibrary();
  openDialog($<HTMLDialogElement>("library-dialog"));
  $("library-warning").hidden = await isPersistent();
}

function formatDate(ms: number) {
  return new Intl.DateTimeFormat(currentLang(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(ms);
}

const ICON_LINK =
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
const ICON_DOWNLOAD =
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>`;
const ICON_TRASH =
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const ICON_BACK =
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`;

const iconBtn = (act: string, label: string, icon: string, id = "") =>
  `<button type="button" class="btn" data-variant="ghost" data-size="icon-sm" data-act="${act}"${
    id ? ` data-id="${id}"` : ""
  } aria-label="${label}" title="${label}">${icon}</button>`;

function resultPill(rec: GameRecord): string {
  const o = outcome(rec);
  const label = o === "other"
    ? (resultToSGF(rec.result) || "—")
    : t(`library.outcome.${o}`);
  return `<span class="lib-result lib-${o}">${esc(label)}</span>`;
}

async function renderLibrary() {
  libraryCache = await listRecords();
  const filter = document.querySelector<HTMLInputElement>(
    'input[name="lib-filter"]:checked',
  )?.value ?? "all";
  const list = libraryCache.filter((r) =>
    filter === "all" || outcome(r) === filter
  );
  const el = $("library-list");
  if (!list.length) {
    el.innerHTML = `<li class="library-empty">${
      t(libraryCache.length ? "library.emptyFilter" : "library.empty")
    }</li>`;
    return;
  }
  const liveId = state.viewer ? state.viewer.live.liveId : state.liveId;
  const openId = state.viewer?.rec.id;
  el.innerHTML = list.map((r) => {
    const current = r.id === liveId
      ? `<span class="lib-tag">${t("library.current")}</span>`
      : r.id === openId
      ? `<span class="lib-tag">${t("library.open")}</span>`
      : "";
    const size = t("opponent.board", { size: r.setup.size });
    return `
    <li class="library-item">
      <button type="button" class="lib-main" data-act="open" data-id="${r.id}">
        ${resultPill(r)}
        <span class="min-w-0 flex flex-col">
          <span class="lib-title">${recordTitle(r)} ${current}</span>
          <span class="lib-meta">${size} · ${
      t("moves.count", { n: r.moves.length })
    } · ${formatDate(r.createdAt)}</span>
        </span>
      </button>
      <span class="lib-actions">
        ${iconBtn("link", t("library.share"), ICON_LINK, r.id)}
        ${iconBtn("download", t("library.download"), ICON_DOWNLOAD, r.id)}
        ${
      r.id === liveId
        ? ""
        : iconBtn("delete", t("library.delete"), ICON_TRASH, r.id)
    }
      </span>
    </li>`;
  }).join("");
}

async function onLibraryClick(e: Event) {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!btn?.dataset.id) return;
  const rec = libraryCache.find((r) => r.id === btn.dataset.id);
  if (!rec) return;
  const act = btn.dataset.act;
  if (act === "open") openRecord(rec);
  else if (act === "link") copyLink(rec);
  else if (act === "download") downloadRecord(rec);
  else if (act === "delete") {
    if (!(await ask(t("library.confirmDelete"), t("library.delete")))) return;
    await deleteRecord(rec.id);
    if (state.viewer?.rec.id === rec.id) closeViewer();
    await renderLibrary();
  }
}

/** Imports SGF text; returns how many games were added. */
async function importSGF(text: string): Promise<number> {
  const { games, failures } = parseSGF(text);
  const known = new Set(
    (await listRecords()).map((r) => gameKey(r.setup, r.moves)),
  );
  let added = 0;
  let last: GameRecord | null = null;
  const now = Date.now();
  for (const [k, g] of games.entries()) {
    const key = gameKey(g.setup, g.moves);
    if (known.has(key)) continue;
    known.add(key);
    const dt = g.date ? Date.parse(g.date) : NaN;
    const rec: GameRecord = {
      id: newId(),
      createdAt: isNaN(dt) ? now - k : dt,
      updatedAt: now - k,
      setup: g.setup,
      moves: g.moves,
      source: "imported",
      black: g.black,
      white: g.white,
      result: g.result ?? null,
    };
    await putRecord(rec);
    last = rec;
    added++;
  }
  if (failures.length && !games.length) toast(t("library.importFailed"));
  else if (failures.length) {
    toast(t("library.importPartial", { n: added, failed: failures.length }));
  } else if (games.length && !added) toast(t("library.importDuplicate"));
  else if (added) toast(t("library.imported", { n: added }));
  await renderLibrary();
  if (added === 1 && last) openRecord(last);
  return added;
}

async function exportAll() {
  const recs = await listRecords();
  if (!recs.length) return;
  download(
    `go-games-${fileStamp(Date.now())}.sgf`,
    recs.map((r) => toSGF(sgfOf(r))).join("\n"),
  );
}

function wireLibrary() {
  $("library-btn").addEventListener("click", openLibrary);
  $("library-list").addEventListener("click", onLibraryClick);
  for (
    const el of document.querySelectorAll<HTMLInputElement>(
      'input[name="lib-filter"]',
    )
  ) el.addEventListener("change", renderLibrary);
  const file = $<HTMLInputElement>("library-file");
  $("library-import-btn").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const texts = await Promise.all(
      [...(file.files ?? [])].map((f) => f.text()),
    );
    file.value = "";
    if (texts.length) await importSGF(texts.join("\n"));
  });
  $("library-paste-btn").addEventListener("click", () => {
    $("library-paste").hidden = false;
    $("library-paste-text").focus();
  });
  $("library-paste-cancel").addEventListener("click", () => {
    $("library-paste").hidden = true;
  });
  $("library-paste-submit").addEventListener("click", async () => {
    const ta = $<HTMLTextAreaElement>("library-paste-text");
    if (!ta.value.trim()) return;
    const added = await importSGF(ta.value);
    if (added) {
      ta.value = "";
      $("library-paste").hidden = true;
    }
  });
  $("library-export-btn").addEventListener("click", exportAll);
  $("viewer-card").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    const rec = state.viewer?.rec;
    if (!btn || !rec) return;
    if (btn.dataset.act === "close") closeViewer();
    else if (btn.dataset.act === "link") copyLink(rec);
    else if (btn.dataset.act === "download") downloadRecord(rec);
  });
  addEventListener("hashchange", openFromHash);
}

function renderViewer() {
  const el = $("viewer-card");
  const rec = state.viewer?.rec;
  el.hidden = !rec;
  if (!rec) return;
  const kind = t(`viewer.kind.${rec.source}`);
  el.innerHTML = `
    <button type="button" class="btn" data-variant="outline" data-size="sm" data-act="close">${ICON_BACK}<span>${
    t("viewer.back")
  }</span></button>
    <div class="viewer-info">
      <span class="viewer-kind">${kind}</span>
      <span class="viewer-names">${recordTitle(rec)}</span>
    </div>
    <span class="viewer-actions">
      ${iconBtn("link", t("library.share"), ICON_LINK)}
      ${iconBtn("download", t("library.download"), ICON_DOWNLOAD)}
    </span>`;
}

// --- Review ---------------------------------------------------------------

const reviewPlayouts = (n: number) => (n <= 9 ? 2500 : n <= 13 ? 1500 : 900);

/** Black's chance at the end, from the result. */
function finalBlack(): number | null {
  const r = state.result;
  if (!r) return null;
  return r.winner === BLACK ? 1 : r.winner === WHITE ? 0 : 0.5;
}

function startReview() {
  if (state.reviewing || state.game.moves.length < 2) return;
  const total = state.game.moves.length;
  if (!state.review || state.review.black.length !== total + 1) {
    state.review = {
      black: Array(total + 1).fill(null),
      best: Array(total + 1).fill(null),
      bestQ: Array(total + 1).fill(null),
      playedQ: Array(total + 1).fill(null),
    };
  }
  const from = Math.max(0, state.review.black.findIndex((x) => x === null));
  state.reviewing = true;
  send({
    type: "analyse",
    id: ++reqId,
    setup: state.setup,
    moves: [...state.game.moves],
    from,
    playouts: reviewPlayouts(state.setup.size),
  });
  render();
}

function onAnalysis(r: Extract<WorkerResponse, { type: "analysis" }>) {
  const rv = state.review;
  if (!rv) return;
  rv.black[r.ply] = Number.isNaN(r.black)
    ? finalBlack() ?? rv.black[r.ply - 1]
    : r.black;
  rv.best[r.ply] = r.best;
  (rv.bestQ ??= [])[r.ply] = r.bestQ;
  (rv.playedQ ??= [])[r.ply] = r.playedQ;
  if (r.done) {
    state.reviewing = false;
    storeReview();
  }
  renderReview();
  renderMoves();
  renderStatus();
  renderBoard();
}

function storeReview() {
  if (state.viewer) {
    const rec = state.viewer.rec;
    rec.review = state.review ?? undefined;
    rec.updatedAt = Date.now();
    putRecord(rec);
  } else save();
}

/** Win rate of the colour that played move `i` before and after it. */
function moveLoss(
  i: number,
): { loss: number; before: number; after: number } | null {
  const rv = state.review;
  if (!rv) return null;
  // Compare the best move with the move played, as seen by the same search
  // (win rates from separate searches are each optimistic for the side to
  // move). If the played move was barely searched, fall back to the
  // opponent's best reply in the next position.
  const best = rv.bestQ?.[i];
  if (best == null) return null;
  let after = rv.playedQ?.[i] ?? null;
  if (after === null) {
    const next = rv.bestQ?.[i + 1];
    if (next == null) {
      if (rv.black[i + 1] == null) return null;
      const c = state.game.colorOf(i);
      after = c === BLACK ? rv.black[i + 1]! : 1 - rv.black[i + 1]!;
    } else after = 1 - next;
  }
  if (rv.best[i] === state.game.moves[i]) after = best;
  return { loss: Math.max(0, best - after), before: best, after };
}

type Mark = "blunder" | "mistake" | "dubious" | null;
function moveMark(i: number): Mark {
  const m = moveLoss(i);
  if (!m) return null;
  if (m.loss >= 0.2) return "blunder";
  if (m.loss >= 0.1) return "mistake";
  if (m.loss >= 0.05) return "dubious";
  return null;
}
const MARK_SYMBOL: Record<string, string> = {
  blunder: "??",
  mistake: "?",
  dubious: "?!",
};

function evalGraph(): string {
  const rv = state.review!;
  const total = state.game.moves.length;
  const W = 300, H = 84;
  const x = (k: number) => (total ? (k / total) * W : 0);
  const y = (b: number) => H - b * H;
  const pts: string[] = [];
  let lastK = 0;
  // Each search slightly favours the side to move; averaging neighbours
  // removes the resulting zigzag from the curve.
  const smooth = (k: number) => {
    const b = rv.black[k];
    if (b == null) return null;
    const p = rv.black[k - 1], q = rv.black[k + 1];
    if (k === 0 || k === total || p == null || q == null) return b;
    return (p + 2 * b + q) / 4;
  };
  for (let k = 0; k <= total; k++) {
    const b = smooth(k);
    if (b == null) continue;
    pts.push(`${x(k).toFixed(1)},${y(b).toFixed(1)}`);
    lastK = k;
  }
  const area = pts.length
    ? `<path class="graph-area" d="M0,${H} L${pts.join(" L")} L${
      x(lastK).toFixed(1)
    },${H} Z"/><path class="graph-line" d="M${pts.join(" L")}"/>`
    : "";
  const cur = currentPly();
  const marks: string[] = [];
  for (let i = 0; i < total; i++) {
    const m = moveMark(i);
    if (m === "blunder" || m === "mistake") {
      const b = smooth(i + 1) ?? 0.5;
      marks.push(
        `<circle class="graph-mark mark-${m}" cx="${x(i + 1)}" cy="${
          y(b)
        }" r="3"/>`,
      );
    }
  }
  return `<svg class="eval-graph" id="eval-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${
    t("review.graph")
  }">
    <rect class="graph-bg" width="${W}" height="${H}"/>
    ${area}
    <line class="graph-mid" x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/>
    <line class="graph-cursor" x1="${x(cur)}" y1="0" x2="${x(cur)}" y2="${H}"/>
    ${marks.join("")}
  </svg>`;
}

function renderReview() {
  const card = $("review-card");
  const rv = state.review;
  if (!rv) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const total = state.game.moves.length;
  const done = rv.black.filter((x) => x !== null).length;
  // Biggest losses, for both sides.
  const losses: { i: number; loss: number }[] = [];
  for (let i = 0; i < total; i++) {
    const m = moveLoss(i);
    if (m && m.loss >= 0.1) losses.push({ i, loss: m.loss });
  }
  losses.sort((a, b) => b.loss - a.loss);
  const count = (c: Color, mark: Mark) =>
    [...Array(total).keys()].filter((i) =>
      state.game.colorOf(i) === c && moveMark(i) === mark
    ).length;
  const sideRow = (c: Color) => `
    <div class="review-side">
      ${stoneIcon(c, "size-3")}
      <span class="font-medium">${esc(sideLabel(c))}</span>
      <span class="ms-auto text-muted-foreground">${
    t("review.counts", {
      blunders: count(c, "blunder"),
      mistakes: count(c, "mistake"),
    })
  }</span>
    </div>`;
  card.innerHTML = `
    <header class="px-5 flex items-baseline justify-between gap-2">
      <h2 class="font-display text-lg">${t("review.title")}</h2>
      <span class="text-xs text-muted-foreground">${
    t("review.blackWinrate")
  }</span>
    </header>
    <section class="px-5 flex flex-col gap-3">
      ${evalGraph()}
      ${
    state.reviewing
      ? `<div class="flex items-center gap-2 text-xs text-muted-foreground"><span class="thinking-dot size-3"></span>${
        t("review.progress", { done, total: total + 1 })
      }</div>`
      : ""
  }
      ${sideRow(BLACK)}${sideRow(WHITE)}
      ${
    losses.length
      ? `<div class="flex flex-col gap-1">
        <span class="text-xs uppercase tracking-wider text-muted-foreground">${
        t("review.turning")
      }</span>
        ${
        losses.slice(0, 4).map(({ i, loss }) =>
          `<button type="button" class="review-loss" data-ply="${i + 1}">${
            stoneIcon(state.game.colorOf(i), "size-3")
          }<span>${t("status.reviewMove", { n: i + 1, move: moveText(i) })}${
            MARK_SYMBOL[moveMark(i) ?? ""] ?? ""
          }</span><span class="ms-auto text-destructive">−${
            Math.round(loss * 100)
          }%</span></button>`
        ).join("")
      }
      </div>`
      : ""
  }
    </section>`;
}

/** Name of a side in the current game (live, or the open record). */
function sideLabel(c: Color): string {
  if (state.viewer) return recordSide(state.viewer.rec, c);
  return c === state.player ? t("player.you") : lname(state.level);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function applyLanguage(l: Lang) {
  setLang(l);
  document.documentElement.lang = l;
  document.title = t("meta.title");
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", t("meta.description"));
  applyStatic();
  $("brand-secondary").hidden = false;
  $("lang-current").textContent = LANGS.find((x) => x.code === l)!.name;
  $<HTMLSelectElement>("lang-select").value = l;
  renderRules();
  renderLevels();
  if ($<HTMLDialogElement>("new-game-dialog").open) syncSetupInputs();
  render();
}

function restore() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if ([9, 13, 19].includes(s.size)) state.setup.size = s.size;
      if (typeof s.handicap === "number") state.setup.handicap = s.handicap;
      if (s.level >= 1 && s.level <= 5) state.level = s.level;
      if (["black", "white", "random"].includes(s.color)) {
        state.colorPref = s.color;
      }
    }
  } catch {
    // ignore
  }
  const saved = load();
  if (saved) {
    const g = Game.fromMoves(saved.setup, saved.moves);
    if (g) {
      state.setup = saved.setup;
      state.player = saved.player;
      state.level = saved.level;
      state.game = g;
      state.phase = saved.phase ?? "play";
      state.result = saved.result ?? null;
      if (saved.id) state.liveId = saved.id;
      state.review = saved.review ?? null;
      if (saved.dead) {
        state.dead = new Uint8Array(saved.setup.size ** 2);
        for (const v of saved.dead) state.dead[v] = 1;
      }
      return true;
    }
  }
  return false;
}

function init() {
  createWorker();
  wireDialogs();

  const sel = $<HTMLSelectElement>("lang-select");
  sel.innerHTML = LANGS.map((l) =>
    `<option value="${l.code}">${l.name}</option>`
  )
    .join("");
  sel.addEventListener("change", () => {
    const l = sel.value as Lang;
    saveLang(l);
    applyLanguage(l);
  });

  const board = $("board");
  board.addEventListener("pointerup", onBoardPointer);
  board.addEventListener("pointermove", onBoardHover);
  board.addEventListener("pointerleave", () => {
    state.hover = null;
    renderBoard();
  });
  board.addEventListener("keydown", onBoardKey);
  board.addEventListener("blur", () => {
    if (state.kbd) {
      state.kbd = false;
      board.classList.remove("kbd-nav");
      renderBoard();
    }
  });

  $("pass-btn").addEventListener("click", pass);
  $("undo-btn").addEventListener("click", undo);
  $("hint-btn").addEventListener("click", requestHint);
  $("resign-btn").addEventListener("click", resign);
  $("new-game-btn").addEventListener("click", async () => {
    if (
      state.phase === "play" && state.game.moves.length > 0 &&
      !(await ask(t("confirm.newGame"), t("confirm.newGame.ok")))
    ) return;
    if (state.viewer) {
      closeViewer();
      openNewGameDialog();
    } else if (state.phase === "over") newGame();
    else openNewGameDialog();
  });
  $("start-game-btn").addEventListener("click", startFromDialog);
  for (
    const el of document.querySelectorAll<HTMLInputElement>(
      'input[name="size"]',
    )
  ) el.addEventListener("change", renderHandicapOptions);
  $("handicap-select").addEventListener("change", updateDialogNotes);
  $("rules-btn").addEventListener(
    "click",
    () => openDialog($<HTMLDialogElement>("rules-dialog")),
  );
  $("theme-btn").addEventListener("click", () => {
    const dark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("go:theme", dark ? "dark" : "light");
    } catch {
      // ignore
    }
  });
  wireLibrary();
  $("analyse-btn").addEventListener("click", startReview);
  $("result-review-btn").addEventListener("click", () => {
    $<HTMLDialogElement>("result-dialog").close();
    startReview();
  });

  document.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(
      "#accept-btn, #resume-btn, #newcomer-btn, #change-opponent-btn, [data-ply], [data-step], [data-live]",
    );
    if (!el) return;
    if (el.id === "accept-btn") acceptScore();
    else if (el.id === "resume-btn") undo();
    else if (el.id === "newcomer-btn") {
      openDialog($<HTMLDialogElement>("rules-dialog"));
    } else if (el.id === "change-opponent-btn") openNewGameDialog();
    else if (el.dataset.ply) viewAt(Number(el.dataset.ply));
    else if (el.dataset.step) viewAt(currentPly() + Number(el.dataset.step));
    else if (el.hasAttribute("data-live")) goLive();
  });
  $("review-card").addEventListener("click", (e) => {
    const g = (e.target as Element).closest("#eval-graph");
    if (!g) return;
    const r = g.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    viewAt(Math.round(f * state.game.moves.length));
  });
  $("nav-first").addEventListener("click", () => viewAt(0));
  $("nav-prev").addEventListener("click", () => viewAt(currentPly() - 1));
  $("nav-next").addEventListener("click", () => viewAt(currentPly() + 1));
  $("nav-last").addEventListener("click", goLive);
  $("nav-live").addEventListener("click", goLive);

  $("result-new-btn").addEventListener("click", () => {
    $<HTMLDialogElement>("result-dialog").close();
    newGame();
  });
  $("result-change-btn").addEventListener("click", () => {
    $<HTMLDialogElement>("result-dialog").close();
    openNewGameDialog();
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (document.querySelector("dialog[open]")) return;
    const k = e.key;
    if (k === "ArrowLeft") viewAt(currentPly() - 1);
    else if (k === "ArrowRight") viewAt(currentPly() + 1);
    else if (k === "Home") viewAt(0);
    else if (k === "End") goLive();
    else if (k === "p" || k === "P") pass();
    else if (k === "u" || k === "U") undo();
    else if (k === "h" || k === "H") requestHint();
    else if (k === "Escape") {
      if (state.preview !== null) {
        state.preview = null;
        render();
      } else if (state.viewPly !== null) goLive();
      else if (state.viewer) closeViewer();
    } else return;
    e.preventDefault();
  });
  matchMedia("(pointer: coarse)").addEventListener("change", render);

  const restored = restore();
  applyLanguage(detectLang());
  if (!restored) newGame();
  else if (state.phase === "scoring" && !state.dead) enterScoring();
  else if (isAITurn()) requestAIMove();
  openFromHash();
}

init();
