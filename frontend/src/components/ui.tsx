import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import type { EstadoAsistencia } from '../types';
import { ETIQUETA_ESTADO } from '../types';

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card shadow-card ${className}`}>{children}</section>;
}

export function Boton({
  variante = 'primario',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primario' | 'secundario' | 'peligro' }) {
  const clases = {
    primario: 'bg-ink text-paper hover:bg-black',
    secundario: 'bg-white text-ink border border-line hover:bg-paper',
    peligro: 'bg-wine text-white hover:bg-red-900',
  }[variante];
  return (
    <button
      {...props}
      className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50 ${clases} ${props.className ?? ''}`}
    />
  );
}

export function Campo({ etiqueta, ...props }: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold text-mist">{etiqueta}</span>
      <input
        {...props}
        className="w-full rounded-xl border border-line bg-white px-3 py-2 outline-none focus:border-ink"
      />
    </label>
  );
}

export function Seleccion({
  etiqueta,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold text-mist">{etiqueta}</span>
      <select {...props} className="w-full rounded-xl border border-line bg-white px-3 py-2 outline-none focus:border-ink">
        {children}
      </select>
    </label>
  );
}

const COLORES: Record<EstadoAsistencia, string> = {
  a_tiempo: 'bg-emerald-100 text-pine',
  tardanza: 'bg-amber-100 text-clay',
  falta: 'bg-wine text-white',
  sin_turno: 'bg-stone-200 text-ink',
  feriado: 'bg-sky-100 text-sky-900',
};

export function Sello({ estado }: { estado: EstadoAsistencia }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${COLORES[estado]}`}>
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}

export function Aviso({ texto }: { texto: string }) {
  return <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-wine">{texto}</p>;
}

export function horaCorta(valor: string | null): string {
  if (!valor) return '—';
  return valor.slice(11, 16) || valor.slice(0, 5);
}
