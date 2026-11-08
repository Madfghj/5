import type { CalendarEvent, ResponseValue } from './types';
export const timeSlots = Array.from({ length: 25 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const parseDate = (key: string) => { const [y,m,d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (date: Date, amount: number) => { const copy = new Date(date); copy.setDate(copy.getDate() + amount); return copy; };
export function monthDays(date: Date): Date[] {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const offset = (start.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => addDays(start, i - offset));
}
export function weekDays(date: Date): Date[] {
  const offset = (date.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => addDays(date, i - offset));
}
export const sortedEvents = (events: CalendarEvent[]) => [...events].sort((a,b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
export const counts = (event: CalendarEvent) => Object.values(event.responses).reduce((out, value) => ({ ...out, [value]: out[value] + 1 }), { yes: 0, no: 0, maybe: 0 } as Record<ResponseValue, number>);
export function icsText(events: CalendarEvent[]): string {
  const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/,'');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//OpenCalendar.space//Calendar//RU','CALSCALE:GREGORIAN'];
  for (const event of events) {
    const day = event.date.replace(/-/g,'');
    lines.push('BEGIN:VEVENT',`UID:${escape(event.id)}@opencalendar.space`,`DTSTAMP:${stamp}`,`DTSTART:${day}T${event.startTime.replace(':','')}00`,`DTEND:${day}T${event.endTime.replace(':','')}00`,`SUMMARY:${escape(event.title)}`,`LOCATION:${escape(event.location)}`,`DESCRIPTION:${escape(event.notes)}`,'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // RFC 5545 folding counts UTF-8 octets, preserving multibyte characters.
  return lines.map(line => { let out='', row='', size=0; for(const char of line) { const length = new TextEncoder().encode(char).length; if(size + length > 73) { out += row+'\r\n '; row=''; size=1; } row+=char; size+=length; } return out+row; }).join('\r\n') + '\r\n';
}
