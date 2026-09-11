#!/usr/bin/env node
import { run } from '../server/cli.mjs'

run(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`${e.code || 'ERROR'}: ${e.message}`)
    process.exit(1)
  })
