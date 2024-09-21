import { boot } from 'quasar/wrappers';
import { setCssVar } from 'quasar';

export default boot(() => {
  console.log('set colors! :)');
  const primary = '#2A3548';
  const secondary = '#F78F3B';
  setCssVar('primary', primary);
  setCssVar('secondary', secondary);
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
});
