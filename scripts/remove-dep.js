const fs = require('fs');
const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');

const args = yargs(hideBin(process.argv))
  .option('dep', {
    type: 'string',
    description: 'Name of the dependency to remove',
    demandOption: true,
  })
  .option('file', {
    type: 'string',
    description: 'Path to the package.json file',
    default: 'package.json',
  })
  .parse();

const pkgJson = JSON.parse(fs.readFileSync(args.file, 'utf-8'));

if (pkgJson.dependencies && pkgJson.dependencies[args.dep]) {
  delete pkgJson.dependencies[args.dep];
}

if (pkgJson.devDependencies && pkgJson.devDependencies[args.dep]) {
  delete pkgJson.devDependencies[args.dep];
}

fs.writeFileSync(args.file, JSON.stringify(pkgJson, null, 2) + '\n', 'utf-8');
