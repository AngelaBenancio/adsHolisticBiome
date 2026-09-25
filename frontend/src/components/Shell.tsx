import { NavLink, Outlet } from 'react-router-dom';
import { useSesion } from '../sesion';

const ENLACES = [
  { to: '/', texto: 'Hoy' },
  { to: '/asistencia', texto: 'Asistencia' },
  { to: '/empleados', texto: 'Empleados' },
  { to: '/turnos', texto: 'Turnos' },
  { to: '/feriados', texto: 'Feriados' },
  { to: '/reloj', texto: 'Reloj' },
];

export function Shell() {
  const { salir, sesion } = useSesion();
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="flex flex-col bg-ink text-paper md:min-h-screen">
        <div className="px-6 pb-4 pt-7">
          <p className="font-display text-3xl leading-none">Asistencias</p>
          <p className="mt-2 text-sm text-stone-400">Lima · reloj en la nube</p>
        </div>
        <nav className="flex gap-2 overflow-auto px-4 pb-4 md:block md:space-y-1">
          {ENLACES.map((enlace) => (
            <NavLink
              key={enlace.to}
              to={enlace.to}
              end={enlace.to === '/'}
              className={({ isActive }) =>
                `block whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ${isActive ? 'bg-paper text-ink' : 'text-stone-300 hover:bg-white/10'}`
              }
            >
              {enlace.texto}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-6 pt-6">
          <p className="text-sm font-semibold text-paper">{sesion?.nombre}</p>
          <p className="text-xs text-stone-500">{sesion?.usuario}</p>
        </div>
        <button type="button" onClick={() => { void salir(); }} className="m-4 rounded-full px-4 py-2 text-left text-sm text-stone-400 hover:bg-white/10">
          Cerrar sesión
        </button>
      </aside>
      <main className="px-4 py-6 md:px-8">
        <Outlet />
      </main>
    </div>
  );
}
