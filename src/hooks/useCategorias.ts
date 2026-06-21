import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface Categoria {
  id: string | null;
  nombre: string;
  icono: string;
  es_personalizada: boolean;
}

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

export const BASE_INCOME_CATS: Categoria[] = [
  { id: null, nombre: 'Sueldo',      icono: '💼', es_personalizada: false },
  { id: null, nombre: 'Bono',        icono: '🎁', es_personalizada: false },
  { id: null, nombre: 'Freelance',   icono: '💻', es_personalizada: false },
  { id: null, nombre: 'Inversiones', icono: '📈', es_personalizada: false },
  { id: null, nombre: 'Negocio',     icono: '🏪', es_personalizada: false },
  { id: null, nombre: 'Otros',       icono: '📦', es_personalizada: false },
];

export const ICON_MAP: Record<string, string> = {
  Alimentación: '🛒', Transporte: '🚗', Vivienda: '🏠',
  Entretenimiento: '🎬', Salud: '💊', Educación: '📚',
  Ropa: '👕', Servicios: '⚡', Restaurantes: '🍽️', Otros: '📦',
  Sueldo: '💼', Bono: '🎁', Freelance: '💻', Inversiones: '📈', Negocio: '🏪',
  Ahorro: '🏦', 'Retiro Ahorro': '💰', 'Pago Tarjeta': '💳', 'Abono Préstamo': '📋',
};

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
          const fromDB = data.map(r => ({
            id:               r.id as string | null,
            nombre:           r.nombre as string,
            icono:            r.icono  as string,
            es_personalizada: r.es_personalizada as boolean,
          }));
          // Always include base categories — merge DB data with base, avoiding duplicates
          const fromDBNames = new Set(fromDB.map(c => c.nombre));
          const baseNotInDB = BASE_EXPENSE_CATS.filter(c => !fromDBNames.has(c.nombre));
          setCategorias([...fromDB, ...baseNotInDB]);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  return { categorias, loading };
}

export function iconForCat(nombre: string, cats: Categoria[]): string {
  if (ICON_MAP[nombre]) return ICON_MAP[nombre];
  return cats.find(c => c.nombre === nombre)?.icono ?? '📦';
}
