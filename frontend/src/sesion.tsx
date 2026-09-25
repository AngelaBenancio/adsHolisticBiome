import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface Sesion {
  token: string;
  usuario: string;
  nombre: string;
}

const CLAVE = 'asistencias.sesion';
const AVISO = 'asistencias.aviso';

let avisoLeido: string | null = null;

export function leerAvisoSesion(): string {
  if (avisoLeido !== null) return avisoLeido;
  const texto = sessionStorage.getItem(AVISO) ?? '';
  if (texto) sessionStorage.removeItem(AVISO);
  avisoLeido = texto;
  return texto;
}

function urlBase(): string {
  return (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/$/, '');
}

function leer(): Sesion | null {
  const crudo = sessionStorage.getItem(CLAVE);
  if (!crudo) return null;
  try {
    const valor = JSON.parse(crudo) as Sesion;
    if (!valor.token || !valor.usuario) return null;
    return valor;
  } catch {
    return null;
  }
}

function guardar(sesion: Sesion): void {
  sessionStorage.setItem(CLAVE, JSON.stringify(sesion));
}

let alExpirar: (() => void) | null = null;

function olvidar(motivo?: string): void {
  if (motivo) {
    sessionStorage.setItem(AVISO, motivo);
    avisoLeido = null;
  }
  sessionStorage.removeItem(CLAVE);
  alExpirar?.();
}

interface ContextoSesion {
  sesion: Sesion | null;
  entrar: (sesion: Sesion) => void;
  salir: () => Promise<void>;
}

const Contexto = createContext<ContextoSesion | null>(null);

export function SesionProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(() => leer());

  useEffect(() => {
    alExpirar = () => setSesion(null);
    return () => {
      alExpirar = null;
    };
  }, []);

  const valor = useMemo<ContextoSesion>(() => ({
    sesion,
    entrar(siguiente) {
      avisoLeido = '';
      guardar(siguiente);
      setSesion(siguiente);
    },
    async salir() {
      const actual = leer();
      if (actual?.token) {
        try {
          await traer(`${urlBase()}/api/auth/logout`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${actual.token}` },
          });
        } catch {
          // La sesión local se cierra aunque el servidor no responda.
        }
      }
      olvidar();
    },
  }), [sesion]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): ContextoSesion {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('Sesion no disponible');
  return valor;
}

async function traer(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error('No se pudo contactar el servidor. Inténtalo de nuevo en un momento.');
  }
}

export async function ingresar(usuario: string, contrasena: string): Promise<Sesion> {
  const respuesta = await traer(`${urlBase()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, contrasena }),
  });
  const cuerpo = await respuesta.json().catch(() => ({})) as {
    error?: string;
    datos?: { token?: string; usuario?: { usuario?: string; nombre?: string } };
  };
  if (respuesta.status >= 500) {
    throw new Error('No se pudo contactar el servidor. Inténtalo de nuevo en un momento.');
  }
  if (!respuesta.ok || !cuerpo.datos?.token || !cuerpo.datos.usuario?.usuario) {
    throw new Error(cuerpo.error ?? 'No se pudo iniciar sesión');
  }
  return {
    token: cuerpo.datos.token,
    usuario: cuerpo.datos.usuario.usuario,
    nombre: cuerpo.datos.usuario.nombre?.trim() || cuerpo.datos.usuario.usuario,
  };
}

export async function consultar<T>(ruta: string, init?: RequestInit): Promise<T> {
  const sesion = leer();
  if (!sesion) throw new Error('Inicia sesión en el panel');
  const respuesta = await traer(`${urlBase()}${ruta}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${sesion.token}`,
      ...(init?.headers ?? {}),
    },
  });
  const cuerpo = await respuesta.json().catch(() => ({})) as { error?: string };
  if (respuesta.status === 401) {
    const mensaje = cuerpo.error ?? 'Sesión expirada. Vuelve a entrar.';
    olvidar(mensaje);
    throw new Error(mensaje);
  }
  if (!respuesta.ok) throw new Error(cuerpo.error ?? `Error ${respuesta.status}`);
  return cuerpo as T;
}
