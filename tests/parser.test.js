const P = require('../parser.js');
const assert = require('assert');
const text = `[04.11.2026 21:00] Айбол: Среда 
Жим лежа - 4х8 25кг
Жим лежа(30°) - 1х19 20кг 2х10 15кг
Разведенре гантелей лежа - 3х12 8кг
Гантели на бицепс - 2х12 9кг 1х3 9кг(во втором подходе последние 4 были с читнгом, и последний подход уже был на пределе, 3 раза 8кг, 3 раза 7кг)
Молотки на бицепс - 3х12 7кг

[07.11.2026 20:54] Айбол: Птяница
Low Row machine - 4х7 65кг
Vertical Traction machine - 5x7 50кг
Поднятин туловища с весом -  2х12 5кг 1х12 10кг
Брусья - 4х20
Французский жим - 1х12 6кг 2х12 7кг
Пресс - 3х12

[08.11.2026 20:43] Айбол: Воскресенье
Приседания в смитте - 4х8 25кг
Жим ногами - 4х10  90кг
Leg extension - 1х12 30кг 2x12 25кг
Lrg curl - 3x12 35кг
Икры - 3х12 80кг
Жим гантелей сидя - 3х10 1x8 16кг
Махи в стороны - 12 15 15 10 6кг
Разведения рук лежа - 3х15 4кг`;
const r = P.parseText(text, '2026-11-12');
assert.strictEqual(r.errors.length, 0, JSON.stringify(r.errors));
assert.strictEqual(r.days.length, 3);
assert.deepStrictEqual(r.days.map(d=>[d.d,d.t,d.ex.length]), [['2026-11-04','Среда',5],['2026-11-06','Птяница',6],['2026-11-08','Воскресенье',8]]);
const ex = (di, i) => r.days[di].ex[i];
assert.deepStrictEqual(ex(0,1).s, [[19,20],[10,15],[10,15]]);
assert.strictEqual(ex(0,1).n, 'Жим лежа(30°)');
assert.deepStrictEqual(ex(0,3).s, [[12,9],[12,9],[3,9]]);
assert.ok(ex(0,3).c.startsWith('во втором'));
assert.deepStrictEqual(ex(1,3).s, [[20,null],[20,null],[20,null],[20,null]]);
assert.deepStrictEqual(ex(2,5).s, [[10,16],[10,16],[10,16],[8,16]]);
assert.deepStrictEqual(ex(2,6).s, [[12,6],[15,6],[15,6],[10,6]]);
// round trip
for (const d of r.days) for (const e of d.ex) {
  const back = P.parseExercise(P.formatExercise(e));
  assert.deepStrictEqual(back.s, e.s, P.formatExercise(e));
}
console.log(r.days.map(d => P.formatDay(d.d, d)).join('\n\n'));
// misc
assert.deepStrictEqual(P.parseExercise('Брусья 4х20').s.length, 4);
assert.deepStrictEqual(P.parseExercise('Т-гриф - 4х8 12,5кг').s[0], [8,12.5]);
assert.strictEqual(P.parseExercise('Т-гриф - 4х8 12,5кг').n, 'Т-гриф');
assert.strictEqual(P.parseExercise('Планка - 3х60 с паузой').c, 'с паузой');
const r2 = P.parseText('Ноги\nПрисед - 5х5 60кг\nерунда 1 2 x', '2026-11-12');
assert.strictEqual(r2.days[0].t, 'Ноги'); assert.strictEqual(r2.days[0].d, '2026-11-12');
assert.strictEqual(P.weekday('2026-11-12'), 'Четверг');
assert.strictEqual(r.days[1].orig, '2026-11-07');
assert.strictEqual(P.weekdayFromTitle('Птяница'), 5); assert.strictEqual(P.weekdayFromTitle('Пресс'), null); assert.strictEqual(P.weekdayFromTitle('Ноги'), null);
console.log('\nOK, errors2=', r2.errors);
