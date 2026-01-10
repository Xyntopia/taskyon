interface Permission {
  id: string
  object: string
  created: number
  allow_create_engine: boolean
  allow_sampling: boolean
  allow_logprobs: boolean
  allow_search_indices: boolean
  allow_view: boolean
  allow_fine_tuning: boolean
  organization: string
  group: null | string
  is_blocking: boolean
}

// ────────────────────────── leaf enums & helpers ──────────────────────────
export type IOmodality = 'text' | 'image' | 'file'

export type SupportedParameter =
  | 'max_tokens'
  | 'temperature'
  | 'top_p'
  | 'tools'
  | 'tool_choice'
  | 'reasoning'
  | 'include_reasoning'
  | 'stop'
  | 'frequency_penalty'
  | 'presence_penalty'
  | 'repetition_penalty'
  | 'response_format'
  | 'top_k'
  | 'top_a'
  | 'top_logprobs'
  | 'logprobs'
  | 'logit_bias'
  | 'seed'
  | 'min_p'
  | 'structured_outputs'
  | 'web_search_options'

/** pricing quoted as *USD per–token* strings to avoid FP rounding */
export interface Pricing {
  prompt: string
  completion: string
  image?: string
  request?: string
  web_search?: string
  internal_reasoning?: string
  input_cache_read?: string
  input_cache_write?: string
}

export interface Architecture {
  /** e.g. `"text->text"` or `"text+image->text"` */
  modality?: string
  input_modalities?: IOmodality[]
  output_modalities?: IOmodality[]
  tokenizer?: string
  instruct_type?: string | null
}

export interface TopProvider {
  context_length: number
  max_completion_tokens: number | null
  is_moderated: boolean
}

// ───────────────────────────────── Model ──────────────────────────────────
export interface ModelCard {
  /** primary identifier */ id: string
  /** canonical >OpenRouter slug */ canonical_slug?: string
  hugging_face_id?: string | null
  name?: string
  description?: string
  context_length?: number
  created?: number

  architecture?: Architecture
  pricing?: Pricing
  top_provider?: TopProvider

  per_request_limits?: { prompt_tokens: string; completion_tokens: string } | null
  supported_parameters?: SupportedParameter[]

  // ── legacy OpenAI‑style fields ──
  object?: string
  owned_by?: string
  permission?: Permission[]
  root?: string
  parent?: string | null

  // ── optional fields from second API ──
  _id?: string
  likes?: number
  trendingScore?: number
  private?: boolean
  downloads?: number
  tags?: string[]
  pipeline_tag?: string
  library_name?: string
  createdAt?: string
  modelId?: string
}

export interface OpenRouterGenerationInfo {
  id: string
  total_cost: number
  created_at: string // ISO 8601 date string
  model: string
  app_id: number
  streamed: boolean
  cancelled: boolean
  provider_name: string
  latency: number
  moderation_latency: null | number // can be null
  generation_time: number
  finish_reason: string
  tokens_prompt: number
  tokens_completion: number
  native_tokens_prompt: number
  native_tokens_completion: number
  num_media_prompt: null | number // can be null
  num_media_completion: null | number // can be null
  origin: string
  usage: number
}
