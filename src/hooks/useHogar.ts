import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';

export interface HogarPerfil {
  id: string;
  nombre: string;
  hogar_id: string;
  rol: 'admin' | 'miembro';
  estado: 'pendiente' | 'activo' | 'removido';
}

export interface HogarModulo {
  modulo: string;
  habilitado: boolean;
}

export interface HogarInfo {
  id: string;
  nombre: string;
  admin_id: string;
  codigo_invitacion: string;
}

export interface MembresiaInfo {
  hogar_id: string;
  rol: 'admin' | 'miembro';
  estado: 'pendiente' | 'activo' | 'removido';
}

export function useHogar() {
  const [loading,    setLoading]    = useState(true);
  const [hogar,      setHogar]      = useState<HogarInfo | null>(null);
  const [membresia,  setMembresia]  = useState<MembresiaInfo | null>(null);
  const [miembros,   setMiembros]   = useState<HogarPerfil[]>([]);
  const [modulos,    setModulos]    = useState<HogarModulo[]>([]);
  const [pendientes, setPendientes] = useState(0);

  const esAdmin = membresia?.rol === 'admin' && membresia?.estado === 'activo';

  const cargar = useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;

      // Membresía del usuario actual
      const { data: mem } = await supabase
        .from('hogar_miembros')
        .select('hogar_id, rol, estado')
        .eq('user_id', user.id)
        .in('estado', ['pendiente', 'activo'])
        .maybeSingle();

      if (!mem || !active) {
        setHogar(null);
        setMembresia(null);
        setMiembros([]);
        setModulos([]);
        setPendientes(0);
        setLoading(false);
        return;
      }

      setMembresia(mem as MembresiaInfo);

      // Datos del hogar
      const { data: hog } = await supabase
        .from('hogares')
        .select('id, nombre, admin_id, codigo_invitacion')
        .eq('id', mem.hogar_id)
        .single();
      if (active && hog) setHogar(hog as HogarInfo);

      if (mem.estado === 'activo') {
        // Perfiles de miembros (via función server-side)
        const { data: perfiles } = await supabase.rpc('fn_perfiles_mi_hogar');
        if (active && perfiles) {
          setMiembros(perfiles as HogarPerfil[]);
          setPendientes(
            (perfiles as HogarPerfil[]).filter(p => p.estado === 'pendiente').length
          );
        }

        // Módulos del hogar
        const { data: mods } = await supabase
          .from('hogar_modulos')
          .select('modulo, habilitado')
          .eq('hogar_id', mem.hogar_id);
        if (active && mods) setModulos(mods as HogarModulo[]);
      }

      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  useFocusEffect(cargar);

  const crearHogar = async (nombre: string): Promise<void> => {
    const { error } = await supabase.rpc('fn_crear_hogar', { p_nombre: nombre });
    if (error) {
      const msg = error.message.includes('YA_TIENE_HOGAR')
        ? 'Ya perteneces a un hogar.'
        : error.message;
      throw new Error(msg);
    }
    cargar();
  };

  const solicitarUnion = async (codigo: string): Promise<void> => {
    const { error } = await supabase.rpc('fn_solicitar_union', { p_codigo: codigo });
    if (error) {
      const msg = error.message.includes('CODIGO_INVALIDO')
        ? 'Código de invitación inválido. Verifícalo con el administrador.'
        : error.message.includes('YA_TIENE_HOGAR')
        ? 'Ya perteneces a un hogar.'
        : error.message;
      throw new Error(msg);
    }
    cargar();
  };

  const aprobar = async (userId: string): Promise<void> => {
    if (!hogar) return;
    const { error } = await supabase.rpc('fn_aprobar_miembro', {
      p_hogar: hogar.id,
      p_user:  userId,
    });
    if (error) throw new Error(error.message);
    cargar();
  };

  const remover = async (userId: string): Promise<void> => {
    if (!hogar) return;
    const { error } = await supabase.rpc('fn_remover_miembro', {
      p_hogar: hogar.id,
      p_user:  userId,
    });
    if (error) throw new Error(error.message);
    cargar();
  };

  const liberarModulo = async (modulo: string, habilitado: boolean): Promise<void> => {
    if (!hogar) return;
    const { error } = await supabase.rpc('fn_liberar_modulo', {
      p_hogar:      hogar.id,
      p_modulo:     modulo,
      p_habilitado: habilitado,
    });
    if (error) throw new Error(error.message);
    setModulos(prev => prev.map(m => m.modulo === modulo ? { ...m, habilitado } : m));
  };

  return {
    loading,
    hogar,
    membresia,
    miembros,
    modulos,
    pendientes,
    esAdmin,
    crearHogar,
    solicitarUnion,
    aprobar,
    remover,
    liberarModulo,
    recargar: cargar,
  };
}
