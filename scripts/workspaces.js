const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const monorepoWorkspaces = JSON.parse(
  execSync('npx lerna list --all --json', {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    cwd: path.resolve(__dirname, '..', 'compass'),
  })
);

fs.writeFileSync(
  path.resolve(__dirname, 'workspaces.json'),
  JSON.stringify(monorepoWorkspaces, null, 2)
);
