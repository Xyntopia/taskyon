/** Rumoca's retained, in-memory table descriptor. IDs stay strings in generated JS. */
export type NativeTableData = {
  id: string
  data: number[][]
  columns: number[]
  smoothness: number
  extrapolation: number
}

/**
 * Self-contained by design: the renderer embeds this function's compiled JavaScript
 * in each generated Model. Do not capture imports or module-scope runtime values.
 * These operations execute without loading the numerical simulation solver.
 */
export function createNativeTableRuntime(externalTables: NativeTableData[]) {
  function lookupTable(id: number) {
    const rounded = Math.round(id)
    if (
      !Number.isFinite(id) ||
      Math.abs(rounded - id) > 1e-6 ||
      rounded <= 0 ||
      rounded >= 18446744073709551616
    )
      throw new Error('Invalid external table id')
    const table = externalTables.find((table) => BigInt(table.id) === BigInt(rounded))
    if (!table) throw new Error('External table data was not provided: ' + id)
    return table
  }
  function tableBounds(table: NativeTableData) {
    const first = table.data[0]?.[0],
      last = table.data.at(-1)?.[0]
    if (typeof first !== 'number' || typeof last !== 'number')
      throw new Error('External table has no bounds')
    return [first, last] as const
  }
  function tableRow(table: NativeTableData, index: number, column: number) {
    const value = table.data[index]?.[column]
    if (typeof value !== 'number') throw new Error('External table row is missing a column')
    return value
  }
  function tableColumn(table: NativeTableData, column: number) {
    const count = table.columns.length || Math.max(0, (table.data[0]?.length || 0) - 1),
      rounded = Math.round(column)
    if (
      !Number.isFinite(column) ||
      Math.abs(rounded - column) > 1e-9 ||
      rounded < 1 ||
      rounded > count
    )
      throw new Error('External table column out of range')
    const selected = table.columns.length ? table.columns[rounded - 1]! - 1 : rounded
    if (!Number.isInteger(selected) || selected < 0 || selected >= table.data[0]!.length)
      throw new Error('Invalid external table column metadata')
    return selected
  }
  function akimaSlopes(xs: number[], ys: number[]) {
    const n = xs.length,
      d = new Array<number>(n + 3).fill(0),
      slopes: number[] = []
    for (let i = 0; i < n - 1; i++) d[i + 2] = (ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!)
    d[0] = 3 * d[2]! - 2 * d[3]!
    d[1] = 2 * d[2]! - d[3]!
    d[n + 1] = 2 * d[n]! - d[n - 1]!
    d[n + 2] = 3 * d[n]! - 2 * d[n - 1]!
    for (let j = 0; j < n; j++) {
      const right = Math.abs(d[j + 3]! - d[j + 2]!),
        left = Math.abs(d[j + 1]! - d[j]!),
        sum = right + left
      const a = left / sum
      slopes.push(sum > 0 ? (1 - a) * d[j + 1]! + a * d[j + 2]! : 0.5 * d[j + 1]! + 0.5 * d[j + 2]!)
    }
    return slopes
  }
  function akimaCoefficients(xs: number[], ys: number[], slopes: number[], i: number) {
    const dx = xs[i + 1]! - xs[i]!,
      secant = (ys[i + 1]! - ys[i]!) / dx,
      c2 = slopes[i]!,
      next = slopes[i + 1]!
    return [(c2 + next - 2 * secant) / (dx * dx), (3 * secant - 2 * c2 - next) / dx, c2] as const
  }
  function akimaLookup(
    table: NativeTableData,
    column: number,
    x: number,
    segment: number,
    outside: boolean,
    preserve: boolean,
  ) {
    const xs = table.data.map((_, i) => tableRow(table, i, 0)),
      ys = table.data.map((_, i) => tableRow(table, i, column))
    const slopes = akimaSlopes(xs, ys),
      last = xs.length - 1
    if (outside && preserve) {
      if (x < xs[0]!) {
        const slope = akimaCoefficients(xs, ys, slopes, 0)[2]
        return { value: ys[0]! + slope * (x - xs[0]!), slope }
      }
      const [a, b, c] = akimaCoefficients(xs, ys, slopes, last - 1),
        v = xs[last]! - xs[last - 1]!,
        slope = (3 * a * v + 2 * b) * v + c
      return { value: ys[last]! + slope * (x - xs[last]!), slope }
    }
    const [a, b, c] = akimaCoefficients(xs, ys, slopes, segment),
      v = x - xs[segment]!
    return {
      value: ys[segment]! + ((a * v + b) * v + c) * v,
      slope: preserve ? (3 * a * v + 2 * b) * v + c : 0,
    }
  }
  // Mirrors `rumoca-eval-solve::table_runtime::eval_table_1d_lookup` and its
  // `extrapolated_x`: unknown smoothness falls back to linear, and every
  // holding extrapolation (HoldLastPoint, NoExtrapolation, unknown) clamps to
  // the last knot instead of refusing the read.
  function tableLookup(table: NativeTableData, column: number, input: number) {
    if ((table.data[0]?.length || 0) < 2)
      throw new Error('External table requires x and output columns')
    const selected = tableColumn(table, column),
      [min, max] = tableBounds(table),
      last = table.data.length - 1
    if (last === 0) return { value: tableRow(table, 0, selected), slope: 0 }
    if (min === max) return { value: tableRow(table, input < min ? 0 : last, selected), slope: 0 }
    let x = input,
      outside = false,
      preserve = true
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max && (x < min || x > max)) {
      if (table.extrapolation === 2) outside = true
      else if (table.extrapolation === 3) {
        let wrapped = (x - min) % (max - min)
        if (wrapped < 0) wrapped += max - min
        x = min + wrapped
      } else {
        x = Math.max(min, Math.min(max, x))
        outside = true
        preserve = false
      }
    }
    let segment = 0
    if (x <= min) segment = 0
    else if (x >= max) segment = last - 1
    else if (x > min) {
      while (segment + 1 < table.data.length && x >= tableRow(table, segment + 1, 0)) segment++
      segment = Math.min(segment, last - 1)
    }
    const next = Math.min(segment + 1, last),
      x0 = tableRow(table, segment, 0),
      x1 = tableRow(table, next, 0),
      y0 = tableRow(table, segment, selected),
      y1 = tableRow(table, next, selected)
    if (table.smoothness === 3 && !outside)
      return { value: x >= max ? tableRow(table, last, selected) : y0, slope: 0 }
    if (Math.abs(x1 - x0) <= Number.EPSILON) return { value: y0, slope: 0 }
    if (table.smoothness === 2 && table.data.length >= 3)
      return akimaLookup(table, selected, x, segment, outside, preserve)
    const slope = (y1 - y0) / (x1 - x0)
    return { value: y0 + (x - x0) * slope, slope: preserve ? slope : 0 }
  }
  function tableNextEvent(table: NativeTableData, time: number) {
    const knots = table.data
      .map((row) => row[0])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    if (knots.length === 0) return Number.MAX_VALUE
    if (table.extrapolation === 3) {
      const [min, max] = tableBounds(table),
        span = max - min
      if (span > 1e-12) {
        const cycle = Math.floor((time - min) / span)
        if (!Number.isFinite(cycle) || cycle < -9223372036854775808 || cycle >= 9223372036854775808)
          throw new Error('Periodic table event cycle out of range')
        const start = BigInt(cycle) - 1n,
          end = BigInt(cycle) + 2n
        if (start < -9223372036854775808n || end > 9223372036854775807n)
          throw new Error('Periodic table event cycle overflows')
        let next = Number.MAX_VALUE
        for (let n = start; n <= end; n++)
          for (const knot of knots) {
            const candidate = knot + Number(n) * span
            if (candidate > time + 1e-12 && candidate < next) next = candidate
          }
        return next
      }
    }
    return knots.find((knot) => knot > time + 1e-12) ?? Number.MAX_VALUE
  }
  return { lookupTable, tableBounds, tableLookup, tableNextEvent }
}
