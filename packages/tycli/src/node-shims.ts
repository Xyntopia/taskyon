const verbose = process.env.TASKYON_CLI_VERBOSE === '1' || process.env.TASKYON_CLI_VERBOSE === 'true'

if (!verbose) {
  console.log = () => {}
  console.info = () => {}
  console.debug = () => {}
  console.warn = () => {}
}

export {}
