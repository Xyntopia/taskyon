import type { QDialogOptions, QDialogSelectionPrompt } from 'quasar'
import { Dialog } from 'quasar'
import { createTool } from '../taskyon/tools'
import type { JSONSchema7 } from 'json-schema'

export const simpleDialogSchema = {
  /* Keep schema self‑contained so Taskyon can inline‑generate types */
  $id: 'SimpleQDialogOptions',
  type: 'object',
  additionalProperties: false,

  /* --- REQUIRED --------------------------------------------------- */
  required: ['message'],

  /* --- MAIN PROPS ------------------------------------------------- */
  properties: {
    /* Text shown in the card header (optional). */
    title: { type: 'string' },

    /* Main body text.  Required so the dialog is never empty. */
    message: { type: 'string' },

    /* ---- Interaction variants ----------------------------------- */
    /* Exactly ONE of prompt / options may be supplied.              */

    /* Free‑form input (text / number) ----------------------------- */
    prompt: {
      type: 'object',
      required: ['model'],
      additionalProperties: true, // allow QInputProps passthrough
      properties: {
        /* Initial value for the input.  The AI can pre‑fill hints. */
        model: { type: 'string' },

        /* Only expose two field types that actually change UX.
           Others (email, date…) become plain text inputs anyway.   */
        type: { enum: ['text', 'number'] },

        /* Optional numeric boundaries when type === 'number' */
        min: { type: 'number' },
        max: { type: 'number' },
        step: { type: 'number' },
      },
    },

    /* Pre‑defined choices ----------------------------------------- */
    options: {
      type: 'object',
      required: ['model', 'items'],
      additionalProperties: true, // allow QOptionGroupProps
      properties: {
        /* radio  -> string   | checkbox -> array */
        model: {}, // keep loose; see read‑only note

        /* Only radio / checkbox are useful for chat UX. */
        // we are leaving out toggle buttons..
        type: { enum: ['radio', 'checkbox'] },

        /* Label/value pairs for the selection widget. */
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['label', 'value'],
            properties: {
              label: { type: 'string' },
              value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
              //color: { type: 'string' },
            },
            additionalProperties: true, // user can pass QOption syntax
          },
        },
      },
    },

    /* ---- Buttons ------------------------------------------------- */
    /* Strings here override Quasar’s default labels.
       We DON’T expose the full QBtn prop object: the AI won’t style. */
    ok: { anyOf: [{ type: 'boolean' }, { type: 'string' }] },
    cancel: { anyOf: [{ type: 'boolean' }, { type: 'string' }] },

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
    // dark/seamless/fullWidth/fullHeight…            // visual sugar
  },
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
    /* ------------------------------------------------------------------ *
     * 1.  Destructure opts to strip the raw .options
     * ------------------------------------------------------------------ */
    const { options: rawOptions, ...rest } = opts

    /* Build a strongly‑typed replacement only when needed */
    const selectionPrompt: QDialogSelectionPrompt | undefined = rawOptions
      ? {
          ...rawOptions,
          model: rawOptions.model as string | readonly unknown[],
        }
      : undefined

    /* ------------------------------------------------------------------ *
     * 2.  Assemble the final payload
     * ------------------------------------------------------------------ */
    const normalized: QDialogOptions = {
      html: false,
      position: 'standard',

      /* caller’s props except the (now removed) .options */
      ...rest,

      /* ensure an OK button exists */
      ok: opts.ok ?? true,

      /* auto‑add Cancel for interactive dialogs */
      cancel: opts.cancel ?? (opts.prompt || rawOptions ? true : false),

      /* add the strongly‑typed options block back in */
      ...(selectionPrompt ? { options: selectionPrompt } : {}),
    }

    /* ------------------------------------------------------------
     * 3.  Show dialog and wrap callbacks in a promise
     * ---------------------------------------------------------- */
    return new Promise<DialogResult>((resolve) => {
      Dialog.create(normalized)
        .onOk((data) => resolve({ action: 'ok', data }))
        .onCancel(() => resolve({ action: 'cancel' }))
        .onDismiss(() => resolve({ action: 'dismiss' }))
    })
  },
})

export const guiTools = [quasarDialogTool]
