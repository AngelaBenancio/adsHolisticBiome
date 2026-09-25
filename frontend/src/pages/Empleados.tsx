import { useEffect, useState, type FormEvent } from 'react';
import { consultar } from '../sesion';
import type { Empleado, Paginacion, Turno } from '../types';
import { Aviso, Boton, Campo, Panel } from '../components/ui';

export function Empleados() {
  const [q, setQ] = useState('');
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [pin, setPin] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  async function cargar() {
    const params = new URLSearchParams({ limite: '100' });
    if (q.trim()) params.set('q', q.trim());
    const [lista, catalogo] = await Promise.all([
      consultar<{ datos: Empleado[]; paginacion: Paginacion }>(`/api/empleados?${params}`),
      consultar<{ datos: Turno[] }>('/api/turnos'),
    ]);
    setEmpleados(lista.datos);
    setTurnos(catalogo.datos.filter((turno) => turno.activo));
  }

  useEffect(() => {
    cargar().catch((fallo: unknown) => setError(fallo instanceof Error ? fallo.message : 'No se pudo cargar el padrón'));
  }, [q]);

  async function crear(evento: FormEvent) {
    evento.preventDefault();
    setError('');
    setAviso('');
    try {
      await consultar('/api/empleados', { method: 'POST', body: JSON.stringify({ pin, nombre }) });
      setPin('');
      setNombre('');
      setAviso('Colaborador creado. Asígnale un turno para poder calcular faltas.');
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo crear');
    }
  }

  async function asignar(empleadoId: number, turnoId: string, vigenteDesde: string) {
    setError('');
    if (!turnoId || !vigenteDesde) return;
    try {
      await consultar(`/api/empleados/${empleadoId}/turno`, {
        method: 'POST',
        body: JSON.stringify({ turno_id: Number(turnoId), vigente_desde: vigenteDesde }),
      });
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo asignar el turno');
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-mist">Padrón</p>
        <h1 className="font-display text-4xl">Empleados</h1>
      </header>
      {error ? <Aviso texto={error} /> : null}
      {aviso ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-pine">{aviso}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Panel className="h-fit p-4">
          <h2 className="mb-3 font-display text-2xl">Alta manual</h2>
          <form className="space-y-3" onSubmit={crear}>
            <Campo etiqueta="PIN del reloj" value={pin} onChange={(evento) => setPin(evento.target.value)} required />
            <Campo etiqueta="Nombre" value={nombre} onChange={(evento) => setNombre(evento.target.value)} required />
            <Boton type="submit">Guardar</Boton>
          </form>
        </Panel>
        <div className="space-y-3">
          <Campo etiqueta="Buscar" value={q} onChange={(evento) => setQ(evento.target.value)} />
          {empleados.map((empleado) => (
            <Ficha key={empleado.id} empleado={empleado} turnos={turnos} onAsignar={asignar} />
          ))}
          {empleados.length === 0 ? <Panel className="p-6 text-mist">Todavía no hay colaboradores.</Panel> : null}
        </div>
      </div>
    </div>
  );
}

function Ficha({
  empleado,
  turnos,
  onAsignar,
}: {
  empleado: Empleado;
  turnos: Turno[];
  onAsignar: (empleadoId: number, turnoId: string, vigenteDesde: string) => Promise<void>;
}) {
  const [turnoId, setTurnoId] = useState(empleado.turno ? String(empleado.turno.id) : '');
  const [desde, setDesde] = useState(empleado.turno?.vigente_desde ?? new Date().toISOString().slice(0, 10));
  return (
    <Panel className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-end">
      <div>
        <p className="font-semibold">{empleado.nombre}</p>
        <p className="text-sm text-mist">
          PIN {empleado.pin}
          {empleado.turno ? ` · ${empleado.turno.nombre} desde ${empleado.turno.vigente_desde}` : ' · sin turno'}
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(evento) => {
          evento.preventDefault();
          void onAsignar(empleado.id, turnoId, desde);
        }}
      >
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-mist">Turno</span>
          <select value={turnoId} onChange={(evento) => setTurnoId(evento.target.value)} className="rounded-xl border border-line bg-white px-3 py-2">
            <option value="">Elegir</option>
            {turnos.map((turno) => (
              <option key={turno.id} value={turno.id}>{turno.nombre}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-mist">Desde</span>
          <input type="date" value={desde} onChange={(evento) => setDesde(evento.target.value)} className="rounded-xl border border-line bg-white px-3 py-2" />
        </label>
        <Boton type="submit" variante="secundario">Asignar</Boton>
      </form>
    </Panel>
  );
}
