import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface Categoria {
  id: string | null;
  nombre: string;
  icono: string;
  es_personalizada: boolean;
}

// Categorías base de gasto — usadas como fallback si la vista no responde
const BASE_EXPENSE_CATS: Categoria[] = [
  { id: null, nombre: 'Alimentación',    icono: '🛒', es_personalizada: false },
  { id: null, nombre: 'Transporte',      icono: '🚗', es_personalizada: false },
  { id: null, nombre: 'Vivienda',        icono: '🏠', es_personalizada: false },
  { id: null, nombre: 'Entretenimiento', icono: '🎬', es_personalizada: false },
  { id: null, nombre: 'Salud',           icono: '💊', es_personalizada: false },
  { id: null, nombre: 'Educación',       icono: '📚', es_personalizada: false },
  { id: null, nombre: 'Ropa',            icono: '👕', es_personalizada: false },
  { id: null, nombre: 'Servicios',       icono: '⚡', es_personalizada: false },
  { id: null, nombre: 'Restaurantes',    icono: '🍽️', es_personalizada: false },
  { id: null, nombre: 'Otros',           icono: '📦', es_personalizada: false },
];

// Categorías de ingreso — no vienen de la vista (son fijas del sistema)
export const BASE_INCOME_CATS: Categoria[] = [
  { id: null, nombre: 'Sueldo',      icono: '💼', es_personalizada: false },
  { id: null, nombre: 'Bono',        icono: '🎁', es_personalizada: false },
  { id: null, nombre: 'Freelance',   icono: '💻', es_personalizada: false },
  { id: null, nombre: 'Inversiones', icono: '📈', es_personalizada: false },
  { id: null, nombre: 'Negocio',     icono: '🏪', es_personalizada: false },
  { id: null, nombre: 'Otros',       icono: '📦', es_personalizada: false },
];

// Mapa icono global para todas las categorías conocidas
export const ICON_MAP: Record<string, string> = {
  // Gasto
  Alimentación: '🛒', Transporte: '🚗', Vivienda: '🏠',
  Entretenimiento: '🎬', Salud: '💊', Educación: '📚',
  Ropa: '👕', Servicios: '⚡', Restaurantes: '🍽️', Otros: '📦',
  // Ingreso
  Sueldo: '💼', Bono: '🎁', Freelance: '💻', Inversiones: '📈', Negocio: '🏪',
  // Sistema
  Ahorro: '🏦', 'Retiro Ahorro': '💰', 'Pago Tarjeta': '💳', 'Abono Préstamo': '📋',
};

/**
 * Hook que devuelve las categorías de gasto unificadas:
 *   - categorías base del sistema
 *   - categorías personalizadas del usuario (public.categorias_personalizadas)
 *   - categorías inferidas del presupuesto_template del onboarding
 *
 * Usa la vista public.v_categorias (migration_v8). Si la vista aún no existe
 * (DB sin v8 ejecutada), cae al fallback hardcodeado sin romper la UI.
 */
export function useCategorias() {
  const [categorias, setCategorias] = useState<Categoria[]>(BASE_EXPENSE_CATS);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('v_categorias')
          .select('id, nombre, icono, es_personalizada, sort_order')
          .order('sort_order', { ascending: true })
          .order('nombre',     { ascending: true });

        if (active && !error && data && data.length > 0) {
          setCategorias(
            data.map(r => ({
              id:               r.id as string | null,
              nombre:           r.nombre as string,
              icono:            r.icono  as string,
              es_personalizada: r.es_personalizada as boolean,
            }))
          );
        }
        // Si hay error (vista no existe todavía) → se queda con el fallback BASE_EXPENSE_CATS
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  return { categorias, loading };
}

/** Devuelve el icono de una categoría, buscando primero en el mapa global
 *  y luego en la lista de categorías cargadas por el hook. */
export function iconForCat(nombre: string, cats: Categoria[]): string {
  if (ICON_MAP[nombre]) return ICON_MAP[nombre];
  return cats.find(c => c.nombre === nombre)?.icono ?? '📦';
}
