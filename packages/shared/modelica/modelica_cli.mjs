#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import initRumoca from 'rumoca-full-web'
import * as rumoca from 'rumoca-full-web'
import { strFromU8, unzipSync } from 'fflate'

const COMMANDS = new Set([
  'init',
  'load-msl',
  'list-classes',
  'get-class-info',
  'compile-model',
  'render-model-js',
  'simulate-model',
])
function usage() {
  return `
Modelica CLI (rumoca wasm)

Usage:
  node src/modules/modelica/modelica_cli.mjs <command> [options]

Commands:
  init
      Initialize wasm runtime and print version/build info.

  load-msl --msl-zip <path>
      Load Modelica Standard Library ZIP into source-root cache.

  list-classes [--prefix <Modelica.XXX>]
      Print class names from loaded source roots.

  get-class-info --model <Qualified.Name>
      Print get_class_info JSON for one model/class.

  compile-model --model <Qualified.Name> [--source-file <path>] [--use-source-roots]
      Compile one model. If --source-file is omitted, source_modelica is fetched via get_class_info.

  render-model-js --model <Qualified.Name> --template-file <path> [--output-file <path>] [--source-file <path>] [--use-source-roots]
      Compile one model, select the template DAE, and render generated JS from the provided template.

  simulate-model --model <Qualified.Name> [--source-file <path>] [--use-source-roots] [--t-end <f64>] [--dt <f64>] [--solver <name>]
      Simulate one model through Rumoca's WASM simulation surface and print the result payload.

Options:
  --threads <n>           wasm_init threads (default: 0)
  --msl-zip <path>        path to MSL zip (can be combined with other commands)
  --model <name>          qualified class/model name
  --source-file <path>    Modelica source file for compile-model
  --template-file <path>  template file used by render-model-js
  --output-file <path>    output file written by render-model-js
  --solver <name>         simulation solver (for example auto, bdf, esdirk34, trbdf2, rk-like)
  --t-end <f64>           simulation stop time for simulate-model
  --dt <f64>              fixed output interval for simulate-model
  --prefix <text>         prefix filter for list-classes
  --use-source-roots      use compile_with_source_roots if available
  --json                  print machine-readable JSON output
  --help                  show this help
`.trim()
}

function parseArgs(argv) {
  const options = {
    threads: 0,
    mslZip: '',
    model: '',
    sourceFile: '',
    templateFile: '',
    outputFile: '',
    prefix: '',
    solver: 'auto',
    tEnd: 1,
    dt: 0.01,
    useSourceRoots: false,
    json: false,
    help: false,
  }
  const positional = []

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? '')
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    if (token === '--help') {
      options.help = true
      continue
    }
    if (token === '--use-source-roots') {
      options.useSourceRoots = true
      continue
    }
    if (token === '--json') {
      options.json = true
      continue
    }
    const key = token.slice(2)
    const value = String(argv[i + 1] ?? '')
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`)
    }
    i += 1
    if (key === 'threads') {
      options.threads = Number.parseInt(value, 10)
      continue
    }
    if (key === 'msl-zip') {
      options.mslZip = value
      continue
    }
    if (key === 'model') {
      options.model = value
      continue
    }
    if (key === 'source-file') {
      options.sourceFile = value
      continue
    }
    if (key === 'solver') {
      options.solver = value
      continue
    }
    if (key === 't-end') {
      options.tEnd = Number.parseFloat(value)
      continue
    }
    if (key === 'dt') {
      options.dt = Number.parseFloat(value)
      continue
    }
    if (key === 'prefix') {
      options.prefix = value
      continue
    }
    if (key === 'template-file') {
      options.templateFile = value
      continue
    }
    if (key === 'output-file') {
      options.outputFile = value
      continue
    }
    throw new Error(`Unknown option: --${key}`)
  }

  const command = positional[0] ?? ''
  return { command, options }
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function asString(value) {
  return typeof value === 'string' ? value : ''
}

function sanitizeLibraryPath(path) {
  const parts = String(path || '')
    .split('/')
    .filter(Boolean)
  if (parts.length > 1 && /(?:Standard)?Library|^MSL/i.test(parts[0] ?? '')) {
    return parts.slice(1).join('/')
  }
  if (parts.length > 0) {
    parts[0] = parts[0].replace(/[\s-][\d.]+$/, '')
  }
  return parts.join('/')
}

function withLibraryContext(qualifiedName, sourceModelica) {
  const source = String(sourceModelica || '')
  if (!source.trim()) return source
  if (/^\s*within\s+[A-Za-z0-9_.]+\s*;/m.test(source)) return source
  const parts = String(qualifiedName || '')
    .split('.')
    .filter(Boolean)
  if (parts.length < 2) return source
  return `within ${parts.slice(0, -1).join('.')};\n\n${source}`
}

function resolveModelName(qualifiedName) {
  const parts = String(qualifiedName || '')
    .split('.')
    .filter(Boolean)
  return parts[parts.length - 1] ?? 'Model'
}

function selectDaeForTemplate(compiled, usePreparedDae = true) {
  if (usePreparedDae) {
    const prepared = asObject(compiled?.dae_prepared)
    if (prepared) return prepared
  }
  const dae = asObject(compiled?.dae)
  if (dae) return dae
  return null
}

function parseJson(raw) {
  return JSON.parse(String(raw))
}

async function initEngine(threads) {
  await initRumoca()
  const safeThreads = Number.isFinite(threads) ? Math.max(0, Math.floor(threads)) : 0
  const rayonEnabled =
    typeof rumoca.wasm_init === 'function' ? Boolean(await rumoca.wasm_init(safeThreads)) : false
  return {
    version: typeof rumoca.get_version === 'function' ? asString(rumoca.get_version()) : '',
    gitCommit: typeof rumoca.get_git_commit === 'function' ? asString(rumoca.get_git_commit()) : '',
    buildTimeUtc:
      typeof rumoca.get_build_time_utc === 'function' ? asString(rumoca.get_build_time_utc()) : '',
    rayonEnabled,
    simulationAvailable: typeof rumoca.simulate_model === 'function',
    simulationModelDiscoveryAvailable: typeof rumoca.get_simulation_models === 'function',
  }
}

async function loadMslZip(mslZipPath) {
  if (!mslZipPath) throw new Error('Missing --msl-zip')
  const absolute = resolve(mslZipPath)
  const bytes = new Uint8Array(await readFile(absolute))
  const archive = unzipSync(bytes)
  const libraries = {}

  for (const [rawPath, content] of Object.entries(archive)) {
    const lowerPath = rawPath.toLowerCase()
    if (!lowerPath.endsWith('.mo')) continue
    if (rawPath.includes('Test') || rawPath.includes('Obsolete')) continue
    libraries[sanitizeLibraryPath(rawPath)] = strFromU8(content)
  }

  const fileCount = Object.keys(libraries).length
  if (fileCount === 0) throw new Error(`No usable .mo files found in zip: ${absolute}`)
  const resultRaw = rumoca.load_source_roots(JSON.stringify(libraries))
  const loaded = parseJson(resultRaw)
  const parsedCount = Number.isFinite(Number(loaded?.parsed_count))
    ? Number(loaded.parsed_count)
    : fileCount
  const documentCount =
    typeof rumoca.get_source_root_document_count === 'function'
      ? Number(rumoca.get_source_root_document_count()) || 0
      : 0
  return { absolute, fileCount, parsedCount, documentCount }
}

function listClasses(prefix) {
  const payload = parseJson(rumoca.list_classes())
  const classes = Array.isArray(payload?.classes) ? payload.classes : []
  const classNames = []
  const visit = (node) => {
    const item = asObject(node)
    if (!item) return
    const qualifiedName = asString(item.qualified_name)
    if (qualifiedName && (!prefix || qualifiedName.startsWith(prefix))) {
      classNames.push(qualifiedName)
    }
    const children = Array.isArray(item.children) ? item.children : []
    for (const child of children) visit(child)
  }
  for (const root of classes) visit(root)
  return { classCount: classNames.length, classes: classNames }
}

function getClassInfo(model) {
  if (!model) throw new Error('Missing --model')
  return parseJson(rumoca.get_class_info(model))
}

async function readModelSource(model, sourceFile) {
  if (sourceFile) {
    const absolute = resolve(sourceFile)
    return { source: String(await readFile(absolute)), sourcePath: absolute }
  }
  const info = getClassInfo(model)
  const source = asString(info?.source_modelica)
  if (!source.trim()) throw new Error(`Class info has no source_modelica for ${model}`)
  return { source, sourcePath: '' }
}

function renderWithRumoca({ dae, templateSource, modelName, templatePath, outputPath }) {
  const daeJson = JSON.stringify(dae)
  if (typeof rumoca.render_template === 'function') {
    return String(rumoca.render_template(daeJson, templateSource) || '')
  }
  if (typeof rumoca.render_target === 'function') {
    const manifestSource = [
      'version = 1',
      'ir = "dae"',
      'name = "javascript"',
      '',
      '[[files]]',
      `path = "${String(outputPath || 'model.js')
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')}"`,
      `template = "${String(templatePath || 'javascript.jinja')
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')}"`,
      '',
    ].join('\n')
    const templatesJson = JSON.stringify({
      [templatePath || 'javascript.jinja']: templateSource,
    })
    const rendered = rumoca.render_target(
      daeJson,
      modelName,
      'javascript',
      manifestSource,
      templatesJson,
    )
    const renderedObj = asObject(rendered)
    const files = Array.isArray(renderedObj?.files) ? renderedObj.files : []
    const firstFile = files[0]
    const firstContent = asObject(firstFile)?.content
    if (typeof firstContent === 'string') return firstContent
    if (typeof rendered === 'string') return rendered
    throw new Error(
      `render_target returned unexpected payload: ${JSON.stringify(rendered).slice(0, 500)}`,
    )
  }
  throw new Error('WASM module is missing render_template / render_target exports')
}

async function compileModelToDae({ model, sourceFile, useSourceRoots }) {
  if (!model) throw new Error('Missing --model')
  if (useSourceRoots && typeof rumoca.compile_with_source_roots === 'function') {
    if (sourceFile) {
      const { source, sourcePath } = await readModelSource(model, sourceFile)
      const normalized = withLibraryContext(model, source)
      const shortName = resolveModelName(model)
      const compiled = parseJson(rumoca.compile_with_source_roots(normalized, shortName, '{}'))
      return { compiled, sourcePath, usedSourceRoots: true }
    }
    const compiled = parseJson(rumoca.compile_with_source_roots('', model, '{}'))
    return { compiled, sourcePath: '', usedSourceRoots: true }
  }
  if (useSourceRoots && typeof rumoca.compile_with_libraries === 'function') {
    if (sourceFile) {
      const { source, sourcePath } = await readModelSource(model, sourceFile)
      const normalized = withLibraryContext(model, source)
      const shortName = resolveModelName(model)
      const compiled = parseJson(rumoca.compile_with_libraries(normalized, shortName, '{}'))
      return { compiled, sourcePath, usedSourceRoots: true }
    }
    const compiled = parseJson(rumoca.compile_with_libraries('', model, '{}'))
    return { compiled, sourcePath: '', usedSourceRoots: true }
  }

  if (!model) throw new Error('Missing --model')
  const { source, sourcePath } = await readModelSource(model, sourceFile)
  const normalized = withLibraryContext(model, source)
  const shortName = resolveModelName(model)
  if (typeof rumoca.compile_to_json !== 'function') {
    throw new Error('WASM module is missing compile_to_json')
  }
  const compiled = parseJson(rumoca.compile_to_json(normalized, shortName))
  return { compiled, sourcePath, usedSourceRoots: false }
}

async function compileModel({ model, sourceFile, useSourceRoots }) {
  const { compiled, sourcePath } = await compileModelToDae({
    model,
    sourceFile,
    useSourceRoots,
  })
  const dae = asObject(compiled?.dae_prepared)
  return {
    model,
    sourcePath,
    usedSourceRoots: Boolean(useSourceRoots),
    hasDaePrepared: Boolean(asObject(compiled?.dae_prepared)),
    hasDaeSelected: Boolean(dae),
    varCounts: dae
      ? {
          x: Object.keys(asObject(dae.x) ?? {}).length,
          y: Object.keys(asObject(dae.y) ?? {}).length,
          u: Object.keys(asObject(dae.u) ?? {}).length,
          p: Object.keys(asObject(dae.p) ?? {}).length,
        }
      : { x: 0, y: 0, u: 0, p: 0 },
  }
}

async function renderModelJs({ model, sourceFile, templateFile, outputFile, useSourceRoots }) {
  if (!templateFile) throw new Error('Missing --template-file')
  const { compiled, sourcePath, usedSourceRoots } = await compileModelToDae({
    model,
    sourceFile,
    useSourceRoots,
  })
  const dae = selectDaeForTemplate(compiled, true)
  if (!dae) throw new Error('Rumoca compile result did not contain dae_prepared / dae')
  const templateAbsolute = resolve(templateFile)
  const templateSource = String(await readFile(templateAbsolute))
  const outputPath = outputFile ? resolve(outputFile) : ''
  const rendered = renderWithRumoca({
    dae,
    templateSource,
    modelName: resolveModelName(model),
    templatePath: templateAbsolute,
    outputPath: outputPath || 'model.js',
  })
  if (outputPath) {
    await writeFile(outputPath, rendered, 'utf8')
  }
  return {
    model,
    sourcePath,
    usedSourceRoots,
    templatePath: templateAbsolute,
    outputPath,
    bytes: Buffer.byteLength(rendered, 'utf8'),
    rendered,
  }
}

async function simulateModel({ model, sourceFile, useSourceRoots, tEnd, dt, solver }) {
  if (!model) throw new Error('Missing --model')
  if (typeof rumoca.simulate_model !== 'function') {
    throw new Error('WASM module is missing simulate_model')
  }

  let source = ''
  let sourcePath = ''
  let modelName = model
  let usedSourceRoots = false

  if (useSourceRoots) {
    usedSourceRoots = true
    if (sourceFile) {
      const loaded = await readModelSource(model, sourceFile)
      source = withLibraryContext(model, loaded.source)
      sourcePath = loaded.sourcePath
      modelName = resolveModelName(model)
    }
  } else {
    const loaded = await readModelSource(model, sourceFile)
    source = withLibraryContext(model, loaded.source)
    sourcePath = loaded.sourcePath
    modelName = resolveModelName(model)
  }

  const simulation = parseJson(
    rumoca.simulate_model(
      source,
      modelName,
      Number.isFinite(tEnd) ? tEnd : 1,
      Number.isFinite(dt) ? dt : 0.01,
      asString(solver) || 'auto',
    ),
  )

  return {
    model,
    modelName,
    sourcePath,
    usedSourceRoots,
    tEnd: Number.isFinite(tEnd) ? tEnd : 1,
    dt: Number.isFinite(dt) ? dt : 0.01,
    solver: asString(solver) || 'auto',
    simulation,
  }
}

function printOutput(options, payload) {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }
  if (typeof payload === 'string') {
    console.log(payload)
    return
  }
  console.log(JSON.stringify(payload, null, 2))
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (options.help || !command || !COMMANDS.has(command)) {
    console.log(usage())
    process.exit(command && !COMMANDS.has(command) ? 1 : 0)
  }

  const initInfo = await initEngine(options.threads)
  const output = { command, init: initInfo }

  if (options.mslZip) {
    output.msl = await loadMslZip(options.mslZip)
  }

  if (command === 'init') {
    printOutput(options, output)
    return
  }
  if (command === 'load-msl') {
    if (!options.mslZip) throw new Error('load-msl requires --msl-zip <path>')
    printOutput(options, output)
    return
  }
  if (command === 'list-classes') {
    output.classes = listClasses(options.prefix)
    printOutput(options, output)
    return
  }
  if (command === 'get-class-info') {
    output.classInfo = getClassInfo(options.model)
    printOutput(options, output)
    return
  }
  if (command === 'compile-model') {
    output.compile = await compileModel({
      model: options.model,
      sourceFile: options.sourceFile,
      useSourceRoots: options.useSourceRoots,
    })
    printOutput(options, output)
    return
  }
  if (command === 'render-model-js') {
    output.render = await renderModelJs({
      model: options.model,
      sourceFile: options.sourceFile,
      templateFile: options.templateFile,
      outputFile: options.outputFile,
      useSourceRoots: options.useSourceRoots,
    })
    printOutput(
      options,
      options.json
        ? output
        : options.outputFile
          ? {
              ...output,
              render: {
                ...output.render,
                rendered: `[written to ${output.render.outputPath || options.outputFile}]`,
              },
            }
          : output.render.rendered,
    )
    return
  }
  if (command === 'simulate-model') {
    output.simulation = await simulateModel({
      model: options.model,
      sourceFile: options.sourceFile,
      useSourceRoots: options.useSourceRoots,
      tEnd: options.tEnd,
      dt: options.dt,
      solver: options.solver,
    })
    printOutput(options, output)
    return
  }

  throw new Error(`Unsupported command: ${command}`)
}

main().catch((error) => {
  console.error(`[modelica_cli] ${(error && error.message) || String(error)}`)
  process.exit(1)
})
