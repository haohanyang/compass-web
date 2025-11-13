const fs = require('fs');

const dep = process.argv[2];

const pkgJsonPath = 'package.json';

const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

if (pkgJson.dependencies && pkgJson.dependencies[dep]) {
  delete pkgJson.dependencies[dep];
}

if (pkgJson.devDependencies && pkgJson.devDependencies[dep]) {
  delete pkgJson.devDependencies[dep];
}

fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf-8');
