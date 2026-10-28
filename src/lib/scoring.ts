import type { Database, ChipType } from "@/lib/database.types";

export type Player = Database["public"]["Tables"]["players"]["Row"];
export type PlayerStats = Database["public"]["Tables"]["player_gameweek_stats"]["Row"];
export type ScoringSettings = Database["public"]["Tables"]["scoring_settings"]["Row"];
export type TeamPick = Database["public"]["Tables"]["team_picks"]["Row"];

export interface PointsBreakdownLine {
  label: string;
  points: number;
}

export interface PlayerPointsResult {
  total: number;
  breakdown: PointsBreakdownLine[];
}

/** Pure per-player points calculation for one gameweek. Used everywhere points
 *  are shown so the UI, leaderboards, and the "tap a player" breakdown never drift apart. */
export function computePlayerPoints(
  stats: PlayerStats | null | undefined,
  scoring: ScoringSettings
): PlayerPointsResult {
  const breakdown: PointsBreakdownLine[] = [];
  if (!stats || !stats.played) {
    return { total: 0, breakdown: [{ label: "Did not play", points: 0 }] };
  }

  let total = 0;
  const add = (label: string, points: number) => {
    if (points !== 0) breakdown.push({ label, points });
    total += points;
  };

  add("Played", scoring.pts_played);

  if (stats.won_match) add("Won match", scoring.pts_won_match);

  if (stats.goals > 0) {
    add(`${stats.goals} goal${stats.goals > 1 ? "s" : ""}`, stats.goals * scoring.pts_goal);
    if (stats.goals >= 3) add("Hat-trick bonus", scoring.pts_hattrick_bonus);
  }

  if (stats.assists > 0) {
    add(`${stats.assists} assist${stats.assists > 1 ? "s" : ""}`, stats.assists * scoring.pts_assist);
  }

  if (stats.clean_sheet) {
    add("Clean sheet", scoring.pts_clean_sheet);
  }

  if (stats.saves > 0) {
    const bundles = Math.floor(stats.saves / scoring.saves_per_point);
    if (bundles > 0) add(`${stats.saves} saves`, bundles * scoring.pts_per_saves_bundle);
  }

  if (stats.goals_conceded > 0) {
    const bundles = Math.floor(stats.goals_conceded / scoring.conceded_per_point_penalty);
    if (bundles > 0) add(`${stats.goals_conceded} conceded`, bundles * scoring.pts_per_conceded_bundle);
  }

  if (stats.penalty_saved > 0) add("Penalty saved", stats.penalty_saved * scoring.pts_pen_saved);
  if (stats.penalty_missed > 0) add("Penalty missed", stats.penalty_missed * scoring.pts_pen_missed);
  if (stats.own_goals > 0) add("Own goal", stats.own_goals * scoring.pts_own_goal);
  if (stats.man_of_match) add("Man of the Match", scoring.pts_motm);

  return { total, breakdown };
}

export interface EffectivePick {
  pick: TeamPick;
  player: Player;
  rawPoints: number;
  /** points actually counted toward the team total, after auto-subs / captaincy / chips */
  countedPoints: number;
  playedInLineup: boolean; // true if this player's points count this gameweek
  isEffectiveCaptain: boolean;
  multiplier: number;
  subbedIn: boolean;
  subbedOut: boolean;
}

export interface TeamGameweekResult {
  rawTotal: number; // before transfer cost
  transferCost: number;
  total: number; // rawTotal - transferCost
  lineup: EffectivePick[];
  chip: ChipType | null;
}

/**
 * Resolves auto-subs, captaincy (with vice-captain fallback), and chip effects,
 * then sums the team's points for one gameweek.
 */
export function computeTeamGameweekPoints(
  picks: TeamPick[],
  playersById: Map<string, Player>,
  statsByPlayerId: Map<string, PlayerStats>,
  scoring: ScoringSettings,
  chip: ChipType | null,
  transferCost: number
): TeamGameweekResult {
  const rawPointsByPickId = new Map<string, number>();
  for (const pick of picks) {
    const stats = statsByPlayerId.get(pick.player_id);
    const { total } = computePlayerPoints(stats, scoring);
    rawPointsByPickId.set(pick.id, total);
  }

  const didPlay = (pick: TeamPick) => statsByPlayerId.get(pick.player_id)?.played === true;

  const starters = picks.filter((p) => p.is_starter);
  const subs = picks
    .filter((p) => !p.is_starter)
    .sort((a, b) => (a.sub_order ?? 99) - (b.sub_order ?? 99));

  const usedSubIds = new Set<string>();
  const lineupMap = new Map<string, EffectivePick>();

  for (const pick of picks) {
    const player = playersById.get(pick.player_id)!;
    lineupMap.set(pick.id, {
      pick,
      player,
      rawPoints: rawPointsByPickId.get(pick.id) ?? 0,
      countedPoints: 0,
      playedInLineup: false,
      isEffectiveCaptain: false,
      multiplier: 1,
      subbedIn: false,
      subbedOut: false,
    });
  }

  const benchBoostActive = chip === "bench_boost";

  if (benchBoostActive) {
    // Every one of the 8 picks counts; no auto-subs needed.
    for (const pick of picks) {
      const entry = lineupMap.get(pick.id)!;
      entry.playedInLineup = true;
      entry.countedPoints = entry.rawPoints;
    }
  } else {
    // Normal path: 6 starters count, with auto-subs for any starter who didn't play.
    for (const starter of starters) {
      const entry = lineupMap.get(starter.id)!;
      if (didPlay(starter)) {
        entry.playedInLineup = true;
        entry.countedPoints = entry.rawPoints;
        continue;
      }
      // find first eligible (played), unused sub, in bench order
      const eligibleSub = subs.find((s) => !usedSubIds.has(s.id) && didPlay(s));
      if (eligibleSub) {
        usedSubIds.add(eligibleSub.id);
        const subEntry = lineupMap.get(eligibleSub.id)!;
        subEntry.playedInLineup = true;
        subEntry.countedPoints = subEntry.rawPoints;
        subEntry.subbedIn = true;
        entry.subbedOut = true;
      }
      // if no eligible sub, starter contributes 0 and stays benched-equivalent
    }
  }

  // Captaincy: captain gets the multiplier if they played in the effective lineup,
  // otherwise it falls to the vice-captain if THEY played.
  const captainPick = picks.find((p) => p.is_captain);
  const vicePick = picks.find((p) => p.is_vice_captain);
  const multiplier = chip === "triple_captain" ? 3 : 2;

  let captainEntry: EffectivePick | undefined;
  if (captainPick) {
    const entry = lineupMap.get(captainPick.id)!;
    if (entry.playedInLineup) captainEntry = entry;
  }
  if (!captainEntry && vicePick) {
    const entry = lineupMap.get(vicePick.id)!;
    if (entry.playedInLineup) captainEntry = entry;
  }
  if (captainEntry) {
    captainEntry.isEffectiveCaptain = true;
    captainEntry.multiplier = multiplier;
    captainEntry.countedPoints = captainEntry.rawPoints * multiplier;
  }

  const rawTotal = Array.from(lineupMap.values()).reduce((sum, e) => sum + e.countedPoints, 0);

  return {
    rawTotal,
    transferCost,
    total: rawTotal - transferCost,
    lineup: Array.from(lineupMap.values()),
    chip,
  };
}
