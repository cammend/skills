const { execFileSync, spawnSync } = require('node:child_process');
const { Console } = require('node:console');
const {
  copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile,
} = require('node:fs/promises');
const { basename, dirname, join, resolve } = require('node:path');
const { parseEnv } = require('node:util');

const { XMLParser, XMLValidator } = require('fast-xml-parser');
const parser = new XMLParser({
  preserveOrder: true,
  commentPropName: '#comment',
  parseTagValue: false,
});
const variantFolders = new Map([
  ['CustomMetadata', ['customMetadata', '.md-meta.xml']],
  ['NamedCredential', ['namedCredentials', '.namedCredential-meta.xml']],
  ['ExternalCredential', ['externalCredentials', '.externalCredential-meta.xml']],
]);

function parseManifest(xml) {
  if (xml.includes('<!DOCTYPE') || XMLValidator.validate(xml) !== true) {
    throw new Error('El manifiesto debe ser XML válido y carecer de DOCTYPE.');
  }
  const nodes = parser.parse(xml).find(node => node.Package)?.Package;
  const version = nodes?.find(node => node.version)?.version[0]?.['#text'];
  if (!/^\d+\.\d+$/.test(version ?? '')) {
    throw new Error('El manifiesto debe tener una versión de Metadata API.');
  }

  const components = [];
  const keys = new Set();
  for (const { types } of nodes.filter(node => node.types)) {
    const type = types.find(node => node.name)?.name[0]?.['#text'];
    if (!type) throw new Error('Cada bloque types debe tener un nombre.');

    let variable = false;
    for (const node of types) {
      if (node['#comment']) {
        const comment = node['#comment'][0]?.['#text'] ?? '';
        variable ||= /\bvariable-por-ambiente\b/i.test(comment);
        continue;
      }
      if (variable && !node.members) {
        throw new Error('La marca variable-por-ambiente debe preceder a un members.');
      }
      if (!node.members) continue;

      const name = node.members[0]?.['#text'];
      if (!name || name.includes('*')) {
        throw new Error(`El manifiesto debe enumerar miembros individuales de ${type}.`);
      }
      const key = `${type}:${name}`;
      if (keys.has(key)) throw new Error(`Componente duplicado: ${key}`);
      if (variable && !variantFolders.has(type)) {
        throw new Error(`Tipo variable sin soporte: ${type}`);
      }
      keys.add(key);
      components.push({ type, name, key, variable });
      variable = false;
    }
    if (variable) throw new Error(`Marca variable-por-ambiente sin miembro en ${type}.`);
  }
  return { version, components };
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function commonManifest(components, version) {
  const groups = new Map();
  for (const { type, name } of components) {
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(name);
  }
  const blocks = [...groups].map(([type, names]) => [
    '  <types>',
    ...names.map(name => `    <members>${escapeXml(name)}</members>`),
    `    <name>${escapeXml(type)}</name>`,
    '  </types>',
  ].join('\n'));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
    ...blocks,
    `  <version>${version}</version>`,
    '</Package>',
    '',
  ].join('\n');
}

function sf(cwd, ...args) {
  try {
    execFileSync('sf', args, {
      cwd,
      env: { ...process.env, SF_DISABLE_LOG_FILE: 'true' },
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (error.stdout) process.stderr.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw new Error(`Falló sf ${args.slice(0, 3).join(' ')}: ${error.status ?? error.code}`);
  }
}

async function copyCommon(root, projectDir, components, version) {
  if (components.length === 0) return;

  const selection = join(projectDir, 'package-comun.xml');
  const converted = join(projectDir, 'metadata-api');
  await writeFile(selection, commonManifest(components, version));
  sf(root, 'project', 'convert', 'source',
    '--root-dir', join(root, 'force-app'), '--manifest', selection,
    '--output-dir', converted, '--api-version', version);

  const actual = parseManifest(await readFile(join(converted, 'package.xml'), 'utf8'));
  const found = new Set(actual.components.map(component => component.key));
  const missing = components.filter(component => !found.has(component.key));
  if (missing.length) {
    throw new Error(`Faltan componentes comunes: ${missing.map(item => item.key).join(', ')}`);
  }

  sf(projectDir, 'project', 'convert', 'mdapi',
    '--root-dir', converted, '--output-dir', join(projectDir, 'force-app'));
  await rm(converted, { recursive: true });
  await rm(selection);
}

async function resolveLocalPaths(fileName, searchDir) {
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_. -]*$/.test(fileName ?? '')) {
    throw new Error('Indica el nombre exacto del archivo, incluida su extensión.');
  }

  const directory = await realpath(resolve(searchDir));
  if (process.platform === 'win32') {
    const command = [
      "$ErrorActionPreference = 'Stop'",
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$paths = @(Get-ChildItem -LiteralPath $env:SF_LOCAL_SEARCH_DIR -Recurse -File -Filter $env:SF_LOCAL_FILE_NAME | Where-Object { $_.Name -eq $env:SF_LOCAL_FILE_NAME } | Select-Object -ExpandProperty FullName)',
      'ConvertTo-Json -InputObject $paths -Compress',
    ].join('\x3b ');
    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', command,
    ], {
      encoding: 'utf8',
      env: { ...process.env, SF_LOCAL_SEARCH_DIR: directory, SF_LOCAL_FILE_NAME: fileName },
    });
    return JSON.parse(output.trim());
  }

  const result = spawnSync('rg', ['--files', '--null', '--glob', fileName, '--', directory], {
    encoding: 'utf8',
  });
  if (result.error?.code === 'ENOENT') {
    throw new Error('Instala ripgrep (rg) para buscar rutas locales.');
  }
  if (result.error) throw result.error;
  if (result.status === 1) return [];
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Falló la búsqueda local con rg.');
  }
  return result.stdout.split('\0').filter(Boolean);
}

async function prepare(root, feature, manifestName) {
  const settings = parseEnv(await readFile(join(root, '.env'), 'utf8'));
  const projectName = settings.SF_PROJECT_NAME;
  const environment = settings.SF_ENV;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(projectName ?? '')) {
    throw new Error('SF_PROJECT_NAME debe ser un nombre de proyecto válido.');
  }
  if (!['dev', 'uat'].includes(environment)) {
    throw new Error('SF_ENV debe ser dev o uat. Para PRD se usa el proyecto raíz.');
  }

  const manifest = await readFile(join(root, 'feature', feature, 'manifest', manifestName), 'utf8');
  const { version, components } = parseManifest(manifest);
  if (!components.length) throw new Error('El manifiesto está vacío.');
  const project = JSON.parse(await readFile(join(root, 'sfdx-project.json'), 'utf8'));
  const copies = [];
  for (const { type, name, variable } of components) {
    if (!variable) continue;
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(name)) {
      throw new Error(`Nombre API inválido para ${type}: ${name}`);
    }
    const [folder, suffix] = variantFolders.get(type);
    const relative = join(folder, name + suffix);
    const source = join(root, 'sandbox', environment, 'force-app', 'main', 'default', relative);
    const info = await stat(source).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!info?.isFile()) throw new Error(`Falta la variante de ${environment}: ${source}`);
    copies.push({ source, relative });
  }

  const workDir = join(root, '.tmp', feature, 'deploy', environment);
  await mkdir(workDir, { recursive: true });
  const directory = await mkdtemp(join(workDir, 'paquete-'));
  try {
    const sourceDir = join(directory, 'force-app', 'main', 'default');
    const targetManifest = join(directory, 'manifest', 'package.xml');
    await mkdir(dirname(targetManifest), { recursive: true });
    await writeFile(targetManifest, manifest);
    // Keep Salesforce CLI from inheriting ignore rules outside the staged project.
    await writeFile(join(directory, '.forceignore'), '');
    await writeFile(join(directory, 'sfdx-project.json'), JSON.stringify({
      packageDirectories: [{ path: 'force-app', default: true }],
      namespace: project.namespace ?? '',
      sourceApiVersion: version,
    }, null, 2) + '\n');

    await copyCommon(root, directory, components.filter(item => !item.variable), version);
    for (const { source, relative } of copies) {
      const destination = join(sourceDir, relative);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
    const display = new Console({ stdout: process.stderr });
    display.log('\nOrigen de los componentes');
    display.table(components.map(({ type, name, variable }) => ({
      Tipo: type,
      Componente: name,
      Origen: variable ? `sandbox/${environment}/force-app/` : 'force-app/',
    })));
    return { directory, manifest: targetManifest, targetOrg: `${projectName}-${environment}` };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function resolveFeature(explicitName, root = process.cwd()) {
  if (explicitName !== undefined) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(explicitName)) {
      throw new Error('El nombre de la mejora debe usar minúsculas, números y guiones.');
    }
    return explicitName;
  }

  const git = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' });
  if (git.error) throw git.error;
  const branch = git.stdout?.trim() ?? '';
  const match = /^feature\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(branch);
  if (git.status !== 0 || !match) {
    throw new Error(`Indica la mejora como argumento o ejecuta desde una rama feature/<nombre>. Rama: ${branch || 'sin rama activa'}.`);
  }
  return match[1];
}

async function main() {
  try {
    const [, , command, ...args] = process.argv;
    if (command === '--resolver-ruta' && args.length <= 2) {
      const [fileName, searchDir = 'force-app'] = args;
      const paths = await resolveLocalPaths(fileName, searchDir);
      console.log(JSON.stringify(paths.sort(), null, 2));
    } else if (args.length <= 1 || (args.length === 2 && args[1] === '--deploy-rapido')) {
      const [projectRoot = '.', mode] = args;
      const manifestName = mode ? 'package-fast-deploy.xml' : 'package.xml';
      const root = await realpath(resolve(projectRoot));
      const result = await prepare(root, resolveFeature(command, root), manifestName);
      console.log(JSON.stringify(result, null, 2));
    } else {
      const script = basename(process.argv[1]);
      throw new Error(`Uso: node ${script} [nombre-feature] [raíz-del-proyecto]
  `
        + `     node ${script} --resolver-ruta <archivo> [carpeta-de-búsqueda]`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { resolveFeature };

if (require.main === module) main();
