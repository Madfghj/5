import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, counts, dateKey, icsText, monthDays, parseDate,
  sortedEvents, timeSlots, weekDays,
} from '../src/calendar.ts';

const localDay = (key) => parseDate(key);

test('time selection has exactly the requested half-hour steps from 08:00 to 20:00', () => {
  assert.equal(timeSlots.length, 25);
  assert.equal(timeSlots[0], '08:00');
  assert.equal(timeSlots.at(-1), '20:00');
  assert.equal(new Set(timeSlots).size, timeSlots.length);
  const minutes = timeSlots.map((value) => {
    assert.match(value, /^\d{2}:(00|30)$/);
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  });
  for (let index = 1; index < minutes.length; index++) {
    assert.equal(minutes[index] - minutes[index - 1], 30);
  }
});

test('February in a leap year contains February 29 once and starts its grid on Monday', () => {
  const days = monthDays(localDay('2024-02-29'));
  assert.equal(days.length, 42);
  assert.equal(days[0].getDay(), 1);
  assert.equal(dateKey(days[0]), '2024-01-29');
  assert.equal(dateKey(days.at(-1)), '2024-03-10');
  assert.equal(days.filter((day) => dateKey(day) === '2024-02-29').length, 1);
  assert.equal(days.filter((day) => day.getMonth() === 1).length, 29);
});

test('month grids handle a previous year and a month whose first day is Monday', () => {
  const january = monthDays(localDay('2027-01-15'));
  assert.equal(dateKey(january[0]), '2026-12-28');
  assert.equal(dateKey(january.at(-1)), '2027-02-07');
  assert.equal(january.filter((day) => day.getMonth() === 0).length, 31);
  const mondayMonth = monthDays(localDay('2021-02-20'));
  assert.equal(dateKey(mondayMonth[0]), '2021-02-01');
  assert.equal(new Set(mondayMonth.map(dateKey)).size, 42);
});

test('week navigation stays continuous over New Year and does not mutate its input', () => {
  const input = localDay('2026-12-31');
  const before = input.getTime();
  assert.deepEqual(weekDays(input).map(dateKey), [
    '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
    '2027-01-01', '2027-01-02', '2027-01-03',
  ]);
  assert.equal(input.getTime(), before);
  assert.equal(dateKey(addDays(input, 1)), '2027-01-01');
  assert.equal(dateKey(addDays(localDay('2027-01-01'), -1)), '2026-12-31');
});

test('date arithmetic preserves calendar days across daylight saving changes', () => {
  const originalZone = process.env.TZ;
  process.env.TZ = 'Europe/Zurich';
  try {
    for (const [day, expected] of [
      ['2026-03-28', '2026-03-29'],
      ['2026-03-29', '2026-03-30'],
      ['2026-10-24', '2026-10-25'],
      ['2026-10-25', '2026-10-26'],
    ]) {
      const result = addDays(localDay(day), 1);
      assert.equal(dateKey(result), expected);
      assert.equal(result.getHours(), 12);
    }
  } finally {
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  }
});

const event = (overrides = {}) => ({
  id: 'event-1', groupId: 'group-1', createdBy: 'user-1',
  title: 'Friends', date: '2026-12-31', startTime: '18:00', endTime: '19:30',
  location: 'Home', notes: '', responses: {}, ...overrides,
});

test('event order follows dates and times without changing the source list', () => {
  const input = [
    event({ id: 'c', date: '2027-01-01', startTime: '08:00' }),
    event({ id: 'b', startTime: '18:30' }),
    event({ id: 'a', startTime: '08:30' }),
  ];
  assert.deepEqual(sortedEvents(input).map(({ id }) => id), ['a', 'b', 'c']);
  assert.deepEqual(input.map(({ id }) => id), ['c', 'b', 'a']);
  assert.deepEqual(counts(event({ responses: { a: 'yes', b: 'maybe', c: 'yes', d: 'no' } })), {
    yes: 2, no: 1, maybe: 1,
  });
  assert.deepEqual(counts(event()), { yes: 0, no: 0, maybe: 0 });
});

test('calendar export escapes text and prevents multiline event injection', () => {
  const output = icsText([event({
    title: 'Встреча, игра; C:\\Pixel\\World\nВторая строка 🌿',
    location: 'Дом; сад, терраса',
    notes: 'Строка 1\r\nEND:VEVENT\r\nBEGIN:VEVENT\nСтрока 2',
  })]);
  const unfolded = output.replace(/\r\n[ \t]/g, '');
  assert.ok(output.endsWith('\r\n'));
  assert.doesNotMatch(output, /(?<!\r)\n/);
  assert.ok(unfolded.includes('SUMMARY:Встреча\\, игра\\; C:\\\\Pixel\\\\World\\nВторая строка 🌿\r\n'));
  assert.ok(unfolded.includes('LOCATION:Дом\\; сад\\, терраса\r\n'));
  assert.ok(unfolded.includes('DESCRIPTION:Строка 1\\nEND:VEVENT\\nBEGIN:VEVENT\\nСтрока 2\r\n'));
  assert.equal(unfolded.split('\r\n').filter((line) => line === 'BEGIN:VEVENT').length, 1);
  assert.equal(unfolded.split('\r\n').filter((line) => line === 'END:VEVENT').length, 1);
  assert.ok(unfolded.includes('DTSTART:20261231T180000\r\n'));
  assert.ok(unfolded.includes('DTEND:20261231T193000\r\n'));
  assert.match(unfolded, /DTSTAMP:\d{8}T\d{6}Z\r\n/);
});

test('RFC 5545 folding limits physical lines to 75 UTF-8 octets and preserves emoji', () => {
  const title = '🌿Планы с друзьями 🧱'.repeat(18);
  const notes = 'éЖ😀漢字'.repeat(40);
  const output = icsText([event({ title, notes })]);
  const physicalLines = output.split('\r\n');
  assert.ok(physicalLines.some((line) => line.startsWith(' ')), 'Long properties must use continuation lines');
  for (const line of physicalLines) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `Line is too long: ${Buffer.byteLength(line, 'utf8')} octets`);
    assert.doesNotMatch(line, /\uFFFD/, 'Folding must not split multibyte characters');
  }
  const unfolded = output.replace(/\r\n[ \t]/g, '');
  assert.ok(unfolded.includes(`SUMMARY:${title}\r\n`));
  assert.ok(unfolded.includes(`DESCRIPTION:${notes}\r\n`));
});

test('an empty calendar still exports a complete VCALENDAR document', () => {
  const output = icsText([]);
  assert.ok(output.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(output.endsWith('END:VCALENDAR\r\n'));
  assert.doesNotMatch(output, /BEGIN:VEVENT/);
});
