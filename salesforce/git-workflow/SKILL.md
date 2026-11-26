---
name: git-workflow
description: Gestiona ramas, historial, sincronización, commits y pull requests con Git y GitHub.
---

# Git y GitHub

Gestiona los cambios locales y remotos del repositorio y su publicación autorizada en GitHub.

## Propósito y límites

Esta Skill es responsable **solo de Git y GitHub**: ramas, historial, diferencias, sincronización, commits y detección de divergencias.

Trabajar en Linux y Windows, evitando comandos dependientes del shell cuando exista una alternativa multiplataforma. Antes de cualquier operación, identificar repositorio, directorio raíz, rama activa, remotos y estado del árbol de trabajo. Nunca asumir que la rama actual representa un ambiente específico sin comprobarlo.

## Convenciones del proyecto

- En proyectos Salesforce, `main` representa la línea base de producción (PRD). Verificar por separado el estado de la org.
- Las features se desarrollan en ramas `feature/<nombre>` (por ejemplo, `feature/mejoras-sv`).
- Mantener `.env` y credenciales fuera de Git. Verificar que `.env`, credenciales y `.tmp/` queden fuera de los cambios preparados antes de hacer commit.
- No mezclar cambios de otras features en commits de la feature actual.

## Nombres de archivos y carpetas

En todos los proyectos en los que se use esta Skill, nombrar los archivos y carpetas nuevos cuyo nombre se pueda elegir con letras ASCII en minúscula (`a-z`), números (`0-9`) y guiones medios (`-`) entre palabras. Usar extensiones en minúscula, como en `feature/mejoras-sv/documentacion/plan-trabajo.md`.

Conservar los nombres que exijan las herramientas, plataformas o formatos del proyecto, como `AGENTS.md` y los archivos de metadatos de Salesforce. Usar las rutas existentes al actualizar archivos o carpetas del proyecto.

## Política de seguridad y autorización

**Permitido por defecto (lectura/no destructivo):** `git status`, `git branch` en modo de consulta, `git log`, `git show`, `git diff`, `git ls-files`, `git remote -v`, `git rev-parse`, `git merge-base`, `git fetch` (actualiza referencias remotas, no el árbol de trabajo), `git diff --check`.

**Requiere confirmación explícita sobre alcance y consecuencias:** `git add`, `git commit`, `git switch`/`checkout` cuando haya cambios locales o se cambie de contexto, `git pull`, `git merge`, `git rebase`, `git cherry-pick`, `git push`, creación/eliminación de ramas, resolución de conflictos, creación de tags y cambios de configuración Git.

**No ejecutar sin autorización explícita, específica y revisión previa del impacto:** `git reset --hard`, `git clean -fd`, `git restore` sobre trabajo no guardado, `git checkout -- <archivo>`, `git push --force`/`--force-with-lease`, eliminación de ramas remotas, reescritura de historial o cualquier operación que pueda descartar trabajo ajeno. Una petición de “sincronizar” **no** autoriza descartes, merges, rebases ni pushes.

No utilizar `git stash` automáticamente: puede ocultar cambios que deben ser revisados. No realizar commits ni pushes silenciosos. Nunca modificar `main` directamente como parte del desarrollo de una feature salvo instrucción explícita.

## Inspección inicial obligatoria

Identificar cambios staged, unstaged y untracked, así como posibles conflictos. No asumir que los cambios preexistentes son propios; preservarlos. Si el árbol está sucio, delimitar exactamente qué archivos pueden tocarse. Si hace falta actualizar las referencias remotas, ejecutar `git fetch` y comparar la rama activa con su upstream antes de proponer una integración.

Para revisar un archivo concreto, comparar sus cambios locales con `git diff -- <ruta>` y `git diff --cached -- <ruta>`. Revisar también el historial y las diferencias de esa ruta con el upstream si existe.

## Pull requests

Verificar la rama origen, la base y el diff. Incluir el alcance y las verificaciones realizadas. Publicar o fusionar el pull request cuando la acción esté autorizada.
