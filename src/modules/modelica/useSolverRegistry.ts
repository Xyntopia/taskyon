import { Notify } from 'quasar'
import { computed, ref, type Ref } from 'vue'
import { watchDebounced } from '@vueuse/core'
import {
  builtinSolvers,
  createDefaultProjectSolvers,
  discoverSolverMetadata,
  extractDefaultsFromJsonSchema,
  solverIdFromKey,
} from 'src/modules/modelica/modelica'

export function useSolverRegistry(params: {
  simT0: Ref<number>
  simTf: Ref<number>
  simDt: Ref<number>
}) {
  const solverOptionsSchema = ref<Record<string, unknown> | undefined>(undefined)
  const selectedSolverKey = ref<string>('builtin:default')
  const newSolverId = ref<string>('solver2')
  const solverOptionsByKey = ref<Record<string, Record<string, unknown>>>({})
  const solverOptions = computed<Record<string, unknown>>({
    get: () => solverOptionsByKey.value[selectedSolverKey.value] ?? {},
    set: (v: Record<string, unknown>) => {
      const key = String(selectedSolverKey.value || '')
      if (!key) return
      solverOptionsByKey.value = {
        ...solverOptionsByKey.value,
        [key]: { ...(v || {}) },
      }
    },
  })
  const showSolverOptionsDialog = ref(false)

  const projectSolvers = ref<Record<string, string>>(createDefaultProjectSolvers())
  const defaultBuiltinSolverSource = builtinSolvers.default ?? ''
  let solverMetadataRefreshId = 0

  const projectSolverIds = computed(() => Object.keys(projectSolvers.value).sort())

  const solverKeyOptions = computed(() => {
    const builtins = Object.keys(builtinSolvers)
      .sort()
      .map((id) => ({ label: `builtin:${id}`, value: `builtin:${id}` }))

    const projects = Object.keys(projectSolvers.value)
      .sort()
      .map((id) => ({ label: `project:${id}`, value: `project:${id}` }))

    return [...builtins, ...projects]
  })

  const isSolverBuiltin = computed(() =>
    String(selectedSolverKey.value || '').startsWith('builtin:'),
  )

  const activeSolverSource = computed({
    get: () => {
      const key = String(selectedSolverKey.value || '')
      if (key.startsWith('builtin:')) {
        return builtinSolvers[solverIdFromKey(key)] ?? ''
      }
      if (key.startsWith('project:')) {
        return projectSolvers.value[solverIdFromKey(key)] ?? ''
      }
      return builtinSolvers[key] ?? ''
    },
    set: (v: string) => {
      if (isSolverBuiltin.value) return
      const id = solverIdFromKey(selectedSolverKey.value)
      if (!id) return
      projectSolvers.value = { ...projectSolvers.value, [id]: String(v ?? '') }
    },
  })

  function addProjectSolver() {
    const id = String(newSolverId.value || '').trim()
    if (!id) return
    if (projectSolvers.value[id] != null) {
      Notify.create({ type: 'warning', message: `Solver '${id}' already exists in the project` })
      selectedSolverKey.value = `project:${id}`
      return
    }
    projectSolvers.value = { ...projectSolvers.value, [id]: defaultBuiltinSolverSource }
    selectedSolverKey.value = `project:${id}`
  }

  function deleteActiveProjectSolver() {
    if (isSolverBuiltin.value) return
    const id = solverIdFromKey(selectedSolverKey.value)
    const keys = Object.keys(projectSolvers.value)
    if (keys.length <= 1) return
    if (!id || projectSolvers.value[id] == null) return

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [id]: _removed, ...rest } = projectSolvers.value
    projectSolvers.value = rest
    const deletedKey = `project:${id}`
    if (solverOptionsByKey.value[deletedKey]) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [deletedKey]: _deletedOptions, ...restOptions } = solverOptionsByKey.value
      solverOptionsByKey.value = restOptions
    }

    const nextId = Object.keys(projectSolvers.value).sort()[0] ?? 'solver1'
    selectedSolverKey.value = `project:${nextId}`
  }

  async function refreshActiveSolverMetadata() {
    const refreshId = ++solverMetadataRefreshId
    const activeKey = String(selectedSolverKey.value || '')
    const solverJs = String(activeSolverSource.value ?? '')
    if (!solverJs.trim()) {
      if (refreshId !== solverMetadataRefreshId) return
      solverOptionsSchema.value = undefined
      return
    }

    const id = 'rumoca-solver-meta'
    try {
      const { schema, simDefaults } = await discoverSolverMetadata(solverJs)
      if (refreshId !== solverMetadataRefreshId) return
      solverOptionsSchema.value = schema

      if (simDefaults && typeof simDefaults === 'object') {
        if (typeof simDefaults.t0 === 'number') params.simT0.value = simDefaults.t0
        if (typeof simDefaults.tf === 'number') params.simTf.value = simDefaults.tf
        if (typeof simDefaults.dt === 'number') params.simDt.value = simDefaults.dt
      }

      const defaults = extractDefaultsFromJsonSchema(schema)
      const current = solverOptionsByKey.value[activeKey] ?? {}
      const merged = { ...defaults, ...current }
      solverOptionsByKey.value = {
        ...solverOptionsByKey.value,
        [activeKey]: merged,
      }
    } catch (e) {
      if (refreshId !== solverMetadataRefreshId) return
      console.warn(`Failed to extract solver metadata (${id}):`, e)
      solverOptionsSchema.value = undefined
    }
  }

  watchDebounced(
    [selectedSolverKey, activeSolverSource],
    async () => {
      await refreshActiveSolverMetadata()
    },
    { debounce: 200, maxWait: 800, immediate: true },
  )

  watchDebounced(
    solverKeyOptions,
    (options) => {
      const selected = String(selectedSolverKey.value || '')
      if (options.some((opt) => opt.value === selected)) return
      const fallback = options.find((opt) => opt.value === 'builtin:default')?.value ?? options[0]?.value
      selectedSolverKey.value = fallback ?? ''
    },
    { debounce: 50, maxWait: 200, immediate: true },
  )

  return {
    solverOptionsSchema,
    solverOptions,
    solverOptionsByKey,
    showSolverOptionsDialog,
    projectSolvers,
    projectSolverIds,
    selectedSolverKey,
    newSolverId,
    solverKeyOptions,
    isSolverBuiltin,
    activeSolverSource,
    addProjectSolver,
    deleteActiveProjectSolver,
  }
}
