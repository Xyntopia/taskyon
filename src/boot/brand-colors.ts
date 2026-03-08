// $
import { defineBoot } from '#q-app/wrappers'
import { setCssVar } from 'quasar'
import { hexToRgb } from '../../packages/shared/modules/utils'
import { initialStoredStateObj } from '../modules/ui/initialState'

function normalizeHexColor(color: string | undefined): string | undefined {
  if (!color) return undefined
  const trimmed = color.trim()
  if (!trimmed) return undefined
  const prefixed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  const shortHex = /^#[0-9a-fA-F]{3}$/
  const longHex = /^#[0-9a-fA-F]{6}$/
  if (shortHex.test(prefixed)) {
    const [r, g, b] = prefixed.slice(1).split('')
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  if (longHex.test(prefixed)) return prefixed.toUpperCase()
  return undefined
}

export function setColors(primary: string | undefined, secondary: string | undefined) {
  const normalizedPrimary = normalizeHexColor(primary)
  const normalizedSecondary = normalizeHexColor(secondary)
  console.log('[THEME] setColors called', {
    primary,
    secondary,
    normalizedPrimary,
    normalizedSecondary,
  })
  if (primary && !normalizedPrimary) {
    console.warn('[THEME] invalid primary color, skipping', primary)
  }
  if (secondary && !normalizedSecondary) {
    console.warn('[THEME] invalid secondary color, skipping', secondary)
  }
  if (normalizedPrimary) {
    setCssVar('primary-rgb', hexToRgb(normalizedPrimary))
    setCssVar('primary', normalizedPrimary)
  }
  if (normalizedSecondary) {
    setCssVar('secondary-rgb', hexToRgb(normalizedSecondary))
    setCssVar('secondary', normalizedSecondary)
  }
  if (typeof window !== 'undefined') {
    const css = getComputedStyle(document.documentElement)
    console.log('[THEME] css vars after setColors', {
      qPrimary: css.getPropertyValue('--q-primary').trim(),
      qPrimaryRgb: css.getPropertyValue('--q-primary-rgb').trim(),
      qSecondary: css.getPropertyValue('--q-secondary').trim(),
      qSecondaryRgb: css.getPropertyValue('--q-secondary-rgb').trim(),
    })
  }
}

export default defineBoot(() => {
  console.log('[THEME] boot set colors')

  // 42, 53, 72
  const primary = initialStoredStateObj?.appConfiguration?.primaryColor ?? '#2A3548'
  // 247, 143, 59
  const secondary = initialStoredStateObj?.appConfiguration?.secondaryColor ?? '#F78F3B'
  console.log('[THEME] initial stored colors', {
    profilePrimary: initialStoredStateObj?.appConfiguration?.primaryColor,
    profileSecondary: initialStoredStateObj?.appConfiguration?.secondaryColor,
    fallbackPrimary: '#2A3548',
    fallbackSecondary: '#F78F3B',
  })
  //setCssVar('primary', primary)
  //setCssVar('secondary', secondary)
  // we have to use "rgb" colors, in order to make them usbale in sass :)
  setColors(primary, secondary)
  //setCssVar('dark-shadow-color', '#FF0000')
  //setCssVar('primary', '#00fff0', document.body);

  /*
  $secondary: #F78F3B
$primary: #2A3548
$accent: #7fa042
$dark: #0d1117
$positive: #7fa042
$negative: #a04242
$info: #8BA7B9
$warning: #ff0000

// override quasar defaults
$dark-shadow-color: $secondary
$dark: $primary
$dark-page: $primary
*/
})
