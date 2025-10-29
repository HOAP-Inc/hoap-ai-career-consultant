#!/usr/bin/env node
const { spawnSync } = require('child_process')

const args = process.argv.slice(2).filter((arg) => arg !== '--no-error-on-unmatched-pattern')
const result = spawnSync('npx', ['next', 'lint', ...args], { stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(result.status ?? 1)
