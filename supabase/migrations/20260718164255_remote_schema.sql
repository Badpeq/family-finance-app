


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."fn_auto_apply_recurrentes"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_inserted INTEGER := 0;
  r          RECORD;
  v_mes_ini  DATE    := date_trunc('month', CURRENT_DATE)::DATE;
  v_mes_fin  DATE    := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::DATE;
BEGIN
  FOR r IN
    SELECT gr.id, gr.monto, gr.categoria, gr.descripcion, gr.dia_cobro
    FROM public.gastos_recurrentes gr
    WHERE gr.user_id    = p_user_id
      AND gr.activo     = true
      AND gr.mes_inicio <= v_mes_ini
      AND (gr.mes_fin IS NULL OR gr.mes_fin >= v_mes_ini)
      AND gr.dia_cobro  <= EXTRACT(DAY FROM CURRENT_DATE)
      -- Solo si NO existe ya una transacción vinculada en el mes actual
      AND NOT EXISTS (
        SELECT 1
        FROM public.transacciones t
        WHERE t.gastos_recurrentes_id = gr.id
          AND t.activo = true
          AND t.fecha >= v_mes_ini
          AND t.fecha  < v_mes_fin
      )
  LOOP
    INSERT INTO public.transacciones (
      user_id,
      tipo,
      monto,
      categoria,
      descripcion,
      metodo_pago,
      fecha,
      moneda,
      tipo_cambio,
      es_gasto_unico,
      gastos_recurrentes_id,
      fuente,
      activo
    ) VALUES (
      p_user_id,
      'gasto',
      r.monto,
      r.categoria,
      r.descripcion,
      'efectivo',
      -- Clamp al último día del mes si dia_cobro > días disponibles
      LEAST(
        (v_mes_ini + (r.dia_cobro - 1) * INTERVAL '1 day')::DATE,
        (v_mes_fin  - INTERVAL '1 day')::DATE
      ),
      'PEN',
      1.0,
      false,
      r.id,
      'auto_recurrente',
      true
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."fn_auto_apply_recurrentes"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_deuda_capas"("p_mes" "date") RETURNS TABLE("categoria" "text", "deuda_real" numeric, "deuda_presupuestada" numeric, "deuda_proyectada" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_uid        UUID  := auth.uid();
  v_inicio     DATE  := DATE_TRUNC('month', p_mes)::DATE;
  v_fin        DATE  := (DATE_TRUNC('month', p_mes) + INTERVAL '1 month - 1 day')::DATE;
  v_dias_mes   INT   := EXTRACT(DAY FROM v_fin)::INT;
  v_dias_trans INT;
BEGIN
  IF v_inicio = DATE_TRUNC('month', CURRENT_DATE)::DATE THEN
    v_dias_trans := GREATEST(1, EXTRACT(DAY FROM CURRENT_DATE)::INT);
  ELSE
    v_dias_trans := v_dias_mes;
  END IF;

  SET LOCAL row_security = off;

  RETURN QUERY
  WITH

  gastos_reales AS (
    SELECT
      t.categoria                                                            AS cat,
      SUM(CASE WHEN t.moneda = 'USD'
               THEN t.monto * COALESCE(t.tipo_cambio, 1)
               ELSE t.monto END)                                            AS total,
      SUM(CASE WHEN NOT COALESCE(t.es_gasto_unico, false)
               THEN CASE WHEN t.moneda = 'USD'
                         THEN t.monto * COALESCE(t.tipo_cambio, 1)
                         ELSE t.monto END
               ELSE 0 END)                                                  AS total_prorratable,
      SUM(CASE WHEN COALESCE(t.es_gasto_unico, false)
               THEN CASE WHEN t.moneda = 'USD'
                         THEN t.monto * COALESCE(t.tipo_cambio, 1)
                         ELSE t.monto END
               ELSE 0 END)                                                  AS total_unico
    FROM public.transacciones t
    WHERE t.user_id = v_uid
      AND t.tipo    = 'gasto'
      AND t.activo  = true
      AND t.fecha   >= v_inicio
      AND t.fecha   <= v_fin
    GROUP BY t.categoria
  ),

  recurrentes_pendientes AS (
    SELECT gr.categoria AS cat, SUM(gr.monto) AS total
    FROM public.gastos_recurrentes gr
    WHERE gr.user_id    = v_uid
      AND gr.mes_inicio <= v_inicio
      AND (gr.mes_fin IS NULL OR gr.mes_fin >= v_inicio)
      AND NOT EXISTS (
        SELECT 1 FROM public.transacciones t
        WHERE t.user_id = v_uid
          AND t.activo  = true
          AND t.fecha   >= v_inicio
          AND t.fecha   <= v_fin
          AND (
            t.gastos_recurrentes_id = gr.id
            OR (t.categoria = gr.categoria
                AND ABS(t.monto - gr.monto) < 0.01
                AND t.gastos_recurrentes_id IS NULL)
          )
      )
    GROUP BY gr.categoria
  ),

  cuotas_mes AS (
    SELECT cc.categoria AS cat, SUM(cc.monto_cuota) AS total
    FROM public.compras_cuotas cc
    WHERE cc.user_id    = v_uid
      AND cc.mes_inicio <= v_inicio
      AND (
        ( EXTRACT(YEAR  FROM v_inicio) - EXTRACT(YEAR  FROM cc.mes_inicio) ) * 12
        + EXTRACT(MONTH FROM v_inicio) - EXTRACT(MONTH FROM cc.mes_inicio)
      ) < cc.total_cuotas
    GROUP BY cc.categoria
  ),

  -- FIX: todos los SELECT usan alias de tabla para evitar ambigüedad con la
  --      variable de salida "categoria" declarada en RETURNS TABLE
  all_cats AS (
    SELECT g.cat FROM gastos_reales           g
    UNION
    SELECT r.cat FROM recurrentes_pendientes  r
    UNION
    SELECT c.cat FROM cuotas_mes              c
  )

  SELECT
    ac.cat                                                            AS categoria,
    COALESCE(gr.total, 0)                                             AS deuda_real,
    COALESCE(gr.total, 0)
      + COALESCE(rp.total, 0)
      + COALESCE(cm.total, 0)                                         AS deuda_presupuestada,
    ROUND(
      (COALESCE(gr.total_prorratable, 0) / v_dias_trans * v_dias_mes)
      + COALESCE(gr.total_unico, 0)
      + COALESCE(rp.total, 0)
      + COALESCE(cm.total, 0)
    , 2)                                                              AS deuda_proyectada

  FROM all_cats ac
  LEFT JOIN gastos_reales          gr ON gr.cat = ac.cat
  LEFT JOIN recurrentes_pendientes rp ON rp.cat = ac.cat
  LEFT JOIN cuotas_mes             cm ON cm.cat = ac.cat
  ORDER BY 4 DESC NULLS LAST;   -- ordinal para evitar ambigüedad con var de salida
END;
$$;


ALTER FUNCTION "public"."fn_deuda_capas"("p_mes" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_reduce_deuda_on_pago"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  SET LOCAL row_security = off;
  UPDATE public.tarjetas_credito
    SET deuda_actual = GREATEST(0, deuda_actual - NEW.monto)
    WHERE id = NEW.tarjeta_id;
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."fn_reduce_deuda_on_pago"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_reduce_saldo_on_abono"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  SET LOCAL row_security = off;
  UPDATE public.prestamos
    SET saldo_pendiente = GREATEST(0, saldo_pendiente - NEW.monto),
        cuotas_pagadas  = cuotas_pagadas + 1
    WHERE id = NEW.prestamo_id;
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."fn_reduce_saldo_on_abono"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_reverse_on_deactivate"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  SET LOCAL row_security = off;

  IF OLD.activo = true AND NEW.activo = false THEN

    IF OLD.categoria = 'Pago Tarjeta' AND OLD.tarjeta_id IS NOT NULL THEN
      UPDATE public.tarjetas_credito
        SET deuda_actual = deuda_actual + OLD.monto
        WHERE id = OLD.tarjeta_id;

    ELSIF OLD.categoria = 'Abono Préstamo' AND OLD.prestamo_id IS NOT NULL THEN
      UPDATE public.prestamos
        SET saldo_pendiente = saldo_pendiente + OLD.monto,
            cuotas_pagadas  = GREATEST(0, cuotas_pagadas - 1)
        WHERE id = OLD.prestamo_id;

    ELSIF OLD.categoria = 'Ahorro' AND OLD.cuenta_ahorro_id IS NOT NULL THEN
      UPDATE public.cuentas_ahorro
        SET saldo_actual = GREATEST(0, saldo_actual - OLD.monto)
        WHERE id = OLD.cuenta_ahorro_id;

    ELSIF OLD.categoria = 'Retiro Ahorro' AND OLD.cuenta_ahorro_id IS NOT NULL THEN
      UPDATE public.cuentas_ahorro
        SET saldo_actual = saldo_actual + OLD.monto
        WHERE id = OLD.cuenta_ahorro_id;

    ELSIF OLD.tipo = 'gasto' AND OLD.metodo_pago = 'tarjeta' AND OLD.tarjeta_id IS NOT NULL THEN
      UPDATE public.tarjetas_credito
        SET deuda_actual = GREATEST(0, deuda_actual - OLD.monto)
        WHERE id = OLD.tarjeta_id;
    END IF;

  END IF;
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."fn_reverse_on_deactivate"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_tx_from_abono_prestamo"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM public.prestamos WHERE id = NEW.prestamo_id;
  INSERT INTO public.transacciones
    (user_id, tipo, monto, categoria, descripcion, prestamo_id, fuente)
  VALUES
    (v_user_id, 'gasto', NEW.monto, 'Abono Préstamo',
     COALESCE(NEW.descripcion, 'Abono de préstamo'), NEW.prestamo_id, 'abono_prestamo')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."fn_tx_from_abono_prestamo"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_tx_from_ahorro"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.subtipo = 'abono' THEN
    INSERT INTO public.transacciones
      (user_id, tipo, monto, categoria, descripcion, cuenta_ahorro_id, fuente)
    VALUES
      (NEW.user_id, 'gasto', NEW.monto, 'Ahorro',
       COALESCE(NEW.descripcion, 'Abono a ahorro'), NEW.cuenta_ahorro_id, 'ahorro_abono')
    ON CONFLICT DO NOTHING;
  ELSIF NEW.subtipo = 'retiro' THEN
    INSERT INTO public.transacciones
      (user_id, tipo, monto, categoria, descripcion, cuenta_ahorro_id, fuente)
    VALUES
      (NEW.user_id, 'ingreso', NEW.monto, 'Retiro Ahorro',
       COALESCE(NEW.descripcion, 'Retiro de ahorro'), NEW.cuenta_ahorro_id, 'ahorro_retiro')
    ON CONFLICT DO NOTHING;
  -- subtipo = 'interes': no afecta cash, solo saldo de cuenta
  END IF;
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."fn_tx_from_ahorro"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_tx_from_pago_tarjeta"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.transacciones
    (user_id, tipo, monto, categoria, descripcion, metodo_pago, tarjeta_id, fuente)
  VALUES
    (NEW.user_id, 'gasto', NEW.monto, 'Pago Tarjeta',
     COALESCE(NEW.descripcion, 'Pago de tarjeta'), 'tarjeta', NEW.tarjeta_id, 'pago_tarjeta')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."fn_tx_from_pago_tarjeta"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_update_deuda_cuotas"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    IF NEW.metodo_pago = 'tarjeta' AND NEW.tarjeta_id IS NOT NULL THEN
        UPDATE public.tarjetas_credito
        SET deuda_actual = deuda_actual + NEW.monto_total
        WHERE id = NEW.tarjeta_id;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_update_deuda_cuotas"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_update_saldo_ahorro"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  SET LOCAL row_security = off;
  IF NEW.subtipo = 'abono' OR NEW.subtipo = 'interes' THEN
    UPDATE public.cuentas_ahorro
      SET saldo_actual = saldo_actual + NEW.monto
      WHERE id = NEW.cuenta_ahorro_id;
  ELSIF NEW.subtipo = 'retiro' THEN
    UPDATE public.cuentas_ahorro
      SET saldo_actual = GREATEST(0, saldo_actual - NEW.monto)
      WHERE id = NEW.cuenta_ahorro_id;
  END IF;
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."fn_update_saldo_ahorro"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_update_saldo_cuenta"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    IF NEW.cuenta_ahorro_id IS NOT NULL THEN
        IF NEW.subtipo IN ('abono', 'interes') THEN
            UPDATE public.cuentas_ahorro
            SET saldo_actual = saldo_actual + NEW.monto
            WHERE id = NEW.cuenta_ahorro_id;
        ELSIF NEW.subtipo = 'retiro' THEN
            UPDATE public.cuentas_ahorro
            SET saldo_actual = saldo_actual - NEW.monto
            WHERE id = NEW.cuenta_ahorro_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_update_saldo_cuenta"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Insertamos el ID y mapeamos el teléfono que viene del registro
  insert into public.profiles (id, celular)
  values (new.id, new.phone);
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ahorros_inversiones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "nombre" "text",
    "descripcion" "text",
    "monto" numeric(12,2) NOT NULL,
    "tipo" "text",
    "creado_en" timestamp without time zone DEFAULT "now"() NOT NULL,
    "subtipo" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "cuenta_ahorro_id" "uuid",
    "moneda_original" character varying(3) DEFAULT 'PEN'::character varying NOT NULL,
    "tipo_cambio" numeric(8,4) DEFAULT 1.0000 NOT NULL,
    CONSTRAINT "ahorros_inversiones_monto_check" CHECK (("monto" > (0)::numeric)),
    CONSTRAINT "ahorros_inversiones_subtipo_check" CHECK (("subtipo" = ANY (ARRAY['abono'::"text", 'retiro'::"text", 'interes'::"text"]))),
    CONSTRAINT "ahorros_inversiones_tipo_check" CHECK (("tipo" = ANY (ARRAY['ahorro'::"text", 'inversion'::"text"])))
);


ALTER TABLE "public"."ahorros_inversiones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categorias_personalizadas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "icono" "text" DEFAULT '📦'::"text" NOT NULL,
    "es_personalizada" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."categorias_personalizadas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compras_cuotas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "descripcion" "text" NOT NULL,
    "categoria" "text" NOT NULL,
    "monto_total" numeric(12,2) NOT NULL,
    "total_cuotas" integer NOT NULL,
    "cuota_actual" integer DEFAULT 1 NOT NULL,
    "monto_cuota" numeric(12,2) NOT NULL,
    "dia_cobro" integer NOT NULL,
    "mes_inicio" "date" NOT NULL,
    "creado_en" timestamp without time zone DEFAULT "now"() NOT NULL,
    "metodo_pago" "text" DEFAULT 'efectivo'::"text",
    "tarjeta_id" "uuid",
    CONSTRAINT "compras_cuotas_dia_cobro_check" CHECK ((("dia_cobro" >= 1) AND ("dia_cobro" <= 31))),
    CONSTRAINT "compras_cuotas_metodo_pago_check" CHECK (("metodo_pago" = ANY (ARRAY['efectivo'::"text", 'tarjeta'::"text"]))),
    CONSTRAINT "compras_cuotas_monto_total_check" CHECK (("monto_total" > (0)::numeric)),
    CONSTRAINT "compras_cuotas_total_cuotas_check" CHECK (("total_cuotas" >= 2))
);


ALTER TABLE "public"."compras_cuotas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cuentas_ahorro" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "nombre_cuenta" "text" NOT NULL,
    "saldo_actual" numeric(12,2) DEFAULT 0 NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"(),
    "moneda" character varying(3) DEFAULT 'PEN'::character varying NOT NULL
);


ALTER TABLE "public"."cuentas_ahorro" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gastos_recurrentes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "categoria" "text" NOT NULL,
    "descripcion" "text",
    "dia_cobro" integer NOT NULL,
    "mes_inicio" "date" NOT NULL,
    "mes_fin" "date",
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "gastos_recurrentes_dia_cobro_check" CHECK ((("dia_cobro" >= 1) AND ("dia_cobro" <= 31))),
    CONSTRAINT "gastos_recurrentes_monto_check" CHECK (("monto" > (0)::numeric))
);


ALTER TABLE "public"."gastos_recurrentes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ingest_tokens" (
    "token" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "descripcion" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ultimo_uso" timestamp with time zone
);


ALTER TABLE "public"."ingest_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."log_errores_ingesta" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text",
    "source" "text" NOT NULL,
    "raw_text" "text" NOT NULL,
    "error_tipo" "text" NOT NULL,
    "error_msg" "text",
    "parsed_partial" "jsonb",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."log_errores_ingesta" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nomina_boletas" (
    "id" "text" NOT NULL,
    "empleador_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "foto_firmada" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."nomina_boletas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nomina_empleadores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "nombre" "text" DEFAULT 'Mi hogar'::"text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "firmas" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."nomina_empleadores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nomina_trabajadores" (
    "id" "text" NOT NULL,
    "empleador_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."nomina_trabajadores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pagos_tarjeta" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tarjeta_id" "uuid" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "descripcion" "text",
    "creado_en" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pagos_tarjeta" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prestamos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "entidad_persona" "text" NOT NULL,
    "tipo" "text" NOT NULL,
    "monto_total" numeric(12,2) NOT NULL,
    "saldo_pendiente" numeric(12,2) NOT NULL,
    "descripcion" "text",
    "creado_en" timestamp with time zone DEFAULT "now"(),
    "cuotas_estimadas" integer,
    "cuotas_pagadas" integer DEFAULT 0 NOT NULL,
    "monto_mensual" numeric(12,2),
    CONSTRAINT "prestamos_tipo_check" CHECK (("tipo" = ANY (ARRAY['recibido'::"text", 'otorgado'::"text"])))
);


ALTER TABLE "public"."prestamos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prestamos_abonos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prestamo_id" "uuid" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "descripcion" "text",
    "creado_en" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."prestamos_abonos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."presupuestos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "categoria" "text" NOT NULL,
    "monto_limite" numeric(12,2) NOT NULL,
    "periodo" "date" NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"(),
    "seguimiento_diario" boolean DEFAULT false,
    CONSTRAINT "presupuestos_monto_limite_check" CHECK (("monto_limite" > (0)::numeric))
);


ALTER TABLE "public"."presupuestos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "celular" "text",
    "nombre" "text",
    "apellido" "text",
    "moneda_base" "text" DEFAULT 'PEN'::"text" NOT NULL,
    "perfil_completado" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ingreso_mensual" numeric,
    "presupuesto_template" "jsonb" DEFAULT '{}'::"jsonb",
    "modulo_ahorros" boolean DEFAULT false,
    "modulo_prestamos" boolean DEFAULT false,
    "modulo_tarjetas" boolean DEFAULT true
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subcategorias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "categoria_id" "uuid",
    "categoria_nombre" "text",
    "nombre" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "chk_subcategoria_cat" CHECK ((("categoria_id" IS NOT NULL) OR ("categoria_nombre" IS NOT NULL)))
);


ALTER TABLE "public"."subcategorias" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tarjetas_credito" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "banco" "text" NOT NULL,
    "nombre_tarjeta" "text" NOT NULL,
    "linea_credito" numeric(12,2) DEFAULT 0 NOT NULL,
    "deuda_actual" numeric(12,2) DEFAULT 0 NOT NULL,
    "dia_cierre" integer,
    "creado_en" timestamp with time zone DEFAULT "now"(),
    "moneda" character varying(3) DEFAULT 'PEN'::character varying NOT NULL,
    "ultimos_4" character varying(4),
    CONSTRAINT "tarjetas_credito_dia_cierre_check" CHECK ((("dia_cierre" >= 1) AND ("dia_cierre" <= 31)))
);


ALTER TABLE "public"."tarjetas_credito" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tipos_cambio" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fecha" "date" NOT NULL,
    "compra" numeric(8,4) NOT NULL,
    "venta" numeric(8,4) NOT NULL,
    "fuente" "text" DEFAULT 'api'::"text",
    "creado_en" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tipos_cambio" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transaccion_detalles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaccion_id" "uuid" NOT NULL,
    "producto" "text" NOT NULL,
    "cantidad" numeric DEFAULT 1 NOT NULL,
    "precio_unitario" numeric NOT NULL,
    "precio_total" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."transaccion_detalles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transacciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "categoria" "text" NOT NULL,
    "descripcion" "text",
    "creado_en" timestamp without time zone DEFAULT "now"() NOT NULL,
    "metodo_pago" "text" DEFAULT 'efectivo'::"text",
    "tarjeta_id" "uuid",
    "activo" boolean DEFAULT true NOT NULL,
    "prestamo_id" "uuid",
    "cuenta_ahorro_id" "uuid",
    "fuente" "text" DEFAULT 'manual'::"text",
    "moneda" character varying(3) DEFAULT 'PEN'::character varying NOT NULL,
    "tipo_cambio" numeric(8,4) DEFAULT 1.0000 NOT NULL,
    "fuente_raw" "text",
    "subcategoria_id" "uuid",
    "es_gasto_unico" boolean DEFAULT false NOT NULL,
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "gastos_recurrentes_id" "uuid",
    "compras_cuotas_id" "uuid",
    "estado" "text" DEFAULT 'MANUAL'::"text",
    CONSTRAINT "transacciones_estado_check" CHECK (("estado" = ANY (ARRAY['MANUAL'::"text", 'PENDIENTE_REVISION'::"text", 'PROCESADO'::"text"]))),
    CONSTRAINT "transacciones_metodo_pago_check" CHECK (("metodo_pago" = ANY (ARRAY['efectivo'::"text", 'tarjeta'::"text"]))),
    CONSTRAINT "transacciones_monto_check" CHECK (("monto" > (0)::numeric)),
    CONSTRAINT "transacciones_tipo_check" CHECK (("tipo" = ANY (ARRAY['ingreso'::"text", 'gasto'::"text"])))
);


ALTER TABLE "public"."transacciones" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_categorias" WITH ("security_invoker"='true') AS
 SELECT NULL::"uuid" AS "id",
    "auth"."uid"() AS "user_id",
    "b"."nombre",
    "b"."icono",
    false AS "es_personalizada",
    0 AS "sort_order"
   FROM ( VALUES ('Alimentación'::"text",'🛒'::"text"), ('Transporte'::"text",'🚗'::"text"), ('Vivienda'::"text",'🏠'::"text"), ('Entretenimiento'::"text",'🎬'::"text"), ('Salud'::"text",'💊'::"text"), ('Educación'::"text",'📚'::"text"), ('Ropa'::"text",'👕'::"text"), ('Servicios'::"text",'⚡'::"text"), ('Restaurantes'::"text",'🍽️'::"text"), ('Otros'::"text",'📦'::"text")) "b"("nombre", "icono")
  WHERE ("auth"."uid"() IS NOT NULL)
UNION ALL
 SELECT "cp"."id",
    "cp"."user_id",
    "cp"."nombre",
    "cp"."icono",
    "cp"."es_personalizada",
    1 AS "sort_order"
   FROM "public"."categorias_personalizadas" "cp"
  WHERE (("cp"."user_id" = "auth"."uid"()) AND ("cp"."nombre" <> ALL (ARRAY['Alimentación'::"text", 'Transporte'::"text", 'Vivienda'::"text", 'Entretenimiento'::"text", 'Salud'::"text", 'Educación'::"text", 'Ropa'::"text", 'Servicios'::"text", 'Restaurantes'::"text", 'Otros'::"text"])))
UNION ALL
 SELECT NULL::"uuid" AS "id",
    "p"."id" AS "user_id",
    "t"."key" AS "nombre",
    '📦'::"text" AS "icono",
    true AS "es_personalizada",
    2 AS "sort_order"
   FROM "public"."profiles" "p",
    LATERAL "jsonb_each_text"("p"."presupuesto_template") "t"("key", "value")
  WHERE (("p"."id" = "auth"."uid"()) AND ("t"."key" <> ALL (ARRAY['Alimentación'::"text", 'Transporte'::"text", 'Vivienda'::"text", 'Entretenimiento'::"text", 'Salud'::"text", 'Educación'::"text", 'Ropa'::"text", 'Servicios'::"text", 'Restaurantes'::"text", 'Otros'::"text"])) AND (NOT (EXISTS ( SELECT 1
           FROM "public"."categorias_personalizadas"
          WHERE (("categorias_personalizadas"."user_id" = "auth"."uid"()) AND ("categorias_personalizadas"."nombre" = "t"."key"))))));


ALTER VIEW "public"."v_categorias" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_gastos_programados_mes" WITH ("security_invoker"='true') AS
 SELECT "gr"."id",
    'recurrente'::"text" AS "tipo_programado",
    "gr"."descripcion",
    "gr"."categoria",
    "gr"."monto" AS "monto_cuota",
    "gr"."dia_cobro",
    (EXISTS ( SELECT 1
           FROM "public"."transacciones" "t"
          WHERE (("t"."gastos_recurrentes_id" = "gr"."id") AND ("t"."activo" = true) AND ("t"."fecha" >= ("date_trunc"('month'::"text", (CURRENT_DATE)::timestamp with time zone))::"date") AND ("t"."fecha" < (("date_trunc"('month'::"text", (CURRENT_DATE)::timestamp with time zone) + '1 mon'::interval))::"date")))) AS "aplicado"
   FROM "public"."gastos_recurrentes" "gr"
  WHERE (("gr"."user_id" = "auth"."uid"()) AND ("gr"."activo" = true) AND ("gr"."mes_inicio" <= ("date_trunc"('month'::"text", (CURRENT_DATE)::timestamp with time zone))::"date") AND (("gr"."mes_fin" IS NULL) OR ("gr"."mes_fin" >= ("date_trunc"('month'::"text", (CURRENT_DATE)::timestamp with time zone))::"date")))
UNION ALL
 SELECT "cc"."id",
    'cuota'::"text" AS "tipo_programado",
    "cc"."descripcion",
    "cc"."categoria",
    "cc"."monto_cuota",
    "cc"."dia_cobro",
    (("cc"."cuota_actual")::numeric >= ((((EXTRACT(year FROM CURRENT_DATE) - EXTRACT(year FROM "cc"."mes_inicio")) * (12)::numeric) + EXTRACT(month FROM CURRENT_DATE)) - EXTRACT(month FROM "cc"."mes_inicio"))) AS "aplicado"
   FROM "public"."compras_cuotas" "cc"
  WHERE (("cc"."user_id" = "auth"."uid"()) AND ("cc"."mes_inicio" <= CURRENT_DATE) AND ("cc"."cuota_actual" < "cc"."total_cuotas"));


ALTER VIEW "public"."v_gastos_programados_mes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_pendientes_clasificacion" AS
 SELECT "id",
    "user_id",
    "monto",
    "moneda",
    "descripcion",
    "categoria",
    "fecha",
    "fuente",
    "estado",
    "fuente_raw",
    "creado_en"
   FROM "public"."transacciones" "t"
  WHERE (("activo" = true) AND ("user_id" = "auth"."uid"()) AND (("categoria" = 'Por clasificar'::"text") OR ("estado" = 'PENDIENTE_REVISION'::"text")))
  ORDER BY "creado_en" DESC;


ALTER VIEW "public"."v_pendientes_clasificacion" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ahorros_inversiones"
    ADD CONSTRAINT "ahorros_inversiones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categorias_personalizadas"
    ADD CONSTRAINT "categorias_personalizadas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compras_cuotas"
    ADD CONSTRAINT "compras_cuotas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cuentas_ahorro"
    ADD CONSTRAINT "cuentas_ahorro_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gastos_recurrentes"
    ADD CONSTRAINT "gastos_recurrentes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingest_tokens"
    ADD CONSTRAINT "ingest_tokens_pkey" PRIMARY KEY ("token");



ALTER TABLE ONLY "public"."log_errores_ingesta"
    ADD CONSTRAINT "log_errores_ingesta_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nomina_boletas"
    ADD CONSTRAINT "nomina_boletas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nomina_empleadores"
    ADD CONSTRAINT "nomina_empleadores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nomina_trabajadores"
    ADD CONSTRAINT "nomina_trabajadores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pagos_tarjeta"
    ADD CONSTRAINT "pagos_tarjeta_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prestamos_abonos"
    ADD CONSTRAINT "prestamos_abonos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prestamos"
    ADD CONSTRAINT "prestamos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."presupuestos"
    ADD CONSTRAINT "presupuestos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."presupuestos"
    ADD CONSTRAINT "presupuestos_user_id_categoria_periodo_key" UNIQUE ("user_id", "categoria", "periodo");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_celular_key" UNIQUE ("celular");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subcategorias"
    ADD CONSTRAINT "subcategorias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tarjetas_credito"
    ADD CONSTRAINT "tarjetas_credito_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tipos_cambio"
    ADD CONSTRAINT "tipos_cambio_fecha_key" UNIQUE ("fecha");



ALTER TABLE ONLY "public"."tipos_cambio"
    ADD CONSTRAINT "tipos_cambio_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transaccion_detalles"
    ADD CONSTRAINT "transaccion_detalles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transacciones"
    ADD CONSTRAINT "transacciones_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_subcategorias_cat_id" ON "public"."subcategorias" USING "btree" ("categoria_id");



CREATE INDEX "idx_subcategorias_user" ON "public"."subcategorias" USING "btree" ("user_id");



CREATE INDEX "idx_tarjetas_ultimos_4" ON "public"."tarjetas_credito" USING "btree" ("user_id", "ultimos_4") WHERE ("ultimos_4" IS NOT NULL);



CREATE INDEX "idx_transacciones_estado" ON "public"."transacciones" USING "btree" ("user_id", "estado") WHERE ("estado" = 'PENDIENTE_REVISION'::"text");



CREATE INDEX "idx_tx_detalles_producto" ON "public"."transaccion_detalles" USING "btree" ("producto" "text_pattern_ops");



CREATE INDEX "idx_tx_detalles_transaccion_id" ON "public"."transaccion_detalles" USING "btree" ("transaccion_id");



CREATE INDEX "transacciones_user_fecha_idx" ON "public"."transacciones" USING "btree" ("user_id", "creado_en" DESC);



CREATE INDEX "transacciones_user_id_idx" ON "public"."transacciones" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "trg_deuda_cuotas" AFTER INSERT ON "public"."compras_cuotas" FOR EACH ROW EXECUTE FUNCTION "public"."fn_update_deuda_cuotas"();



CREATE OR REPLACE TRIGGER "trg_reduce_deuda_on_pago" AFTER INSERT ON "public"."pagos_tarjeta" FOR EACH ROW EXECUTE FUNCTION "public"."fn_reduce_deuda_on_pago"();



CREATE OR REPLACE TRIGGER "trg_reduce_saldo_on_abono" AFTER INSERT ON "public"."prestamos_abonos" FOR EACH ROW EXECUTE FUNCTION "public"."fn_reduce_saldo_on_abono"();



CREATE OR REPLACE TRIGGER "trg_reverse_on_deactivate" AFTER UPDATE OF "activo" ON "public"."transacciones" FOR EACH ROW EXECUTE FUNCTION "public"."fn_reverse_on_deactivate"();



CREATE OR REPLACE TRIGGER "trg_tx_from_abono_prestamo" AFTER INSERT ON "public"."prestamos_abonos" FOR EACH ROW EXECUTE FUNCTION "public"."fn_tx_from_abono_prestamo"();



CREATE OR REPLACE TRIGGER "trg_tx_from_ahorro" AFTER INSERT ON "public"."ahorros_inversiones" FOR EACH ROW EXECUTE FUNCTION "public"."fn_tx_from_ahorro"();



CREATE OR REPLACE TRIGGER "trg_tx_from_pago_tarjeta" AFTER INSERT ON "public"."pagos_tarjeta" FOR EACH ROW EXECUTE FUNCTION "public"."fn_tx_from_pago_tarjeta"();



CREATE OR REPLACE TRIGGER "trg_update_saldo_ahorro" AFTER INSERT ON "public"."ahorros_inversiones" FOR EACH ROW EXECUTE FUNCTION "public"."fn_update_saldo_ahorro"();



ALTER TABLE ONLY "public"."ahorros_inversiones"
    ADD CONSTRAINT "ahorros_inversiones_cuenta_ahorro_id_fkey" FOREIGN KEY ("cuenta_ahorro_id") REFERENCES "public"."cuentas_ahorro"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ahorros_inversiones"
    ADD CONSTRAINT "ahorros_inversiones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categorias_personalizadas"
    ADD CONSTRAINT "categorias_personalizadas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compras_cuotas"
    ADD CONSTRAINT "compras_cuotas_tarjeta_id_fkey" FOREIGN KEY ("tarjeta_id") REFERENCES "public"."tarjetas_credito"("id");



ALTER TABLE ONLY "public"."compras_cuotas"
    ADD CONSTRAINT "compras_cuotas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cuentas_ahorro"
    ADD CONSTRAINT "cuentas_ahorro_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."gastos_recurrentes"
    ADD CONSTRAINT "gastos_recurrentes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ingest_tokens"
    ADD CONSTRAINT "ingest_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_boletas"
    ADD CONSTRAINT "nomina_boletas_empleador_id_fkey" FOREIGN KEY ("empleador_id") REFERENCES "public"."nomina_empleadores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_boletas"
    ADD CONSTRAINT "nomina_boletas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_empleadores"
    ADD CONSTRAINT "nomina_empleadores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_trabajadores"
    ADD CONSTRAINT "nomina_trabajadores_empleador_id_fkey" FOREIGN KEY ("empleador_id") REFERENCES "public"."nomina_empleadores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_trabajadores"
    ADD CONSTRAINT "nomina_trabajadores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pagos_tarjeta"
    ADD CONSTRAINT "pagos_tarjeta_tarjeta_id_fkey" FOREIGN KEY ("tarjeta_id") REFERENCES "public"."tarjetas_credito"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pagos_tarjeta"
    ADD CONSTRAINT "pagos_tarjeta_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."prestamos_abonos"
    ADD CONSTRAINT "prestamos_abonos_prestamo_id_fkey" FOREIGN KEY ("prestamo_id") REFERENCES "public"."prestamos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prestamos"
    ADD CONSTRAINT "prestamos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."presupuestos"
    ADD CONSTRAINT "presupuestos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subcategorias"
    ADD CONSTRAINT "subcategorias_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias_personalizadas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subcategorias"
    ADD CONSTRAINT "subcategorias_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tarjetas_credito"
    ADD CONSTRAINT "tarjetas_credito_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."transaccion_detalles"
    ADD CONSTRAINT "transaccion_detalles_transaccion_id_fkey" FOREIGN KEY ("transaccion_id") REFERENCES "public"."transacciones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transacciones"
    ADD CONSTRAINT "transacciones_compras_cuotas_id_fkey" FOREIGN KEY ("compras_cuotas_id") REFERENCES "public"."compras_cuotas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transacciones"
    ADD CONSTRAINT "transacciones_cuenta_ahorro_id_fkey" FOREIGN KEY ("cuenta_ahorro_id") REFERENCES "public"."cuentas_ahorro"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transacciones"
    ADD CONSTRAINT "transacciones_gastos_recurrentes_id_fkey" FOREIGN KEY ("gastos_recurrentes_id") REFERENCES "public"."gastos_recurrentes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transacciones"
    ADD CONSTRAINT "transacciones_prestamo_id_fkey" FOREIGN KEY ("prestamo_id") REFERENCES "public"."prestamos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transacciones"
    ADD CONSTRAINT "transacciones_subcategoria_id_fkey" FOREIGN KEY ("subcategoria_id") REFERENCES "public"."subcategorias"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transacciones"
    ADD CONSTRAINT "transacciones_tarjeta_id_fkey" FOREIGN KEY ("tarjeta_id") REFERENCES "public"."tarjetas_credito"("id");



ALTER TABLE ONLY "public"."transacciones"
    ADD CONSTRAINT "transacciones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "El usuario elimina sus transacciones" ON "public"."transacciones" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "El usuario inserta sus transacciones" ON "public"."transacciones" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "El usuario lee sus transacciones" ON "public"."transacciones" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "El usuario solo edita su propio perfil" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "El usuario solo ve su propio perfil" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."ahorros_inversiones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categorias_personalizadas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."compras_cuotas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cuentas_ahorro" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cuentas_ahorro_own" ON "public"."cuentas_ahorro" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "cuentas_ahorro_update_own" ON "public"."cuentas_ahorro" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."gastos_recurrentes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingest_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ingest_tokens_own" ON "public"."ingest_tokens" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."log_errores_ingesta" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nomina_boletas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nomina_empleadores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nomina_trabajadores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own" ON "public"."nomina_boletas" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own" ON "public"."nomina_empleadores" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own" ON "public"."nomina_trabajadores" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."pagos_tarjeta" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pagos_tarjeta_own" ON "public"."pagos_tarjeta" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."prestamos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prestamos_abonos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prestamos_abonos_own" ON "public"."prestamos_abonos" USING ((EXISTS ( SELECT 1
   FROM "public"."prestamos" "p"
  WHERE (("p"."id" = "prestamos_abonos"."prestamo_id") AND ("p"."user_id" = "auth"."uid"())))));



CREATE POLICY "prestamos_own" ON "public"."prestamos" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "prestamos_update_own" ON "public"."prestamos" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."presupuestos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "presupuestos_all_own" ON "public"."presupuestos" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subcategorias" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subcategorias_own" ON "public"."subcategorias" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."tarjetas_credito" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tarjetas_credito_own" ON "public"."tarjetas_credito" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "tarjetas_update_own" ON "public"."tarjetas_credito" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "tc_insert" ON "public"."tipos_cambio" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "tc_select" ON "public"."tipos_cambio" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "tc_update" ON "public"."tipos_cambio" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."tipos_cambio" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transaccion_detalles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transacciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transacciones_update_own" ON "public"."transacciones" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "usuario gestiona sus ahorros" ON "public"."ahorros_inversiones" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "usuario gestiona sus cuotas" ON "public"."compras_cuotas" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "usuario gestiona sus recurrentes" ON "public"."gastos_recurrentes" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "usuario_elimina_sus_detalles" ON "public"."transaccion_detalles" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."transacciones" "t"
  WHERE (("t"."id" = "transaccion_detalles"."transaccion_id") AND ("t"."user_id" = "auth"."uid"())))));



CREATE POLICY "usuario_inserta_sus_detalles" ON "public"."transaccion_detalles" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."transacciones" "t"
  WHERE (("t"."id" = "transaccion_detalles"."transaccion_id") AND ("t"."user_id" = "auth"."uid"())))));



CREATE POLICY "usuario_lee_sus_detalles" ON "public"."transaccion_detalles" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."transacciones" "t"
  WHERE (("t"."id" = "transaccion_detalles"."transaccion_id") AND ("t"."user_id" = "auth"."uid"())))));



CREATE POLICY "usuarios_ven_sus_categorias" ON "public"."categorias_personalizadas" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."fn_auto_apply_recurrentes"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_auto_apply_recurrentes"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_auto_apply_recurrentes"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_auto_apply_recurrentes"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_deuda_capas"("p_mes" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_deuda_capas"("p_mes" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_deuda_capas"("p_mes" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_reduce_deuda_on_pago"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_reduce_deuda_on_pago"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_reduce_deuda_on_pago"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_reduce_saldo_on_abono"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_reduce_saldo_on_abono"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_reduce_saldo_on_abono"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_reverse_on_deactivate"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_reverse_on_deactivate"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_reverse_on_deactivate"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_tx_from_abono_prestamo"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_tx_from_abono_prestamo"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_tx_from_abono_prestamo"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_tx_from_ahorro"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_tx_from_ahorro"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_tx_from_ahorro"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_tx_from_pago_tarjeta"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_tx_from_pago_tarjeta"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_tx_from_pago_tarjeta"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_update_deuda_cuotas"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_update_deuda_cuotas"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_update_deuda_cuotas"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_update_saldo_ahorro"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_update_saldo_ahorro"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_update_saldo_ahorro"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_update_saldo_cuenta"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_update_saldo_cuenta"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_update_saldo_cuenta"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";


















GRANT ALL ON TABLE "public"."ahorros_inversiones" TO "anon";
GRANT ALL ON TABLE "public"."ahorros_inversiones" TO "authenticated";
GRANT ALL ON TABLE "public"."ahorros_inversiones" TO "service_role";



GRANT ALL ON TABLE "public"."categorias_personalizadas" TO "anon";
GRANT ALL ON TABLE "public"."categorias_personalizadas" TO "authenticated";
GRANT ALL ON TABLE "public"."categorias_personalizadas" TO "service_role";



GRANT ALL ON TABLE "public"."compras_cuotas" TO "anon";
GRANT ALL ON TABLE "public"."compras_cuotas" TO "authenticated";
GRANT ALL ON TABLE "public"."compras_cuotas" TO "service_role";



GRANT ALL ON TABLE "public"."cuentas_ahorro" TO "anon";
GRANT ALL ON TABLE "public"."cuentas_ahorro" TO "authenticated";
GRANT ALL ON TABLE "public"."cuentas_ahorro" TO "service_role";



GRANT ALL ON TABLE "public"."gastos_recurrentes" TO "anon";
GRANT ALL ON TABLE "public"."gastos_recurrentes" TO "authenticated";
GRANT ALL ON TABLE "public"."gastos_recurrentes" TO "service_role";



GRANT ALL ON TABLE "public"."ingest_tokens" TO "anon";
GRANT ALL ON TABLE "public"."ingest_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."ingest_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."log_errores_ingesta" TO "anon";
GRANT ALL ON TABLE "public"."log_errores_ingesta" TO "authenticated";
GRANT ALL ON TABLE "public"."log_errores_ingesta" TO "service_role";



GRANT ALL ON TABLE "public"."nomina_boletas" TO "anon";
GRANT ALL ON TABLE "public"."nomina_boletas" TO "authenticated";
GRANT ALL ON TABLE "public"."nomina_boletas" TO "service_role";



GRANT ALL ON TABLE "public"."nomina_empleadores" TO "anon";
GRANT ALL ON TABLE "public"."nomina_empleadores" TO "authenticated";
GRANT ALL ON TABLE "public"."nomina_empleadores" TO "service_role";



GRANT ALL ON TABLE "public"."nomina_trabajadores" TO "anon";
GRANT ALL ON TABLE "public"."nomina_trabajadores" TO "authenticated";
GRANT ALL ON TABLE "public"."nomina_trabajadores" TO "service_role";



GRANT ALL ON TABLE "public"."pagos_tarjeta" TO "anon";
GRANT ALL ON TABLE "public"."pagos_tarjeta" TO "authenticated";
GRANT ALL ON TABLE "public"."pagos_tarjeta" TO "service_role";



GRANT ALL ON TABLE "public"."prestamos" TO "anon";
GRANT ALL ON TABLE "public"."prestamos" TO "authenticated";
GRANT ALL ON TABLE "public"."prestamos" TO "service_role";



GRANT ALL ON TABLE "public"."prestamos_abonos" TO "anon";
GRANT ALL ON TABLE "public"."prestamos_abonos" TO "authenticated";
GRANT ALL ON TABLE "public"."prestamos_abonos" TO "service_role";



GRANT ALL ON TABLE "public"."presupuestos" TO "anon";
GRANT ALL ON TABLE "public"."presupuestos" TO "authenticated";
GRANT ALL ON TABLE "public"."presupuestos" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."subcategorias" TO "anon";
GRANT ALL ON TABLE "public"."subcategorias" TO "authenticated";
GRANT ALL ON TABLE "public"."subcategorias" TO "service_role";



GRANT ALL ON TABLE "public"."tarjetas_credito" TO "anon";
GRANT ALL ON TABLE "public"."tarjetas_credito" TO "authenticated";
GRANT ALL ON TABLE "public"."tarjetas_credito" TO "service_role";



GRANT ALL ON TABLE "public"."tipos_cambio" TO "anon";
GRANT ALL ON TABLE "public"."tipos_cambio" TO "authenticated";
GRANT ALL ON TABLE "public"."tipos_cambio" TO "service_role";



GRANT ALL ON TABLE "public"."transaccion_detalles" TO "anon";
GRANT ALL ON TABLE "public"."transaccion_detalles" TO "authenticated";
GRANT ALL ON TABLE "public"."transaccion_detalles" TO "service_role";



GRANT ALL ON TABLE "public"."transacciones" TO "anon";
GRANT ALL ON TABLE "public"."transacciones" TO "authenticated";
GRANT ALL ON TABLE "public"."transacciones" TO "service_role";



GRANT ALL ON TABLE "public"."v_categorias" TO "anon";
GRANT ALL ON TABLE "public"."v_categorias" TO "authenticated";
GRANT ALL ON TABLE "public"."v_categorias" TO "service_role";



GRANT ALL ON TABLE "public"."v_gastos_programados_mes" TO "anon";
GRANT ALL ON TABLE "public"."v_gastos_programados_mes" TO "authenticated";
GRANT ALL ON TABLE "public"."v_gastos_programados_mes" TO "service_role";



GRANT ALL ON TABLE "public"."v_pendientes_clasificacion" TO "anon";
GRANT ALL ON TABLE "public"."v_pendientes_clasificacion" TO "authenticated";
GRANT ALL ON TABLE "public"."v_pendientes_clasificacion" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































