import { useEffect, useState } from 'react';
import { consultar } from '../sesion';
import type { Resumen } from '../types';
import { Aviso, Boton, Panel, Sello, horaCorta } from '../components/ui';

export function Hoy() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  async function cargar() {
    setError('');
    const cuerpo = await consultar<{ datos: Resumen }>('/api/resumen');
    setResumen(cuerpo.datos);
  }

  useEffect(() => {
    cargar()
      .catch((fallo: unknown) => setError(fallo instanceof Error ? fallo.message : 'No se pudo cargar el dia'))
      .finally(() => setCargando(false));
  }, []);

  async function recalcular() {
    if (!resumen) return;
    setOcupado(true);
    setError('');
    try {
      await consultar('/api/asistencias/recalcular', {
        method: 'POST',
        body: JSON.stringify({ desde: resumen.fecha, hasta: resumen.fecha }),
      });
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo recalcular');
    } finally {
      setOcupado(false);
    }
  }

  const metricas = resumen
    ? [
        { etiqueta: 'A tiempo', valor: resumen.a_tiempo, tono: 'text-pine' },
        { etiqueta: 'Tardanzas', valor: resumen.tardanza, tono: 'text-clay' },
        { etiqueta: 'Faltas', valor: resumen.falta, tono: 'text-wine' },
        { etiqueta: 'Feriados', valor: resumen.feriado, tono: 'text-ink' },
        { etiqueta: 'Relojes en línea', valor: `${resumen.dispositivos_en_linea}/${resumen.dispositivos}`, tono: 'text-ink' },
      ]
    : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-mist">Hoy</p>
          <h1 className="font-display text-4xl">{resumen?.fecha ?? (error ? 'Sin conexión' : 'Cargando')}</h1>
        </div>
        <Boton variante="secundario" onClick={recalcular} disabled={ocupado || !resumen}>
          {ocupado ? 'Cerrando…' : 'Cerrar faltas de hoy'}
        </Boton>
      </header>
      {error ? <Aviso texto={error} /> : null}
      {cargando && !resumen ? <Panel className="px-5 py-8 text-mist">Cargando el día…</Panel> : null}
      {resumen && resumen.feriado > 0 ? (
        <Panel className="px-5 py-4 text-sm">
          Hoy está marcado como feriado. No se generan faltas ni tardanzas.
        </Panel>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {metricas.map((metrica) => (
          <Panel key={metrica.etiqueta} className="px-5 py-4">
            <p className="text-sm font-semibold text-mist">{metrica.etiqueta}</p>
            <p className={`font-display text-5xl ${metrica.tono}`}>{metrica.valor}</p>
          </Panel>
        ))}
      </div>
      <Panel className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-2xl">Para revisar</h2>
          <p className="text-sm text-mist">{resumen ? `${resumen.marcaciones} marcas crudas` : ''}</p>
        </div>
        <ul>
          {(resumen?.alertas ?? []).map((alerta) => (
            <li key={alerta.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-line px-5 py-3 last:border-0">
              <div>
                <p className="font-semibold">{alerta.empleado.nombre}</p>
                <p className="text-sm text-mist">PIN {alerta.empleado.pin} · {alerta.turno?.nombre ?? 'Sin turno'}</p>
              </div>
              <p className="text-sm">{horaCorta(alerta.hora_entrada_real)}{alerta.minutos_tarde ? ` · ${alerta.minutos_tarde} min` : ''}</p>
              <Sello estado={alerta.estado} />
            </li>
          ))}
          {resumen && resumen.alertas.length === 0 ? (
            <li className="px-5 py-8 text-mist">Nadie figura en falta o tardanza.</li>
          ) : null}
        </ul>
      </Panel>
    </div>
  );
}
