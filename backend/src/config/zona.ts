/**
 * Se importa antes que el resto para que Node interprete la hora local
 * como America/Lima. Peru no aplica horario de verano.
 */
process.env.TZ = 'America/Lima';
