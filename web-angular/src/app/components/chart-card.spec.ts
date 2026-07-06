import { TestBed } from '@angular/core/testing';
import type { ChartConfiguration } from 'chart.js';
import type { Dataset } from '@dairy/shared';
import { ChartCard } from './chart-card';

const dataset: Dataset = {
  datasetId: 'd1',
  kind: 'timeseries',
  scopeLabel: 'Kundi group',
  interval: 'day',
  points: [
    { periodStart: '2026-07-01', totalLitres: 100, avgPerAnimal: 5 },
    { periodStart: '2026-07-02', totalLitres: 110, avgPerAnimal: 5.5 },
  ],
};

describe('ChartCard', () => {
  // The chart canvas is not rendered here (jsdom lacks a 2D context); we verify
  // the Recharts -> Chart.js data mapping on the component instance instead.
  it('maps dataset points to two Chart.js line series', () => {
    const fixture = TestBed.createComponent(ChartCard);
    fixture.componentRef.setInput('dataset', dataset);
    const data = (
      fixture.componentInstance as unknown as {
        data: () => ChartConfiguration<'line'>['data'];
      }
    ).data();

    expect(data.labels).toEqual(['2026-07-01', '2026-07-02']);
    expect(data.datasets).toHaveLength(2);
    expect(data.datasets[0].label).toBe('Total litres');
    expect(data.datasets[0].data).toEqual([100, 110]);
    expect(data.datasets[0].borderColor).toBe('#8a6431');
    expect(data.datasets[1].label).toBe('Avg / animal');
    expect(data.datasets[1].data).toEqual([5, 5.5]);
    expect(data.datasets[1].borderDash).toEqual([4, 3]);
  });
});
