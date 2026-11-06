/**
 * Game records: SGF (Smart Game Format) export and import, and compact
 * share codes that put a whole game into a URL.
 */
import { BLACK, type Color, PASS, WHITE } from "./board.ts";
import { firstMover, Game, type GameSetup } from "./game.ts";

export interface RecordResult {
  winner: Color | 0;
  reason: "score" | "resign" | "time" | "other";
  /** Black minus White for "score". */
  margin?: number;
}

export interface SgfGame {
  setup: GameSetup;
  moves: number[];
  black?: string;
  white?: string;
  date?: string;
  result?: RecordResult;
  event?: string;
}

// ---------------------------------------------------------------- export

const sgfPoint = (v: number, n: number) =>
  v === PASS ? "" : String.fromCharCode(97 + (v % n), 97 + ((v / n) | 0));

const sgfText = (s: string) => s.replace(/\\/g, "\\\\").replace(/]/g, "\\]");

export function resultToSGF(r: RecordResult | undefined | null): string {
  if (!r) return "";
  if (r.winner === 0) return "0";
  const w = r.winner === BLACK ? "B" : "W";
  if (r.reason === "resign") return `${w}+R`;
  if (r.reason === "time") return `${w}+T`;
  if (r.reason === "score" && r.margin !== undefined) {
    return `${w}+${Math.abs(r.margin)}`;
  }
  return `${w}+`;
}

export function toSGF(g: SgfGame): string {
  const n = g.setup.size;
  const props: string[] = [
    "GM[1]",
    "FF[4]",
    "CA[UTF-8]",
    "AP[kt3k-go:1]",
    "RU[Chinese]",
    `SZ[${n}]`,
    `KM[${g.setup.komi}]`,
  ];
  if (g.setup.handicap >= 2) props.push(`HA[${g.setup.handicap}]`);
  const stones = setupStones(g.setup);
  if (stones.black.length) {
    props.push(`AB${stones.black.map((v) => `[${sgfPoint(v, n)}]`).join("")}`);
  }
  if (stones.white.length) {
    props.push(`AW${stones.white.map((v) => `[${sgfPoint(v, n)}]`).join("")}`);
  }
  if (g.black) props.push(`PB[${sgfText(g.black)}]`);
  if (g.white) props.push(`PW[${sgfText(g.white)}]`);
  if (g.date) props.push(`DT[${sgfText(g.date)}]`);
  if (g.event) props.push(`EV[${sgfText(g.event)}]`);
  const re = resultToSGF(g.result);
  if (re) props.push(`RE[${re}]`);
  if (g.setup.first && stones.black.length === 0 && g.setup.first === WHITE) {
    props.push("PL[W]");
  }
  const game = new Game(g.setup);
  const moves = g.moves.map((v, i) =>
    `;${game.colorOf(i) === BLACK ? "B" : "W"}[${sgfPoint(v, n)}]`
  );
  const lines: string[] = [];
  let line = "";
  for (const m of moves) {
    if (line.length + m.length > 72) {
      lines.push(line);
      line = "";
    }
    line += m;
  }
  if (line) lines.push(line);
  return `(;${props.join("")}\n${lines.join("\n")})\n`;
}

/** Black and white stones on the board before the first move. */
function setupStones(s: GameSetup) {
  const b = Game.initialBoard(s);
  const black: number[] = [], white: number[] = [];
  for (let v = 0; v < s.size * s.size; v++) {
    const c = b.at(v);
    if (c === BLACK) black.push(v);
    else if (c === WHITE) white.push(v);
  }
  return { black, white };
}

// ---------------------------------------------------------------- import

interface Node {
  props: Map<string, string[]>;
}

/** Parses SGF text into its game trees' main lines. */
function parseTrees(text: string): Node[][] {
  const trees: Node[][] = [];
  let i = 0;
  const len = text.length;
  const ws = () => {
    while (i < len && /\s/.test(text[i])) i++;
  };
  // Parse one game tree, returning its main line.
  const tree = (): Node[] => {
    // assumes text[i] === "("
    i++;
    const seq: Node[] = [];
    let first = true;
    while (i < len) {
      ws();
      const ch = text[i];
      if (ch === ";") {
        i++;
        const node: Node = { props: new Map() };
        while (i < len) {
          ws();
          const m = /^[A-Za-z]+/.exec(text.slice(i, i + 16));
          if (!m) break;
          const id = m[0].replace(/[a-z]/g, "");
          i += m[0].length;
          const vals: string[] = [];
          ws();
          while (text[i] === "[") {
            i++;
            let v = "";
            while (i < len && text[i] !== "]") {
              if (text[i] === "\\") i++;
              v += text[i++] ?? "";
            }
            i++;
            vals.push(v);
            ws();
          }
          node.props.set(id, [...(node.props.get(id) ?? []), ...vals]);
        }
        seq.push(node);
      } else if (ch === "(") {
        // Variations: follow the first, skip the rest.
        const sub = tree();
        if (first) seq.push(...sub);
        first = false;
      } else if (ch === ")") {
        i++;
        return seq;
      } else {
        i++;
      }
    }
    return seq;
  };
  while (i < len) {
    const j = text.indexOf("(", i);
    if (j < 0) break;
    i = j;
    // Require "(;" to start a tree.
    let k = j + 1;
    while (k < len && /\s/.test(text[k])) k++;
    if (text[k] !== ";") {
      i = j + 1;
      continue;
    }
    trees.push(tree());
  }
  return trees;
}

function parsePoint(s: string, n: number): number {
  if (s === "" || (s === "tt" && n <= 19)) return PASS;
  const x = s.charCodeAt(0) - 97, y = s.charCodeAt(1) - 97;
  if (!(x >= 0 && x < n && y >= 0 && y < n)) throw new Error(`bad point ${s}`);
  return y * n + x;
}

/** Point lists may use compressed rectangles ("aa:cc"). */
function parsePoints(vals: string[], n: number): number[] {
  const out: number[] = [];
  for (const v of vals) {
    if (v.includes(":")) {
      const [a, b] = v.split(":");
      const p = parsePoint(a, n), q = parsePoint(b, n);
      for (let y = (p / n) | 0; y <= ((q / n) | 0); y++) {
        for (let x = p % n; x <= q % n; x++) out.push(y * n + x);
      }
    } else out.push(parsePoint(v, n));
  }
  return out;
}

export function parseResult(re: string | undefined): RecordResult | undefined {
  if (!re) return undefined;
  const s = re.trim().toUpperCase();
  if (s === "0" || s === "DRAW" || s === "JIGO") {
    return { winner: 0, reason: "score", margin: 0 };
  }
  const m = /^([BW])\+(.*)$/.exec(s);
  if (!m) return undefined;
  const winner = m[1] === "B" ? BLACK : WHITE;
  const rest = m[2];
  if (/^R/.test(rest)) return { winner, reason: "resign" };
  if (/^T/.test(rest)) return { winner, reason: "time" };
  const x = parseFloat(rest);
  if (!isNaN(x)) {
    return { winner, reason: "score", margin: winner === BLACK ? x : -x };
  }
  return { winner, reason: "other" };
}

export interface SgfFailure {
  index: number;
  error: string;
}

/** Parses every game in SGF text (main lines only). */
export function parseSGF(
  text: string,
): { games: SgfGame[]; failures: SgfFailure[] } {
  const games: SgfGame[] = [];
  const failures: SgfFailure[] = [];
  parseTrees(text).forEach((nodes, index) => {
    try {
      if (!nodes.length) throw new Error("empty game");
      const root = nodes[0].props;
      const get = (k: string) => root.get(k)?.[0];
      const n = Number(get("SZ") ?? 19);
      if (![...Array(17)].some((_, k) => k + 3 === n)) {
        throw new Error(`unsupported board size ${get("SZ")}`);
      }
      const km = parseFloat(get("KM") ?? "");
      const ha = Number(get("HA") ?? 0) || 0;
      const ab = parsePoints(root.get("AB") ?? [], n);
      const aw = parsePoints(root.get("AW") ?? [], n);
      const raw: [Color, number][] = [];
      for (const node of nodes) {
        const b = node.props.get("B"), w = node.props.get("W");
        if (b) raw.push([BLACK, parsePoint(b[0], n)]);
        else if (w) raw.push([WHITE, parsePoint(w[0], n)]);
      }
      const pl = get("PL");
      const first: Color = raw.length
        ? raw[0][0]
        : pl === "W"
        ? WHITE
        : pl === "B"
        ? BLACK
        : ab.length
        ? WHITE
        : BLACK;
      const setup: GameSetup = {
        size: n,
        komi: isNaN(km) ? (ab.length ? 0.5 : 7.5) : km,
        handicap: ha >= 2
          ? ha
          : ab.length >= 2 && aw.length === 0
          ? ab.length
          : 0,
        ab,
        aw,
        first,
      };
      // Moves must alternate: fill a missing turn with a pass.
      const moves: number[] = [];
      let toPlay = first;
      for (const [c, v] of raw) {
        if (c !== toPlay) moves.push(PASS);
        moves.push(v);
        toPlay = c === BLACK ? WHITE : BLACK;
      }
      const g = new Game(setup);
      moves.forEach((v, k) => {
        if (g.play(v) === false) {
          throw new Error(`illegal move ${k + 1}`);
        }
      });
      games.push({
        setup,
        moves,
        black: get("PB"),
        white: get("PW"),
        date: get("DT"),
        event: get("EV"),
        result: parseResult(get("RE")),
      });
    } catch (e) {
      failures.push({ index, error: (e as Error).message });
    }
  });
  return { games, failures };
}

// ---------------------------------------------------------------- share codes

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * A compact, URL-safe text form of a game: a header of dot-separated fields
 * followed by two base64url characters per move (0 = pass, v + 1 otherwise).
 *
 *   1.<size>.<komi × 2>.<handicap>.<first>.<result>.<setup>.<moves>
 */
export function encodeShare(g: SgfGame): string {
  const enc = (x: number) => B64[(x >> 6) & 63] + B64[x & 63];
  const moves = g.moves.map((v) => enc(v === PASS ? 0 : v + 1)).join("");
  const s = g.setup;
  let setup = "";
  if (s.ab || s.aw) {
    // Explicit setup stones: list them as moves with a separator.
    setup = (s.ab ?? []).map((v) => enc(v + 1)).join("") + "~" +
      (s.aw ?? []).map((v) => enc(v + 1)).join("");
  }
  return [
    "1",
    s.size,
    Math.round(s.komi * 2),
    s.handicap,
    firstMover(s) === BLACK ? "b" : "w",
    encodeURIComponent(resultToSGF(g.result)),
    setup,
    moves,
  ].join(".");
}

export function decodeShare(code: string): SgfGame | null {
  const parts = code.split(".");
  if (parts[0] !== "1" || parts.length < 8) return null;
  const [, sz, km, ha, first, re, setupStr, moveStr] = parts.slice(0, 8);
  const n = Number(sz);
  if (!(n >= 3 && n <= 19)) return null;
  const dec = (s: string) => {
    const out: number[] = [];
    for (let i = 0; i + 1 < s.length; i += 2) {
      const a = B64.indexOf(s[i]), b = B64.indexOf(s[i + 1]);
      if (a < 0 || b < 0) throw new Error("bad code");
      out.push((a << 6) | b);
    }
    return out;
  };
  try {
    const moves = dec(moveStr).map((x) => (x === 0 ? PASS : x - 1));
    if (moves.some((v) => v !== PASS && (v < 0 || v >= n * n))) return null;
    const setup: GameSetup = {
      size: n,
      komi: Number(km) / 2,
      handicap: Number(ha) || 0,
      first: first === "w" ? WHITE : BLACK,
    };
    if (setupStr) {
      const [a, w] = setupStr.split("~");
      setup.ab = dec(a ?? "").map((x) => x - 1);
      setup.aw = dec(w ?? "").map((x) => x - 1);
    }
    if (isNaN(setup.komi)) return null;
    if (!Game.fromMoves(setup, moves)) return null;
    return { setup, moves, result: parseResult(decodeURIComponent(re)) };
  } catch {
    return null;
  }
}
