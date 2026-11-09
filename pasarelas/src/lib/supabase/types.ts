import type { Database as Generated } from "./database.types";

/**
 * El tipo de la base que usan los clientes de Supabase del proyecto.
 *
 * Es el generado (`npm run db:types` → database.types.ts) con un solo ajuste: al ESCRIBIR, las columnas de
 * dinero y de porcentaje aceptan cadenas decimales ("90.30", "2.9"). El generador las declara `number`, y el
 * dinero nunca pasa por `number`: PostgREST recibe la cadena y Postgres la convierte a `numeric` sin perder nada.
 *
 * Al LEER, esas columnas se piden con `::text` (`select("id, net_amount::text")`) y llegan como cadena.
 */
type DecimalColumn =
  | "pct"
  | "fixed"
  | "platform_fee_pct"
  | "platform_fee_fixed"
  | "dispute_fee"
  | "amount"
  | "gross_original"
  | "refunded_amount"
  | "gross_amount"
  | "fees_total"
  | "net_amount"
  | "alloc_base_amount";

type DecimalAsString<Row> = {
  [Column in keyof Row]: Column extends DecimalColumn ? Exclude<Row[Column], number> | string : Row[Column];
};

type PublicTables = Generated["public"]["Tables"];

export type Database = Omit<Generated, "public"> & {
  public: Omit<Generated["public"], "Tables"> & {
    Tables: {
      [Table in keyof PublicTables]: Omit<PublicTables[Table], "Insert" | "Update"> & {
        Insert: DecimalAsString<PublicTables[Table]["Insert"]>;
        Update: DecimalAsString<PublicTables[Table]["Update"]>;
      };
    };
  };
};

export type { Json } from "./database.types";
