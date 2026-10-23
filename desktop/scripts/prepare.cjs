// Prépare l'édition bureau : construit l'application en mode « desktop » puis
// copie le résultat dans desktop/app-dist, que electron-builder empaquette.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const racine = path.resolve(__dirname, '..', '..');
const cible = path.resolve(__dirname, '..', 'app-dist');

execSync('npm run build -- --mode desktop', { cwd: racine, stdio: 'inherit' });

fs.rmSync(cible, { recursive: true, force: true });
fs.cpSync(path.join(racine, 'dist-desktop'), cible, { recursive: true });

// La version de l'édition bureau suit celle de l'application.
const versionApp = JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8')).version;
const pkgPath = path.resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.version !== versionApp) {
  pkg.version = versionApp;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
console.log(`Application ${versionApp} prête dans ${cible}`);
