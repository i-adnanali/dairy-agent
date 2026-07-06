import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ChartConfiguration } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import type { Dataset } from '@dairy/shared';

// Port of web-react/src/components/ChartCard.tsx (Recharts -> Chart.js via ng2-charts).
@Component({
  selector: 'app-chart-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseChartDirective],
  template: `
    <div class="rounded-xl border border-farm-200 bg-white p-4 shadow-sm">
      <div class="mb-2 flex items-baseline justify-between">
        <h3 class="text-sm font-semibold text-farm-800">
          {{ dataset().scopeLabel }} — {{ dataset().interval }}ly yield
        </h3>
        <span class="text-xs text-farm-500">{{ dataset().points.length }} points</span>
      </div>
      <div class="h-56 w-full">
        <canvas baseChart type="line" [data]="data()" [options]="options"></canvas>
      </div>
    </div>
  `,
})
export class ChartCard {
  readonly dataset = input.required<Dataset>();

  protected readonly data = computed<ChartConfiguration<'line'>['data']>(() => {
    const points = this.dataset().points;
    return {
      labels: points.map((p) => p.periodStart),
      datasets: [
        {
          label: 'Total litres',
          data: points.map((p) => p.totalLitres),
          borderColor: '#8a6431',
          backgroundColor: '#8a6431',
          borderWidth: 2,
          pointRadius: 0,
          cubicInterpolationMode: 'monotone',
        },
        {
          label: 'Avg / animal',
          data: points.map((p) => p.avgPerAnimal),
          borderColor: '#c29b5c',
          backgroundColor: '#c29b5c',
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          cubicInterpolationMode: 'monotone',
        },
      ],
    };
  });

  protected readonly options: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, labels: { font: { size: 12 } } },
      tooltip: { enabled: true },
    },
    scales: {
      x: {
        grid: { color: '#e6d7b8' },
        border: { color: '#8a6431' },
        ticks: { font: { size: 11 }, color: '#8a6431' },
      },
      y: {
        grid: { color: '#e6d7b8' },
        border: { color: '#8a6431' },
        ticks: { font: { size: 11 }, color: '#8a6431' },
      },
    },
  };
}
