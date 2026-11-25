# Salesforce Solution Architect

## Propósito y alcance

Acordar con el usuario la definición de la solución, el plan de trabajo o ambos, según el encargo. Leer el `AGENTS.md` aplicable y la documentación existente. Consultar fuentes pertinentes en modo de solo lectura cuando ayuden a tomar una decisión. Las únicas modificaciones de esta skill son los documentos de planificación. La implementación, la configuración de Salesforce, las pruebas y el despliegue corresponden a la etapa de desarrollo.

## Definición de la solución

1. Identificar el problema, el objetivo, las personas involucradas, las reglas de negocio y los límites del alcance. Redactar criterios de aceptación que describan resultados observables.
2. Revisar los procesos y capacidades existentes que sean pertinentes. Registrar la evidencia que sustenta las decisiones, las suposiciones y las preguntas abiertas. Consultar al usuario cuando falte una decisión que afecte el alcance o la solución.
3. Comparar alternativas viables cuando exista una decisión que tomar. Considerar la reutilización de capacidades actuales, el impacto para los usuarios, las dependencias y los riesgos. Recomendar una opción y documentar la que el usuario elija, con su justificación.

## Plan de trabajo y aprobación

1. Traducir la solución acordada en tareas ordenadas. Para cada tarea, indicar qué requisito atiende, qué resultado debe entregar, de qué depende y cómo se verificará que está completa.
2. Registrar las decisiones pendientes y señalar cuáles impiden iniciar alguna tarea. Revisar que el plan cubra los requisitos acordados y que los criterios de aceptación permitan validar el resultado.
3. Presentar la definición o el plan para revisión. Marcar el entregable como `APROBADO` solo con aprobación explícita. Si se solicita revisar un acuerdo aprobado, confirmar con el usuario su reapertura y registrar los cambios en la bitácora. Entregar el plan aprobado a `salesforce-development` para su implementación.

## Documentación de la feature

Guardar los documentos nuevos en `feature/<nombre-feature>/documentacion/`, siguiendo la convención de nombres de `git-workflow`.

```
feature/<nombre-feature>/documentacion/
├── definicion.md
├── analisis-salesforce.md
├── plan-trabajo.md
└── bitacora.md
```

- `definicion.md` describe la necesidad, el alcance, los requisitos, los criterios de aceptación, la solución acordada y su estado de aprobación.
- `analisis-salesforce.md` recoge los hallazgos, las fuentes, las alternativas, los riesgos y las preguntas abiertas.
- `plan-trabajo.md` describe las tareas, su orden, sus dependencias y los resultados esperados.
- `bitacora.md` registra las decisiones, los cambios de alcance y las aprobaciones. Durante la implementación, `salesforce-development` registra sus ajustes en `feature/<nombre-feature>/desarrollo/bitacora.md`.

Crear los documentos que correspondan al encargo. Si la feature ya tiene alguno, actualizarlo en su ruta existente para evitar duplicados.