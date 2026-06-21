import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serializeObject } from '../modules/serializeObject'
import { resolveCachedModelicaLibraryZipPath } from './modelicaLibraryCacheNode'

const MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS = {
  format: 'json' as const,
  maxDepth: 6,
  maxArrayLength: 10,
  maxObjectKeys: 35,
  maxStringLength: 1200,
  indent: 2,
}

const execFileAsync = (file: string, args: string[]): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              [
                error.message,
                stdout ? `stdout:\n${stdout}` : '',
                stderr ? `stderr:\n${stderr}` : '',
              ]
                .filter(Boolean)
                .join('\n'),
            ),
          )
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })

export async function runModelicaCliMslFirstOrderRumocaSimulation() {
  const resolvedMslZipPath = await resolveCachedModelicaLibraryZipPath()
  const debug: Record<string, unknown> = {
    phase: 'init',
    mslZipPath: resolvedMslZipPath,
  }
  const tempDir = await mkdtemp(join(tmpdir(), 'taskyon-modelica-cli-'))
  const sourcePath = join(tempDir, 'MslFirstOrderCliSmoke.mo')

  try {
    const source = `
model MslFirstOrderCliSmoke
  Modelica.Blocks.Sources.Step step(height = 1, startTime = 0.1);
  Modelica.Blocks.Continuous.FirstOrder firstOrder(T = 0.5, k = 1);
equation
  connect(step.y, firstOrder.u);
end MslFirstOrderCliSmoke;
`.trim()
    await writeFile(sourcePath, `${source}\n`, 'utf8')
    debug.sourcePath = sourcePath
    debug.phase = 'exec-cli'

    const cliUrl = new URL('./modelica_cli.mjs', import.meta.url)
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      cliUrl.pathname,
      'simulate-model',
      '--msl-zip',
      resolvedMslZipPath,
      '--model',
      'MslFirstOrderCliSmoke',
      '--source-file',
      sourcePath,
      '--use-source-roots',
      '--t-end',
      '1',
      '--dt',
      '0.02',
      '--solver',
      'auto',
      '--json',
    ])
    debug.stderr = stderr

    const parsed = JSON.parse(stdout) as {
      simulation?: {
        simulation?: {
          payload?: {
            names?: string[]
            allData?: number[][]
            nStates?: number
          }
        }
      }
    }
    const payload = parsed.simulation?.simulation?.payload
    const names = Array.isArray(payload?.names) ? payload.names : []
    const allData = Array.isArray(payload?.allData) ? payload.allData : []
    const times = Array.isArray(allData[0]) ? allData[0] : []
    const firstOrderIndex = names.indexOf('firstOrder.y')
    const firstOrderSeries: number[] =
      firstOrderIndex >= 0 && Array.isArray(allData[firstOrderIndex + 1])
        ? (allData[firstOrderIndex + 1] as number[])
        : []

    debug.payloadPreview = {
      names: names.slice(0, 12),
      nStates: payload?.nStates,
      timeSamples: times.length,
      firstOrderSamples: firstOrderSeries.slice(0, 8),
    }

    if (times.length < 10) {
      throw new Error(`CLI simulation returned too few time samples: ${times.length}`)
    }
    if (firstOrderIndex < 0) {
      throw new Error(`CLI simulation payload missing firstOrder.y series: ${names.join(', ')}`)
    }
    if (firstOrderSeries.length !== times.length) {
      throw new Error(
        `CLI simulation firstOrder.y length mismatch: series=${firstOrderSeries.length}, times=${times.length}`,
      )
    }
    const finiteValues = firstOrderSeries.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    )
    if (finiteValues.length !== firstOrderSeries.length) {
      throw new Error('CLI simulation firstOrder.y contains non-finite values')
    }
    const start = firstOrderSeries[0] ?? Number.NaN
    const finish = firstOrderSeries[firstOrderSeries.length - 1] ?? Number.NaN
    if (!(finish > start + 0.2)) {
      throw new Error(
        `CLI simulation firstOrder.y did not respond to the step input as expected (start=${start}, end=${finish})`,
      )
    }

    return {
      ok: true,
      model: 'MslFirstOrderCliSmoke',
      sourcePath,
      timeSamples: times.length,
      firstOrderStart: start,
      firstOrderEnd: finish,
      payloadPreview: debug.payloadPreview,
    }
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
    throw new Error([baseMessage, `MSL CLI simulation debug:\n${debugDump}`].join('\n'))
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
