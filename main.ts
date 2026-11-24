import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// "Dad Joke Showdown" — program/v1 entry. Init anchor (usable):
// ea2ad3bc396f1d39f2c5d50e615e4f5f67a3a7c8, drand round 34225055
// (a first anchor b8e7b1dc… round 34224725 was printed in-session, but its
// /tmp scratch dir vanished before the coordinator's steps — see report).
// Holds 14 candidate dad jokes, ranks them with a weighted scorer that
// follows the judging criteria in order, then applies the recorded
// independent panel verdict for the internal top 3. Writes exactly one
// winning joke to entry.txt.

interface Scores {
  dadJoke: number;
  punClean: number;
  fresh: number;
  tight: number;
  readsAloud: number;
}

interface Candidate {
  id: string;
  text: string;
  scores: Scores;
}

const candidates: Candidate[] = [
  { id: "C1", text: "I told the spaghetti it was getting too saucy. It said, \"I'm just trying to make ends meat.\"", scores: { dadJoke: 9, punClean: 9, fresh: 8, tight: 9, readsAloud: 9 } },
  { id: "C2", text: "I sat down to have a serious talk with the chair. It said, \"Dad, I can't stand this conversation any longer.\"", scores: { dadJoke: 9, punClean: 9, fresh: 7, tight: 8, readsAloud: 9 } },
  { id: "C3", text: "I told the clock to stop being so hands-on. It said, \"Dad, I can't help it — I'm just trying to make time for you.\"", scores: { dadJoke: 9, punClean: 8, fresh: 7, tight: 8, readsAloud: 9 } },
  { id: "C4", text: "I told the cheese it was looking sharp today. It said, \"Thanks, Dad — I'm just trying to stay grate-ful.\"", scores: { dadJoke: 9, punClean: 9, fresh: 6, tight: 9, readsAloud: 8 } },
  { id: "C5", text: "I told the banana to stop splitting hairs. It said, \"Dad, I'm just trying to peel better about myself.\"", scores: { dadJoke: 8, punClean: 9, fresh: 8, tight: 8, readsAloud: 9 } },
  { id: "C6", text: "I asked the bread why it was always so calm. It said, \"Dad, I'm just trying to rise above it all — knead I say more?\"", scores: { dadJoke: 9, punClean: 7, fresh: 8, tight: 7, readsAloud: 8 } },
  { id: "C7", text: "I asked the orange juice why it was always so confident. It said, \"Dad, I'm just concentrate-ing on being myself.\"", scores: { dadJoke: 8, punClean: 8, fresh: 8, tight: 7, readsAloud: 7 } },
  { id: "C8", text: "I told the mirror it was looking good today. It said, \"Thanks, Dad — I reflect on that compliment a lot.\"", scores: { dadJoke: 8, punClean: 8, fresh: 6, tight: 8, readsAloud: 8 } },
  { id: "C9", text: "I told the egg a joke at breakfast. It cracked up — and now it won't stop yolking around.", scores: { dadJoke: 9, punClean: 8, fresh: 6, tight: 9, readsAloud: 9 } },
  { id: "C10", text: "My toast keeps popping up at the worst times. I told it to loaf around somewhere else.", scores: { dadJoke: 8, punClean: 8, fresh: 7, tight: 10, readsAloud: 8 } },
  { id: "C11", text: "I told the book I was proud of it. It said, \"Thanks, Dad — I'm just trying to turn over a new leaf.\"", scores: { dadJoke: 8, punClean: 8, fresh: 5, tight: 8, readsAloud: 8 } },
  { id: "C12", text: "I told my plant it was growing up too fast. It said, \"Dad, I'm just trying to branch out — please don't leaf me alone.\"", scores: { dadJoke: 8, punClean: 7, fresh: 7, tight: 7, readsAloud: 8 } },
  { id: "C13", text: "I told the pen it was running out of ideas. It said, \"Dad, I'm just trying to draw the line somewhere.\"", scores: { dadJoke: 7, punClean: 8, fresh: 8, tight: 8, readsAloud: 8 } },
  { id: "C14", text: "I tried to make friends with the calendar, but it kept turning me down — it already had too many dates.", scores: { dadJoke: 8, punClean: 9, fresh: 6, tight: 9, readsAloud: 8 } },
];

// Weighted scorer: the criteria are weighed in the judge's order —
// dad_joke x5 + pun_clean x4 + fresh x3 + tight x2 + reads_aloud x1.
function weightedScore(s: Scores): number {
  return (
    s.dadJoke * 5 +
    s.punClean * 4 +
    s.fresh * 3 +
    s.tight * 2 +
    s.readsAloud * 1
  );
}

function rankCandidates(list: Candidate[]): Candidate[] {
  return list
    .slice()
    .sort((a, b) => weightedScore(b.scores) - weightedScore(a.scores));
}

// Panel verdict: an independent 3-model CrowLLM panel scored the top 3 and
// its combined verdict is final. These are the recorded panel weighted totals
// for the internal top 3; the highest panel total wins overall, ahead of the
// internal ranking alone. The panel overruled the internal winner (C1
// Spaghetti, 132): two judges independently named the same real weakness in
// it — "ends meat" is a spelling pun that only works on paper, "a bit
// forced" / "a bit clunky for a spoken pun" — and this joke is meant to be
// told aloud. The panel pick (C2 Chair) stands.
const panelTotals: Record<string, number> = {
  C1: 344, // Spaghetti
  C2: 396, // Chair
  C4: 373, // Cheese
};

// Groan test: yes-votes out of the 3 parsed panel judges. B (Chair) and A
// (Spaghetti) both 3/3; C (Cheese) 2/3 — grok-4.7-fast gave it the highest
// scores yet answered "no" on the groan, a self-contradiction recorded in
// panel-results.json. Groan votes break a panel-total tie.
const panelGroans: Record<string, number> = {
  C1: 3, // Spaghetti
  C2: 3, // Chair
  C4: 2, // Cheese
};

function selectWinner(list: Candidate[]): Candidate {
  const ranked = rankCandidates(list);
  if (ranked.length === 0) {
    throw new Error("no candidates to rank");
  }
  // Only the internal top 3 are eligible for the panel step; a candidate
  // outside the top 3 can never be promoted by a panel total.
  const top3 = ranked.slice(0, 3);
  let winner = top3[0];
  let bestPanel = -Infinity;
  let bestGroans = -Infinity;
  for (const c of top3) {
    const panel = panelTotals[c.id];
    const groans = panelGroans[c.id] ?? 0;
    if (
      panel !== undefined &&
      (panel > bestPanel || (panel === bestPanel && groans > bestGroans))
    ) {
      bestPanel = panel;
      bestGroans = groans;
      winner = c;
    }
  }
  return winner;
}

function main(): void {
  const winner = selectWinner(candidates);
  // Gate guard: the entry must be 1–200 characters, a single text, not only
  // white space — fail loudly instead of writing an invalid entry.
  if (winner.text.length < 1 || winner.text.length > 200 || winner.text.trim().length === 0) {
    throw new Error(`winning joke fails the gate (${winner.text.length} chars): ${JSON.stringify(winner.text)}`);
  }
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "entry.txt"), winner.text + "\n", "utf8");
}

main();
