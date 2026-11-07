import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(process.cwd(), 'src/components/board-table/table.module.css'),
  'utf8',
);

/** Body of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} rule exists`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
}

// Regression: full-bleed cells (Status, Priority) paint an absolute pill over the cell's own
// outline, so the bulk-edit highlight was invisible. It must be an overlay above the content.
describe('bulk-edit column highlight', () => {
  it('draws an ::after overlay that ignores the pointer and paints above the cell content', () => {
    const body = rule('.cellBulk::after');
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/inset:\s*0/);
    expect(body).toMatch(/pointer-events:\s*none/);
    expect(body).toMatch(/z-index:\s*var\(--atrium-z-raised\)/);
    expect(body).toMatch(/box-shadow:\s*inset[^;]*var\(--atrium-table-bulk-outline-width\)/);
  });

  it('does not rely on the cell outline, which coloured cells paint over', () => {
    expect(rule('.cellBulk')).not.toMatch(/outline/);
  });
});
