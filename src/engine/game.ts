/**
 * A game of go: a board size, komi, handicap and the sequence of moves, with
 * the rules applied on top of {@link Board}: positional superko, no suicide,
 * the game ends after two passes in a row (or a resignation).
 *
 * Scoring is by area (Chinese rules): stones on the board plus surrounded
 * empty points, after removing dead stones, plus komi for White.
 */
import {
  BLACK,
  Board,
  type Color,
  EMPTY,
  handicapPoints,
  opponent,
  PASS,
  WHITE,
} from "./board.ts";

export interface GameSetup {
  size: number;
  komi: number;
  handicap: number;
}

export const DEFAULT_KOMI = 7.5;

/** Usual komi: 7.5 for an even game, 0.5 with handicap stones. */
export const defaultKomi = (handicap: number) =>
  handicap >= 2 ? 0.5 : DEFAULT_KOMI;

export class Game {
  readonly setup: GameSetup;
  board: Board;
  readonly moves: number[] = [];
  /** Hashes of every position so far (for superko). */
  readonly seen = new Set<string>();
  private history: Board[] = [];

  constructor(setup: GameSetup) {
    this.setup = setup;
    this.board = Game.initialBoard(setup);
    this.seen.add(this.board.hash);
  }

  static initialBoard(setup: GameSetup): Board {
    const b = new Board(setup.size);
    const hc = handicapPoints(setup.size, setup.handicap);
    for (const v of hc) b.place(b.pt(v), BLACK);
    if (hc.length) b.toPlay = WHITE;
    return b;
  }

  /** Replays a move list; returns null if any move is illegal. */
  static fromMoves(setup: GameSetup, moves: number[]): Game | null {
    const g = new Game(setup);
    for (const m of moves) if (!g.play(m)) return null;
    return g;
  }

  get n() {
    return this.board.n;
  }
  get toPlay(): Color {
    return this.board.toPlay;
  }
  /** Two passes in a row. */
  get ended(): boolean {
    return this.board.passes >= 2;
  }

  /** Whether the side to move may play vertex `v` (or pass). */
  isLegal(v: number): boolean {
    if (this.ended) return false;
    if (v === PASS) return true;
    const b = this.board;
    const p = b.pt(v);
    if (!b.isLegal(p, b.toPlay)) return false;
    const t = b.clone();
    t.play(p);
    return !this.seen.has(t.hash);
  }

  legalMoves(): number[] {
    const out: number[] = [];
    for (let v = 0; v < this.n * this.n; v++) if (this.isLegal(v)) out.push(v);
    return out;
  }

  /** Plays vertex `v` or PASS. Returns the stones captured, or false. */
  play(v: number): number | false {
    if (!this.isLegal(v)) return false;
    this.history.push(this.board.clone());
    const captured = this.board.play(this.board.pt(v));
    this.moves.push(v);
    if (v !== PASS) this.seen.add(this.board.hash);
    return captured;
  }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    const v = this.moves.pop()!;
    if (v !== PASS) this.seen.delete(this.board.hash);
    this.board = prev;
    return true;
  }

  /** The board after `ply` moves. */
  boardAt(ply: number): Board {
    if (ply >= this.moves.length) return this.board;
    return this.history[ply];
  }

  /** Colour that played move `i` (0-based). */
  colorOf(i: number): Color {
    const first = this.setup.handicap >= 2 ? WHITE : BLACK;
    return i % 2 === 0 ? first : opponent(first);
  }
}

export interface Score {
  black: number;
  white: number;
  /** Black minus White, komi included. */
  margin: number;
  /** Per vertex: BLACK, WHITE or EMPTY (neutral / dame). */
  owner: Uint8Array;
  /** Per vertex: territory points (empty points that count for a side). */
  territory: { black: number; white: number };
  stones: { black: number; white: number };
  /** Dead stones removed, by their colour. */
  dead: { black: number; white: number };
}

/** Area score of a board with the given dead stones (vertex flags). */
export function scoreBoard(b: Board, komi: number, deadV?: Uint8Array): Score {
  const n = b.n;
  let dead: Uint8Array | undefined;
  if (deadV) {
    dead = new Uint8Array(b.w * b.w);
    for (let v = 0; v < n * n; v++) if (deadV[v]) dead[b.pt(v)] = 1;
  }
  const ownP = new Uint8Array(b.w * b.w);
  b.areaScore(dead, ownP);
  const owner = new Uint8Array(n * n);
  const s = {
    stones: { black: 0, white: 0 },
    territory: { black: 0, white: 0 },
    dead: { black: 0, white: 0 },
  };
  for (let v = 0; v < n * n; v++) {
    const p = b.pt(v);
    owner[v] = ownP[p];
    const c = b.color[p];
    const isDead = !!(dead && dead[p]);
    if (c === BLACK || c === WHITE) {
      if (isDead) {
        if (c === BLACK) s.dead.black++;
        else s.dead.white++;
      } else if (c === BLACK) s.stones.black++;
      else s.stones.white++;
    }
    if ((c === EMPTY || isDead) && ownP[p] === BLACK) s.territory.black++;
    if ((c === EMPTY || isDead) && ownP[p] === WHITE) s.territory.white++;
  }
  const black = s.stones.black + s.territory.black;
  const white = s.stones.white + s.territory.white + komi;
  return { ...s, black, white, margin: black - white, owner };
}

/** Result text in SGF style: "B+3.5", "W+R", "Draw". */
export function resultString(
  winner: Color | 0,
  margin: number | "R" | "T",
): string {
  if (winner === 0) return "0";
  return `${winner === BLACK ? "B" : "W"}+${
    typeof margin === "number" ? Math.abs(margin) : margin
  }`;
}
