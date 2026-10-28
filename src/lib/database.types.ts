// Hand-authored to mirror supabase/schema.sql. If you prefer generated types,
// run: npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts

export type ChipType = "wildcard" | "bench_boost" | "triple_captain";

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<
        { id: string; email: string; team_name: string; is_admin: boolean; created_at: string },
        { id: string; email: string; team_name?: string; is_admin?: boolean; created_at?: string }
      >;
      players: Table<
        { id: string; name: string; price: number; created_at: string },
        { id?: string; name: string; price: number; created_at?: string }
      >;
      league_settings: Table<
        {
          id: number;
          invite_token: string;
          budget_total: number;
          squad_size: number;
          starters_count: number;
          current_gameweek_id: string | null;
        },
        {
          id?: number;
          invite_token?: string;
          budget_total?: number;
          squad_size?: number;
          starters_count?: number;
          current_gameweek_id?: string | null;
        }
      >;
      scoring_settings: Table<
        {
          id: number;
          pts_played: number;
          pts_won_match: number;
          pts_goal: number;
          pts_hattrick_bonus: number;
          pts_assist: number;
          pts_clean_sheet: number;
          saves_per_point: number;
          pts_per_saves_bundle: number;
          pts_pen_saved: number;
          conceded_per_point_penalty: number;
          pts_per_conceded_bundle: number;
          pts_pen_missed: number;
          pts_own_goal: number;
          pts_motm: number;
          transfer_hit_cost: number;
        },
        Partial<{
          id: number;
          pts_played: number;
          pts_won_match: number;
          pts_goal: number;
          pts_hattrick_bonus: number;
          pts_assist: number;
          pts_clean_sheet: number;
          saves_per_point: number;
          pts_per_saves_bundle: number;
          pts_pen_saved: number;
          conceded_per_point_penalty: number;
          pts_per_conceded_bundle: number;
          pts_pen_missed: number;
          pts_own_goal: number;
          pts_motm: number;
          transfer_hit_cost: number;
        }>
      >;
      gameweeks: Table<
        { id: string; number: number; deadline: string; is_scored: boolean; created_at: string },
        { id?: string; number: number; deadline: string; is_scored?: boolean; created_at?: string }
      >;
      player_gameweek_stats: Table<
        {
          id: string;
          player_id: string;
          gameweek_id: string;
          played: boolean;
          goals: number;
          assists: number;
          clean_sheet: boolean;
          saves: number;
          goals_conceded: number;
          penalty_saved: number;
          penalty_missed: number;
          own_goals: number;
          won_match: boolean;
          man_of_match: boolean;
        },
        {
          id?: string;
          player_id: string;
          gameweek_id: string;
          played?: boolean;
          goals?: number;
          assists?: number;
          clean_sheet?: boolean;
          saves?: number;
          goals_conceded?: number;
          penalty_saved?: number;
          penalty_missed?: number;
          own_goals?: number;
          won_match?: boolean;
          man_of_match?: boolean;
        }
      >;
      team_picks: Table<
        {
          id: string;
          user_id: string;
          gameweek_id: string;
          player_id: string;
          is_starter: boolean;
          sub_order: number | null;
          is_captain: boolean;
          is_vice_captain: boolean;
        },
        {
          id?: string;
          user_id: string;
          gameweek_id: string;
          player_id: string;
          is_starter?: boolean;
          sub_order?: number | null;
          is_captain?: boolean;
          is_vice_captain?: boolean;
        }
      >;
      transfers: Table<
        {
          id: string;
          user_id: string;
          gameweek_id: string;
          player_out_id: string | null;
          player_in_id: string | null;
          is_hit: boolean;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          gameweek_id: string;
          player_out_id?: string | null;
          player_in_id?: string | null;
          is_hit?: boolean;
          created_at?: string;
        }
      >;
      chips_used: Table<
        { id: string; user_id: string; chip_type: ChipType; gameweek_id: string; used_at: string },
        { id?: string; user_id: string; chip_type: ChipType; gameweek_id: string; used_at?: string }
      >;
      transfer_bank: Table<
        { user_id: string; free_transfers: number },
        { user_id: string; free_transfers?: number }
      >;
      gameweek_transfer_cost: Table<
        { user_id: string; gameweek_id: string; transfers_made: number; hits: number; cost: number },
        {
          user_id: string;
          gameweek_id: string;
          transfers_made?: number;
          hits?: number;
          cost?: number;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      submit_team_picks: {
        Args: { p_gameweek_id: string; p_picks: unknown; p_chip?: string | null };
        Returns: { ok: boolean; transfers_made: number; hits: number; cost: number };
      };
      admin_advance_gameweek: {
        Args: { p_closing_gameweek_id: string; p_new_current_gameweek_id: string };
        Returns: undefined;
      };
      regenerate_invite_token: {
        Args: Record<string, never>;
        Returns: string;
      };
      validate_invite: {
        Args: { p_token: string };
        Returns: boolean;
      };
      is_admin: { Args: Record<string, never>; Returns: boolean };
    };
  };
}
