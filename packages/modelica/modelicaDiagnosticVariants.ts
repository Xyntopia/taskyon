import type {
  DiagnosticsTestContext,
  TaskyonTestFn,
  TestRecord,
} from '@taskyon/common/modules/diagnosticsRunner'

export type ModelicaGenerator = 'dae' | 'solve'

export interface ModelicaGeneratorDiagnostic extends TaskyonTestFn {
  (context?: DiagnosticsTestContext, generator?: ModelicaGenerator): unknown
  modelicaGenerators?: readonly ModelicaGenerator[]
}

/** One discovery boundary for Modelica diagnostics in Node and browser runtimes. */
export function collectModelicaDiagnosticTests(
  module: Readonly<Record<string, unknown>>,
): TestRecord {
  return Object.fromEntries(
    Object.entries(module)
      .filter(([name, value]) => name.startsWith('testModelica') && typeof value === 'function')
      .flatMap(([name, value]) => {
        const diagnostic = value as ModelicaGeneratorDiagnostic
        if (!diagnostic.modelicaGenerators) return [[name, diagnostic] as const]
        return diagnostic.modelicaGenerators.map((generator) => {
          const run = Object.assign(
            (context?: DiagnosticsTestContext) => diagnostic(context, generator),
            diagnostic,
          )
          return [`${name}${generator === 'dae' ? 'Dae' : 'Solve'}`, run] as const
        })
      }),
  )
}
