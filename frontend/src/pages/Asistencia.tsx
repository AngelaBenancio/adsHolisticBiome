import { useEffect, useState } from 'react';
import { consultar } from '../sesion';
import type { Feriado, Marcacion, Paginacion, ResultadoAsistencia } from '../types';
import { Aviso, Boton, Campo, Panel, Seleccion, Sello, horaCorta } from '../components/ui';

function hoyLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function Asistencia() {
  const [desde, setDesde] = useState(hoyLocal);
  const [hasta, setHasta] = useState(hoyLocal);
  const [estado, setEstado] = useState('');
  const [q, setQ] = useState('');
  const [vista, setVista] = useState<'calculada' | 'cruda'>('calculada');
  const [filas, setFilas] = useState<ResultadoAsistencia[]>([]);
  const [crudas, setCrudas] = useState<Marcacion[]>([]);
  const [paginacion, setPaginacion] = useState<Paginacion | null>(null);
  const [pagina, setPagina] = useState(1);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [cerrando, setCerrando] = useState(false);
  const [cierre, setCierre] = useState(0);
  const [feriados, setFeriados] = useState<Record<string, string>>({});

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const params = new URLSearchParams({ desde, hasta, pagina: String(pagina), limite: '50' });
    if (estado) params.set('estado', estado);
    if (q.trim()) params.set('q', q.trim());
    const ruta = vista === 'calculada' ? `/api/asistencias?${params}` : `/api/marcaciones?${params}`;
    const anios = new Set([desde.slice(0, 4), hasta.slice(0, 4)].filter((valor) => /^\d{4}$/.test(valor)));
    Promise.all([
      consultar<{ datos: ResultadoAsistencia[] | Marcacion[]; paginacion: Paginacion }>(ruta),
      ...[...anios].map((anio) => consultar<{ datos: Feriado[] }>(`/api/feriados?anio=${anio}`)),
    ])
      .then((cuerpos) => {
        if (!vivo) return;
        const lista = cuerpos[0];
        setPaginacion(lista.paginacion);
        if (vista === 'calculada') setFilas(lista.datos as ResultadoAsistencia[]);
        else setCrudas(lista.datos as Marcacion[]);
        const mapa: Record<string, string> = {};
        for (const cuerpo of cuerpos.slice(1)) {
          for (const feriado of (cuerpo as { datos: Feriado[] }).datos) mapa[feriado.fecha] = feriado.descripcion;
        }
        setFeriados(mapa);
        setError('');
      })
      .catch((fallo: unknown) => {
        if (!vivo) return;
        setError(fallo instanceof Error ? fallo.message : 'No se pudo listar');
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [desde, hasta, estado, q, vista, pagina, cierre]);

  async function cerrarRango() {
    setCerrando(true);
    setError('');
    try {
      await consultar('/api/asistencias/recalcular', {
        method: 'POST',
        body: JSON.stringify({ desde, hasta }),
      });
      setVista('calculada');
      setPagina(1);
      setCierre((valor) => valor + 1);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo cerrar el rango');
    } finally {
      setCerrando(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-mist">Detalle</p>
          <h1 className="font-display text-4xl">Marcaciones</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Boton variante="secundario" onClick={() => void cerrarRango()} disabled={cerrando || cargando}>
            {cerrando ? 'Cerrando…' : 'Cerrar faltas del rango'}
          </Boton>
          <Boton variante={vista === 'calculada' ? 'primario' : 'secundario'} onClick={() => { setVista('calculada'); setPagina(1); }}>Calculadas</Boton>
          <Boton variante={vista === 'cruda' ? 'primario' : 'secundario'} onClick={() => { setVista('cruda'); setPagina(1); }}>Crudas</Boton>
        </div>
      </header>
      <Panel className="grid gap-3 p-4 md:grid-cols-4">
        <Campo etiqueta="Desde" type="date" value={desde} onChange={(evento) => { setDesde(evento.target.value); setPagina(1); }} />
        <Campo etiqueta="Hasta" type="date" value={hasta} onChange={(evento) => { setHasta(evento.target.value); setPagina(1); }} />
        <Seleccion etiqueta="Estado" value={estado} onChange={(evento) => { setEstado(evento.target.value); setPagina(1); }} disabled={vista === 'cruda'}>
          <option value="">Todos</option>
          <option value="a_tiempo">A tiempo</option>
          <option value="tardanza">Tardanza</option>
          <option value="falta">Falta</option>
          <option value="sin_turno">Sin turno</option>
          <option value="feriado">Feriado</option>
        </Seleccion>
        <Campo etiqueta="PIN o nombre" value={q} onChange={(evento) => { setQ(evento.target.value); setPagina(1); }} />
      </Panel>
      {error ? <Aviso texto={error} /> : null}
      {cargando ? <Panel className="px-4 py-8 text-mist">Cargando registros…</Panel> : null}
      <Panel className={`overflow-x-auto ${cargando ? 'hidden' : ''}`}>
        {vista === 'calculada' ? (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-mist">
              <tr>
                <th className="px-4 py-3 font-semibold">Colaborador</th>
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Turno</th>
                <th className="px-4 py-3 font-semibold">Entrada</th>
                <th className="px-4 py-3 font-semibold">Salida</th>
                <th className="px-4 py-3 font-semibold">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => (
                <tr key={fila.id} className={`border-b border-line last:border-0 ${fila.estado === 'falta' ? 'bg-rose-50' : fila.estado === 'feriado' ? 'bg-sky-50' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{fila.empleado.nombre}</p>
                    <p className="text-mist">PIN {fila.empleado.pin}</p>
                  </td>
                  <td className="px-4 py-3">{fila.fecha}</td>
                  <td className="px-4 py-3">{fila.turno ? `${fila.turno.nombre} · ${fila.turno.hora_entrada.slice(0, 5)}` : '—'}</td>
                  <td className="px-4 py-3">{horaCorta(fila.hora_entrada_real)}</td>
                  <td className="px-4 py-3">{horaCorta(fila.hora_salida_real)}</td>
                  <td className="px-4 py-3">
                    <Sello estado={fila.estado} />
                    {fila.estado === 'feriado' && feriados[fila.fecha] ? <span className="ml-2 text-mist">{feriados[fila.fecha]}</span> : null}
                    {fila.minutos_tarde ? <span className="ml-2 text-clay">{fila.minutos_tarde} min</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-mist">
              <tr>
                <th className="px-4 py-3 font-semibold">Colaborador</th>
                <th className="px-4 py-3 font-semibold">Cuando</th>
                <th className="px-4 py-3 font-semibold">Evento</th>
                <th className="px-4 py-3 font-semibold">Método</th>
                <th className="px-4 py-3 font-semibold">Reloj</th>
              </tr>
            </thead>
            <tbody>
              {crudas.map((fila) => (
                <tr key={fila.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold">{fila.empleado}</p>
                    <p className="text-mist">PIN {fila.pin}</p>
                  </td>
                  <td className="px-4 py-3">{fila.fecha_hora}</td>
                  <td className="px-4 py-3">{fila.tipo_evento_nombre}</td>
                  <td className="px-4 py-3">{fila.metodo_verificacion_nombre}</td>
                  <td className="px-4 py-3">{fila.dispositivo.alias ?? fila.dispositivo.sn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {paginacion && paginacion.total === 0 ? <p className="px-4 py-8 text-mist">No hay registros en ese rango.</p> : null}
      </Panel>
      {paginacion && paginacion.paginas > 1 ? (
        <div className="flex items-center gap-3">
          <Boton variante="secundario" disabled={pagina <= 1} onClick={() => setPagina((valor) => valor - 1)}>Anterior</Boton>
          <span className="text-sm text-mist">Página {paginacion.pagina} de {paginacion.paginas}</span>
          <Boton variante="secundario" disabled={pagina >= paginacion.paginas} onClick={() => setPagina((valor) => valor + 1)}>Siguiente</Boton>
        </div>
      ) : null}
    </div>
  );
}
