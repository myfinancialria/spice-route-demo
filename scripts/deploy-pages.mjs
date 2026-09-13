/**
 * Builds the app into docs/ for GitHub Pages and leaves the markers Pages
 * needs: .nojekyll so the assets folder is served verbatim, and 404.html so a
 * refresh on a deep link still loads the app.
 */
import { execSync } from 'node:child_process'
import { copyFileSync, writeFileSync } from 'node:fs'

execSync('npx vite build', { stdio: 'inherit' })
writeFileSync('docs/.nojekyll', '')
copyFileSync('docs/index.html', 'docs/404.html')
console.log('\ndocs/ is ready to publish. Commit it and push to main.')
