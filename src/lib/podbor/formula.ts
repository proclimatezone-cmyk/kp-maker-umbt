/**
 * Безопасный парсер арифметики для поля «Площадь» — можно ввести готовое
 * число или выражение (8*5, =8*5, 20+20), как в ячейке Excel. Никакого
 * eval(): простой рекурсивный спуск по +, -, *, /, скобкам.
 * Возвращает null, если строка не число и не корректное выражение.
 */
export function evalAreaFormula(input: string): number | null {
  if (input == null) return null;
  let expr = String(input).trim();
  if (!expr) return null;

  expr = expr.replace(/^=/, '').replace(/,/g, '.').replace(/\s+/g, '');
  if (!expr || !/^[0-9+\-*/().]+$/.test(expr)) return null;

  let i = 0;
  const peek = () => expr[i];

  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = expr[i++];
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = expr[i++];
      const rhs = parseFactor();
      if (op === '*') value *= rhs;
      else {
        if (rhs === 0) throw new Error('div by zero');
        value /= rhs;
      }
    }
    return value;
  }

  function parseFactor(): number {
    if (peek() === '+') { i++; return parseFactor(); }
    if (peek() === '-') { i++; return -parseFactor(); }
    if (peek() === '(') {
      i++;
      const value = parseExpr();
      if (expr[i] !== ')') throw new Error('unbalanced parens');
      i++;
      return value;
    }
    const start = i;
    while (i < expr.length && /[0-9.]/.test(expr[i])) i++;
    if (i === start) throw new Error('expected number');
    const num = parseFloat(expr.slice(start, i));
    if (isNaN(num)) throw new Error('bad number');
    return num;
  }

  try {
    const result = parseExpr();
    if (i !== expr.length) return null;
    if (!isFinite(result) || result < 0) return null;
    return Math.round(result * 100) / 100;
  } catch {
    return null;
  }
}
