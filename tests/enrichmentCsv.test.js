const {
  parseCsv, buildCsv, escapeFormula, toCsvField, joinList,
  validateHeaders, sampleTemplateCsv,
  INPUT_COLUMNS, REVIEW_COLUMNS, FULL_EXPORT_COLUMNS
} = require('../src/enrichmentCsv');

describe('parseCsv', () => {
  test('parses a valid complete file', () => {
    const csv = 'email,Title Override\nfoo@bar.com,Central Cee\nx@y.com,Cannons\n';
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(['email', 'Title Override']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ email: 'foo@bar.com', 'Title Override': 'Central Cee' });
  });

  test('accepts only required columns populated', () => {
    const csv = 'email,Title Override\nfoo@bar.com,Central Cee';
    const { rows } = parseCsv(csv);
    expect(rows[0]['Title Override']).toBe('Central Cee');
  });

  test('handles quoted commas inside fields', () => {
    const csv = 'email,Title Override\n"a@b.com","Hey, that\'s me"\n';
    const { rows } = parseCsv(csv);
    expect(rows[0]['Title Override']).toBe("Hey, that's me");
  });

  test('handles unicode names', () => {
    const csv = 'email,Title Override\na@b.com,박현철\n';
    const { rows } = parseCsv(csv);
    expect(rows[0]['Title Override']).toBe('박현철');
  });

  test('skips empty rows', () => {
    const csv = 'email,Title Override\n\nx@y.com,Cannons\n\n';
    const { rows } = parseCsv(csv);
    expect(rows).toHaveLength(1);
  });

  test('strips UTF-8 BOM', () => {
    const csv = '﻿email,Title Override\nfoo@bar.com,Cannons\n';
    const { headers } = parseCsv(csv);
    expect(headers).toEqual(['email', 'Title Override']);
  });

  test('handles embedded newlines inside quotes', () => {
    const csv = 'email,Title Override\n"a@b.com","Line1\nLine2"\n';
    const { rows } = parseCsv(csv);
    expect(rows[0]['Title Override']).toBe('Line1\nLine2');
  });

  test('handles CRLF line endings', () => {
    const csv = 'email,Title Override\r\nfoo@bar.com,Cannons\r\n';
    const { rows } = parseCsv(csv);
    expect(rows[0].email).toBe('foo@bar.com');
  });

  test('preserves escaped double quotes', () => {
    const csv = 'email,Title Override\na@b.com,"She said ""hi"""\n';
    const { rows } = parseCsv(csv);
    expect(rows[0]['Title Override']).toBe('She said "hi"');
  });
});

describe('validateHeaders', () => {
  test('missing required column detected', () => {
    const r = validateHeaders(['email']);
    expect(r.missingRequired).toEqual(['Title Override']);
  });

  test('unknown columns reported', () => {
    const r = validateHeaders(['email', 'Title Override', 'random_col']);
    expect(r.unknownColumns).toEqual(['random_col']);
    expect(r.missingRequired).toEqual([]);
  });

  test('all required columns present', () => {
    const r = validateHeaders(INPUT_COLUMNS);
    expect(r.missingRequired).toEqual([]);
  });
});

describe('escapeFormula (CSV injection guard)', () => {
  test('prefixes leading = with apostrophe', () => {
    expect(escapeFormula('=SUM(A1)')).toBe("'=SUM(A1)");
  });
  test('prefixes leading + / - / @', () => {
    expect(escapeFormula('+cmd')).toBe("'+cmd");
    expect(escapeFormula('-2+3')).toBe("'-2+3");
    expect(escapeFormula('@include')).toBe("'@include");
  });
  test('leaves safe values alone', () => {
    expect(escapeFormula('Central Cee')).toBe('Central Cee');
    expect(escapeFormula('')).toBe('');
  });
  test('prefixes leading tab / CR', () => {
    expect(escapeFormula('\tHIDDEN')).toBe("'\tHIDDEN");
  });
});

describe('toCsvField', () => {
  test('quotes fields with commas', () => {
    expect(toCsvField('a,b')).toBe('"a,b"');
  });
  test('escapes double quotes', () => {
    expect(toCsvField('say "hi"')).toBe('"say ""hi"""');
  });
  test('applies formula-injection escape then quoting when needed', () => {
    expect(toCsvField('=SUM(1,2)')).toBe(`"'=SUM(1,2)"`);
  });
});

describe('joinList', () => {
  test('comma-delimits with a space after each comma', () => {
    expect(joinList(['a', 'b', 'c'])).toBe('a, b, c');
  });
  test('filters empty entries and trims', () => {
    expect(joinList(['a', '', ' b ', null])).toBe('a, b');
  });
  test('returns empty for non-array input', () => {
    expect(joinList(null)).toBe('');
    expect(joinList('single')).toBe('single');
  });
});

describe('buildCsv', () => {
  test('exports columns in the required canonical order', () => {
    const row = {};
    for (const c of INPUT_COLUMNS) row[c] = '';
    row.email = 'a@b.com';
    row['Title Override'] = 'Central Cee';
    const csv = buildCsv(INPUT_COLUMNS, [row]);
    const lines = csv.split('\n');
    expect(lines[0].split(',')).toEqual(INPUT_COLUMNS);
  });

  test('review columns append after input columns in full export', () => {
    expect(FULL_EXPORT_COLUMNS.slice(0, INPUT_COLUMNS.length)).toEqual(INPUT_COLUMNS);
    expect(FULL_EXPORT_COLUMNS.slice(INPUT_COLUMNS.length)).toEqual(REVIEW_COLUMNS);
  });

  test('escapes injection strings in output', () => {
    const row = {};
    for (const c of INPUT_COLUMNS) row[c] = '';
    row.email = 'a@b.com';
    row['Title Override'] = '=EVIL()';
    const csv = buildCsv(INPUT_COLUMNS, [row]);
    // Value must be apostrophe-prefixed. Quoting is optional (no
    // special chars in "'=EVIL()") — both forms neutralize the formula.
    expect(csv).toMatch(/(?:^|,)('=EVIL\(\)|"'=EVIL\(\)")(?:,|\n|$)/m);
  });

  test('escapes injection strings that also need quoting', () => {
    const row = {};
    for (const c of INPUT_COLUMNS) row[c] = '';
    row.email = 'a@b.com';
    row['Title Override'] = '=SUM(1,2)';  // has a comma → must quote
    const csv = buildCsv(INPUT_COLUMNS, [row]);
    expect(csv).toContain(`"'=SUM(1,2)"`);
  });
});

describe('sampleTemplateCsv', () => {
  test('has the expected header line', () => {
    const csv = sampleTemplateCsv();
    const header = csv.split('\n')[0];
    expect(header.split(',').slice(0, 6)).toEqual([
      'email','first_name','last_name','full_name','stage_name','Title Override'
    ]);
  });
});
