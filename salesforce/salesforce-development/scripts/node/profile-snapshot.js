const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');

const [orgAlias, profileArgument, outputName] = process.argv.slice(2);
const profileNames = (profileArgument || '').split(';').map(name => name.trim());

if (!orgAlias || profileNames.some(name => !name)) {
    console.error(
        'Uso: node profile-snapshot.js <org-alias> "Perfil A;Perfil B" [archivo.txt]'
    );
    process.exit(1);
}

function resolveSfCommand() {
    if (process.platform !== 'win32') return { command: 'sf', prefix: [] };

    // Ejecutar el entry point con Node evita invocar sf.cmd mediante un shell.
    // Así las consultas SOQL, incluidos saltos de línea, se conservan como argumentos.
    for (const directory of (process.env.PATH || '').split(path.delimiter)) {
        if (!directory) continue;
        const binDirectory = directory.replace(/^"|"$/g, '');
        const executable = path.join(binDirectory, 'sf.exe');
        if (fs.existsSync(executable)) return { command: executable, prefix: [] };

        const entryPoints = [
            path.join(binDirectory, 'node_modules', '@salesforce', 'cli', 'bin', 'run.js'),
            path.resolve(binDirectory, '..', 'client', 'bin', 'run.js')
        ];
        for (const entryPoint of entryPoints) {
            if (fs.existsSync(entryPoint)) {
                return { command: process.execPath, prefix: [entryPoint] };
            }
        }
    }
    throw new Error('No se encontró Salesforce CLI en PATH. Instala @salesforce/cli o agrega su carpeta bin a PATH.');
}

let sfCommand;
const timestamp = [
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
].join('_');
const queryLogPath = path.resolve(
    __dirname, '..', '..', '.tmp',
    `profile-queries-${orgAlias.replace(/[^a-zA-Z0-9_-]/g, '_')}_${timestamp}_${process.pid}.jsonl`
);
let currentProfile = null;
let queryNumber = 0;

function logQuery(entry) {
    fs.mkdirSync(path.dirname(queryLogPath), { recursive: true });
    fs.appendFileSync(queryLogPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        org: orgAlias,
        profile: currentProfile,
        ...entry
    }) + '\n', 'utf8');
}

function getOutputPath(profileName, index) {
    const safeName = name => name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const suffix = profileNames.length > 1 ? `_${index + 1}_${safeName(profileName)}` : '';
    let fileName;

    if (outputName) {
        const extension = path.extname(outputName);
        const stem = extension ? outputName.slice(0, -extension.length) : outputName;
        fileName = `${stem}${suffix}${extension}`;
    } else {
        fileName = `profile-${safeName(orgAlias + ' ' + profileName)}_${timestamp}${suffix ? `_${index + 1}` : ''}.txt`;
    }

    return path.resolve(__dirname, '..', '..', './.tmp', fileName);
}

function sf(args) {
    sfCommand ||= resolveSfCommand();
    const result = execFileSync(sfCommand.command, [...sfCommand.prefix, ...args], {
        encoding: 'utf8',
        maxBuffer: 100 * 1024 * 1024,
        windowsHide: true
    });

    const parsed = JSON.parse(result);

    if (parsed.status !== 0) {
        throw new Error(JSON.stringify(parsed));
    }

    return parsed.result;
}

function query(soql, tooling = false) {
    const queryId = ++queryNumber;
    // Guardar antes de invocar Salesforce para conservar incluso la consulta que falle.
    logQuery({ queryId, event: 'query', api: tooling ? 'tooling' : 'data', soql });
    const args = [
        'data', 'query',
        '--query', soql,
        '--target-org', orgAlias,
        '--json'
    ];

    if (tooling) args.push('--use-tooling-api');

    try {
        const result = sf(args);

        // No generar snapshots incompletos.
        if (result.done === false) {
            throw new Error(`Consulta incompleta: ${soql}`);
        }

        const records = result.records || [];
        logQuery({ queryId, event: 'success', records: records.length });
        return records;
    } catch (error) {
        logQuery({
            queryId, event: 'error', message: error.message,
            stdout: error.stdout?.toString(), stderr: error.stderr?.toString()
        });
        throw error;
    }
}

function escapeSoql(value) {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function sortByName(a, b) {
    return a.localeCompare(b, 'en', {
        sensitivity: 'variant',
        numeric: true
    });
}

function bool(value) {
    return value === true ? 'true' : 'false';
}

function section(title, lines) {
    return [
        '='.repeat(78),
        `${title} (${lines.length})`,
        '='.repeat(78),
        ...lines,
        ''
    ].join('\n');
}

function permissionValues(record, fields) {
    return fields
        .map(field => `${field}=${bool(record[field])}`)
        .join(' | ');
}

function getSystemPermissionFields() {
    const result = sf([
        'sobject', 'describe',
        '--sobject', 'PermissionSet',
        '--target-org', orgAlias,
        '--json'
    ]);

    return result.fields
        .map(field => field.name)
        .filter(name => name.startsWith('Permissions'))
        .sort(sortByName);
}

function getProfile(profileName) {
    const records = query(`
        SELECT Id, Name
        FROM Profile
        WHERE Name = '${escapeSoql(profileName)}'
        LIMIT 1
    `);

    if (!records.length) {
        throw new Error(`Perfil no encontrado: ${profileName}`);
    }

    return records[0];
}

function getProfilePermissionSet(profileId) {
    const records = query(`
        SELECT Id
        FROM PermissionSet
        WHERE IsOwnedByProfile = true
        AND ProfileId = '${profileId}'
        LIMIT 1
    `);

    if (!records.length) {
        throw new Error('No se encontró el PermissionSet del perfil.');
    }

    return records[0].Id;
}

function getSystemPermissions(permissionSetId, fields) {
    const chunkSize = 100;
    const permissions = [];

    for (let i = 0; i < fields.length; i += chunkSize) {
        const chunk = fields.slice(i, i + chunkSize);

        console.log(
            `Consultando permisos del sistema: ${Math.min(i + chunkSize, fields.length)}/${fields.length}`
        );

        const records = query(`
            SELECT ${chunk.join(', ')}
            FROM PermissionSet
            WHERE Id = '${permissionSetId}'
        `);

        if (!records.length) {
            throw new Error(
                `No se encontró PermissionSet: ${permissionSetId}`
            );
        }

        const record = records[0];

        for (const field of chunk) {
            const name = field.replace(/^Permissions/, '');

            permissions.push(
                `${name} = ${bool(record[field])}`
            );
        }
    }

    return permissions.sort(sortByName);
}

function getObjectPermissions(permissionSetId) {
    const fields = [
        'PermissionsCreate',
        'PermissionsRead',
        'PermissionsEdit',
        'PermissionsDelete',
        'PermissionsViewAllRecords',
        'PermissionsModifyAllRecords'
    ];

    const records = query(`
        SELECT SobjectType, ${fields.join(', ')}
        FROM ObjectPermissions
        WHERE ParentId = '${permissionSetId}'
    `);

    return records
        .map(record =>
            `${record.SobjectType} | ${permissionValues(record, fields)}`
        )
        .sort(sortByName);
}

function getFieldPermissions(permissionSetId) {
    const fields = [
        'PermissionsRead',
        'PermissionsEdit'
    ];

    const records = query(`
        SELECT Field, ${fields.join(', ')}
        FROM FieldPermissions
        WHERE ParentId = '${permissionSetId}'
    `);

    return records
        .map(record =>
            `${record.Field} | ${permissionValues(record, fields)}`
        )
        .sort(sortByName);
}

function getSetupEntityAccess(permissionSetId) {
    return query(`
        SELECT SetupEntityId, SetupEntityType
        FROM SetupEntityAccess
        WHERE ParentId = '${permissionSetId}'
    `).filter(record => record.SetupEntityType !== 'CustomPermission');
}

function getEntityNames(objectName, ids) {
    const result = new Map();

    if (!ids.length) return result;

    const chunkSize = 100;

    for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const idList = chunk.map(id => `'${id}'`).join(',');

        const records = query(`
            SELECT Id, Name
            FROM ${objectName}
            WHERE Id IN (${idList})
        `, true);

        for (const record of records) {
            result.set(record.Id, record.Name);
        }
    }

    return result;
}

function getAccessSections(accessRecords) {
    const types = {
        ApexClass: {
            object: 'ApexClass',
            title: '04 - APEX CLASSES'
        },
        ApexPage: {
            object: 'ApexPage',
            title: '05 - VISUALFORCE PAGES'
        }
    };

    const sections = [];

    for (const [type, config] of Object.entries(types)) {
        const records = accessRecords.filter(
            record => record.SetupEntityType === type
        );

        const ids = [...new Set(records.map(r => r.SetupEntityId))];
        const names = getEntityNames(config.object, ids);

        const lines = records
            .map(record =>
                names.get(record.SetupEntityId) ||
                `ID:${record.SetupEntityId}`
            )
            .sort(sortByName);

        sections.push(section(config.title, lines));
    }

    const knownTypes = new Set(Object.keys(types));

    const otherLines = accessRecords
        .filter(record => !knownTypes.has(record.SetupEntityType))
        .map(record =>
            `${record.SetupEntityType} | ${record.SetupEntityId}`
        )
        .sort(sortByName);

    sections.push(section('06 - OTHER SETUP ENTITY ACCESS', otherLines));

    return sections;
}

function snapshotProfile(profileName, permissionSetId, systemFields) {
    console.log(`Perfil: ${profileName}`);

    console.log('Consultando permisos del sistema...');
    const systemPermissions = getSystemPermissions(
        permissionSetId,
        systemFields
    );

    console.log('Consultando permisos de objetos...');
    const objectPermissions = getObjectPermissions(permissionSetId);

    console.log('Consultando permisos de campos...');
    const fieldPermissions = getFieldPermissions(permissionSetId);

    console.log('Consultando clases, páginas y otros accesos...');
    const setupAccess = getSetupEntityAccess(permissionSetId);
    const countAccess = type => setupAccess.filter(record => record.SetupEntityType === type).length;
    const knownTypes = new Set(['ApexClass', 'ApexPage']);

    const activeSystemPermissions = systemPermissions.filter(permission => permission.endsWith(' = true')).length;
    const systemPermissionsSummary = `${systemPermissions.length} permisos totales | ${activeSystemPermissions} activos | ${systemPermissions.length - activeSystemPermissions} inactivos`;

    const contents = [
        `PROFILE: ${profileName}`,
        '',
        'RESUMEN DE PERMISOS',
        `Sistema: ${systemPermissionsSummary}`,
        `Clases: ${countAccess('ApexClass')} permisos`,
        `Objetos: ${objectPermissions.length} permisos`,
        `Campos: ${fieldPermissions.length} permisos`,
        `Páginas Visualforce: ${countAccess('ApexPage')} permisos`,
        `Otros accesos: ${setupAccess.filter(record => !knownTypes.has(record.SetupEntityType)).length} permisos`,
        '',
        section('01 - SYSTEM PERMISSIONS', systemPermissions),
        section('02 - OBJECT PERMISSIONS', objectPermissions),
        section('03 - FIELD PERMISSIONS', fieldPermissions),
        ...getAccessSections(setupAccess)
    ].join('\n');

    console.log(`Sistema: ${systemPermissionsSummary}`);
    console.log(`Objetos: ${objectPermissions.length}`);
    console.log(`Campos: ${fieldPermissions.length}`);
    console.log(`Otros accesos: ${setupAccess.length}`);
    return contents;
}

function main() {
    console.log(`Organización: ${orgAlias}`);
    logQuery({ event: 'start', profiles: profileNames });
    console.log(`Registro de consultas: ${queryLogPath}`);
    const systemFields = getSystemPermissionFields();

    profileNames.forEach((profileName, index) => {
        currentProfile = profileName;
        const profile = getProfile(profileName);
        const contents = snapshotProfile(
            profile.Name,
            getProfilePermissionSet(profile.Id),
            systemFields
        );
        const outputPath = getOutputPath(profile.Name, index);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, contents, 'utf8');
        console.log(`Archivo generado: ${outputPath}`);
    });
}

try {
    main();
} catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
}