/// <reference lib="webworker" />
/**
 * Runs the engine off the main thread: the computer's moves, hints, dead
 * stone estimation for the count, and game review.
 */
import { Game, type GameSetup } from "../engine/game.ts";
import { PASS } from "../engine/board.ts";
import {
  chooseMove,
  deadFromOwnership,
  estimateOwnership,
  Searcher,
} from "../engine/search.ts";

export type WorkerRequest =
  | {
    type: "move";
    id: number;
    setup: GameSetup;
    moves: number[];
    level: number;
  }
  | { type: "hint"; id: number; setup: GameSetup; moves: number[] }
  | { type: "dead"; id: number; setup: GameSetup; moves: number[] }
  | {
    type: "analyse";
    id: number;
    setup: GameSetup;
    moves: number[];
    from: number;
    playouts: number;
  };

export type WorkerResponse =
  | { type: "move"; id: number; move: number | "resign"; winrate: number }
  | { type: "hint"; id: number; move: number; winrate: number }
  | { type: "dead"; id: number; dead: number[] }
  | {
    type: "analysis";
    id: number;
    ply: number;
    /** Black's win rate in the position after `ply` moves. */
    black: number;
    /** Best move for the side to move there (vertex or PASS). */
    best: number;
    done: boolean;
  };

function build(setup: GameSetup, moves: number[]): Game {
  const g = new Game(setup);
  for (const m of moves) {
    if (g.play(m) === false) throw new Error(`illegal move ${m}`);
  }
  return g;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === "move") {
      const g = build(req.setup, req.moves);
      const r = chooseMove(
        g.board,
        req.level,
        req.setup.komi,
        g.seen,
        g.moves.length,
      );
      let move = r.move;
      if (move !== "resign" && !g.isLegal(move)) move = PASS;
      post({ type: "move", id: req.id, move, winrate: r.winrate });
    } else if (req.type === "hint") {
      const g = build(req.setup, req.moves);
      const s = new Searcher(g.board, {
        playouts: 20000,
        timeMs: 1500,
        komi: req.setup.komi,
        seen: g.seen,
      });
      const r = s.run();
      let move = g.board.vertex(r.move);
      if (!g.isLegal(move)) move = PASS;
      post({ type: "hint", id: req.id, move, winrate: r.winrate });
    } else if (req.type === "dead") {
      const g = build(req.setup, req.moves);
      const own = estimateOwnership(g.board, req.setup.komi, 6000, 1500);
      const dead = deadFromOwnership(g.board, own);
      const list: number[] = [];
      for (let v = 0; v < dead.length; v++) if (dead[v]) list.push(v);
      post({ type: "dead", id: req.id, dead: list });
    } else if (req.type === "analyse") {
      analyse(req);
    }
  } catch (err) {
    console.error(err);
    if (req.type === "move") {
      post({ type: "move", id: req.id, move: PASS, winrate: 0.5 });
    } else if (req.type === "hint") {
      post({ type: "hint", id: req.id, move: PASS, winrate: 0.5 });
    } else if (req.type === "dead") {
      post({ type: "dead", id: req.id, dead: [] });
    }
  }
};

function analyse(
  req: Extract<WorkerRequest, { type: "analyse" }>,
) {
  const g = new Game(req.setup);
  for (let k = 0; k < req.from; k++) g.play(req.moves[k]);
  for (let k = req.from; k <= req.moves.length; k++) {
    let black = 0.5, best = PASS;
    if (g.ended) {
      // Finished: the count decides; leave it to the caller.
      black = NaN;
    } else {
      const s = new Searcher(g.board, {
        playouts: req.playouts,
        timeMs: 4000,
        komi: req.setup.komi,
        seen: g.seen,
      });
      const r = s.run();
      black = g.board.toPlay === 1 ? r.winrate : 1 - r.winrate;
      best = g.board.vertex(r.move);
    }
    post({
      type: "analysis",
      id: req.id,
      ply: k,
      black,
      best,
      done: k === req.moves.length,
    });
    if (k < req.moves.length) g.play(req.moves[k]);
  }
}

function post(r: WorkerResponse) {
  self.postMessage(r);
}
