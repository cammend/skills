const { spawnSync } = require('node:child_process');
const { readFile, realpath } = require('node:fs/promises');
const { join } = require('node:path');
const { createInterface } = require('node:readline');
const { parseArgs, parseEnv } = require('node:util');
const { resolveFeature } = require('./clone-project.js');

function confirmDeployment() {
  return new Promise(resolve => {
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    prompt.setPrompt('Presiona Enter para continuar o Ctrl+C para cancelar. ');
    prompt.on('line', answer => {
      if (answer.trim() !== '') {
        prompt.prompt();
        return;
      }
      resolve(true);
      prompt.close();
    });
    prompt.once('SIGINT', () => prompt.close());
    prompt.once('close', () => resolve(false));
    prompt.prompt();
  });
}

async function deploy(feature, skipConfirmation) {
  const root = await realpath(process.cwd());
  const { SF_PROJECT_NAME: name, SF_ENV: environment } = parseEnv(
    await readFile(join(root, '.env'), 'utf8'),
  );
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(name ?? '')) {
    throw new Error('Configura SF_PROJECT_NAME en .env.');
  }
  if (!['dev', 'uat'].includes(environment)) {
    throw new Error('El despliegue rápido solo admite SF_ENV=dev o SF_ENV=uat.');
  }
  const targetOrg = `${name}-${environment}`;
  const preparer = join(__dirname, 'clone-project.js');
  const preparation = spawnSync(process.execPath, [preparer, feature, root, '--deploy-rapido'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (preparation.error) throw preparation.error;
  if (preparation.status !== 0) throw new Error('Falló la preparación del paquete auxiliar.');
  const prepared = JSON.parse(preparation.stdout);
  if (prepared.targetOrg !== targetOrg) {
    throw new Error('El ambiente del paquete preparado difiere del destino.');
  }

  const check = spawnSync('sf', [
    'data', 'query', '--target-org', targetOrg, '--json',
    '--query', 'SELECT IsSandbox FROM Organization',
  ], { cwd: root, encoding: 'utf8' });
  if (check.error) throw check.error;
  if (check.status !== 0) {
    throw new Error(check.stderr?.trim() || check.stdout?.trim() || 'No se pudo comprobar la org.');
  }
  if (JSON.parse(check.stdout).result?.records?.[0]?.IsSandbox !== true) {
    throw new Error(`El alias ${targetOrg} debe apuntar a un sandbox Salesforce.`);
  }

  const args = [
    'project', 'deploy', 'start', '--target-org', targetOrg,
    '--manifest', prepared.manifest, '--test-level', 'NoTestRun',
  ];
  const command = ['sf', ...args].map(value => /\s/.test(value) ? `"${value}"` : value);
  console.error('\nVista previa de despliegue directo');
  console.error(`  Mejora     ${feature}`);
  console.error(`  Ambiente   ${environment.toUpperCase()}`);
  console.error(`  Org        ${targetOrg}`);
  console.error(`  Proyecto   ${prepared.directory}`);
  console.error(`  Manifiesto ${prepared.manifest}`);
  console.error('  Pruebas    NoTestRun');
  console.error(`  Comando    ${command.join(' ')}\n`);

  if (!skipConfirmation && !await confirmDeployment()) {
    console.error('\nDespliegue cancelado.');
    process.exitCode = 130;
    return;
  }

  const result = spawnSync('sf', args, { cwd: prepared.directory, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

async function main() {
  try {
    const { values, positionals } = parseArgs({
      options: { yes: { type: 'boolean' } },
      allowPositionals: true,
    });
    if (positionals.length > 1) {
      throw new Error('Uso: node fast-deploy.js [mejora] [--yes]');
    }
    await deploy(resolveFeature(positionals[0]), values.yes);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

main();
