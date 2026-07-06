import { TestBed } from '@angular/core/testing';
import type { ToolCallView } from '@dairy/shared';
import { ToolCallChip } from './tool-call-chip';

const call: ToolCallView = {
  toolUseId: 't1',
  name: 'get_milk_timeseries',
  status: 'done',
  argSummary: '{"group":"Kundi"}',
};

describe('ToolCallChip', () => {
  it('renders name + status and toggles the arg summary on click', () => {
    const fixture = TestBed.createComponent(ToolCallChip);
    fixture.componentRef.setInput('call', call);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain('get_milk_timeseries');
    expect(el.textContent).toContain('done');
    expect(el.textContent).not.toContain('{"group":"Kundi"}');

    el.querySelector('button')!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('{"group":"Kundi"}');
  });

  it('applies error styling for error status', () => {
    const fixture = TestBed.createComponent(ToolCallChip);
    fixture.componentRef.setInput('call', { ...call, status: 'error' });
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(button.className).toContain('text-red-700');
  });
});
