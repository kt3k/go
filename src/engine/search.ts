/**
 * Monte-Carlo tree search with RAVE (rapid action value estimation) and
 * light, heuristic playouts.
 *
 * Playouts play random moves that do not fill the player's own eyes, with
 * a few local tactics near the last move (capture a chain in atari, run
 * from atari, avoid needless self-atari). The tree uses UCT blended with
 * all-moves-as-first statistics and a handful of priors (edge moves are
 * poor early on, captures and moves near the last move are good).
 */
import { BLACK, Board, type Color, EDGE, EMPTY, PASS, WHITE } from "./board.ts";

/** Small fast PRNG (mulberry32) so playouts are cheap. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SearchOptions {
  playouts: number;
  timeMs: number;
  komi: number;
  /** Use playout tactics (captures, escapes). */
  tactics?: boolean;
  /** Hashes of earlier positions (superko); moves recreating them are cut. */
  seen?: Set<string>;
  seed?: number;
}

export interface SearchResult {
  /** Best move as a padded point, or PASS. */
  move: number;
  /** Win rate of the side to move, 0..1. */
  winrate: number;
  playouts: number;
  /** Ownership per padded point: +1 Black … -1 White. */
  ownership: Float32Array;
  /** Children sorted by visits: [point, visits, winrate]. */
  candidates: [number, number, number][];
}

class Node {
  move: number;
  /** Colour that played `move` into this node. */
  color: number;
  n = 0;
  /** Wins for `color`. */
  w = 0;
  rn = 0;
  rw = 0;
  /** Real visits (n also counts the prior's virtual ones). */
  visits = 0;
  children: Node[] | null = null;
  constructor(move: number, color: number, priorN: number, priorW: number) {
    this.move = move;
    this.color = color;
    this.n = priorN;
    this.w = priorW;
  }
}

const RAVE_K = 600;
const UCT_C = 0.25;
const EXPAND_AT = 6;

export class Searcher {
  private readonly root: Node;
  private readonly rootBoard: Board;
  private readonly opts: SearchOptions;
  private readonly rand: () => number;
  private readonly b: Board;
  /** First colour to play each point in the current simulation. */
  private readonly amaf: Uint8Array;
  private readonly owner: Float64Array;
  private ownerCount = 0;
  private readonly ownBuf: Uint8Array;
  playouts = 0;

  constructor(board: Board, opts: SearchOptions) {
    this.rootBoard = board.clone();
    this.opts = opts;
    this.rand = rng(opts.seed ?? (Math.random() * 2 ** 32));
    this.b = board.clone();
    this.amaf = new Uint8Array(board.w * board.w);
    this.owner = new Float64Array(board.w * board.w);
    this.ownBuf = new Uint8Array(board.w * board.w);
    this.root = new Node(board.last, 3 - board.toPlay, 0, 0);
  }

  run(): SearchResult {
    const t0 = Date.now();
    const { playouts, timeMs } = this.opts;
    let i = 0;
    while (i < playouts) {
      this.simulate();
      i++;
      if ((i & 63) === 0 && Date.now() - t0 > timeMs) break;
    }
    return this.result();
  }

  /** Visits and win rate (for the side to move) of one root move. */
  childStats(p: number): { visits: number; winrate: number } | null {
    const k = this.root.children?.find((c) => c.move === p);
    if (!k || k.n === 0) return null;
    return { visits: k.visits, winrate: k.w / k.n };
  }

  result(): SearchResult {
    const kids = this.root.children ?? [];
    const sorted = kids.filter((k) => k.visits > 0).sort((a, b) =>
      b.visits - a.visits || b.w / b.n - a.w / a.n
    );
    const best = sorted[0];
    const ownership = new Float32Array(this.owner.length);
    for (let p = 0; p < ownership.length; p++) {
      ownership[p] = this.ownerCount ? this.owner[p] / this.ownerCount : 0;
    }
    return {
      move: best ? best.move : PASS,
      winrate: best ? best.w / best.n : 0.5,
      playouts: this.playouts,
      ownership,
      candidates: sorted.slice(0, 8).map((k) => [k.move, k.visits, k.w / k.n]),
    };
  }

  private simulate() {
    const b = this.b;
    b.copyFrom(this.rootBoard);
    this.amaf.fill(0);
    const path: Node[] = [this.root];
    let node = this.root;
    // Selection / expansion.
    while (true) {
      if (b.passes >= 2) break;
      if (!node.children) {
        if (node.visits >= EXPAND_AT || node === this.root) {
          this.expand(node, b);
        } else break;
      }
      const child = this.select(node);
      if (!child) break;
      b.play(child.move);
      if (child.move !== PASS && !this.amaf[child.move]) {
        this.amaf[child.move] = child.color;
      }
      path.push(child);
      node = child;
    }
    // Playout.
    const winner = this.playout(b);
    this.playouts++;
    // Backpropagation.
    for (let i = path.length - 1; i >= 0; i--) {
      const nd = path[i];
      nd.n++;
      nd.visits++;
      if (nd.color === winner) nd.w++;
      if (nd.children) {
        // RAVE: credit siblings whose move was played later by their colour.
        const toMove = 3 - nd.color;
        for (const ch of nd.children) {
          if (ch.move === PASS) continue;
          if (this.amaf[ch.move] === toMove) {
            ch.rn++;
            if (winner === toMove) ch.rw++;
          }
        }
      }
    }
  }

  private select(node: Node): Node | null {
    const kids = node.children!;
    if (kids.length === 0) return null;
    const logN = Math.log(node.n + 1);
    let best: Node | null = null;
    let bestV = -Infinity;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      let v: number;
      if (k.n === 0 && k.rn === 0) v = 10 + this.rand();
      else {
        const q = k.n > 0 ? k.w / k.n : 0.5;
        const rq = k.rn > 0 ? k.rw / k.rn : q;
        const beta = Math.sqrt(RAVE_K / (3 * k.n + RAVE_K));
        v = (1 - beta) * q + beta * rq +
          UCT_C * Math.sqrt(logN / (k.n + 1));
      }
      if (v > bestV) {
        bestV = v;
        best = k;
      }
    }
    return best;
  }

  private expand(node: Node, b: Board) {
    const c = b.toPlay;
    const kids: Node[] = [];
    const n = b.n, w = b.w;
    const early = b.emptyCount > n * n * 0.6;
    const isRoot = node === this.root;
    const seen = isRoot ? this.opts.seen : undefined;
    const lastP = b.last;
    const scratch = isRoot && seen ? b.clone() : null;
    for (let i = 0; i < b.emptyCount; i++) {
      const p = b.empties[i];
      if (!b.isLegal(p, c)) continue;
      if (b.isEye(p, c)) continue;
      if (scratch) {
        scratch.copyFrom(b);
        scratch.play(p);
        if (seen!.has(scratch.hash)) continue;
      }
      // Priors as virtual visits: [visits, wins].
      let pn = 0, pw = 0;
      const x = (p % w) - 1, y = ((p / w) | 0) - 1;
      const line = Math.min(x, y, n - 1 - x, n - 1 - y);
      if (early && n >= 9) {
        if (line === 0) {
          pn += 20;
          pw += 2;
        } else if (line === 1) {
          pn += 10;
          pw += 3;
        } else if (line === 2 || line === 3) {
          pn += 10;
          pw += 6;
        }
      } else if (line === 0) {
        pn += 6;
        pw += 2;
      }
      const tact = this.tacticalValue(b, p, c);
      if (tact > 0) {
        pn += 20;
        pw += 18;
      } else if (tact < 0) {
        pn += 20;
        pw += 2;
      }
      if (lastP >= 0) {
        const dx = Math.abs(x - ((lastP % w) - 1));
        const dy = Math.abs(y - (((lastP / w) | 0) - 1));
        if (dx <= 1 && dy <= 1) {
          pn += 6;
          pw += 4;
        }
      }
      kids.push(new Node(p, c, pn, pw));
    }
    // Passing is always possible, but rarely good while there are moves.
    kids.push(new Node(PASS, c, kids.length ? 10 : 0, kids.length ? 1 : 0));
    node.children = kids;
  }

  /**
   * +1 for moves that capture or save a chain in atari, -1 for moves that
   * put a sizeable chain of one's own in atari, 0 otherwise.
   */
  private tacticalValue(b: Board, p: number, c: Color): number {
    const w = b.w, color = b.color;
    const o = 3 - c;
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const q = i === 0 ? p - w : i === 1 ? p - 1 : i === 2 ? p + 1 : p + w;
      const k = color[q];
      if (k === o && b.liberties(q, 2) === 1) return 1;
      if (k === c && b.liberties(q, 2) === 1) value = 1;
    }
    const libs = b.libertiesAfter(p, c, 2);
    if (libs === 1) {
      // Self-atari: bad unless it is a lone stone (a throw-in may be fine).
      let own = 0;
      if (color[p - w] === c) own++;
      if (color[p - 1] === c) own++;
      if (color[p + 1] === c) own++;
      if (color[p + w] === c) own++;
      if (own > 0) return -1;
      if (value === 1) return 0;
    }
    return value;
  }

  /** Random playout to the end; returns the winning colour. */
  private playout(b: Board): number {
    const rand = this.rand;
    const tactics = this.opts.tactics !== false;
    const max = b.n * b.n * 3;
    const finished = b.passes >= 2;
    let moves = 0;
    while (b.passes < 2 && moves < max) {
      const c = b.toPlay;
      let p = -1;
      if (tactics && b.last >= 0 && rand() < 0.9) p = this.localMove(b, c);
      if (p < 0) p = this.randomMove(b, c);
      if (p !== PASS && !this.amaf[p]) this.amaf[p] = c;
      b.play(p);
      moves++;
    }
    const own = this.ownBuf;
    const score = finished
      ? b.areaScore(undefined, own)
      : this.quickScore(b, own);
    for (let i = 0; i < own.length; i++) {
      if (own[i] === BLACK) this.owner[i]++;
      else if (own[i] === WHITE) this.owner[i]--;
    }
    this.ownerCount++;
    return score - this.opts.komi > 0 ? BLACK : WHITE;
  }

  /** Captures or escapes around the last move. */
  private localMove(b: Board, c: Color): number {
    const w = b.w, color = b.color, last = b.last;
    const o = 3 - c;
    // Opponent chain next to (or at) the last move in atari: capture it.
    // Own chain in atari next to the last move: extend.
    let escape = -1;
    for (let i = 0; i < 5; i++) {
      const q = i === 0
        ? last
        : i === 1
        ? last - w
        : i === 2
        ? last - 1
        : i === 3
        ? last + 1
        : last + w;
      const k = color[q];
      if (k !== BLACK && k !== WHITE) continue;
      if (b.liberties(q, 2) !== 1) continue;
      const lib = b.lastLiberty;
      if (k === o) {
        if (b.isLegal(lib, c)) return lib;
      } else if (escape < 0 && b.isLegal(lib, c)) {
        // Only run if it gains liberties.
        const gain = (color[lib - w] === EMPTY ? 1 : 0) +
          (color[lib - 1] === EMPTY ? 1 : 0) +
          (color[lib + 1] === EMPTY ? 1 : 0) +
          (color[lib + w] === EMPTY ? 1 : 0);
        if (gain >= 2) escape = lib;
      }
    }
    return escape;
  }

  private randomMove(b: Board, c: Color): number {
    const n = b.emptyCount;
    if (n === 0) return PASS;
    const start = (this.rand() * n) | 0;
    const empties = b.empties;
    for (let i = 0; i < n; i++) {
      const p = empties[(start + i) % n];
      if (!b.isLegal(p, c) || b.isEye(p, c)) continue;
      return p;
    }
    return PASS;
  }

  /** Area score of a finished playout: stones plus single-point eyes. */
  private quickScore(b: Board, own: Uint8Array): number {
    const color = b.color, w = b.w;
    let s = 0;
    own.fill(0);
    for (let y = 1; y <= b.n; y++) {
      for (let p = y * w + 1, e = p + b.n; p < e; p++) {
        const k = color[p];
        if (k === BLACK) {
          s++;
          own[p] = BLACK;
        } else if (k === WHITE) {
          s--;
          own[p] = WHITE;
        } else if (k === EMPTY) {
          let t = 0;
          const a = color[p - w],
            bb = color[p - 1],
            cc = color[p + 1],
            d = color[p + w];
          if (a !== EDGE) t |= a;
          if (bb !== EDGE) t |= bb;
          if (cc !== EDGE) t |= cc;
          if (d !== EDGE) t |= d;
          if (t === BLACK) {
            s++;
            own[p] = BLACK;
          } else if (t === WHITE) {
            s--;
            own[p] = WHITE;
          }
        }
      }
    }
    return s;
  }
}

/** Opponent strengths: playout budget, time cap and playout tactics. */
export const LEVELS = [
  { id: 1, playouts: 300, timeMs: 400, tactics: false, noise: 0.3 },
  { id: 2, playouts: 1200, timeMs: 900, tactics: true, noise: 0.1 },
  { id: 3, playouts: 5000, timeMs: 1800, tactics: true, noise: 0 },
  { id: 4, playouts: 16000, timeMs: 3500, tactics: true, noise: 0 },
  { id: 5, playouts: 60000, timeMs: 7000, tactics: true, noise: 0 },
];

export interface MoveChoice {
  /** Vertex, PASS, or "resign". */
  move: number | "resign";
  winrate: number;
  playouts: number;
}

/**
 * Picks the computer's move. `oppPassed` is true when the opponent's last
 * move was a pass: then the computer passes too if it is ahead once dead
 * stones are taken off.
 */
export function chooseMove(
  board: Board,
  level: number,
  komi: number,
  seen: Set<string>,
  moveCount: number,
): MoveChoice {
  const L = LEVELS.find((l) => l.id === level) ?? LEVELS[2];
  const s = new Searcher(board, {
    playouts: L.playouts,
    timeMs: L.timeMs,
    komi,
    tactics: L.tactics,
    seen,
  });
  const r = s.run();
  const me = board.toPlay;
  let move = r.move;
  // Weak opponents sometimes pick a lesser candidate.
  if (L.noise > 0 && r.candidates.length > 1 && Math.random() < L.noise) {
    const pool = r.candidates.slice(0, 4).filter((c) => c[0] !== PASS);
    if (pool.length) move = pool[(Math.random() * pool.length) | 0][0];
  }
  if (board.last === PASS && move !== PASS) {
    // The opponent passed: pass too when the board is settled and we are
    // ahead once dead stones are removed (rather than filling territory).
    const margin = estimateMargin(board, r.ownership, komi);
    const ahead = me === BLACK ? margin > 0 : margin < 0;
    if (ahead && unsettled(board, r.ownership) <= 0.04) move = PASS;
  }
  const n = board.n;
  if (
    level >= 3 && r.winrate < 0.04 && r.playouts > 500 &&
    moveCount > n * n / 3
  ) {
    return { move: "resign", winrate: r.winrate, playouts: r.playouts };
  }
  return {
    move: board.vertex(move),
    winrate: r.winrate,
    playouts: r.playouts,
  };
}

/** Dead stones (vertex flags) guessed from playout ownership. */
export function deadFromOwnership(
  board: Board,
  ownership: Float32Array,
): Uint8Array {
  const n = board.n;
  const dead = new Uint8Array(n * n);
  const done = new Uint8Array(board.w * board.w);
  for (let v = 0; v < n * n; v++) {
    const p = board.pt(v);
    const c = board.color[p];
    if ((c !== BLACK && c !== WHITE) || done[p]) continue;
    const stones = board.chain(p);
    let sum = 0;
    for (const s of stones) {
      done[s] = 1;
      sum += ownership[s];
    }
    const avg = sum / stones.length;
    const isDead = c === BLACK ? avg < -0.3 : avg > 0.3;
    if (isDead) { for (const s of stones) dead[board.vertex(s)] = 1; }
  }
  return dead;
}

/** Fraction of the board whose owner the playouts are unsure about. */
export function unsettled(board: Board, ownership: Float32Array): number {
  const n = board.n;
  let k = 0;
  for (let v = 0; v < n * n; v++) {
    if (Math.abs(ownership[board.pt(v)]) < 0.7) k++;
  }
  return k / (n * n);
}

/** Black-minus-White margin once dead stones are removed. */
export function estimateMargin(
  board: Board,
  ownership: Float32Array,
  komi: number,
): number {
  const deadV = deadFromOwnership(board, ownership);
  const dead = new Uint8Array(board.w * board.w);
  for (let v = 0; v < deadV.length; v++) if (deadV[v]) dead[board.pt(v)] = 1;
  return board.areaScore(dead) - komi;
}

/** Ownership estimate for scoring (both sides' view, many playouts). */
export function estimateOwnership(
  board: Board,
  komi: number,
  playouts = 3000,
  timeMs = 1500,
): Float32Array {
  const s = new Searcher(board, { playouts, timeMs, komi, tactics: true });
  return s.run().ownership;
}
