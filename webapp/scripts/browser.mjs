import { existsSync } from 'node:fs'

// Prefer an explicit browser in CI; retain the existing Windows installation.
export const executablePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(path => existsSync(path))
