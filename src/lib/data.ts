import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getProfile(supabase: SupabaseServerClient) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", auth.user.id).single();
  return profile ?? null;
}

export async function requireProfile(supabase: SupabaseServerClient) {
  const profile = await getProfile(supabase);
  if (!profile) throw new Error("Not authenticated");
  return profile;
}

export async function getLeagueSettings(supabase: SupabaseServerClient) {
  const { data } = await supabase.from("league_settings").select("*").eq("id", 1).single();
  return data!;
}

export async function getScoringSettings(supabase: SupabaseServerClient) {
  const { data } = await supabase.from("scoring_settings").select("*").eq("id", 1).single();
  return data!;
}

export async function getGameweeks(supabase: SupabaseServerClient) {
  const { data } = await supabase.from("gameweeks").select("*").order("number", { ascending: true });
  return data ?? [];
}

export async function getCurrentGameweek(supabase: SupabaseServerClient) {
  const settings = await getLeagueSettings(supabase);
  if (settings.current_gameweek_id) {
    const { data } = await supabase
      .from("gameweeks")
      .select("*")
      .eq("id", settings.current_gameweek_id)
      .single();
    if (data) return data;
  }
  const gameweeks = await getGameweeks(supabase);
  return gameweeks.find((g) => new Date(g.deadline) > new Date()) ?? gameweeks[gameweeks.length - 1] ?? null;
}

export async function getPlayers(supabase: SupabaseServerClient) {
  const { data } = await supabase.from("players").select("*").order("price", { ascending: false });
  return data ?? [];
}

export async function getPlayersMap(supabase: SupabaseServerClient) {
  const players = await getPlayers(supabase);
  return new Map(players.map((p) => [p.id, p]));
}

export async function getStatsForGameweek(supabase: SupabaseServerClient, gameweekId: string) {
  const { data } = await supabase
    .from("player_gameweek_stats")
    .select("*")
    .eq("gameweek_id", gameweekId);
  return new Map((data ?? []).map((s) => [s.player_id, s]));
}

export async function getTeamPicks(supabase: SupabaseServerClient, userId: string, gameweekId: string) {
  const { data } = await supabase
    .from("team_picks")
    .select("*")
    .eq("user_id", userId)
    .eq("gameweek_id", gameweekId);
  return data ?? [];
}

export async function getAllPicksForGameweek(supabase: SupabaseServerClient, gameweekId: string) {
  const { data } = await supabase.from("team_picks").select("*").eq("gameweek_id", gameweekId);
  return data ?? [];
}

export async function getAllProfiles(supabase: SupabaseServerClient) {
  const { data } = await supabase.from("profiles").select("*").order("team_name", { ascending: true });
  return data ?? [];
}

export async function getTransferCosts(supabase: SupabaseServerClient, gameweekId: string) {
  const { data } = await supabase
    .from("gameweek_transfer_cost")
    .select("*")
    .eq("gameweek_id", gameweekId);
  return new Map((data ?? []).map((c) => [c.user_id, c]));
}

export async function getChipsForGameweek(supabase: SupabaseServerClient, gameweekId: string) {
  const { data } = await supabase.from("chips_used").select("*").eq("gameweek_id", gameweekId);
  return new Map((data ?? []).map((c) => [c.user_id, c.chip_type]));
}

export async function getMyChips(supabase: SupabaseServerClient, userId: string) {
  const { data } = await supabase.from("chips_used").select("*").eq("user_id", userId);
  return data ?? [];
}

export async function getMyTransferBank(supabase: SupabaseServerClient, userId: string) {
  const { data } = await supabase.from("transfer_bank").select("*").eq("user_id", userId).single();
  return data ?? { user_id: userId, free_transfers: 1 };
}

export async function getLastPicksGameweek(
  supabase: SupabaseServerClient,
  userId: string,
  beforeGameweekNumber: number
) {
  const { data } = await supabase
    .from("team_picks")
    .select("gameweek_id, gameweeks!inner(number)")
    .eq("user_id", userId)
    .lt("gameweeks.number", beforeGameweekNumber)
    .order("gameweeks(number)", { ascending: false })
    .limit(1);
  type Row = { gameweek_id: string };
  const rows = (data ?? []) as unknown as Row[];
  return rows[0]?.gameweek_id ?? null;
}

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Gameweek = Database["public"]["Tables"]["gameweeks"]["Row"];

/**
 * The squad to show in an editor for `gameweek`: picks already saved for it,
 * or (if none yet) the most recent earlier gameweek's squad as a starting template.
 */
export async function getSquadForEditing(
  supabase: SupabaseServerClient,
  userId: string,
  gameweek: Gameweek
) {
  const existing = await getTeamPicks(supabase, userId, gameweek.id);
  if (existing.length > 0) {
    return { picks: existing, isSavedForThisGameweek: true, hasAnySquad: true };
  }

  const { data: priorGameweeks } = await supabase
    .from("gameweeks")
    .select("id, number")
    .lt("number", gameweek.number)
    .order("number", { ascending: false });

  for (const prior of priorGameweeks ?? []) {
    const priorPicks = await getTeamPicks(supabase, userId, prior.id);
    if (priorPicks.length > 0) {
      return { picks: priorPicks, isSavedForThisGameweek: false, hasAnySquad: true };
    }
  }

  return { picks: [], isSavedForThisGameweek: false, hasAnySquad: false };
}
