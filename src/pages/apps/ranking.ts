// ranking.ts
// TODO: add more features, such as:   repeating syllables, e.g. "NameNanny" aliterations
// and other "Stilmittel", maybe also phonetics? let AI come up with a way
// to generate more features...
import { useNlpWorker } from '@taskyon/taskyon'
import z from 'zod'

const { vectorizeText } = useNlpWorker()

// ----------------- Types -----------------
export interface Candidate {
  id: string
  name: string
  vec: number[] // numeric embedding vector
}

export interface Duel {
  leftId: string
  rightId: string
  /** -1 = draw/ignore; 0 = left wins; 1 = right wins */
  winner: -1 | 0 | 1
}

export interface RankingParameters {
  trainingCadence: number
  initialGenerateCount: number
  generationBatchSize: number
  uncertainWeight: number
  topWeight: number
  randomWeight: number
  autoGenerate: boolean
  autoTrain: boolean
  namingGoal: string
  modelType: 'rf' | 'logreg' | 'svm' | 'mlp'
}

export interface ModelState {
  nextId: number
  trainingInFlight: boolean
  lastError?: string
  modelBlob?: string // serialized model
}

export type WorkerResult<T> = { ok: true; data: T } | { ok: false; error: string }

// ----------------- Defaults -----------------
export function createInitialState(params?: Partial<RankingParameters>) {
  return {
    candidates: {} as Record<string, Candidate>,
    duels: [] as Duel[],
    params: {
      trainingCadence: 10,
      initialGenerateCount: 10,
      generationBatchSize: 10,
      uncertainWeight: 0.5,
      topWeight: 0.3,
      randomWeight: 0.2,
      autoGenerate: true,
      autoTrain: true,
      namingGoal: '',
      modelType: 'svm',
      ...params,
    } as RankingParameters,
    model: {
      nextId: 0,
      trainingInFlight: false,
    } as ModelState,
    ranking: [] as string[],
  }
}

export type RankingState = ReturnType<typeof createInitialState>

const RankingStateSchema = z.object({
  candidates: z.record(
    z.string(),
    z.object({ id: z.string(), name: z.string(), vec: z.array(z.number()) }),
  ),
  duels: z.array(
    z.object({
      leftId: z.string(),
      rightId: z.string(),
      winner: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    }),
  ),
  params: z.object({
    trainingCadence: z.number(),
    initialGenerateCount: z.number(),
    generationBatchSize: z.number(),
    uncertainWeight: z.number(),
    topWeight: z.number(),
    randomWeight: z.number(),
    autoGenerate: z.boolean(),
    autoTrain: z.boolean(),
    namingGoal: z.string(),
    modelType: z.enum(['rf', 'logreg', 'svm', 'mlp']),
  }),
  model: z.object({
    nextId: z.number(),
    trainingInFlight: z.boolean(),
    lastError: z.string().optional(),
    modelBlob: z.string().optional(),
  }),
  ranking: z.array(z.string()),
})

export const parseRankingState = (value: unknown): RankingState => {
  const parsed = RankingStateSchema.parse(value)
  const { lastError, modelBlob, ...model } = parsed.model
  return {
    ...parsed,
    model: {
      ...model,
      ...(lastError === undefined ? {} : { lastError }),
      ...(modelBlob === undefined ? {} : { modelBlob }),
    },
  }
}

export type RankingPythonResult = { stdout: string; result: unknown }
export type RunRankingPython = (code: string) => Promise<RankingPythonResult>

const RankingPythonResultSchema = z.object({ stdout: z.string(), result: z.unknown() })
export const parseRankingPythonResult = (value: unknown): RankingPythonResult =>
  RankingPythonResultSchema.parse(value)

const buildPythonCall = (script: string, functionName: string, args: unknown[]) => `${script}
import json
ranking_args = json.loads(${JSON.stringify(JSON.stringify(args))})
${functionName}(*ranking_args)
`

// ----------------- Vectorizer -----------------
// TODO: Replace with HuggingFace transformer.js embedding call.
// For now, just return a simple hash-based dummy vector row-by-row.
async function vectorize(name: string): Promise<number[]> {
  /*simple vectorizer:
  const arr = new Array(16).fill(0)
  for (let i = 0; i < name.length; i++) {
    arr[i % arr.length] += name.charCodeAt(i) % 17
  }
  return arr*/
  // create a vector using transformer.js
  const vec = await vectorizeText(name, 'xyntopia/all-MiniLM-L6-v2')
  console.debug('[vectorize] done', { len: vec.length })
  return vec
}

// ----------------- Python Scripts -----------------
const TRAIN_RF_SCRIPT = `
from sklearn.ensemble import RandomForestClassifier
import base64, pickle
def train_model(vectors, duels):
    if not duels: return ""
    X, y = [], []
    for n1,n2,w in duels:
        X.append(vectors[n1] + vectors[n2])
        y.append(w)
    clf = RandomForestClassifier(n_estimators=50, n_jobs=-1)
    clf.fit(X,y)
    return base64.b64encode(pickle.dumps(clf)).decode("utf-8")
train_model
`

const TRAIN_LOGREG_SCRIPT = `
from sklearn.linear_model import LogisticRegression
import base64, pickle
def train_logreg(vectors, duels):
    if not duels: return ""
    X, y = [], []
    for n1,n2,w in duels:
        X.append(vectors[n1] + vectors[n2])
        y.append(w)
    clf = LogisticRegression(max_iter=1000)
    clf.fit(X,y)
    return base64.b64encode(pickle.dumps(clf)).decode("utf-8")
train_logreg
`

const TRAIN_SVM_SCRIPT = `
from sklearn.svm import LinearSVC
import base64, pickle
def train_svm(vectors, duels):
    if not duels: return ""
    X, y = [], []
    for n1,n2,w in duels:
        X.append(vectors[n1] + vectors[n2])
        y.append(w)
    clf = LinearSVC(max_iter=5000)
    clf.fit(X,y)
    return base64.b64encode(pickle.dumps(clf)).decode("utf-8")
train_svm
`

const TRAIN_MLP_SCRIPT = `
from sklearn.neural_network import MLPClassifier
import base64, pickle
def train_mlp(vectors, duels):
    if not duels: return ""
    X, y = [], []
    for n1,n2,w in duels:
        X.append(vectors[n1] + vectors[n2])
        y.append(w)
    clf = MLPClassifier(hidden_layer_sizes=(64,), max_iter=500)
    clf.fit(X,y)
    return base64.b64encode(pickle.dumps(clf)).decode("utf-8")
train_mlp
`

// ----------------- State Transforms -----------------
export async function addCandidates(state: RankingState, names: string[]): Promise<RankingState> {
  console.debug('[addCandidates] start', { names })
  const newCands: Record<string, Candidate> = {}
  for (const nm of names) {
    const name = nm.trim()
    if (!name) continue
    const exists = Object.values(state.candidates).some(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    )
    if (!exists) {
      const vec = await vectorize(name)
      const id = state.model.nextId++
      newCands[id] = { id: String(id), name, vec }
    } else {
      console.debug('[addCandidates] skipped duplicate', { name })
    }
  }
  console.debug('[addCandidates] added', { count: Object.keys(newCands).length })
  return { ...state, candidates: { ...state.candidates, ...newCands } }
}

export function recordDuel(
  state: RankingState,
  leftId: string,
  rightId: string,
  winner: -1 | 0 | 1,
): RankingState {
  console.debug('[recordDuel]', { leftId, rightId, winner })
  const newDuels = [{ leftId, rightId, winner }, ...state.duels]
  return { ...state, duels: newDuels }
}

// ----------------- Training -----------------
export async function trainPythonModel(
  state: RankingState,
  runPython: RunRankingPython,
): Promise<WorkerResult<string>> {
  console.debug('[trainPythonModel] start', {
    candCount: Object.keys(state.candidates).length,
    duelCount: state.duels.length,
  })
  if (state.model.trainingInFlight) {
    console.debug('[trainPythonModel] skipped, already in flight')
    return { ok: true, data: state.model.modelBlob ?? '' }
  }

  const vectors = extractVectorMap(state)
  const duels = state.duels.filter((duel) => duel.winner !== -1).map((duel) => ({ ...duel }))
  console.debug('[trainPythonModel] vectors/duels', {
    vectorsLen: vectors.length,
    duelsLen: duels.length,
  })

  let training: { script: string; functionName: string }
  switch (state.params.modelType) {
    case 'logreg':
      training = { script: TRAIN_LOGREG_SCRIPT, functionName: 'train_logreg' }
      break
    case 'svm':
      training = { script: TRAIN_SVM_SCRIPT, functionName: 'train_svm' }
      break
    case 'mlp':
      training = { script: TRAIN_MLP_SCRIPT, functionName: 'train_mlp' }
      break
    case 'rf':
      training = { script: TRAIN_RF_SCRIPT, functionName: 'train_model' }
      break
  }

  const augmentedDuels = duels.flatMap((d) => {
    const invWinner = d.winner === -1 ? -1 : d.winner === 0 ? 1 : 0
    return [
      [d.leftId, d.rightId, d.winner],
      // augment data by adding an inversed duel
      [d.rightId, d.leftId, invWinner],
    ]
  })

  try {
    const res = await runPython(
      buildPythonCall(training.script, training.functionName, [vectors, augmentedDuels]),
    )
    const modelBlob = z.string().safeParse(res.result)
    if (!modelBlob.success) return { ok: false, error: 'Python training returned no model' }
    console.debug('[trainPythonModel] success, blob length', modelBlob.data.length)
    return { ok: true, data: modelBlob.data }
  } catch (err) {
    console.error('[trainPythonModel] error', err)
    return { ok: false, error: String(err) }
  }
}

function extractVectorMap(state: {
  candidates: Record<string, Candidate>
  duels: Duel[]
  params: RankingParameters
  model: ModelState
  ranking: string[]
}) {
  return Object.values(state.candidates).reduce(
    (vectors, candidate) => ({ ...vectors, [candidate.id]: [...candidate.vec] }),
    {} as Record<string, number[]>,
  )
}

// ----------------- Ranking -----------------
export async function rankCandidates(
  modelBlob: string,
  ids: string[],
  vectors: Record<string, number[]>,
  runPython: RunRankingPython,
): Promise<WorkerResult<string[]>> {
  const pythonScript = `
import base64, pickle, functools, sklearn

def rank_candidates(model_blob, ids, vectors):
    if not model_blob: return ids
    clf = pickle.loads(base64.b64decode(model_blob))

    def predict_proba(v1, v2):
        if hasattr(clf, "predict_proba"):
            return float(clf.predict_proba([v1+v2])[0][1])
        else:
            return float(clf.decision_function([v1+v2])[0])
    def cmp(a, b):
        pa = predict_proba(vectors[a], vectors[b])
        return -1 if pa < 0.5 else 1

    return sorted(ids, key=functools.cmp_to_key(cmp))
rank_candidates
  `
  console.debug('[rankCandidates] start', {
    idsLen: ids.length,
    vecsLen: Object.keys(vectors).length,
  })
  try {
    const res = await runPython(
      buildPythonCall(pythonScript, 'rank_candidates', [modelBlob, ids, vectors]),
    )
    const rankedIds = z.array(z.string()).safeParse(res.result)
    if (!rankedIds.success) return { ok: false, error: 'Python ranking returned invalid ids' }
    console.debug('[rankCandidates] done', { outLen: rankedIds.data.length })
    return { ok: true, data: rankedIds.data }
  } catch (err) {
    console.error('[rankCandidates] error', err)
    return { ok: false, error: String(err) }
  }
}

// ----------------- Queries -----------------
export async function getRanking(
  state: RankingState,
  runPython: RunRankingPython,
): Promise<WorkerResult<string[]>> {
  console.debug('[getRanking] start', {
    candCount: Object.keys(state.candidates).length,
    duelCount: state.duels.length,
  })
  if (Object.keys(state.candidates).length === 0) return { ok: true, data: [] }
  if (state.duels.length === 0 || !state.model.modelBlob) {
    console.debug('[getRanking] cold start')
    return { ok: true, data: Object.keys(state.candidates) }
  }
  const res = await rankCandidates(
    state.model.modelBlob,
    Object.keys(state.candidates),
    extractVectorMap(state),
    runPython,
  )
  if (!res.ok) return res
  console.debug('[getRanking] ranked', { order: res.data })
  return { ok: true, data: res.data }
}

// ----------------- Duel Selection -----------------
export function getNextDuel(state: RankingState): WorkerResult<[Candidate, Candidate] | []> {
  console.debug('[getNextDuel] start', {
    candCount: Object.keys(state.candidates).length,
    rankingLen: state.ranking.length,
  })
  if (Object.keys(state.candidates).length < 2) return { ok: true, data: [] }

  const ids = state.ranking.length ? state.ranking : Object.keys(state.candidates)

  // --- Config ---
  const RANDOM_PROB = 0.5
  const MAX_WINDOW_SIZE = 2
  const baseBias = 0.1
  const topBias = 1.0
  const adjProb = 0.5

  // --- Helpers ---
  const duelCounts: Record<string, number> = {}
  for (const d of state.duels) {
    duelCounts[d.leftId] = (duelCounts[d.leftId] ?? 0) + 1
    duelCounts[d.rightId] = (duelCounts[d.rightId] ?? 0) + 1
  }

  const hasDueled = (a: string, b: string) =>
    state.duels.some(
      (d) => (d.leftId === a && d.rightId === b) || (d.leftId === b && d.rightId === a),
    )

  function pickWeighted(ids: string[]): string {
    const n = ids.length
    const weights = ids.map((_, i) => baseBias + topBias / (i + 1))
    const total = weights.reduce((a, b) => a + b, 0)
    let r = Math.random() * total
    for (let i = 0; i < n; i++) {
      r -= weights[i]!
      if (r <= 0) return ids[i]!
    }
    return ids[n - 1]!
  }

  // --- Cold start or random exploration ---
  if (!state.ranking.length || Math.random() < RANDOM_PROB) {
    console.debug('[getNextDuel] exploration')
    for (let attempt = 0; attempt < 20; attempt++) {
      const aId = pickWeighted(ids)
      const a = state.candidates[aId]
      if (!a) continue

      let bId: string | undefined
      if (Math.random() < adjProb) {
        // pick within window around a
        const idx = ids.indexOf(aId)
        const winSize = Math.max(1, Math.floor((MAX_WINDOW_SIZE * idx) / ids.length))
        const partners: Candidate[] = []
        for (let offset = 1; offset <= winSize && idx + offset < ids.length; offset++) {
          const cand = state.candidates[ids[idx + offset]!]
          if (cand && !hasDueled(aId, cand.id)) partners.push(cand)
        }
        if (partners.length > 0) {
          partners.sort((x, y) => (duelCounts[x.id] ?? 0) - (duelCounts[y.id] ?? 0))
          bId = partners[0]!.id
        }
      }

      if (!bId) {
        // fallback random distinct
        const others = ids.filter((id) => id !== aId && !hasDueled(aId, id))
        if (others.length === 0) continue
        bId = others[Math.floor(Math.random() * others.length)]!
      }

      const b = state.candidates[bId]
      if (b) {
        console.debug('[getNextDuel] picked', { a: a.id, b: b.id })
        return { ok: true, data: [a, b] }
      }
    }
    console.debug('[getNextDuel] failed exploration')
    return { ok: true, data: [] }
  }

  // --- Guided selection (ranking order + window) ---
  for (let rankIndex = 0; rankIndex < ids.length; rankIndex++) {
    const aId = ids[rankIndex]!
    const a = state.candidates[aId]
    if (!a) continue

    const winSize = Math.max(1, Math.floor((MAX_WINDOW_SIZE * rankIndex) / ids.length))
    const partners: Candidate[] = []
    for (let offset = 1; offset <= winSize && rankIndex + offset < ids.length; offset++) {
      const bId = ids[rankIndex + offset]!
      const b = state.candidates[bId]
      if (b && !hasDueled(aId, bId)) partners.push(b)
    }

    if (partners.length > 0) {
      partners.sort((x, y) => (duelCounts[x.id] ?? 0) - (duelCounts[y.id] ?? 0))
      console.debug('[getNextDuel] guided', { a: a.id, b: partners[0]!.id })
      return { ok: true, data: [a, partners[0]!] }
    }
  }

  console.debug('[getNextDuel] none found')
  return { ok: true, data: [] }
}
