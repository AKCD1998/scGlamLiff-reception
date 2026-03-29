import "dotenv/config";
import { query, pool } from "../src/db.js";
import { APPOINTMENT_ADDON_OPTIONS } from "../../shared/appointmentAddonCatalog.js";

const statements = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `
    CREATE TABLE IF NOT EXISTS public.appointment_addons (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
      topping_code text NOT NULL REFERENCES public.toppings(code),
      addon_kind text NOT NULL,
      amount_thb integer NOT NULL DEFAULT 0,
      customer_package_id uuid REFERENCES public.customer_packages(id),
      package_mask_deducted boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT appointment_addons_amount_thb_check CHECK (amount_thb >= 0),
      CONSTRAINT appointment_addons_addon_kind_check
        CHECK (addon_kind IN ('package_mask_included', 'paid_topping'))
    );
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS appointment_addons_appointment_id_idx
    ON public.appointment_addons (appointment_id);
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_addons_customer_package_id_idx
    ON public.appointment_addons (customer_package_id);
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_addons_topping_code_idx
    ON public.appointment_addons (topping_code);
  `,
];

async function ensureCanonicalToppings() {
  for (const option of APPOINTMENT_ADDON_OPTIONS) {
    await query(
      `
        INSERT INTO public.toppings (
          id,
          code,
          category,
          title_th,
          title_en,
          price_thb,
          is_active,
          created_at
        )
        VALUES (
          gen_random_uuid(),
          $1,
          $2,
          $3,
          $4,
          $5,
          true,
          now()
        )
        ON CONFLICT (code)
        DO UPDATE SET
          category = EXCLUDED.category,
          title_th = EXCLUDED.title_th,
          title_en = EXCLUDED.title_en,
          price_thb = EXCLUDED.price_thb,
          is_active = true
      `,
      [
        option.code,
        option.category,
        option.title_th,
        option.title_en,
        option.price_thb,
      ]
    );
  }
}

async function run() {
  try {
    for (const sql of statements) {
      await query(sql);
    }
    await ensureCanonicalToppings();
    console.log("appointment_addons schema ensured.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
