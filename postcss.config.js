import autoprefixer from 'autoprefixer'

// Broader Browserslist coverage includes older Safari and other browsers
// that still need vendor-prefixed CSS properties.
export default {
  plugins: [autoprefixer()],
}
