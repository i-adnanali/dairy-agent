import assert from 'node:assert';
import { test } from 'node:test';
import { coarsenInterval, shapeMilkYield } from './shaper';
import type { Milking } from '@dairy/shared';

test('coarsenInterval: day stays day within 90 days', () => {
  const r = coarsenInterval('day', 30);
  assert.equal(r.interval, 'day');
  assert.equal(r.coarsened, false);
});

test('coarsenInterval: day -> week past 90 days', () => {
  const r = coarsenInterval('day', 120);
  assert.equal(r.interval, 'week');
  assert.equal(r.coarsened, true);
});

test('coarsenInterval: day -> month past 365 days', () => {
  const r = coarsenInterval('day', 400);
  assert.equal(r.interval, 'month');
  assert.equal(r.coarsened, true);
});

test('shapeMilkYield: digest summarises without leaking every row', () => {
  const rows: Milking[] = [];
  // 10 days, 2 sessions/day, 1 animal
  for (let d = 0; d < 10; d++) {
    const date = `2026-01-${String(d + 1).padStart(2, '0')}`;
    rows.push({ id: `m${d}a`, animal_id: 'animal_001', date, session: 'morning', yield_litres: 5 });
    rows.push({ id: `m${d}b`, animal_id: 'animal_001', date, session: 'evening', yield_litres: 5 });
  }
  const { digest, dataset } = shapeMilkYield({
    rows,
    animalCount: 1,
    scopeLabel: 'B-001',
    from: '2026-01-01',
    to: '2026-01-10',
    requestedInterval: 'day',
  });
  assert.equal(digest.bucketCount, 10);
  assert.equal(digest.totalLitres, 100);
  // dataset carries the full series; digest carries only summary fields.
  assert.equal(dataset.points.length, 10);
  assert.ok(!('points' in (digest as unknown as Record<string, unknown>)));
});
