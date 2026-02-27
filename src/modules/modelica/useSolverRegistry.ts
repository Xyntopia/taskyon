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
  const solverOptions = ref<Record<string, unknown>>({})
  const showSolverOptionsDialog = ref(false)

  const projectSolvers = ref<Record<string, string>>(createDefaultProjectSolvers())
  const defaultBuiltinSolverSource = builtinSolvers.default ?? ''

  const projectSolverIds = computed(() => Object.keys(projectSolvers.value).sort())
  const selectedSolverKey = ref<string>('builtin:default')
  const newSolverId = ref<string>('solver2')

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

    const nextId = Object.keys(projectSolvers.value).sort()[0] ?? 'solver1'
    selectedSolverKey.value = `project:${nextId}`
  }

  async function refreshActiveSolverMetadata() {
    const solverJs = String(activeSolverSource.value ?? '')
    if (!solverJs.trim()) {
      solverOptionsSchema.value = undefined
      return
    }

    const id = 'rumoca-solver-meta'
    try {
      const { schema, simDefaults } = await discoverSolverMetadata(solverJs)
      solverOptionsSchema.value = schema

      if (simDefaults && typeof simDefaults === 'object') {
        if (typeof simDefaults.t0 === 'number') params.simT0.value = simDefaults.t0
        if (typeof simDefaults.tf === 'number') params.simTf.value = simDefaults.tf
        if (typeof simDefaults.dt === 'number') params.simDt.value = simDefaults.dt
      }

      if (!solverOptions.value || Object.keys(solverOptions.value).length === 0) {
        solverOptions.value = extractDefaultsFromJsonSchema(schema)
      }
    } catch (e) {
      console.warn(`Failed to extract solver metadata (${id}):`, e)
      solverOptionsSchema.value = undefined
    }
  }

  watchDebounced(
    [selectedSolverKey, activeSolverSource],
    async () => {
      await refreshActiveSolverMetadata()
    },
    { debounce: 200, maxWait: 800 },
  )

  return {
    solverOptionsSchema,
    solverOptions,
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
