import { RecordWatch } from './record-watch';

describe('RecordWatch', () => {
  it('announces a power record once, when the rolling average beats it', () => {
    const w = new RecordWatch({ BEST_5S: 500, BEST_1MIN: 400 });
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) expect(w.onSecond(600, i * 10)).toEqual([]);
    const fifth = w.onSecond(600, 40);
    expect(fifth).toEqual([{ metric: 'BEST_5S', value: 600 }]);
    for (let i = 0; i < 70; i++) seen.push(...w.onSecond(600, 50 + i * 10).map((r) => r.metric));
    expect(seen).toEqual(['BEST_1MIN']);
  });

  it('does not watch records that do not exist yet', () => {
    const w = new RecordWatch({});
    for (let i = 0; i < 100; i++) expect(w.onSecond(1000, i * 100)).toEqual([]);
  });

  it('uses a sliding window, not the ride average', () => {
    const w = new RecordWatch({ BEST_5S: 380 });
    for (let i = 0; i < 20; i++) w.onSecond(100, 0);
    const out = [];
    for (let i = 0; i < 5; i++) out.push(...w.onSecond(400, 0));
    expect(out).toEqual([{ metric: 'BEST_5S', value: 400 }]);
  });

  it('announces the longest ride when the distance passes it', () => {
    const w = new RecordWatch({ LONGEST_RIDE: 1000 });
    expect(w.onSecond(200, 999)).toEqual([]);
    expect(w.onSecond(200, 1001)).toEqual([{ metric: 'LONGEST_RIDE', value: 1001 }]);
    expect(w.onSecond(200, 2000)).toEqual([]);
  });
});
