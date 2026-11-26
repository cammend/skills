---
name: salesforce-development
description: Implementa planes Salesforce aprobados y gestiona pruebas, metadatos, validaciones y despliegues en DEV, UAT y PRD.
---

# Desarrollo Salesforce

Implementa cambios aprobados en Salesforce y verifica sus efectos en cada ambiente con trazabilidad por componente.

## 1. Objetivo y alcance

Actuar como ingeniero Salesforce conservador y verificable. Trabajar con el repositorio local, Git y Salesforce CLI (`sf`) sin suponer que Git, DEV, UAT y PRD están sincronizados. Priorizar evidencia, cambios mínimos, trazabilidad y autorización explícita para acciones de riesgo.

Implementar el plan aprobado. Resolver las decisiones de diseño pendientes con [Arquitectura de soluciones Salesforce](../salesforce-solution-architect/SKILL.md). Consultar `definicion.md`, `analisis-salesforce.md`, `plan-trabajo.md` y `bitacora.md` en `feature/<nombre>/documentacion/`, si existen. Usar las rutas existentes para documentación previa, incluido `plan-tecnico.md` cuando sea el plan vigente. Leer también `componentes.json` si la feature lo tiene. Seguir también el `AGENTS.md` aplicable. Ante contradicciones, detenerse y pedir decisión; las restricciones de seguridad prevalecen.

## 2. Ambientes y autorizaciones

### Configuración del proyecto en `.env`

Copiar la [plantilla `.env.example`](.env.example) como `.env` en la raíz del proyecto Salesforce, junto a `sfdx-project.json`. Ajustar los valores al proyecto y mantener `.env` fuera de Git. Estas son las variables que consumen los scripts:

| Variable | Cuándo se requiere | Valor |
| --- | --- | --- |
| `SF_PROJECT_NAME` | Preparación de paquetes, validación y despliegue rápido | Nombre base del proyecto sin sufijo de ambiente. Debe empezar con una letra o dígito y puede contener letras ASCII, dígitos y guiones. |
| `SF_ENV` | Preparación de paquetes, validación y despliegue rápido | `dev`, `uat` o `prd`. La preparación de paquetes y el despliegue rápido admiten `dev` y `uat`. |
| `SF_VALIDATION_TEST_CLASS` | Validación cuando el manifiesto no aporta clases de prueba Apex | Nombre API de una clase de prueba existente en la org destino, con prefijo de espacio de nombres si corresponde. |

```dotenv
SF_PROJECT_NAME=autos
SF_ENV=dev
SF_VALIDATION_TEST_CLASS=RevisionCotizacionFunctionalTest
```

El alias activo sigue el patrón `<name>-<ambiente>`. Esta configuración selecciona `autos-dev`. La org debe estar autenticada en Salesforce CLI. Para consultar otro ambiente del mismo proyecto, conservar el nombre y usar el sufijo de destino. Leer los valores como datos. Si falta un valor requerido, es inválido o el destino solicitado contradice la configuración, resolverlo antes de ejecutar comandos contra una org. `profile-snapshot.js` recibe su alias como argumento y la búsqueda local de `clone-project.js` usa solo el archivo y la carpeta indicados.

| Ambiente | Alias SF CLI | Uso | Política |
| --- | --- | --- | --- |
| DEV | `<name>-dev` | Desarrollo y pruebas | Se permiten cambios **dentro del alcance autorizado** después de revisar divergencias. |
| UAT | `<name>-uat` | Validación de aceptación | Consultas permitidas; deployments y modificaciones requieren aprobación explícita del alcance y destino. |
| PRD | `<name>-prd` | Producción y referencia | **Solo lectura por defecto**. No desplegar, insertar, actualizar, borrar, ejecutar Apex anónimo con efectos, cambiar permisos ni ejecutar operaciones destructivas. |

Reglas obligatorias:

1. Usar `--target-org <alias>` en **cada** comando Salesforce que acepte ese parámetro. No depender de la org predeterminada ni de la org seleccionada en VS Code.
2. Verificar el alias y la identidad de la org antes de una operación con efectos: `sf org display --target-org <alias> --json`. No mostrar ni registrar tokens o secretos del resultado.
3. **Nunca interpretar una aprobación para DEV/UAT como autorización para PRD.** Para cualquier operación que altere PRD se necesita aprobación específica de usuario, ambiente, componentes, acción y alcance, inmediatamente antes de ejecutarla. Si falta, detenerse.
4. No ejecutar `sf data ...` de escritura, `sf apex run` con efectos, `sf project deploy start`, `sf project deploy quick`, `sf project delete ...` u operaciones equivalentes en PRD sin autorización explícita. Tampoco alterar datos productivos como preparación de pruebas.
5. Una validación/dry-run en PRD no modifica permanentemente los metadatos, pero consume recursos y ejecuta pruebas; solicitar autorización explícita antes de iniciarla.
6. No hacer cambios de configuración manuales en Setup por iniciativa propia. Si son necesarios, documentar pasos, impacto y aprobación.
7. No asumir que una sandbox contiene la misma metadata, licencias, usuarios, datos o permisos que PRD.

## 3. Preparación de la sesión

Antes de editar o desplegar:

1. Leer `AGENTS.md` y la documentación de la feature activa, si existe.
2. Verificar la rama activa `feature/<nombre>` y el estado local y remoto según [Git y GitHub](../git-workflow/SKILL.md). Usar el mismo nombre para la carpeta `feature/<nombre>/` en la raíz del proyecto y resolver cualquier discrepancia de rama antes de editar.
3. Resolver el alias activo según la sección 2 e identificar el alcance y los componentes.
4. Comprobar la autenticación con `sf org display --target-org <alias>` y proteger las credenciales.

### Registros de desarrollo

Crear `feature/<nombre>/desarrollo/` y mantener estos dos archivos:

- `bitacora.md` registra cada cambio o ajuste realizado durante el desarrollo. Añadir fecha, tarea, componentes afectados, ajuste y motivo, y resultado de la verificación cuando se realice.
- `registro-modificaciones-sf.md` registra la última modificación reportada por Salesforce para cada componente que se vaya a cambiar. Antes de la primera edición, añadir una entrada por componente y por ambiente (PRD, UAT y DEV), con tipo, nombre API, tarea, alias de la org, fecha de consulta, autor y fecha de última modificación con zona horaria, fuente y estado. Conservar la referencia inicial y añadir entradas para comprobaciones posteriores y cambios propios confirmados.

Obtener autor y fecha directamente de cada org. El historial de Git, los archivos locales y sus marcas de tiempo sirven para revisar el trabajo local y quedan fuera de este registro. Un componente con varios archivos locales se identifica por su tipo y nombre API en Salesforce.

### Manifiestos de la mejora

Guardar los manifiestos en `feature/<nombre>/manifest/`. Mantener un paquete principal y los auxiliares que requiera el trabajo:

- `package.xml` es el manifiesto completo de la mejora. Incluir todos los componentes nuevos o editados y documentar cada miembro con un comentario XML inmediatamente antes de su etiqueta `<members>`. Usar `<!-- Nuevo -->` o `<!-- Editado -->` según corresponda. Detallar los miembros individualmente para que cada clasificación sea inequívoca. Mantenerlo actualizado con cada ajuste y usar este mismo manifiesto para validar y desplegar en DEV, UAT y PRD, conforme a las autorizaciones de cada ambiente.
- `package-retrieve-sin-perfiles.xml` es el auxiliar para descargar los componentes de un ambiente excluyendo perfiles. Incluir los tipos y miembros recuperables que correspondan al alcance de la descarga. Para una descarga general, preparar el manifiesto con el inventario de metadatos del ambiente de origen. Excluir el tipo `Profile` por completo. Los auxiliares de descarga contienen únicamente las entradas necesarias del manifiesto XML, sin comentarios de clasificación ni documentación por miembro. Usarlos solo para recuperación.

### Preparación del paquete para DEV y UAT

Usar [clone-project.js](scripts/node/clone-project.js) con Node.js 22 o posterior y Salesforce CLI. Copiar el directorio `scripts/node/` de la skill al proyecto Salesforce. Desde la raíz del proyecto, instalar la dependencia una vez con `npm ci --prefix scripts/node`. Desde la raíz del proyecto ejecutar `node scripts/node/clone-project.js [nombre]`. También se puede indicar la raíz del proyecto como segundo argumento. En los tres scripts, si se omite el nombre, se toma de la rama activa `feature/<nombre>`. En otras ramas o con HEAD separado, indicar el nombre explícitamente.

El script lee el ambiente del `.env`, selecciona los componentes comunes desde `force-app/` y toma los marcados con `<!-- Nuevo | variable-por-ambiente -->` o `<!-- Editado | variable-por-ambiente -->` de `sandbox/<ambiente>/force-app/main/default/`. El comentario `variable-por-ambiente` es la marca que determina el origen del componente para DEV o UAT. Colocarlo inmediatamente antes de cada `<members>` activo que tenga una variante. La marca se aplica únicamente a ese miembro. Los miembros sin marca se resuelven desde `force-app/` del proyecto raíz, aunque exista una copia en el sandbox. Las variantes admitidas son `CustomMetadata`, `NamedCredential` y `ExternalCredential`. Si falta una variante, la preparación falla.

La tabla de preparación muestra el tipo, nombre API y carpeta de origen de cada componente. El resultado JSON contiene la carpeta DX bajo `.tmp/<nombre>/deploy/<ambiente>/`, la ruta del manifiesto y el alias destino. El script solo prepara archivos locales. Para PRD usar el proyecto raíz.

Para buscar un archivo local por nombre, ejecutar `node scripts/node/clone-project.js --resolver-ruta Procesar_Cotizacion.flow-meta.xml` desde la raíz del proyecto. La búsqueda devuelve un arreglo JSON de rutas absolutas. Busca en `force-app/` por defecto. Para buscar en un sandbox, pasar `sandbox/uat/force-app` como argumento adicional. El modo usa PowerShell en Windows y requiere `rg` en Linux. Opera sin conexión a Salesforce.

### Validación de la mejora

`validate.js` ejecuta exclusivamente `sf project deploy validate` con `RunSpecifiedTests`. Quick Deploy es una operación separada.

Cuando el usuario solicite validar una mejora en DEV, UAT o PRD, ejecutar desde la raíz `node scripts/node/validate.js [nombre]`. Usar este script como punto de entrada para las validaciones. Mantener [validate.js](scripts/node/validate.js) junto a `clone-project.js`. El validador lee el destino del `.env` y prepara automáticamente un paquete en DEV o UAT. En PRD usa el proyecto raíz. Muestra la mejora, el ambiente, el alias, la carpeta del proyecto, el manifiesto, las pruebas y el comando antes de validar. Obtener la autorización explícita para validar en PRD según la sección 2. Presionar Enter para ejecutar `sf project deploy validate` y guardar el reporte JSON. Para cancelar, presionar Ctrl+C. Si el manifiesto no incluye pruebas, usar `SF_VALIDATION_TEST_CLASS` del `.env`. Debe ser una clase Apex de prueba existente en la org destino. El validador la pasa como `--tests` sin agregarla al manifiesto. Si tampoco se define esa variable, se detiene antes de solicitar la validación.

### Despliegue directo para pruebas en sandbox

Al implementar un cambio solicitado en componentes Salesforce, crear o actualizar `feature/<nombre>/manifest/package-fast-deploy.xml` con los componentes del ajuste actual y sus dependencias de despliegue. Revisar sus miembros antes de cada ejecución para evitar incluir cambios ajenos al ajuste. Usar la marca `variable-por-ambiente` en los miembros que requieran una copia del sandbox.

Después de preparar y revisar los cambios, ejecutar solo en DEV o UAT y dentro del alcance autorizado. Para UAT, obtener aprobación explícita del alcance y el destino antes de ejecutar. Usar desde la raíz `node scripts/node/fast-deploy.js [nombre] --yes` como parte de la tarea. El script comprueba que el alias apunte a un sandbox, muestra los componentes, el destino y el comando, y ejecuta `sf project deploy start --test-level NoTestRun` sin confirmación adicional. Para uso manual, omitir `--yes` para confirmar con Enter o cancelar con Ctrl+C. Registrar el resultado en la bitácora de desarrollo. El despliegue completo de la mejora usa el flujo de validación y PRD queda fuera del despliegue rápido.

### Archivos temporales y de apoyo

Usar `.tmp/` en la raíz del repositorio para descargar información de trabajo y guardar archivos temporales o de apoyo, como resultados de consultas, exportaciones, comparaciones, scripts auxiliares y metadatos recuperados para revisión. Reservar `force-app/` para los componentes del proyecto y `feature/<nombre>/documentacion/` para la documentación de la feature.

Organizar `.tmp/<nombre>/` por tarea, propósito o ambiente, según el trabajo. Crear las subcarpetas al necesitarlas y guardar cada archivo en la que corresponda. Por ejemplo:

- `.tmp/mejoras-sv/retrieve/dev/` y `.tmp/mejoras-sv/retrieve/prd/` para recuperar metadatos por separado.
- `.tmp/mejoras-sv/consultas/` para resultados de consultas.
- `.tmp/mejoras-sv/comparaciones/` para diferencias y archivos de apoyo de la revisión.
- `.tmp/perfiles/<alias-org>/<ejecución>/` para los informes y el registro de consultas de una captura de perfiles por org.

Mantener `.tmp/` fuera del control de versiones según [Git y GitHub](../git-workflow/SKILL.md).

## 4. Antes de editar un componente Salesforce existente

**Puerta obligatoria de seguridad.** Aplicar a Apex, LWC, Aura, Flow, ValidationRule, CustomObject, CustomField, Profile, PermissionSet, FlexiPage, Layout, CustomMetadata y otros tipos relevantes.

1. Identificar tipo, nombre API, ruta local, dependencias y feature/tarea que justifica la modificación.
2. Revisar las diferencias locales y remotas de la ruta del componente según [Git y GitHub](../git-workflow/SKILL.md).
3. Revisar el inventario si existe. Consultar PRD, UAT y DEV por cada componente previsto, en modo de solo lectura.
4. Consultar `LastModifiedDate` y `LastModifiedBy` mediante Tooling API, Metadata API u otro mecanismo compatible con **cada tipo**. Agrupar consultas cuando sea posible. Si Salesforce no expone el autor o la fecha, registrar cada valor que sí esté disponible y marcar el faltante como `UNKNOWN`. Si una org no está disponible o faltan permisos, registrar `UNKNOWN` y el motivo. Usar `NOT_FOUND` solo si la consulta confirma la ausencia del componente en esa org.
5. Si hay diferencias, o no existe una referencia inicial fiable, comparar **contenido real** mediante un retrieve aislado en un directorio o proyecto temporal bajo `.tmp/<nombre>/retrieve/<ambiente>/`, sin sobrescribir `force-app` ni el trabajo del usuario. Normalizar únicamente diferencias de formato justificadas; no asumir que fechas iguales implican contenido igual.
6. Informar: qué versión hay en Git local/remoto, DEV, UAT y PRD; quién y cuándo modificó en cada org según Salesforce; qué cambió; qué versión se propone usar; riesgos de sobrescritura.
7. **Ante divergencia no explicada, detener la edición y solicitar decisión.** No elegir PRD, Git o sandbox como fuente canónica sin autorización. PRD es referencia importante, pero no necesariamente contiene el desarrollo más reciente.
8. Guardar las observaciones por org en `desarrollo/registro-modificaciones-sf.md` antes de editar. Registrar las decisiones de desarrollo en `desarrollo/bitacora.md` y actualizar `componentes.json` si existe como inventario.
9. Incorporar cada componente nuevo al registro antes de crearlo. Comprobar su estado en los tres ambientes para detectar componentes con el mismo tipo y nombre API.

Estados sugeridos: `UNCHANGED`, `CHANGED`, `NOT_FOUND`, `UNKNOWN`, `UNSUPPORTED`. No convertir errores de conexión, permisos o consulta en `UNCHANGED`.

**Chequeo final:** antes del deployment volver a comprobar los componentes modificados contra la referencia inicial y las modificaciones propias registradas. Si cambiaron en remoto/ambientes por terceros, investigar y solicitar decisión antes de sobrescribir.

### Manejo de componentes particulares

#### Perfiles aditivos

Incluir en cada archivo `.profile-meta.xml` de la mejora únicamente las entradas necesarias para conceder los permisos aprobados para el proyecto. Conservar los accesos vigentes de la org de destino y excluir del XML los permisos ajenos a la mejora, las revocaciones y la configuración general del perfil. Si se recupera un perfil como referencia, mantener la copia en `.tmp/` y preparar el XML de despliegue con las entradas de la mejora.

Al modificar un perfil existente, comparar cada bloque afectado con los accesos del destino. Revisar los valores `false` requeridos por el formato para evitar que deshabiliten permisos vigentes. Si una entrada pudiera quitar un acceso existente, resolver la diferencia antes de desplegar. Incluir en `package.xml` los perfiles afectados y los componentes de la mejora a los que se concede acceso. En la validación previa al despliegue, comprobar el alcance del XML y que el cambio preserve los permisos existentes.

## 5. Prioridad de scripts y alternativa con SF CLI

Usar primero el script incluido para la operación. Reservar el uso directo de `sf` para operaciones que los scripts no cubren o para casos en que el script aplicable no puede ejecutarse después de revisar sus requisitos y el error.

| Operación | Script preferente |
| --- | --- |
| Preparar un paquete DEV/UAT o localizar un archivo | [clone-project.js](scripts/node/clone-project.js) |
| Validar el manifiesto completo | [validate.js](scripts/node/validate.js) |
| Desplegar un ajuste puntual en DEV/UAT | [fast-deploy.js](scripts/node/fast-deploy.js) |
| Inventariar permisos de perfiles | [profile-snapshot.js](scripts/node/profile-snapshot.js) |

Para inventariar permisos, ejecutar `node scripts/node/profile-snapshot.js "<alias>" "Perfil A;Perfil B" [archivo.txt]` con el alias verificado. El script consulta la org en modo de solo lectura y escribe informes de texto y un registro JSONL en `.tmp/perfiles/<alias-org>/<ejecución>/` del proyecto. Tratar el contenido como información interna de accesos.

Al recurrir a SF CLI, registrar el motivo y conservar las comprobaciones del flujo original, incluida la org de destino, el manifiesto, las variantes por ambiente, las pruebas y las autorizaciones aplicables. Si el script detectó un problema de seguridad, de alcance o de datos, resolverlo antes de operar. Si ya se inició una operación remota, comprobar su estado antes de reintentar. Usar `--target-org` cuando el comando lo admita y `--json` si se necesita procesar o guardar el resultado. Consultar `sf <comando> --help` para confirmar las opciones disponibles.

En los ejemplos, `SF_TARGET_ORG` representa el alias activo y `SF_PRD_ORG` el alias de producción del mismo proyecto. Asignar estos valores después de leer y validar el `.env` según la sección 2.

### Identidad y lectura

```bash
sf org list
sf org display --target-org "$SF_TARGET_ORG" --json
sf data query --target-org "$SF_TARGET_ORG" --query "SELECT Id, Name FROM ApexClass LIMIT 5" --use-tooling-api --json
sf data query --target-org "$SF_PRD_ORG" --query "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM ApexClass WHERE Name = 'MiClase'" --use-tooling-api --json
```

### Retrieve (solo después de revisar alcance y riesgo de sobrescritura)

```bash
sf project retrieve start --target-org "$SF_TARGET_ORG" --manifest "$SF_RETRIEVE_MANIFEST"
```

Asignar a `SF_RETRIEVE_MANIFEST` la ruta absoluta de `feature/<nombre>/manifest/package-retrieve-sin-perfiles.xml` antes de ejecutar el comando desde el proyecto temporal. El retrieve puede reemplazar archivos locales. Para comparar sin afectar el trabajo actual, usar un directorio o proyecto temporal aislado bajo `.tmp/<nombre>/retrieve/<ambiente>/` y revisar los resultados antes de copiar. No recuperar un Profile parcial y asumir que contiene todos sus permisos: el contenido recuperado depende del manifiesto y del tipo de metadato.

### Validación y despliegue de mejoras

Usar `node scripts/node/validate.js [nombre]` para validar la mejora completa en DEV, UAT o PRD y reportar el identificador de la validación. La aplicación posterior se realiza mediante Quick Deploy con la validación exitosa de la misma org cuando Salesforce lo habilite y el despliegue esté autorizado según la sección 2. Para aplicar ajustes puntuales en DEV o UAT, seguir el flujo de `fast-deploy.js` descrito arriba. Los scripts son los puntos de entrada para aplicar o validar estos cambios.

### Pruebas ya desplegadas en una org

```bash
sf apex run test \
  --target-org "$SF_TARGET_ORG" \
  --tests RevisionCotizacionFunctionalTest \
  --result-format human \
  --wait 30
```

Los comandos anteriores son ejemplos; sustituir nombres y manifiestos por los de la feature real. No ejecutar comandos de ejemplo sin comprobar el contexto.

## 6. Estrategia de pruebas Apex funcionales

Las pruebas representan comportamientos observables y criterios de aceptación, no solo detalles internos. Diseñar escenarios antes de implementar la funcionalidad cuando sea viable. Preferir Apex Tests para lógica, DML, automatizaciones, seguridad efectiva y transiciones de estado; reconocer cuando una prueba UI/manual es necesaria para comprobar experiencia real de usuario o visualización de archivos.

Reglas:

1. **Autosuficiencia:** usar `@IsTest` con `SeeAllData=false` (por defecto). Crear Account, Opportunity, Quote, ContentVersion, relaciones, usuarios y demás registros necesarios en el test, `@TestSetup` o Test Data Factory.
2. No usar IDs fijos ni depender de datos de negocio preexistentes en DEV/UAT/PRD. Evitar nombres de Profile, etapas o Record Types fijos si pueden variar; cuando sean configuración necesaria, verificar su disponibilidad y documentar dependencia.
3. Para probar propietarios o roles, crear usuarios de prueba cuando sea posible y establecer explícitamente `OwnerId` o ejecutar las operaciones con `System.runAs` según el escenario.
4. `System.runAs` **no garantiza** por sí solo comprobación de CRUD/FLS. Para operaciones que deben respetar seguridad, usar `WITH USER_MODE` o DML en modo usuario, y verificar tanto éxito autorizado como rechazo no autorizado. Asegurar datos accesibles para distinguir falta de permisos de ausencia de registros.
5. Probar acciones reales (leer, crear, actualizar, aprobar, relacionar archivos) y sus resultados, en vez de limitarse a consultar asignaciones de permisos. Tener presente que algunas capacidades de UI o acceso a archivos no se demuestran completamente con Apex.
6. Una prueba que no compila por falta de metadatos es `BLOCKED`, no una prueba funcional ejecutada y fallida. Distinguir `NOT_RUN`, `BLOCKED`, `FAILED`, `PASSED`.
7. No cambiar una prueba aprobada solo para que pase. Si el comportamiento esperado cambia, actualizar primero la especificación con autorización.
8. Mantener tests portables, deterministas, independientes del orden de ejecución y sin `SeeAllData=true`, salvo excepción documentada.
9. No asumir que la creación de datos de prueba evita todas las dependencias de configuración: validaciones, automatizaciones, picklists, licencias y permisos pueden variar entre orgs.

El avance funcional puede expresarse como escenarios `PASSED` / escenarios totales, indicando por separado los bloqueados/no ejecutados. **No presentar ese porcentaje como esfuerzo de desarrollo completado.**

## 7. Desarrollo por tareas y trazabilidad

- Ejecutar solo tareas del plan de trabajo aprobado. Si no existe, seguir [Arquitectura de soluciones Salesforce](../salesforce-solution-architect/SKILL.md).
- Antes de cada edición: realizar la puerta de seguridad de la sección 4.
- Implementar cambios mínimos y evitar refactorizaciones fuera de alcance.
- Tras cada tarea: ejecutar las pruebas relevantes, revisar el diff de la tarea, añadir los resultados y decisiones a `desarrollo/bitacora.md`.
- Registrar nuevos componentes o modificaciones en el inventario técnico. No modificar silenciosamente la definición aprobada.
- No crear ni activar usuarios reales, ni asignar licencias/permisos a usuarios de negocio, sin autorización expresa. Para tests, usar usuarios de prueba aislados.

## 8. Control de calidad previo a deployment

Antes de desplegar:

1. Confirmar ambiente de destino y alias.
2. Confirmar rama, estado Git, commits y diferencias con remoto.
3. Confirmar inventario de componentes y ausencia de cambios externos no resueltos.
4. Revisar `feature/<nombre>/manifest/package.xml` y sus dependencias. Confirmar que incluya todos los componentes nuevos o editados de la mejora, con su clasificación, y excluir metadatos ajenos a la feature.
5. Revisar especialmente Profile, PermissionSet, Flow, CustomObject, Layout y CustomMetadata por su alcance y particularidades de despliegue.
6. Validar compilación y Apex Tests aplicables. Reportar clases ejecutadas, éxitos, fallos, bloqueos y cobertura cuando corresponda.
7. Evaluar cambios destructivos, activación de Flows, usuarios referenciados, accesos y diferencias de configuración por ambiente.
8. Mostrar un resumen de riesgos y verificar la autorización según el ambiente y el alcance descritos en la sección 2.
9. Tras un deployment autorizado, comprobar el resultado, actualizar `desarrollo/bitacora.md` y volver a consultar los componentes en la org de destino. Añadir el autor y la fecha observados a `desarrollo/registro-modificaciones-sf.md` y conservar las entradas iniciales.

## 9. Reporte obligatorio al usuario

En revisiones y operaciones relevantes, resumir:

- **Ambiente y alcance:** org, rama, feature, componentes.
- **Evidencia:** consultas/fechas/autores/diffs/commits relevantes, o límites de verificación.
- **Divergencias:** detectadas, resueltas, pendientes.
- **Acción:** realizada o propuesta, con su justificación.
- **Pruebas:** `PASSED`, `FAILED`, `BLOCKED`, `NOT_RUN` y causa.
- **Siguiente paso:** qué falta y si requiere autorización.

No afirmar que una validación, prueba o deployment se completó sin resultado comprobado. No ocultar fallos ni declarar equivalencia entre orgs basándose solo en fechas.

## 10. Restricciones finales

- No sobrescribir archivos locales o remotos por conveniencia.
- No modificar PRD sin autorización explícita y específica.
- No usar `--ignore-conflicts` para saltarse una revisión de cambios.
- No asumir que la ausencia de un componente en una consulta significa que no existe: considerar API, tipo, permisos, nombre y cobertura.
- No usar datos reales de negocio como fixtures de pruebas.
- No exponer tokens, contraseñas, secretos ni contenido sensible en logs o bitácoras.
- Ante incertidumbre material, detenerse, mostrar evidencia y solicitar decisión.
