import { useEffect, useState, type FormEvent } from 'react';
import { consultar } from '../sesion';
import type { Turno } from '../types';
import { DIAS } from '../types';
import { Aviso, Boton, Campo, Panel } from '../components/ui';

function diasDesdeChecks(activos: boolean[]): string {
  return activos.map((activo) => (activo ? '1' : '0')).join('');
}

export function Turnos() {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [nombre, setNombre] = useState('Oficina');
  const [entrada, setEntrada] = useState('08:00');
  const [salida, setSalida] = useState('17:30');
  const [tolerancia, setTolerancia] = useState('10');
  const [dias, setDias] = useState([true, true, true, true, true, false, false]);
  const [error, setError] = useState('');

  async function cargar() {
    const cuerpo = await consultar<{ datos: Turno[] }>('/api/turnos');
    setTurnos(cuerpo.datos);
  }

  useEffect(() => {
    cargar().catch((fallo: unknown) => setError(fallo instanceof Error ? fallo.message : 'No se pudieron leer los turnos'));
  }, []);

  async function crear(evento: FormEvent) {
    evento.preventDefault();
    setError('');
    try {
      await consultar('/api/turnos', {
        method: 'POST',
        body: JSON.stringify({
          nombre,
          hora_entrada: entrada,
          hora_salida: salida,
          tolerancia_minutos: Number(tolerancia),
          dias_semana: diasDesdeChecks(dias),
        }),
      });
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo crear el turno');
    }
  }

  async function alternar(turno: Turno) {
    setError('');
    try {
      await consultar(`/api/turnos/${turno.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: !turno.activo }),
      });
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo actualizar');
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-mist">Horario</p>
        <h1 className="font-display text-4xl">Turnos</h1>
      </header>
      {error ? <Aviso texto={error} /> : null}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Panel className="h-fit p-4">
          <h2 className="mb-3 font-display text-2xl">Nuevo turno</h2>
          <form className="space-y-3" onSubmit={crear}>
            <Campo etiqueta="Nombre" value={nombre} onChange={(evento) => setNombre(evento.target.value)} required />
            <Campo etiqueta="Entrada" type="time" value={entrada} onChange={(evento) => setEntrada(evento.target.value)} required />
            <Campo etiqueta="Tolerancia (minutos)" type="number" min={0} max={180} value={tolerancia} onChange={(evento) => setTolerancia(evento.target.value)} required />
            <Campo etiqueta="Salida" type="time" value={salida} onChange={(evento) => setSalida(evento.target.value)} required />
            <div className="flex flex-wrap gap-2">
              {DIAS.map((dia, indice) => (
                <button
                  key={dia}
                  type="button"
                  onClick={() => setDias((actual) => actual.map((valor, i) => (i === indice ? !valor : valor)))}
                  className={`h-9 w-9 rounded-full text-sm font-bold ${dias[indice] ? 'bg-ink text-paper' : 'border border-line text-mist'}`}
                >
                  {dia}
                </button>
              ))}
            </div>
            <Boton type="submit">Crear turno</Boton>
          </form>
        </Panel>
        <div className="space-y-3">
          {turnos.map((turno) => (
            <Panel key={turno.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">{turno.nombre}</p>
                <p className="text-sm text-mist">
                  {turno.hora_entrada.slice(0, 5)} + {turno.tolerancia_minutos} min · sale {turno.hora_salida.slice(0, 5)}
                </p>
                <p className="mt-1 text-sm">{turno.dias_semana.split('').map((bit, indice) => (bit === '1' ? DIAS[indice] : '·')).join(' ')}</p>
              </div>
              <Boton variante="secundario" onClick={() => alternar(turno)}>{turno.activo ? 'Desactivar' : 'Activar'}</Boton>
            </Panel>
          ))}
          {turnos.length === 0 ? <Panel className="p-6 text-mist">Crea el horario de la oficina para poder marcar tardanzas y faltas.</Panel> : null}
        </div>
      </div>
    </div>
  );
}
