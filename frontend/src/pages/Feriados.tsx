import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { consultar } from '../sesion';
import type { Feriado } from '../types';
import { Aviso, Boton, Campo, Panel } from '../components/ui';

function hoyLima(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function claveMes(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

export function Feriados() {
  const hoy = hoyLima();
  const [anio, setAnio] = useState(Number(hoy.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoy.slice(5, 7)));
  const [feriados, setFeriados] = useState<Feriado[]>([]);
  const [fecha, setFecha] = useState(hoy);
  const [descripcion, setDescripcion] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  async function cargar(anioLista: number) {
    setCargando(true);
    setError('');
    try {
      const cuerpo = await consultar<{ datos: Feriado[] }>(`/api/feriados?anio=${anioLista}`);
      setFeriados(cuerpo.datos);
    } catch (fallo) {
      setFeriados([]);
      setError(fallo instanceof Error ? fallo.message : 'No se pudieron leer los feriados');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void cargar(anio);
  }, [anio]);

  const porFecha = useMemo(() => {
    const mapa = new Map<string, Feriado>();
    for (const feriado of feriados) mapa.set(feriado.fecha, feriado);
    return mapa;
  }, [feriados]);

  const cuadricula = useMemo(() => {
    const primero = new Date(Date.UTC(anio, mes - 1, 1));
    const inicio = (primero.getUTCDay() + 6) % 7;
    const cantidad = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    const celdas: Array<{ dia: number; fecha: string } | null> = Array.from({ length: inicio }, () => null);
    for (let dia = 1; dia <= cantidad; dia += 1) {
      celdas.push({ dia, fecha: `${claveMes(anio, mes)}-${String(dia).padStart(2, '0')}` });
    }
    return celdas;
  }, [anio, mes]);

  const nombreMes = new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(anio, mes - 1, 1)));

  function moverMes(delta: number) {
    const siguiente = new Date(Date.UTC(anio, mes - 1 + delta, 1));
    setAnio(siguiente.getUTCFullYear());
    setMes(siguiente.getUTCMonth() + 1);
  }

  async function crear(evento: FormEvent) {
    evento.preventDefault();
    setGuardando(true);
    setError('');
    try {
      await consultar('/api/feriados', {
        method: 'POST',
        body: JSON.stringify({ fecha, descripcion: descripcion.trim() }),
      });
      setDescripcion('');
      const anioFecha = Number(fecha.slice(0, 4));
      const mesFecha = Number(fecha.slice(5, 7));
      if (anioFecha === anio) await cargar(anio);
      else setAnio(anioFecha);
      setMes(mesFecha);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo registrar el feriado');
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(feriado: Feriado) {
    if (!window.confirm(`¿Quitar el feriado del ${feriado.fecha}?`)) return;
    setError('');
    try {
      await consultar(`/api/feriados/${feriado.id}`, { method: 'DELETE' });
      await cargar(anio);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo quitar el feriado');
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-mist">Calendario</p>
        <h1 className="font-display text-4xl">Feriados</h1>
        <p className="mt-1 max-w-xl text-mist">Un día registrado aquí no genera falta ni tardanza. Queda marcado como feriado.</p>
      </header>
      {error ? <Aviso texto={error} /> : null}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Panel className="h-fit p-4">
          <h2 className="mb-3 font-display text-2xl">Nuevo feriado</h2>
          <form className="space-y-3" onSubmit={crear}>
            <Campo etiqueta="Fecha" type="date" value={fecha} onChange={(evento) => setFecha(evento.target.value)} required />
            <Campo etiqueta="Descripción" value={descripcion} onChange={(evento) => setDescripcion(evento.target.value)} maxLength={150} required />
            <Boton type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Registrar'}</Boton>
          </form>
        </Panel>
        <Panel className="p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl capitalize">{nombreMes}</h2>
            <div className="flex gap-2">
              <Boton type="button" variante="secundario" onClick={() => moverMes(-1)}>Anterior</Boton>
              <Boton type="button" variante="secundario" onClick={() => moverMes(1)}>Siguiente</Boton>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-mist">
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((dia) => <div key={dia} className="py-1">{dia}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cuadricula.map((celda, indice) => {
              if (!celda) return <div key={`vacio-${indice}`} />;
              const feriado = porFecha.get(celda.fecha);
              const esHoy = celda.fecha === hoy;
              return (
                <div
                  key={celda.fecha}
                  title={feriado?.descripcion}
                  className={`flex min-h-14 flex-col items-center justify-center rounded-xl text-sm ${feriado ? 'bg-sky-100 font-semibold text-sky-950' : 'bg-white'} ${esHoy ? 'ring-1 ring-ink' : ''}`}
                >
                  <span>{celda.dia}</span>
                  {feriado ? <span className="mt-1 h-1.5 w-1.5 rounded-full bg-sky-700" /> : null}
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
      <Panel className="overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-2xl">Registrados en {anio}</h2>
        </div>
        {cargando ? <p className="px-5 py-8 text-mist">Cargando feriados…</p> : null}
        {!cargando && feriados.length === 0 ? <p className="px-5 py-8 text-mist">No hay feriados en este año.</p> : null}
        <ul>
          {feriados.map((feriado) => (
            <li key={feriado.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-0">
              <div>
                <p className="font-semibold">{feriado.fecha}</p>
                <p className="text-sm text-mist">{feriado.descripcion}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-950">Feriado</span>
                <Boton type="button" variante="secundario" onClick={() => void quitar(feriado)}>Quitar</Boton>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
