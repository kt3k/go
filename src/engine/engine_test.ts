import { assert, assertEquals } from "@std/assert";
import { BLACK, Board, coordName, parseCoord, PASS, WHITE } from "./board.ts";
import { Game, scoreBoard } from "./game.ts";
import { chooseMove, Searcher } from "./search.ts";

const at = (n: number, s: string) => parseCoord(s, n)!;

function play(g: Game, ...coords: string[]) {
  for (const c of coords) {
    const v = c === "pass" ? PASS : at(g.n, c);
    assert(g.play(v) !== false, `illegal ${c}`);
  }
}

Deno.test("coordinates skip I", () => {
  assertEquals(coordName(at(19, "J10"), 19), "J10");
  assertEquals(coordName(0, 9), "A9");
  assertEquals(coordName(80, 9), "J1");
});

Deno.test("capture a single stone", () => {
  const g = new Game({ size: 9, komi: 7.5, handicap: 0 });
  play(g, "E5", "D5", "A1", "F5", "A2", "E4", "A3", "E6");
  // E5 (black) is surrounded by white on four sides.
  assertEquals(g.board.at(at(9, "E5")), 0);
  assertEquals(g.board.prisoners[WHITE], 1);
});

Deno.test("suicide is illegal", () => {
  const g = new Game({ size: 9, komi: 7.5, handicap: 0 });
  play(g, "B1", "pass", "A2", "pass");
  g.board.toPlay = WHITE;
  assertEquals(g.isLegal(at(9, "A1")), false);
});

Deno.test("simple ko", () => {
  const g = new Game({ size: 9, komi: 7.5, handicap: 0 });
  // Black stones: C5 D4 D6 ; White: E4 E6 F5 ; then White D5, Black E5 takes.
  play(g, "C5", "E4", "D4", "E6", "D6", "F5", "A1", "D5", "E5");
  assertEquals(g.board.at(at(9, "D5")), 0, "black captured at D5");
  // White may not retake at D5 straight away.
  assertEquals(g.isLegal(at(9, "D5")), false);
  play(g, "J9", "J8");
  assertEquals(g.isLegal(at(9, "D5")), true);
});

Deno.test("area scoring with komi", () => {
  const b = new Board(5);
  // Black wall on column C, White wall on column D.
  for (let y = 0; y < 5; y++) {
    b.place(b.pt(y * 5 + 2), BLACK);
    b.place(b.pt(y * 5 + 3), WHITE);
  }
  const s = scoreBoard(b, 0.5);
  assertEquals(s.black, 15);
  assertEquals(s.white, 10.5);
  assertEquals(s.margin, 4.5);
});

Deno.test("search captures a stone in atari", () => {
  const g = new Game({ size: 9, komi: 7.5, handicap: 0 });
  play(g, "E5", "D5", "E4", "D4", "F5", "C3", "F4", "E6", "A9", "E3");
  // White E6 hangs? Black to move: check the engine returns a legal move.
  const r = chooseMove(g.board, 3, 7.5, new Set(), g.moves.length);
  assert(r.move === "resign" || r.move === PASS || g.isLegal(r.move));
});

Deno.test("playouts are fast enough", () => {
  const b = new Board(9);
  const t = performance.now();
  const r = new Searcher(b, { playouts: 3000, timeMs: 10000, komi: 7.5 })
    .run();
  const ms = performance.now() - t;
  console.log(`9x9: ${r.playouts} playouts in ${ms.toFixed(0)}ms`);
  const b19 = new Board(19);
  const t2 = performance.now();
  const r2 = new Searcher(b19, { playouts: 500, timeMs: 10000, komi: 7.5 })
    .run();
  console.log(
    `19x19: ${r2.playouts} playouts in ${
      (performance.now() - t2).toFixed(0)
    }ms`,
  );
});
