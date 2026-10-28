import { createClient } from "@/lib/supabase/server";
import { computeTeamGameweekPoints, type Player, type ScoringSettings, type TeamPick } from "@/lib/scoring";
import type { ChipType } from "@/lib/database.types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface TeamGameweekRow {
  userId: string;
  teamName: string;
  gwPoints: number;
  transferCost: number;
  totalPoints: number;
  chip: ChipType | null;
}

export interface TeamOverallRow {
  userId: string;
  teamName: string;
  totalPoints: number;
  rank: number;
}

export interface PlayerPointsRow {
  playerId: string;
  name: string;
  price: number;
  points: number;
}

async function loadBaseData(supabase: SupabaseServerClient) {
  const [{ data: players }, { data: scoring }, { data: profiles }] = await Promise.all([
    supabase.from("players").select("*"),
    supabase.from("scoring_settings").select("*").eq("id", 1).single(),
    supabase.from("profiles").select("*"),
  ]);
  return {
    playersById: new Map((players ?? []).map((p) => [p.id, p])),
    players: players ?? [],
    scoring: scoring as ScoringSettings,
    profiles: profiles ?? [],
  };
}

async function loadGameweekRawData(supabase: SupabaseServerClient, gameweekId: string) {
  const [{ data: picks }, { data: stats }, { data: chips }, { data: costs }] = await Promise.all([
    supabase.from("team_picks").select("*").eq("gameweek_id", gameweekId),
    supabase.from("player_gameweek_stats").select("*").eq("gameweek_id", gameweekId),
    supabase.from("chips_used").select("*").eq("gameweek_id", gameweekId),
    supabase.from("gameweek_transfer_cost").select("*").eq("gameweek_id", gameweekId),
  ]);
  return {
    picks: (picks ?? []) as TeamPick[],
    statsByPlayerId: new Map((stats ?? []).map((s) => [s.player_id, s])),
    chipByUser: new Map((chips ?? []).map((c) => [c.user_id, c.chip_type as ChipType])),
    costByUser: new Map((costs ?? []).map((c) => [c.user_id, c.cost])),
  };
}

export async function computeGameweekLeaderboard(
  supabase: SupabaseServerClient,
  gameweekId: string
): Promise<TeamGameweekRow[]> {
  const { playersById, scoring, profiles } = await loadBaseData(supabase);
  const { picks, statsByPlayerId, chipByUser, costByUser } = await loadGameweekRawData(supabase, gameweekId);

  const picksByUser = new Map<string, TeamPick[]>();
  for (const pick of picks) {
    const arr = picksByUser.get(pick.user_id) ?? [];
    arr.push(pick);
    picksByUser.set(pick.user_id, arr);
  }

  const rows: TeamGameweekRow[] = [];
  for (const profile of profiles) {
    const userPicks = picksByUser.get(profile.id);
    if (!userPicks || userPicks.length === 0) {
      rows.push({ userId: profile.id, teamName: profile.team_name, gwPoints: 0, transferCost: 0, totalPoints: 0, chip: null });
      continue;
    }
    const chip = chipByUser.get(profile.id) ?? null;
    const cost = costByUser.get(profile.id) ?? 0;
    const result = computeTeamGameweekPoints(userPicks, playersById as Map<string, Player>, statsByPlayerId, scoring, chip, cost);
    rows.push({
      userId: profile.id,
      teamName: profile.team_name,
      gwPoints: result.rawTotal,
      transferCost: cost,
      totalPoints: result.total,
      chip,
    });
  }

  return rows.sort((a, b) => b.totalPoints - a.totalPoints);
}

export async function computeOverallLeaderboard(
  supabase: SupabaseServerClient,
  uptoGameweekNumber?: number
): Promise<TeamOverallRow[]> {
  const { data: gameweeks } = await supabase.from("gameweeks").select("*").eq("is_scored", true).order("number");
  const scored = (gameweeks ?? []).filter((g) => !uptoGameweekNumber || g.number <= uptoGameweekNumber);

  const { profiles } = await loadBaseData(supabase);
  const totals = new Map<string, number>(profiles.map((p) => [p.id, 0]));

  for (const gw of scored) {
    const rows = await computeGameweekLeaderboard(supabase, gw.id);
    for (const row of rows) {
      totals.set(row.userId, (totals.get(row.userId) ?? 0) + row.totalPoints);
    }
  }

  const ranked = profiles
    .map((p) => ({ userId: p.id, teamName: p.team_name, totalPoints: totals.get(p.id) ?? 0 }))
    .sort((a, b) => b.totalPoints - a.totalPoints);

  return ranked.map((r, i) => ({ ...r, rank: i + 1 }));
}

export async function computeTopPlayersForGameweek(
  supabase: SupabaseServerClient,
  gameweekId: string
): Promise<PlayerPointsRow[]> {
  const { players, scoring } = await loadBaseData(supabase);
  const { statsByPlayerId } = await loadGameweekRawData(supabase, gameweekId);
  const { computePlayerPoints } = await import("@/lib/scoring");

  return players
    .map((p) => ({
      playerId: p.id,
      name: p.name,
      price: p.price,
      points: computePlayerPoints(statsByPlayerId.get(p.id), scoring).total,
    }))
    .sort((a, b) => b.points - a.points);
}

export async function computeTopPlayersOverall(supabase: SupabaseServerClient): Promise<PlayerPointsRow[]> {
  const { data: gameweeks } = await supabase.from("gameweeks").select("*").eq("is_scored", true);
  const { players, scoring } = await loadBaseData(supabase);
  const { computePlayerPoints } = await import("@/lib/scoring");

  const totals = new Map<string, number>(players.map((p) => [p.id, 0]));
  for (const gw of gameweeks ?? []) {
    const { statsByPlayerId } = await loadGameweekRawData(supabase, gw.id);
    for (const p of players) {
      const pts = computePlayerPoints(statsByPlayerId.get(p.id), scoring).total;
      totals.set(p.id, (totals.get(p.id) ?? 0) + pts);
    }
  }

  return players
    .map((p) => ({ playerId: p.id, name: p.name, price: p.price, points: totals.get(p.id) ?? 0 }))
    .sort((a, b) => b.points - a.points);
}

/** Overall rank as of each scored gameweek, keyed by userId -> rank at that checkpoint. */
export async function computeRankHistory(supabase: SupabaseServerClient) {
  const { data: gameweeks } = await supabase.from("gameweeks").select("*").eq("is_scored", true).order("number");
  const scored = gameweeks ?? [];
  const history: { number: number; ranks: Map<string, number> }[] = [];

  for (const gw of scored) {
    const overall = await computeOverallLeaderboard(supabase, gw.number);
    history.push({ number: gw.number, ranks: new Map(overall.map((r) => [r.userId, r.rank])) });
  }

  return history;
}
