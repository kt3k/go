import { assert, assertEquals } from "@std/assert";
import { BLACK, PASS, WHITE } from "./board.ts";
import {
  decodeShare,
  encodeShare,
  parseSGF,
  type SgfGame,
  toSGF,
} from "./record.ts";

const sample: SgfGame = {
  setup: { size: 9, komi: 7.5, handicap: 0 },
  moves: [40, 30, 50, PASS, 20],
  black: "You",
  white: "Kitsune [狐]",
  result: { winner: WHITE, reason: "resign" },
};

Deno.test("SGF round trip", () => {
  const sgf = toSGF(sample);
  assert(sgf.includes("SZ[9]"));
  assert(sgf.includes("RE[W+R]"));
  assert(sgf.includes(";W[]"), "pass is empty");
  const { games, failures } = parseSGF(sgf);
  assertEquals(failures, []);
  assertEquals(games.length, 1);
  assertEquals(games[0].moves, sample.moves);
  assertEquals(games[0].white, "Kitsune [狐]");
  assertEquals(games[0].result?.winner, WHITE);
});

Deno.test("SGF with handicap and variations", () => {
  const text = `(;GM[1]SZ[19]HA[2]KM[0.5]AB[pd][dp]RE[B+12.5]
    ;W[dd];B[pq](;W[qf];B[nc])(;W[cc]))`;
  const { games, failures } = parseSGF(text);
  assertEquals(failures, []);
  const g = games[0];
  assertEquals(g.moves.length, 4);
  assertEquals(g.setup.first, WHITE);
  assertEquals(g.result?.margin, 12.5);
  assertEquals(g.result?.winner, BLACK);
});

Deno.test("SGF failures are reported", () => {
  const { games, failures } = parseSGF("(;SZ[9];B[ee];W[ee])(;SZ[9];B[aa])");
  assertEquals(games.length, 1);
  assertEquals(failures.length, 1);
});

Deno.test("share code round trip", () => {
  const code = encodeShare(sample);
  const g = decodeShare(code)!;
  assertEquals(g.moves, sample.moves);
  assertEquals(g.setup.size, 9);
  assertEquals(g.result?.reason, "resign");
  assertEquals(decodeShare("garbage"), null);
});
