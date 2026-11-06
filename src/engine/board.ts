/**
 * Go board with fast incremental updates, shared by the game rules and the
 * Monte-Carlo playouts.
 *
 * Points are stored on a padded grid (`w = n + 2`) so that every point on the
 * board has four neighbours; the padding holds {@link EDGE}. Outside this
 * module, points are addressed by their *vertex* `y * n + x` (0 ≤ x, y < n,
 * y = 0 being the top row) or {@link PASS}.
 *
 * Chains are kept as circular linked lists with a shared head and a count of
 * pseudo-liberties (each stone–empty-neighbour pair counts once), which is
 * enough to detect captures and suicide in O(1).
 */

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export const EDGE = 3;
export type Color = 1 | 2;
export const PASS = -1;

export const opponent = (c: Color): Color => (3 - c) as Color;

/** Zobrist keys, shared by all boards (indexed by colour × padded point). */
const ZOBRIST: Uint32Array = (() => {
  const max = 21 * 21;
  const z = new Uint32Array(3 * max * 2);
  let s = 0x9e3779b9;
  const rnd = () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };
  for (let i = 0; i < z.length; i++) z[i] = rnd();
  return z;
})();
const ZMAX = 21 * 21;

export class Board {
  readonly n: number;
  readonly w: number;
  readonly color: Uint8Array;
  readonly head: Int32Array;
  readonly next: Int32Array;
  /** Pseudo-liberties, valid at chain heads. */
  readonly libs: Int32Array;
  /** Chain sizes, valid at chain heads. */
  readonly size: Int32Array;
  /** Empty points (padded), in no particular order. */
  readonly empties: Int32Array;
  /** Index of each empty point in `empties`. */
  readonly emptyAt: Int32Array;
  emptyCount = 0;
  /** Point forbidden by the simple ko rule for the side to move, or -1. */
  ko = -1;
  toPlay: Color = BLACK;
  /** Stones captured by each colour (index 1 = by Black, 2 = by White). */
  readonly prisoners = [0, 0, 0];
  hashLo = 0;
  hashHi = 0;
  /** The last move (padded point or PASS), or -2 at the start. */
  last = -2;
  passes = 0;

  private readonly nb = new Int32Array(4);
  private readonly nb2 = new Int32Array(4);
  /** Scratch marks for liberty counting and flood fills. */
  private readonly mark: Uint32Array;
  private stamp = 1;

  constructor(n: number) {
    if (n < 2 || n > 19) throw new Error(`bad board size ${n}`);
    this.n = n;
    const w = n + 2;
    this.w = w;
    const len = w * w;
    this.color = new Uint8Array(len).fill(EDGE);
    this.head = new Int32Array(len);
    this.next = new Int32Array(len);
    this.libs = new Int32Array(len);
    this.size = new Int32Array(len);
    this.empties = new Int32Array(n * n);
    this.emptyAt = new Int32Array(len).fill(-1);
    this.mark = new Uint32Array(len);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const p = (y + 1) * w + x + 1;
        this.color[p] = EMPTY;
        this.emptyAt[p] = this.emptyCount;
        this.empties[this.emptyCount++] = p;
      }
    }
  }

  /** Padded point of a vertex (or PASS). */
  pt(v: number): number {
    if (v === PASS) return PASS;
    const x = v % this.n, y = (v / this.n) | 0;
    return (y + 1) * this.w + x + 1;
  }

  /** Vertex of a padded point (or PASS). */
  vertex(p: number): number {
    if (p < 0) return PASS;
    return ((p / this.w | 0) - 1) * this.n + (p % this.w) - 1;
  }

  /** Colour at a vertex. */
  at(v: number): number {
    return this.color[this.pt(v)];
  }

  clone(): Board {
    const b = new Board(this.n);
    b.copyFrom(this);
    return b;
  }

  copyFrom(o: Board) {
    this.color.set(o.color);
    this.head.set(o.head);
    this.next.set(o.next);
    this.libs.set(o.libs);
    this.size.set(o.size);
    this.empties.set(o.empties);
    this.emptyAt.set(o.emptyAt);
    this.emptyCount = o.emptyCount;
    this.ko = o.ko;
    this.toPlay = o.toPlay;
    this.prisoners[1] = o.prisoners[1];
    this.prisoners[2] = o.prisoners[2];
    this.hashLo = o.hashLo;
    this.hashHi = o.hashHi;
    this.last = o.last;
    this.passes = o.passes;
  }

  /** Hash of the stones on the board (positional, ignoring side to move). */
  get hash(): string {
    return `${this.hashLo.toString(36)}.${this.hashHi.toString(36)}`;
  }

  private toggle(c: number, p: number) {
    const i = (c * ZMAX + p) * 2;
    this.hashLo ^= ZOBRIST[i];
    this.hashHi ^= ZOBRIST[i + 1];
  }

  private removeEmpty(p: number) {
    const i = this.emptyAt[p];
    const lastP = this.empties[--this.emptyCount];
    this.empties[i] = lastP;
    this.emptyAt[lastP] = i;
    this.emptyAt[p] = -1;
  }

  private addEmpty(p: number) {
    this.emptyAt[p] = this.emptyCount;
    this.empties[this.emptyCount++] = p;
  }

  /**
   * Whether `c` may play at padded point `p` under the simple ko rule
   * (no suicide). Superko is checked by {@link Game}.
   */
  isLegal(p: number, c: Color): boolean {
    if (p === PASS) return true;
    if (this.color[p] !== EMPTY) return false;
    if (p === this.ko && c === this.toPlay) return false;
    const w = this.w;
    const color = this.color, head = this.head, libs = this.libs;
    const n0 = p - w, n1 = p - 1, n2 = p + 1, n3 = p + w;
    if (
      color[n0] === EMPTY || color[n1] === EMPTY || color[n2] === EMPTY ||
      color[n3] === EMPTY
    ) return true;
    const o = 3 - c;
    // Each neighbouring chain: count how many of its stones touch p.
    const nbs = this.nb;
    nbs[0] = n0;
    nbs[1] = n1;
    nbs[2] = n2;
    nbs[3] = n3;
    for (let i = 0; i < 4; i++) {
      const q = nbs[i];
      const k = color[q];
      if (k !== c && k !== o) continue;
      const h = head[q];
      let adj = 0;
      for (let j = 0; j < 4; j++) {
        const r = nbs[j];
        if ((color[r] === c || color[r] === o) && head[r] === h) adj++;
      }
      if (k === c && libs[h] > adj) return true;
      if (k === o && libs[h] === adj) return true;
    }
    return false;
  }

  /** Plays a (legal) move for the side to move. Returns stones captured. */
  play(p: number): number {
    const c = this.toPlay;
    this.toPlay = (3 - c) as Color;
    this.last = p;
    if (p === PASS) {
      this.ko = -1;
      this.passes++;
      return 0;
    }
    this.passes = 0;
    const w = this.w;
    const color = this.color, head = this.head, libs = this.libs;
    color[p] = c;
    head[p] = p;
    this.next[p] = p;
    this.size[p] = 1;
    libs[p] = 0;
    this.removeEmpty(p);
    this.toggle(c, p);
    const nbs = this.nb2;
    nbs[0] = p - w;
    nbs[1] = p - 1;
    nbs[2] = p + 1;
    nbs[3] = p + w;
    for (let i = 0; i < 4; i++) {
      const q = nbs[i];
      const k = color[q];
      if (k === EMPTY) libs[p]++;
      else if (k !== EDGE) libs[head[q]]--;
    }
    for (let i = 0; i < 4; i++) {
      const q = nbs[i];
      if (color[q] === c && head[q] !== head[p]) this.merge(head[p], head[q]);
    }
    let captured = 0;
    let lastCaptured = -1;
    const o = 3 - c;
    for (let i = 0; i < 4; i++) {
      const q = nbs[i];
      if (color[q] === o && libs[head[q]] === 0) {
        lastCaptured = q;
        captured += this.capture(head[q]);
      }
    }
    this.prisoners[c] += captured;
    const h = head[p];
    this.ko = captured === 1 && this.size[h] === 1 && libs[h] === 1
      ? lastCaptured
      : -1;
    return captured;
  }

  private merge(a: number, b: number) {
    if (this.size[a] < this.size[b]) [a, b] = [b, a];
    const head = this.head, next = this.next;
    let s = b;
    do {
      head[s] = a;
      s = next[s];
    } while (s !== b);
    const t = next[a];
    next[a] = next[b];
    next[b] = t;
    this.size[a] += this.size[b];
    this.libs[a] += this.libs[b];
  }

  private capture(h: number): number {
    const color = this.color, next = this.next, w = this.w;
    const c = color[h];
    let s = h;
    let n = 0;
    do {
      color[s] = EMPTY;
      this.addEmpty(s);
      this.toggle(c, s);
      n++;
      s = next[s];
    } while (s !== h);
    s = h;
    do {
      const nbs0 = s - w, nbs1 = s - 1, nbs2 = s + 1, nbs3 = s + w;
      if (color[nbs0] === 1 || color[nbs0] === 2) this.libs[this.head[nbs0]]++;
      if (color[nbs1] === 1 || color[nbs1] === 2) this.libs[this.head[nbs1]]++;
      if (color[nbs2] === 1 || color[nbs2] === 2) this.libs[this.head[nbs2]]++;
      if (color[nbs3] === 1 || color[nbs3] === 2) this.libs[this.head[nbs3]]++;
      s = next[s];
    } while (s !== h);
    return n;
  }

  /** Places a stone without it counting as a move (handicap setup). */
  place(p: number, c: Color) {
    const save = this.toPlay;
    this.toPlay = c;
    this.play(p);
    this.toPlay = save;
    this.last = -2;
  }

  private nextStamp(): number {
    if (++this.stamp === 0xffffffff) {
      this.mark.fill(0);
      this.stamp = 1;
    }
    return this.stamp;
  }

  /**
   * Real liberties of the chain at `p`, counting up to `max`. When exactly
   * one is found, it is stored in {@link lastLiberty}.
   */
  liberties(p: number, max = 1000): number {
    const st = this.nextStamp();
    const mark = this.mark, color = this.color, next = this.next, w = this.w;
    let n = 0;
    let s = this.head[p];
    const h = s;
    do {
      const a = s - w, b = s - 1, c = s + 1, d = s + w;
      if (color[a] === EMPTY && mark[a] !== st) {
        mark[a] = st;
        this.lastLiberty = a;
        if (++n >= max) return n;
      }
      if (color[b] === EMPTY && mark[b] !== st) {
        mark[b] = st;
        this.lastLiberty = b;
        if (++n >= max) return n;
      }
      if (color[c] === EMPTY && mark[c] !== st) {
        mark[c] = st;
        this.lastLiberty = c;
        if (++n >= max) return n;
      }
      if (color[d] === EMPTY && mark[d] !== st) {
        mark[d] = st;
        this.lastLiberty = d;
        if (++n >= max) return n;
      }
      s = next[s];
    } while (s !== h);
    return n;
  }
  lastLiberty = -1;

  /**
   * Liberties (up to `max`) the chain formed by `c` playing at empty `p`
   * would have, ignoring captures; returns `max` when the move captures.
   */
  libertiesAfter(p: number, c: number, max = 2): number {
    const w = this.w, color = this.color;
    const o = 3 - c;
    const nbs = this.nb2;
    nbs[0] = p - w;
    nbs[1] = p - 1;
    nbs[2] = p + 1;
    nbs[3] = p + w;
    for (let i = 0; i < 4; i++) {
      const q = nbs[i];
      if (color[q] === o && this.liberties(q, 2) === 1) return max;
    }
    const st = this.nextStamp();
    const mark = this.mark, next = this.next;
    mark[p] = st;
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const q = nbs[i];
      if (color[q] === EMPTY && mark[q] !== st) {
        mark[q] = st;
        if (++n >= max) return n;
      }
    }
    for (let i = 0; i < 4; i++) {
      const q = nbs[i];
      if (color[q] !== c || mark[q] === st) continue;
      const h = this.head[q];
      let s = h;
      do {
        mark[s] = st;
        for (let j = 0; j < 4; j++) {
          const r = j === 0 ? s - w : j === 1 ? s - 1 : j === 2 ? s + 1 : s + w;
          if (color[r] === EMPTY && mark[r] !== st) {
            mark[r] = st;
            if (++n >= max) return n;
          }
        }
        s = next[s];
      } while (s !== h);
    }
    return n;
  }

  /** Stones of the chain at padded point `p`. */
  chain(p: number): number[] {
    const out: number[] = [];
    let s = p;
    do {
      out.push(s);
      s = this.next[s];
    } while (s !== p);
    return out;
  }

  /**
   * Whether `p` is an eye of `c`: all four neighbours are `c` (or the edge)
   * and few enough diagonals belong to the opponent.
   */
  isEye(p: number, c: number): boolean {
    const color = this.color, w = this.w;
    const a = color[p - w],
      b = color[p - 1],
      d = color[p + 1],
      e = color[p + w];
    if (
      (a !== c && a !== EDGE) || (b !== c && b !== EDGE) ||
      (d !== c && d !== EDGE) || (e !== c && e !== EDGE)
    ) return false;
    const o = 3 - c;
    let bad = 0, edge = 0;
    for (let i = 0; i < 4; i++) {
      const k = color[
        i === 0
          ? p - w - 1
          : i === 1
          ? p - w + 1
          : i === 2
          ? p + w - 1
          : p + w + 1
      ];
      if (k === o) bad++;
      else if (k === EDGE) edge++;
    }
    return edge > 0 ? bad === 0 : bad < 2;
  }

  /**
   * Area score (stones + surrounded empty regions) as Black minus White,
   * without komi. `dead` marks stones to be removed first. When `owner` is
   * given it receives, per padded point, BLACK, WHITE or EMPTY (neutral).
   */
  areaScore(dead?: Uint8Array, owner?: Uint8Array): number {
    const n = this.n, w = this.w, color = this.color;
    const col = new Uint8Array(color);
    if (dead) {
      for (let p = 0; p < col.length; p++) {
        if (dead[p] && (col[p] === BLACK || col[p] === WHITE)) col[p] = EMPTY;
      }
    }
    const own = owner ?? new Uint8Array(col.length);
    own.fill(EMPTY);
    const seen = new Uint8Array(col.length);
    const stack: number[] = [];
    const region: number[] = [];
    let score = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const p = (y + 1) * w + x + 1;
        if (col[p] === BLACK || col[p] === WHITE) {
          own[p] = col[p];
          score += col[p] === BLACK ? 1 : -1;
          continue;
        }
        if (seen[p]) continue;
        let touch = 0;
        region.length = 0;
        stack.push(p);
        seen[p] = 1;
        while (stack.length) {
          const q = stack.pop()!;
          region.push(q);
          for (const r of [q - w, q - 1, q + 1, q + w]) {
            const k = col[r];
            if (k === EMPTY) {
              if (!seen[r]) {
                seen[r] = 1;
                stack.push(r);
              }
            } else if (k !== EDGE) touch |= k;
          }
        }
        if (touch === BLACK || touch === WHITE) {
          for (const q of region) own[q] = touch;
          score += touch === BLACK ? region.length : -region.length;
        }
      }
    }
    return score;
  }
}

/** Star points (hoshi) of a board size, as vertices. */
export function starPoints(n: number): number[] {
  const v = (x: number, y: number) => y * n + x;
  if (n < 7) return [];
  const d = n >= 13 ? 3 : 2;
  const lo = d, hi = n - 1 - d, mid = (n - 1) / 2;
  const pts = [v(lo, lo), v(hi, lo), v(lo, hi), v(hi, hi)];
  if (n % 2 === 1) {
    pts.push(v(mid, mid));
    if (n >= 19) pts.push(v(mid, lo), v(mid, hi), v(lo, mid), v(hi, mid));
  }
  return pts;
}

/** Handicap stone vertices (traditional placement), for 2–9 stones. */
export function handicapPoints(n: number, count: number): number[] {
  if (count < 2) return [];
  const v = (x: number, y: number) => y * n + x;
  const d = n >= 13 ? 3 : 2;
  const lo = d, hi = n - 1 - d, mid = (n - 1) / 2;
  const tr = v(hi, lo), bl = v(lo, hi), br = v(hi, hi), tl = v(lo, lo);
  const c = v(mid, mid);
  const l = v(lo, mid), r = v(hi, mid), t = v(mid, lo), b = v(mid, hi);
  const max = n % 2 === 1 ? (n >= 13 ? 9 : 5) : 4;
  count = Math.min(count, max);
  switch (count) {
    case 2:
      return [tr, bl];
    case 3:
      return [tr, bl, br];
    case 4:
      return [tr, bl, br, tl];
    case 5:
      return [tr, bl, br, tl, c];
    case 6:
      return [tr, bl, br, tl, l, r];
    case 7:
      return [tr, bl, br, tl, l, r, c];
    case 8:
      return [tr, bl, br, tl, l, r, t, b];
    default:
      return [tr, bl, br, tl, l, r, t, b, c];
  }
}

/** Largest handicap a board size supports. */
export const maxHandicap = (n: number) => n % 2 === 1 ? (n >= 13 ? 9 : 5) : 4;

const LETTERS = "ABCDEFGHJKLMNOPQRST"; // no I, as is customary

/** Human-readable coordinate of a vertex ("D4"), or "pass". */
export function coordName(v: number, n: number): string {
  if (v === PASS) return "pass";
  const x = v % n, y = (v / n) | 0;
  return `${LETTERS[x]}${n - y}`;
}

export const columnLetter = (x: number) => LETTERS[x];

/** Parses "D4" style coordinates. */
export function parseCoord(s: string, n: number): number | null {
  const m = /^([A-HJ-T])(\d{1,2})$/i.exec(s.trim());
  if (!m) return null;
  const x = LETTERS.indexOf(m[1].toUpperCase());
  const y = n - Number(m[2]);
  if (x < 0 || x >= n || y < 0 || y >= n) return null;
  return y * n + x;
}
