import type { QDialogInputPrompt, QDialogOptions, QDialogSelectionPrompt } from 'quasar'
import { Dialog } from 'quasar'
import type { JSONSchema7 } from 'json-schema'
import { createTool } from '@taskyon/taskyon'

export const simpleDialogSchema = {
  $id: 'SimpleQDialogOptions',
  type: 'object',
  additionalProperties: false,

  /* --- REQUIRED --------------------------------------------------- */
  required: ['variant', 'message'],

  /* --- MAIN PROPS ------------------------------------------------- */
  properties: {
    /* Explicit selector so even “tiny” models know what to build */
    variant: {
      enum: ['prompt', 'options'],
      description:
        'variant - Specifies the dialog type to render. This property is required and determines which additional properties are expected. ',
    },

    /* Common fields */
    title: { type: 'string' },
    message: { type: 'string' },

    /* Prompt variant ---------------------------------------------- */
    prompt: {
      type: 'object',
      additionalProperties: true,
      properties: {
        model: { type: 'string' },
        type: { enum: ['text', 'number'] },
        min: { type: 'number' },
        max: { type: 'number' },
        step: { type: 'number' },
      },
    },

    /* Options variant --------------------------------------------- */
    options: {
      type: 'object',
      additionalProperties: true,
      required: ['items'],
      properties: {
        type: { enum: ['radio', 'checkbox', 'toggle'] }, // ''
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['label', 'value'],
            properties: {
              label: { type: 'string' },
              value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
              //color: { type: 'string' },
            },
          },
        },
      },
    },

    /* ---- Buttons ------------------------------------------------- */
    /* Strings here override Quasar’s default labels.
       We DON’T expose the full QBtn prop object: the AI won’t style. */
    ok: { anyOf: [{ type: 'boolean' }, { type: 'string' }] },
    cancel: { anyOf: [{ type: 'boolean' }, { type: 'string' }] },
  },

  /* Enforce one-of without deleting props so schema stays simple */
  oneOf: [
    {
      properties: { variant: { const: 'prompt' } },
      required: ['prompt'],
      not: { required: ['options'] },
    },
    {
      properties: { variant: { const: 'options' } },
      required: ['options'],
      not: { required: ['prompt'] },
    },
  ],

  /* ---- Behaviour toggles -------------------------------------- */
  // persistent: { type: 'boolean' }, // AI may need modal locks
  // noEscDismiss: { type: 'boolean' },
  // noBackdropDismiss: { type: 'boolean' },

  /* --------------------------------------------------------------
       # Commented‑out fields the AI won’t need *
       * keep them so you can uncomment later
    */

  // position : { enum: ['top','right','bottom','left','standard'] },
  // html     : { type: 'boolean', default: false }, // always false → omit
  // progress : { anyOf:[{type:'boolean'}] },        // spinner UX too fancy
  // options  : { type:'object' },                   // handled above
  // prompt   : { type:'object' },                   // handled above
  // dark/seamless/fullWidth/fullHeight…
} as const satisfies JSONSchema7

type DialogResult = { action: 'ok'; data: unknown } | { action: 'cancel' } | { action: 'dismiss' }

/* ------------------------------------------------------------------ *
 * 3.  Taskyon tool wrapper
 * ------------------------------------------------------------------ */
export const quasarDialogTool = createTool({
  name: 'userdialog',
  description: 'Display a Dialog to collect user input/confirmation.',
  longDescription: 'Builds alert, confirm, prompt or option dialogs and returns { action, data }.',

  parameters: simpleDialogSchema,
  renderOptions: { hideChat: false, hideLlm: false },

  async function(opts): Promise<DialogResult> {
    /* ----- 1. destructure + runtime guard -------------------------- */
    const {
      variant,
      prompt,
      options: rawOptions,
      ...rest
    } = opts as {
      variant: 'prompt' | 'options'
      prompt?: unknown
      options?: unknown
    } & Record<string, unknown>

    if (variant === 'prompt' && !prompt) {
      throw new Error('variant "prompt" requires a prompt block')
    }
    if (variant === 'options' && !rawOptions) {
      throw new Error('variant "options" requires an options block')
    }

    /* ----- 2. cast blocks after guarding --------------------------- */
    const dialogPrompt: QDialogInputPrompt | undefined =
      variant === 'prompt'
        ? (() => {
            const p = prompt as NonNullable<QDialogOptions['prompt']> // <- alias
            return {
              ...p,
              model: p.model ?? (p.type === 'number' ? 0 : ''),
            }
          })()
        : undefined

    const selectionPrompt: QDialogSelectionPrompt | undefined =
      variant === 'options'
        ? {
            ...(rawOptions as QDialogSelectionPrompt),

            // auto-initialise model if caller omitted it
            model:
              (rawOptions as QDialogSelectionPrompt).model ??
              ((rawOptions as QDialogSelectionPrompt).type === 'radio'
                ? ((rawOptions as QDialogSelectionPrompt).items?.[0]?.value ?? null) // first value
                : []), // empty array for checkbox
          }
        : undefined

    /* ----- 3. assemble final payload ------------------------------- */
    const normalized: QDialogOptions = {
      html: false,
      position: 'standard',

      color: 'secondary',
      ...rest, // title, message, …
      ...(dialogPrompt ? { prompt: dialogPrompt } : {}),
      ...(selectionPrompt ? { options: selectionPrompt } : {}),

      ok: (opts as { ok?: string | boolean }).ok ?? true,
      cancel:
        (opts as { cancel?: string | boolean }).cancel ??
        (variant === 'prompt' || variant === 'options'),
    }

    /* ----- 4. open dialog ------------------------------------------ */
    return new Promise<DialogResult>((resolve) => {
      Dialog.create(normalized)
        .onOk((data) => resolve({ action: 'ok', data }))
        .onCancel(() => resolve({ action: 'cancel' }))
        .onDismiss(() => resolve({ action: 'dismiss' }))
    })
  },
})

export const guiTools = [quasarDialogTool]
