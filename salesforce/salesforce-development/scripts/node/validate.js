/**
 * Valida el manifiesto completo de una mejora con RunSpecifiedTests.
 *
 * node validate.js [nombre]
 *
 * Ejecutar desde la raíz del proyecto Salesforce. Si se omite el nombre,
 * se obtiene de la rama feature/<nombre>. Lee SF_PROJECT_NAME y SF_ENV del
 * .env y toma feature/<nombre>/manifest/package.xml. Para DEV y UAT prepara
 * un paquete con clone-project.js. Para PRD usa el proyecto raíz.
 *
 * Detecta clases de prueba Apex del manifiesto. Si no hay ninguna, requiere
 * SF_VALIDATION_TEST_CLASS con el nombre de una prueba existente en la org.
 * Muestra el destino, manifiesto, pruebas y comando. Enter inicia la validación
 * y Ctrl+C cancela. Validar en PRD requiere autorización previa.
 *
 * Guarda la respuesta JSON de SF CLI bajo .tmp/<nombre>/deploy/<ambiente>/,
 * dentro del paquete preparado cuando corresponde. Emite un resumen JSON
 * con targetOrg, tests, report, jobId y status. No aplica Quick Deploy.
 */

const { spawnSync } = require('node:child_process');
const { mkdir, readFile, realpath, writeFile } = require('node:fs/promises');
const { basename, dirname, join } = require('node:path');
const { createInterface } = require('node:readline');
const { parseEnv } = require('node:util');
const { resolveFeature } = require('./clone-project.js');

const { XMLParser, XMLValidator } = require('fast-xml-parser');

async function listTests(project, manifest) {
  const xml = await readFile(manifest, 'utf8');
  if (xml.includes('<!DOCTYPE') || XMLValidator.validate(xml) !== true) {
    throw new Error('El manifiesto debe ser XML válido y carecer de DOCTYPE.');
  }
  const parser = new XMLParser({ isArray: tag => tag === 'types' || tag === 'members' });
  const types = parser.parse(xml).Package?.types;
  if (!types?.length) throw new Error('El manifiesto no contiene componentes.');

  const classes = types.filter(group => group.name === 'ApexClass').flatMap(group => group.members);
  const tests = [];
  for (const name of new Set(classes)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Enumera cada clase Apex con su nombre API: ${name}`);
    }
    const path = join(project, 'force-app', 'main', 'default', 'classes', name + '.cls');
    const source = await readFile(path, 'utf8');
    const code = source.replace(/'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, ' ');
    const declaration = /\bclass\s+[a-zA-Z_][a-zA-Z0-9_]*/i.exec(code);
    if (declaration && /@isTest\b/i.test(code.slice(0, declaration.index))
        || /\btestMethod\s+void\b/i.test(code)) {
      tests.push(name);
    }
  }
  return tests;
}

function confirmValidation() {
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

async function validate(feature) {
  const root = await realpath(process.cwd());
  const {
    SF_PROJECT_NAME: name,
    SF_ENV: environment,
    SF_VALIDATION_TEST_CLASS: fallbackTest,
  } = parseEnv(
    await readFile(join(root, '.env'), 'utf8'),
  );
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(name ?? '')
      || !['dev', 'uat', 'prd'].includes(environment)) {
    throw new Error('Configura SF_PROJECT_NAME y SF_ENV (dev, uat o prd) en .env.');
  }

  const targetOrg = `${name}-${environment}`;
  const production = environment === 'prd';
  const originalManifest = join(root, 'feature', feature, 'manifest', 'package.xml');
  let project = root;
  let manifest = originalManifest;
  const outputDir = join(root, '.tmp', feature, 'deploy', environment);
  if (!production) {
    const preparer = join(__dirname, 'clone-project.js');
    const preparation = spawnSync(process.execPath, [preparer, feature, root], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    if (preparation.error) throw preparation.error;
    if (preparation.status !== 0) throw new Error('Falló la preparación del paquete.');
    const prepared = JSON.parse(preparation.stdout);
    if (prepared.targetOrg !== targetOrg) {
      throw new Error('El ambiente del paquete preparado difiere del ambiente de validación.');
    }
    project = await realpath(prepared.directory);
    if (dirname(project) !== await realpath(outputDir) || !basename(project).startsWith('paquete-')) {
      throw new Error(`La carpeta preparada debe estar directamente bajo ${outputDir}.`);
    }
    manifest = join(project, 'manifest', 'package.xml');
    const [current, staged] = await Promise.all([readFile(originalManifest), readFile(manifest)]);
    if (!current.equals(staged)) throw new Error('El manifiesto cambió. Prepara el paquete de nuevo.');
  }

  const manifestTests = await listTests(project, manifest);
  const useFallback = manifestTests.length === 0;
  if (useFallback && !/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(fallbackTest ?? '')) {
    throw new Error('El manifiesto no incluye pruebas. Define SF_VALIDATION_TEST_CLASS con el nombre de una clase de prueba de la org destino.');
  }
  const tests = useFallback ? [fallbackTest] : manifestTests;

  const args = [
    'project', 'deploy', 'validate', '--target-org', targetOrg, '--manifest', manifest,
    '--test-level', 'RunSpecifiedTests', '--json',
    ...tests.flatMap(test => ['--tests', test]),
  ];
  const command = ['sf', ...args].map(value => /\s/.test(value) ? `"${value}"` : value);
  console.error('\nVista previa de validación');
  console.error(`  Mejora     ${feature}`);
  console.error(`  Ambiente   ${environment.toUpperCase()}`);
  console.error(`  Org        ${targetOrg}`);
  console.error(`  Proyecto   ${project}`);
  console.error(`  Manifiesto ${manifest}`);
  console.error(`  Pruebas    ${tests.join(', ')} (${useFallback ? '.env, clase existente en la org' : 'package.xml'})`);
  console.error(`  Comando    ${command.join(' ')}\n`);

  if (!await confirmValidation()) {
    console.error('\nValidación cancelada.');
    process.exitCode = 130;
    return;
  }

  const logDir = production ? outputDir : project;
  await mkdir(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const report = join(logDir, `validacion-${timestamp}.json`);
  const run = spawnSync('sf', args, { cwd: project, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (run.error) throw run.error;
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.stdout) await writeFile(report, run.stdout, { flag: 'wx' });
  const result = run.stdout ? JSON.parse(run.stdout) : {};
  console.log(JSON.stringify({
    targetOrg, tests, report: run.stdout ? report : null,
    jobId: result.result?.id ?? null, status: result.result?.status ?? result.name ?? null,
  }, null, 2));
  process.exitCode = run.status ?? 1;
}

async function main() {
  try {
    const [, , feature, ...extra] = process.argv;
    if (extra.length) {
      throw new Error('Uso: node validate.js [mejora]');
    }
    await validate(resolveFeature(feature));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

main();
