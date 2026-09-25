export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      batches: {
        Row: {
          actual_yield: number | null
          business_id: string
          created_at: string
          id: string
          ingredient_cost_kobo: number
          logged_by: string | null
          packaging_kobo: number
          recipe_id: string
          scale_factor: number
          utilities_kobo: number
        }
        Insert: {
          actual_yield?: number | null
          business_id: string
          created_at?: string
          id?: string
          ingredient_cost_kobo?: number
          logged_by?: string | null
          packaging_kobo?: number
          recipe_id: string
          scale_factor?: number
          utilities_kobo?: number
        }
        Update: {
          actual_yield?: number | null
          business_id?: string
          created_at?: string
          id?: string
          ingredient_cost_kobo?: number
          logged_by?: string | null
          packaging_kobo?: number
          recipe_id?: string
          scale_factor?: number
          utilities_kobo?: number
        }
        Relationships: [
          {
            foreignKeyName: "batches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          created_at: string
          currency: string
          id: string
          name: string
          region_profile: string | null
          target_margin_bps: number
        }
        Insert: {
          created_at?: string
          currency?: string
          id: string
          name: string
          region_profile?: string | null
          target_margin_bps?: number
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          name?: string
          region_profile?: string | null
          target_margin_bps?: number
        }
        Relationships: []
      }
      cash_drawers: {
        Row: {
          business_id: string
          closed_at: string | null
          closing_counted_kobo: number | null
          discrepancy_kobo: number | null
          expected_cash_kobo: number | null
          id: string
          opened_at: string
          opened_by: string | null
          opening_float_kobo: number
          status: string
        }
        Insert: {
          business_id: string
          closed_at?: string | null
          closing_counted_kobo?: number | null
          discrepancy_kobo?: number | null
          expected_cash_kobo?: number | null
          id?: string
          opened_at?: string
          opened_by?: string | null
          opening_float_kobo?: number
          status?: string
        }
        Update: {
          business_id?: string
          closed_at?: string | null
          closing_counted_kobo?: number | null
          discrepancy_kobo?: number | null
          expected_cash_kobo?: number | null
          id?: string
          opened_at?: string
          opened_by?: string | null
          opening_float_kobo?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_drawers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_deposits: {
        Row: {
          business_id: string
          created_at: string
          customer_name: string
          deposit_kobo: number
          event_date: string | null
          id: string
          items_summary: string | null
          phone: string | null
          settled: boolean
          total_contract_kobo: number
        }
        Insert: {
          business_id: string
          created_at?: string
          customer_name: string
          deposit_kobo?: number
          event_date?: string | null
          id?: string
          items_summary?: string | null
          phone?: string | null
          settled?: boolean
          total_contract_kobo?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          customer_name?: string
          deposit_kobo?: number
          event_date?: string | null
          id?: string
          items_summary?: string | null
          phone?: string | null
          settled?: boolean
          total_contract_kobo?: number
        }
        Relationships: [
          {
            foreignKeyName: "catering_deposits_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_payouts: {
        Row: {
          business_id: string
          channel: string
          commission_kobo: number
          created_at: string
          gross_sales_kobo: number
          id: string
          net_payout_kobo: number
        }
        Insert: {
          business_id: string
          channel: string
          commission_kobo?: number
          created_at?: string
          gross_sales_kobo?: number
          id?: string
          net_payout_kobo?: number
        }
        Update: {
          business_id?: string
          channel?: string
          commission_kobo?: number
          created_at?: string
          gross_sales_kobo?: number
          id?: string
          net_payout_kobo?: number
        }
        Relationships: [
          {
            foreignKeyName: "channel_payouts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_credits: {
        Row: {
          amount_kobo: number
          business_id: string
          created_at: string
          customer_name: string
          id: string
          phone: string | null
          settled: boolean
        }
        Insert: {
          amount_kobo?: number
          business_id: string
          created_at?: string
          customer_name: string
          id?: string
          phone?: string | null
          settled?: boolean
        }
        Update: {
          amount_kobo?: number
          business_id?: string
          created_at?: string
          customer_name?: string
          id?: string
          phone?: string | null
          settled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "customer_credits_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          base_unit: string
          business_id: string
          category: string | null
          created_at: string
          current_cost_kobo: number
          id: string
          min_threshold_qty: number
          name: string
          previous_cost_kobo: number
          stock_base_qty: number
          supplier: string | null
        }
        Insert: {
          base_unit: string
          business_id: string
          category?: string | null
          created_at?: string
          current_cost_kobo?: number
          id?: string
          min_threshold_qty?: number
          name: string
          previous_cost_kobo?: number
          stock_base_qty?: number
          supplier?: string | null
        }
        Update: {
          base_unit?: string
          business_id?: string
          category?: string | null
          created_at?: string
          current_cost_kobo?: number
          id?: string
          min_threshold_qty?: number
          name?: string
          previous_cost_kobo?: number
          stock_base_qty?: number
          supplier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      margin_flags: {
        Row: {
          acknowledged: boolean
          business_id: string
          created_at: string
          flag_type: string
          id: string
          message: string | null
          recipe_id: string | null
          role: string | null
          severity: string | null
        }
        Insert: {
          acknowledged?: boolean
          business_id: string
          created_at?: string
          flag_type: string
          id?: string
          message?: string | null
          recipe_id?: string | null
          role?: string | null
          severity?: string | null
        }
        Update: {
          acknowledged?: boolean
          business_id?: string
          created_at?: string
          flag_type?: string
          id?: string
          message?: string | null
          recipe_id?: string | null
          role?: string | null
          severity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "margin_flags_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "margin_flags_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          business_id: string
          created_at: string
          id: string
          order_id: string
          quantity: number
          recipe_id: string
          unit_price_kobo: number
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          order_id: string
          quantity: number
          recipe_id: string
          unit_price_kobo: number
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          order_id?: string
          quantity?: number
          recipe_id?: string
          unit_price_kobo?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          business_id: string
          channel: string | null
          created_at: string
          created_by: string | null
          id: string
          price_tier: string | null
          status: string
          subtotal_kobo: number
          total_kobo: number
        }
        Insert: {
          business_id: string
          channel?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          price_tier?: string | null
          status?: string
          subtotal_kobo?: number
          total_kobo?: number
        }
        Update: {
          business_id?: string
          channel?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          price_tier?: string | null
          status?: string
          subtotal_kobo?: number
          total_kobo?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      price_decisions: {
        Row: {
          business_id: string
          created_at: string
          decided_by: string | null
          decision: string | null
          id: string
          previous_price_kobo: number | null
          recipe_id: string | null
          suggested_price_kobo: number | null
        }
        Insert: {
          business_id: string
          created_at?: string
          decided_by?: string | null
          decision?: string | null
          id?: string
          previous_price_kobo?: number | null
          recipe_id?: string | null
          suggested_price_kobo?: number | null
        }
        Update: {
          business_id?: string
          created_at?: string
          decided_by?: string | null
          decision?: string | null
          id?: string
          previous_price_kobo?: number | null
          recipe_id?: string | null
          suggested_price_kobo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "price_decisions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_decisions_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          business_id: string
          id: string
          ingredient_id: string
          market_unit: string
          payment_method: string | null
          qty: number
          recorded_at: string
          recorded_by: string | null
          total_kobo: number
        }
        Insert: {
          business_id: string
          id?: string
          ingredient_id: string
          market_unit: string
          payment_method?: string | null
          qty: number
          recorded_at?: string
          recorded_by?: string | null
          total_kobo: number
        }
        Update: {
          business_id?: string
          id?: string
          ingredient_id?: string
          market_unit?: string
          payment_method?: string | null
          qty?: number
          recorded_at?: string
          recorded_by?: string | null
          total_kobo?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchases_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_items: {
        Row: {
          business_id: string
          created_at: string
          id: string
          ingredient_id: string
          quantity: number
          recipe_id: string
          unit: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          ingredient_id: string
          quantity: number
          recipe_id: string
          unit: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          ingredient_id?: string
          quantity?: number
          recipe_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          business_id: string
          category: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          selling_price_kobo: number
          yield_portions: number
        }
        Insert: {
          business_id: string
          category?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          selling_price_kobo?: number
          yield_portions?: number
        }
        Update: {
          business_id?: string
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          selling_price_kobo?: number
          yield_portions?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_users: {
        Row: {
          business_id: string
          created_at: string
          display_name: string
          email: string | null
          failed_attempts: number
          id: string
          is_active: boolean
          locked_until: number
          phone: string | null
          pin_hash: string | null
          pin_salt: string | null
          role: string
        }
        Insert: {
          business_id: string
          created_at?: string
          display_name: string
          email?: string | null
          failed_attempts?: number
          id?: string
          is_active?: boolean
          locked_until?: number
          phone?: string | null
          pin_hash?: string | null
          pin_salt?: string | null
          role: string
        }
        Update: {
          business_id?: string
          created_at?: string
          display_name?: string
          email?: string | null
          failed_attempts?: number
          id?: string
          is_active?: boolean
          locked_until?: number
          phone?: string | null
          pin_hash?: string | null
          pin_salt?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_users_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_conversions: {
        Row: {
          base_qty: number
          business_id: string
          created_at: string
          id: string
          ingredient_id: string
          market_unit: string
        }
        Insert: {
          base_qty: number
          business_id: string
          created_at?: string
          id?: string
          ingredient_id: string
          market_unit: string
        }
        Update: {
          base_qty?: number
          business_id?: string
          created_at?: string
          id?: string
          ingredient_id?: string
          market_unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_conversions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_conversions_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      wastage_logs: {
        Row: {
          business_id: string
          cost_kobo: number
          created_at: string
          id: string
          ingredient_id: string
          logged_by: string | null
          qty: number
          reason: string | null
          unit: string
        }
        Insert: {
          business_id: string
          cost_kobo?: number
          created_at?: string
          id?: string
          ingredient_id: string
          logged_by?: string | null
          qty: number
          reason?: string | null
          unit: string
        }
        Update: {
          business_id?: string
          cost_kobo?: number
          created_at?: string
          id?: string
          ingredient_id?: string
          logged_by?: string | null
          qty?: number
          reason?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "wastage_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wastage_logs_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
