import { Dialog } from 'quasar'
import { createTool } from '../taskyon/tools'
import type { JSONSchema7 } from 'json-schema'

/* ------------------------------------------------------------------ *
 * 1.  JSON‑Schema definition
 * ------------------------------------------------------------------ */
export const qDialogSchema = {
  $id: 'QDialogOptions',
  type: 'object',
  additionalProperties: true,
  required: ['message'],
  properties: {
    /* Basic copy‑props ------------------------------------------------ */
    title: { type: 'string' },
    message: { type: 'string' },
    html: { type: 'boolean', default: false },
    position: {
      type: 'string',
      enum: ['top', 'right', 'bottom', 'left', 'standard'],
      default: 'standard',
    },

    /* Behaviour toggles ---------------------------------------------- */
    persistent: { type: 'boolean' },
    noEscDismiss: { type: 'boolean' },
    noBackdropDismiss: { type: 'boolean' },

    /* Buttons --------------------------------------------------------- */
    ok: {
      anyOf: [
        { type: 'boolean' },
        { type: 'string' },
        { type: 'object', additionalProperties: true },
      ],
    },
    cancel: {
      anyOf: [
        { type: 'boolean' },
        { type: 'string' },
        { type: 'object', additionalProperties: true },
      ],
    },

    /* Progress‑spinner shorthand ------------------------------------- */
    progress: {
      anyOf: [
        { type: 'boolean' },
        {
          type: 'object',
          additionalProperties: true, // <- accept spinner: Component, etc.
          properties: {
            color: { type: 'string' }, // keep NamedColor ≈ string
            // spinner key intentionally omitted ⇢ anything allowed
          },
        },
      ],
    },

    /* Prompt & option helpers ---------------------------------------- */
    prompt: { $ref: '#/$defs/prompt' },
    options: { $ref: '#/$defs/options' },
  },

  /* ------------------------------------------------------------------ *
   * Sub‑schemas
   * ------------------------------------------------------------------ */
  $defs: {
    prompt: {
      type: 'object',
      required: ['model'],
      additionalProperties: true, // let Quasar/QInputProps flow through
      properties: {
        model: { type: 'string' },
        type: {
          type: 'string',
          enum: [
            'textarea',
            'button',
            'checkbox',
            'color',
            'date',
            'datetime-local',
            'email',
            'file',
            'hidden',
            'image',
            'month',
            'number',
            'password',
            'radio',
            'range',
            'search',
            'tel',
            'text',
            'time',
            'url',
            'week',
          ],
        },
      },
    },

    options: {
      type: 'object',
      required: ['model'],
      additionalProperties: true, // allow QOptionGroupProps passthrough
      properties: {
        model: {
          oneOf: [
            { type: 'string' }, // radio‑style single value
            { type: 'array' }, // checkbox / toggle list
          ],
        },
        type: {
          type: 'string',
          enum: ['radio', 'checkbox', 'toggle'],
        },
      },
    },
  },
} as const satisfies JSONSchema7

/* ------------------------------------------------------------------ *
 * 3.  Taskyon tool wrapper
 * ------------------------------------------------------------------ */
export const quasarDialogTool = createTool({
  name: 'quasarDialog',
  description: 'Display a Quasar dialog to collect user input/confirmation.',
  longDescription:
    'Programmatically builds alert, confirm, prompt or option ' +
    'dialogs and returns { action, data }.',
  parameters: qDialogSchema,
  renderOptions: { hideChat: false, hideLlm: false },
  async function(opts) {
    // tiny runtime shim — adapt Dialog.create() to a promise interface
    return new Promise((resolve) => {
      Dialog.create(opts)
        .onOk((data: unknown) => resolve({ action: 'ok', data }))
        .onCancel(() => resolve({ action: 'cancel' }))
        .onDismiss(() => resolve({ action: 'dismiss' }))
    })
  },
})

export const guiTools = [quasarDialogTool]
