// $
import { defineBoot } from '#q-app/wrappers'
import { setCssVar } from 'quasar'

export default defineBoot(() => {
  console.log('set colors! :)')
  // 42, 53, 72
  //const primary = '#2A3548'
  // 247, 143, 59
  //const secondary = '#F78F3B'
  //setCssVar('primary', primary)
  //setCssVar('secondary', secondary)
  // we have to use "rgb" colors, in order to make them usbale in sass :)
  setCssVar('primary-rgb', '42, 53, 72')
  setCssVar('secondary-rgb', '247, 143, 59')
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
