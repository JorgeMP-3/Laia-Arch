# Guía de programación para entender LAIA

> Documento didáctico.
> Pensado para leer el código de LAIA con calma, entender qué lenguaje se está usando y reconocer qué está pasando en cada archivo importante.

---

## Objetivo de esta guía

Esta guía existe para que puedas leer el proyecto y entenderlo de verdad, no solo “seguirlo por encima”.

No está escrita para enseñarte toda la informática del mundo.
Está escrita para enseñarte **el tipo de programación que aparece en LAIA**.

Cuando termines de leerla, la idea es que seas capaz de:

- abrir un archivo `.ts` y no sentir que todo es ruido
- distinguir datos, tipos, funciones y lógica real
- entender qué hace cada parte principal de `Laia Arch`
- seguir una explicación técnica sin perderte en la sintaxis
- reconocer por dónde pasa la información dentro del instalador

Esta guía va a ser deliberadamente más detallada que la anterior.

---

## 1. Qué lenguaje usa realmente este proyecto

El proyecto usa principalmente:

- **TypeScript**
- ejecutado sobre **Node.js**

Eso significa:

- el lenguaje en el que está escrito el código fuente es TypeScript
- el entorno que lo ejecuta es Node.js

### Qué es TypeScript

TypeScript es un lenguaje construido encima de JavaScript.

La idea central es esta:

- JavaScript permite escribir lógica y ejecutar programas
- TypeScript añade información extra sobre los datos para que el editor y el compilador detecten errores antes

Ejemplo muy simple:

```ts
function add(a: number, b: number): number {
  return a + b;
}
```

Esto dice:

- `a` tiene que ser un número
- `b` tiene que ser un número
- la función devuelve un número

Si más tarde alguien hace esto:

```ts
add("2", 3);
```

TypeScript lo marcará como error.

JavaScript por sí solo no protege tanto.

### Qué es Node.js

Node.js es un entorno para ejecutar JavaScript o TypeScript fuera del navegador.

Gracias a Node.js, `Laia Arch` puede:

- leer archivos del sistema
- escribir configuración
- abrir una conversación por terminal
- llamar a APIs externas
- lanzar comandos del sistema
- comprobar servicios

En otras palabras:

- TypeScript = cómo escribimos el programa
- Node.js = dónde corre ese programa

---

## 2. Qué tipo de programa es LAIA Arch

`Laia Arch` no es solo una web.
En la parte que estás trabajando ahora, es sobre todo un **programa de terminal** con lógica de instalación.

Eso significa que el programa:

1. arranca
2. inspecciona el sistema
3. habla contigo
4. construye una intención y un plan
5. ejecuta cambios
6. verifica si quedaron bien
7. intenta reparar si algo falla

Por eso el código mezcla cosas de varios tipos:

- conversación con IA
- análisis de texto
- planificación
- ejecución de comandos
- verificación técnica
- persistencia de estado

No es un proyecto “simple”.
Pero sí está organizado en piezas entendibles si sabes qué buscar.

---

## 3. Cómo leer un archivo TypeScript sin agobiarte

No leas un archivo grande como si fuera una novela.
Léelo por capas.

## Capa 1 — El nombre del archivo

Primero pregúntate:

- ¿este archivo define tipos?
- ¿este archivo conversa?
- ¿este archivo ejecuta?
- ¿este archivo verifica?

Ejemplos:

- `types.ts` → define estructuras de datos
- `conversation.ts` → gestiona la conversación
- `plan-generator.ts` → fabrica pasos del plan
- `executor.ts` → ejecuta esos pasos

## Capa 2 — Los imports

Arriba del archivo verás imports.

Ejemplo:

```ts
import * as fs from "node:fs";
import { buildConversationArtifacts } from "./conversation-semantics.js";
import type { ConversationIntent } from "./types.js";
```

Esto ya te dice bastante:

- usa archivos del sistema (`fs`)
- usa una función de otro módulo local
- depende de un tipo llamado `ConversationIntent`

Los imports son pistas.
Te dicen de qué depende ese archivo.

## Capa 3 — Los tipos y constantes

Normalmente arriba aparecen:

- `type`
- `interface`
- constantes
- helpers

Eso prepara el terreno.

## Capa 4 — La función principal

Casi siempre hay una o varias funciones “importantes”.

Por ejemplo:

- `runConversation(...)`
- `generatePlan(...)`
- `executePlan(...)`

Si entiendes esas funciones, entiendes el corazón del archivo.

---

## 4. Conceptos de TypeScript que aparecen todo el rato en LAIA

Aquí vamos a entrar ya en conceptos de programación reales.

---

## 4.1 Variables: `const` y `let`

### `const`

```ts
const mode = "adaptive";
```

Significa:

- esa variable no se va a reasignar después

Importante:

- no significa “todo lo de dentro es inmutable”
- significa “esa variable seguirá apuntando al mismo valor o al mismo objeto”

Ejemplo:

```ts
const user = { name: "Ana" };
user.name = "María"; // esto sí puede pasar
```

Lo que no puedes hacer es:

```ts
user = { name: "Carlos" }; // error
```

### `let`

```ts
let stageIndex = 0;
stageIndex = stageIndex + 1;
```

Significa:

- esta variable sí puede cambiar

Regla práctica:

- `const` cuando no necesitas reasignar
- `let` cuando sí necesitas mover el valor

---

## 4.2 Tipos básicos

TypeScript trabaja con tipos básicos como:

- `string` → texto
- `number` → número
- `boolean` → verdadero o falso

Ejemplo:

```ts
const companyName: string = "Laia Agency";
const teamSize: number = 8;
const needsVpn: boolean = true;
```

Muchas veces TypeScript puede deducir el tipo solo:

```ts
const companyName = "Laia Agency";
```

Aquí no hace falta escribir `: string` porque TypeScript lo infiere.

---

## 4.3 Funciones

Una función es un bloque de lógica reutilizable.

Ejemplo:

```ts
function buildDomain(name: string): string {
  return `${name}.local`;
}
```

Esto significa:

- nombre de la función: `buildDomain`
- entrada: un texto llamado `name`
- salida: un texto

### Ejemplo más realista

```ts
function isRemoteRequired(remoteUsers: number, needsVpn: boolean): boolean {
  return remoteUsers > 0 || needsVpn;
}
```

Esto significa:

- si hay usuarios remotos o si la VPN es necesaria, devuelve `true`

### Funciones flecha

En TypeScript verás mucho esta forma:

```ts
const isEnabled = (value: boolean): boolean => value === true;
```

Es otra forma de definir funciones.

No es otro concepto.
Es la misma idea con otra sintaxis.

---

## 4.4 Objetos

Un objeto es una estructura con claves y valores.

Ejemplo:

```ts
const goal = {
  companyName: "Laia Agency",
  targetDomain: "laia.local",
  remoteAccessRequired: true,
};
```

Aquí el objeto tiene tres propiedades:

- `companyName`
- `targetDomain`
- `remoteAccessRequired`

Para leer una propiedad:

```ts
goal.companyName;
```

### Importante en LAIA

En este proyecto casi todo circula como objetos.

Ejemplos:

- escaneo del sistema
- configuración de instalación
- intención de conversación
- sesión de instalación
- propuesta de acción

Por eso, aprender a leer objetos bien es clave.

---

## 4.5 Interfaces

Una `interface` describe cómo tiene que ser un objeto.

Ejemplo:

```ts
interface InstallationGoal {
  companyName: string;
  targetHostname: string;
  targetDomain: string;
  desiredServices: string[];
}
```

Esto no ejecuta nada.

No es una función.
No es un proceso.
No “hace”.

Solo define la forma correcta de un dato.

### Cómo leerlo correctamente

Esto significa:

- cualquier objeto que quiera ser un `InstallationGoal` debe tener esas propiedades

Ejemplo válido:

```ts
const goal: InstallationGoal = {
  companyName: "Laia Agency",
  targetHostname: "laia-host",
  targetDomain: "laia.local",
  desiredServices: ["dns", "ldap", "docker"],
};
```

Ejemplo inválido:

```ts
const goal: InstallationGoal = {
  companyName: "Laia Agency",
  targetDomain: "laia.local",
};
```

Aquí faltan propiedades.

### Idea importante

Las interfaces en LAIA son importantísimas porque organizan el lenguaje interno del proyecto.

Si entiendes `types.ts`, entiendes:

- qué datos existen
- cómo son
- cómo pasan de un módulo a otro

---

## 4.6 `type`

También verás mucho `type`.

Ejemplo:

```ts
type InstallMode = "tool-driven" | "guided" | "adaptive";
```

Esto define un tipo más concreto.

Aquí significa:

- un `InstallMode` solo puede ser uno de esos tres textos

### Por qué esto es útil

Porque evita errores tontos.

Si escribes:

```ts
const mode: InstallMode = "adaptativo";
```

eso sería incorrecto.

El valor válido tiene que ser exactamente uno de los permitidos.

### Diferencia práctica entre `interface` y `type`

En uso cotidiano dentro de este proyecto:

- `interface` suele describir objetos estructurados
- `type` suele usarse para alias, combinaciones o uniones más pequeñas

No necesitas obsesionarte con la diferencia teórica al principio.

Necesitas reconocer su función práctica.

---

## 4.7 Tipos unión

Una unión significa:

- “esto puede ser uno de varios tipos o valores”

Ejemplo:

```ts
type ApprovalResult = "approved" | "rejected" | "timeout";
```

Ahora imagina esta función:

```ts
function handleApproval(result: ApprovalResult) {
  if (result === "approved") {
    console.log("Seguimos");
  } else if (result === "rejected") {
    console.log("Paramos");
  } else {
    console.log("Se acabó el tiempo");
  }
}
```

Aquí el tipo hace que la lógica sea más clara y más segura.

---

## 4.8 Propiedades opcionales

Ejemplo:

```ts
interface NetworkConfig {
  serverIp: string;
  internalDomain: string;
  vpnRange?: string;
}
```

El `?` significa:

- esa propiedad puede estar o puede no estar

Ejemplo válido:

```ts
const a: NetworkConfig = {
  serverIp: "192.168.100.14",
  internalDomain: "laia.local",
};
```

También válido:

```ts
const b: NetworkConfig = {
  serverIp: "192.168.100.14",
  internalDomain: "laia.local",
  vpnRange: "10.10.10.0/24",
};
```

### Cómo se lee en código real

Cuando una propiedad es opcional, verás accesos así:

```ts
config.network?.vpnRange;
```

Eso significa:

- si `network` existe, mira `vpnRange`
- si no existe, no rompas el programa

---

## 4.9 Arrays

Un array es una lista ordenada de valores.

Ejemplo:

```ts
const services = ["dns", "ldap", "docker"];
```

### Métodos que verás mucho

#### `map`

Transforma cada elemento.

```ts
const upper = services.map((service) => service.toUpperCase());
```

Resultado:

```ts
["DNS", "LDAP", "DOCKER"];
```

#### `filter`

Se queda solo con los elementos que cumplen una condición.

```ts
const networkServices = services.filter((service) => service !== "docker");
```

Resultado:

```ts
["dns", "ldap"];
```

#### `find`

Busca el primer elemento que cumpla una condición.

```ts
const dockerService = services.find((service) => service === "docker");
```

Resultado:

- `"docker"` si existe
- `undefined` si no existe

#### `some`

Comprueba si al menos uno cumple la condición.

```ts
const hasDocker = services.some((service) => service === "docker");
```

Resultado:

- `true`

### Ejemplo real de LAIA

```ts
const desiredServices = Object.entries(finalData.services)
  .filter(([, enabled]) => enabled)
  .map(([service]) => service);
```

Vamos a leer esto despacio:

#### Paso 1

`Object.entries(finalData.services)`

Convierte un objeto como este:

```ts
{
  dns: true,
  ldap: true,
  samba: false
}
```

en un array así:

```ts
[
  ["dns", true],
  ["ldap", true],
  ["samba", false],
];
```

#### Paso 2

`.filter(([, enabled]) => enabled)`

Esto significa:

- de cada pareja, ignora el primer valor
- quédate con `enabled`
- filtra solo los que sean `true`

Resultado intermedio:

```ts
[
  ["dns", true],
  ["ldap", true],
];
```

#### Paso 3

`.map(([service]) => service)`

Esto significa:

- de cada pareja, quédate solo con el nombre del servicio

Resultado final:

```ts
["dns", "ldap"];
```

Este tipo de lectura por fases es muy importante para entender TypeScript real.

---

## 4.10 Desestructuración

Esto aparece mucho y al principio puede parecer raro.

Ejemplo:

```ts
const [service, enabled] = ["dns", true];
```

Ahora:

- `service` vale `"dns"`
- `enabled` vale `true`

En funciones se usa muchísimo:

```ts
Object.entries(data.services).filter(([, enabled]) => enabled);
```

Aquí:

- la pareja es `[clave, valor]`
- `,` delante del nombre significa “ignora el primer elemento”
- `enabled` toma el segundo

Otro ejemplo:

```ts
const { company, services } = config;
```

Esto significa:

- saca del objeto `config` las propiedades `company` y `services`
- crea variables con esos nombres

---

## 4.11 `async` y `await`

Este es uno de los conceptos más importantes del proyecto.

Cuando algo tarda tiempo, no se resuelve “instantáneamente”.

Ejemplos reales:

- llamar a Anthropic
- leer un archivo
- ejecutar comandos
- esperar a una verificación

Para eso se usan funciones `async`.

Ejemplo:

```ts
async function loadConfig(): Promise<string> {
  return "ok";
}
```

La palabra clave importante no es solo `async`.
La otra mitad es `await`.

```ts
const result = await loadConfig();
```

Eso significa:

- espera a que termine esa operación
- cuando termine, guarda el resultado

### Ejemplo útil

```ts
async function callAI(): Promise<string> {
  return "respuesta del modelo";
}

async function run() {
  const text = await callAI();
  console.log(text);
}
```

### Qué pasa si no usas `await`

```ts
const text = callAI();
console.log(text);
```

Aquí `text` no sería la respuesta final.
Sería una promesa pendiente.

Eso es un error mental muy típico al principio.

---

## 4.12 `Promise`

Una `Promise` representa un resultado que todavía no ha llegado.

Ejemplo:

```ts
function fetchStatus(): Promise<string> {
  return Promise.resolve("running");
}
```

Eso significa:

- la función no entrega el texto directamente
- entrega una operación que más tarde producirá ese texto

### Cómo reconocerlo en lectura real

Si ves:

```ts
Promise<string>;
```

léelo como:

- “más tarde tendré un string”

Si ves:

```ts
Promise<ConversationIntent>;
```

léelo como:

- “más tarde tendré un ConversationIntent”

---

## 4.13 `try / catch`

Esto sirve para manejar errores.

Ejemplo:

```ts
try {
  const data = JSON.parse(text);
  return data;
} catch (error) {
  console.error("No se pudo parsear el JSON");
}
```

Eso significa:

- intenta ejecutar algo delicado
- si falla, entra en `catch`

En LAIA aparece mucho en:

- llamadas a APIs
- parseo de JSON
- herramientas del sistema
- lectura de archivos

### Por qué esto importa tanto aquí

Porque `Laia Arch` trabaja con cosas que pueden fallar en el mundo real:

- el modelo puede responder mal
- un archivo puede no existir
- un comando puede romperse
- un servicio puede no arrancar

El código tiene que estar preparado para eso.

---

## 4.14 `if`, `else`, condiciones y ramas

En proyectos como este, muchas decisiones dependen del contexto.

Ejemplo:

```ts
if (remoteUsers > 0) {
  enableWireGuard();
} else {
  skipWireGuard();
}
```

Eso significa:

- si hay usuarios remotos, activa la VPN
- si no, no la actives

Gran parte de `plan-generator.ts` y `executor.ts` es precisamente esto:

- reglas condicionales
- decisiones según estado observado

---

## 4.15 `switch`

También verás `switch` cuando hay varios caminos posibles.

Ejemplo:

```ts
switch (mode) {
  case "tool-driven":
    return buildFastPrompt();
  case "guided":
    return buildGuidedPrompt();
  default:
    return buildAdaptivePrompt();
}
```

Esto significa:

- si el modo es uno, usa una lógica
- si es otro, usa otra
- si no coincide con los anteriores, usa el camino por defecto

---

## 4.16 Módulos, `export` e `import`

Cada archivo de TypeScript suele ser un módulo.

Si quieres usar algo desde otro archivo, tienes que exportarlo.

### Exportar

```ts
export function buildSummary() {
  return "ok";
}
```

### Importar

```ts
import { buildSummary } from "./summary.js";
```

Eso significa:

- el archivo `summary.ts` expone una función
- otro archivo la usa

### Por qué es importante

Esto es lo que hace posible dividir el proyecto en piezas.

Por ejemplo:

- `conversation.ts` no necesita contener toda la lógica semántica
- puede importarla desde `conversation-semantics.ts`

Eso hace el código más legible y más testeable.

---

## 4.17 Qué significa `import type`

A veces verás:

```ts
import type { ConversationIntent } from "./types.js";
```

Eso significa:

- estamos importando solo el tipo
- no la lógica ejecutable

Sirve para dejar claro que ese import existe solo para describir datos.

---

## 4.18 JSON y parseo

JSON aparece por todas partes en LAIA porque es una forma simple de guardar datos estructurados.

Ejemplo de JSON:

```json
{
  "companyName": "Laia Agency",
  "remoteUsers": 2,
  "services": ["dns", "ldap", "docker"]
}
```

### Convertir texto JSON en objeto

```ts
const text = '{"companyName":"Laia Agency"}';
const data = JSON.parse(text);
```

### Convertir objeto en JSON

```ts
const data = { companyName: "Laia Agency" };
const text = JSON.stringify(data, null, 2);
```

El `null, 2` sirve para formatearlo bonito.

### Por qué esto importa en LAIA

Se usa para:

- guardar `installer-config.json`
- guardar `installer-intent.json`
- persistir estado de sesión
- intercambiar estructuras con el modelo

---

## 5. Conceptos de programación importantes en este proyecto

Aquí ya no hablamos solo de sintaxis.
Hablamos de ideas.

---

## 5.1 Datos vs comportamiento

Esta diferencia es fundamental.

### Datos

Los datos describen estado o información.

Ejemplos:

- `SystemScan`
- `InstallerConfig`
- `ConversationIntent`
- `InstallPlan`
- `InstallSessionState`

### Comportamiento

El comportamiento hace cosas.

Ejemplos:

- `runConversation(...)`
- `generatePlan(...)`
- `executePlan(...)`
- `verifyProposal(...)`

### Cómo usar esta distinción al leer

Si un bloque describe forma, probablemente habla de datos.
Si un bloque recibe cosas y devuelve otras, probablemente ejecuta lógica.

Muchos errores de lectura vienen de mezclar ambas ideas.

---

## 5.2 Estado

El estado es la información actual del sistema en un momento concreto.

Ejemplo simple:

```ts
const session = {
  currentProposalId: "ldap-01",
  completedProposalIds: ["init-01", "init-02"],
};
```

Eso representa:

- en qué punto estamos
- qué ya se hizo

En `Laia Arch`, el estado es clave porque la instalación puede:

- pausarse
- reanudarse
- fallar
- repararse

Si no guardas estado, el programa “se olvida” de lo ocurrido.

---

## 5.3 Flujo de datos

Un proyecto como este no es solo “muchas funciones”.
Es un recorrido de datos.

En el instalador, el flujo simplificado es:

```text
BootstrapResult
  -> SystemScan
  -> ConversationResult
  -> InstallerConfig / ConversationIntent
  -> InstallPlan
  -> ActionProposal[]
  -> ActionExecution / VerificationReport / InstallSessionState
```

Esto es muy importante.

Si entiendes qué objeto produce cada fase y cuál consume la siguiente, el proyecto deja de parecer caótico.

---

## 5.4 Contrato

La palabra “contrato” sale mucho en proyectos grandes.

Aquí significa:

- una estructura estable que varios módulos aceptan como verdad

Ejemplo:

- `ConversationIntent`

Eso actúa como contrato entre:

- la parte de conversación
- la parte de ejecución

Si ambas partes entienden igual ese objeto, pueden trabajar separadas.

Si no, todo se rompe.

---

## 5.5 Heurística

Una heurística es una regla práctica para inferir algo.

No es certeza matemática.

Ejemplo dentro de conversación:

- si el usuario dice “tenemos 2 comerciales remotos”, inferimos que el acceso remoto es real
- si luego dice “nadie trabaja fuera”, detectamos contradicción

La heurística intenta ayudar cuando no todo viene perfectamente estructurado.

En `conversation-semantics.ts` hay varias de estas ideas.

---

## 5.6 Verificación

Verificar no es lo mismo que ejecutar.

Ejecutar significa:

- lanzar un comando o una acción

Verificar significa:

- comprobar que el resultado final es correcto

Ejemplo:

```ts
// ejecutar
systemctl start nginx

// verificar
systemctl is-active nginx
nginx -t
```

Esto importa muchísimo en LAIA porque un comando puede terminar “sin error” y aun así dejar el sistema roto.

Por eso el proyecto usa `VerificationRequirement` y `VerificationReport`.

---

## 5.7 Persistencia

Persistir significa:

- guardar estado en disco para no perderlo cuando el proceso termina

Ejemplo:

```ts
fs.writeFileSync("session.json", JSON.stringify(session, null, 2));
```

Si luego el programa vuelve a arrancar, puede leer ese archivo y continuar.

Esto es justo lo que hace que una instalación larga se pueda reanudar.

---

## 5.8 Agéntico

En este proyecto, “agéntico” significa que el sistema no sigue solo una receta fija.

Hace algo más rico:

1. observa
2. decide
3. ejecuta
4. verifica
5. repara
6. recuerda lo que pasó

Ejemplo conceptual:

```text
si LDAP falla:
  mirar estado
  entender el error
  intentar reparación
  verificar otra vez
  continuar o escalar
```

Eso es mucho más cercano a un agente que a un simple script lineal.

---

## 6. Cómo está organizado LAIA Arch por dentro

Ahora que ya sabes la sintaxis básica, vamos a aterrizarla en el proyecto.

---

## 6.1 `src/installer/types.ts`

Este archivo es uno de los más importantes del proyecto.

No porque ejecute cosas.
Sino porque define el vocabulario central.

Aquí se describen objetos como:

- `SystemScan`
- `InstallerConfig`
- `InstallationGoal`
- `ConversationIntent`
- `InstallPlan`
- `ActionProposal`
- `VerificationRequirement`
- `VerificationReport`
- `InstallSessionState`

### Cómo leerlo

No lo leas como código complejo.
Léelo como un diccionario técnico.

Pregunta para cada tipo:

- ¿qué representa?
- ¿qué propiedades tiene?
- ¿en qué momento del flujo aparece?

Si haces eso, el resto del proyecto se vuelve mucho más legible.

---

## 6.2 `src/installer/index.ts`

Este archivo orquesta el flujo principal.

Es el punto donde se encadenan las fases del instalador.

La idea mental es:

```text
bootstrap
-> scan
-> conversation
-> plan
-> credentials
-> execution
```

No suele contener el detalle profundo de cada fase.
Contiene el orden general.

Cuando quieras saber “qué pasa primero y qué pasa después”, este es uno de los primeros sitios que debes leer.

---

## 6.3 `src/installer/conversation.ts`

Aquí vive la conversación real con el usuario.

Este archivo hace cosas como:

- construir prompts
- elegir modo (`tool-driven`, `guided`, `adaptive`)
- leer entradas del usuario por terminal
- llamar al modelo
- reunir todos los mensajes
- extraer una configuración estructurada

### Qué idea importante debes tener aquí

La conversación no es solo “chat”.

La conversación es una fase de recopilación de información.

Su salida importante no es el texto bonito.
Su salida importante es:

- `ConversationResult`
- y dentro de él, especialmente `ConversationIntent`

---

## 6.4 `src/installer/conversation-semantics.ts`

Este archivo no lleva el diálogo directo.

Su trabajo es interpretar el significado de la conversación.

Por ejemplo:

- detectar que algo sí quedó confirmado
- detectar que algo falta
- detectar contradicciones
- construir resumen y decisiones

### Ejemplo real del tipo de lógica que hay aquí

```ts
const contradictions = inferConversationContradictions(messages);
```

Eso significa:

- toma el transcript
- analiza patrones
- devuelve contradicciones detectadas

Aquí aparece bastante lógica heurística.
Es una capa semántica encima del transcript.

---

## 6.5 `src/installer/plan-generator.ts`

Este archivo convierte la configuración en pasos concretos.

Piensa en él como el traductor entre:

- lo que la empresa necesita
- lo que el sistema debe hacer

Ejemplo conceptual:

```text
si hay usuarios remotos:
  añadir WireGuard

si Docker está activo:
  preparar Agora

si Samba está activa:
  crear shares
```

La idea importante aquí es que el plan no es magia.
Es código.

Eso significa que puedes leer exactamente por qué se genera cada paso.

---

## 6.6 `src/installer/executor.ts`

Este es uno de los archivos más complejos del proyecto.

Su misión es llevar el plan a la realidad.

Hace cosas como:

- pedir aprobación humana
- ejecutar pasos
- guardar resultados
- verificar el estado final
- intentar reparaciones
- permitir reanudar

### Cómo leerlo sin perderte

No intentes entenderlo entero de una vez.

Busca estos bloques:

1. carga o crea estado de sesión
2. recorre pasos o propuestas
3. ejecuta
4. verifica
5. repara si hace falta
6. guarda el estado actualizado

Si lo lees con ese mapa mental, se vuelve mucho más razonable.

---

## 6.7 `src/installer/tools/`

Esta carpeta contiene herramientas concretas.

Cada tool hace una tarea más específica.

Ejemplos:

- leer archivos
- instalar paquetes
- comprobar servicios
- configurar Samba
- verificar Docker

La idea importante es:

- el sistema grande se divide en acciones más pequeñas y reutilizables

Eso hace que el agente no tenga que inventarlo todo cada vez.

---

## 7. Ejemplos de lectura de código difícil

Aquí vamos a practicar cómo leer trozos que suelen impresionar al principio.

---

## 7.1 Ejemplo de cadena con `filter` y `map`

Código:

```ts
const desiredServices = Object.entries(finalData.services)
  .filter(([, enabled]) => enabled)
  .map(([service]) => service);
```

Lectura humana:

1. toma todos los pares `servicio -> activo`
2. elimina los que están a `false`
3. quédate solo con el nombre del servicio

Resultado final:

- una lista de servicios activos

---

## 7.2 Ejemplo de acceso seguro con `?.`

Código:

```ts
const domain = config.network?.internalDomain;
```

Lectura humana:

- si `config.network` existe, dame `internalDomain`
- si no existe, no rompas el programa

Esto evita errores típicos cuando una parte del objeto todavía no está definida.

---

## 7.3 Ejemplo de tipo unión

Código:

```ts
type StepStatus = "pending" | "running" | "done" | "failed";
```

Lectura humana:

- un paso solo puede estar en uno de esos cuatro estados

Luego puedes hacer:

```ts
function printStatus(status: StepStatus) {
  if (status === "done") {
    console.log("Paso completado");
  }
}
```

Esto hace que el código sea más legible y reduce errores.

---

## 7.4 Ejemplo de función asíncrona realista

Código:

```ts
async function loadIntent(path: string): Promise<ConversationIntent | null> {
  try {
    const raw = await fs.promises.readFile(path, "utf8");
    return JSON.parse(raw) as ConversationIntent;
  } catch {
    return null;
  }
}
```

Lectura paso a paso:

1. intenta leer un archivo
2. espera a que la lectura termine
3. convierte el texto JSON en objeto
4. si algo falla, devuelve `null`

### Qué conceptos mezcla

- `async`
- `await`
- `Promise`
- `try/catch`
- `JSON.parse`
- tipo unión: `ConversationIntent | null`

Este es el tipo de mezcla real que verás bastante.

---

## 7.5 Ejemplo de construir un objeto grande

Código:

```ts
const goal: InstallationGoal = {
  companyName: finalData.company.name,
  installMode: mode,
  targetHostname: scan.os.hostname,
  targetDomain: finalData.network.internalDomain,
  desiredServices: Object.entries(finalData.services)
    .filter(([, enabled]) => enabled)
    .map(([service]) => service),
  remoteAccessRequired:
    finalData.access.remoteUsers > 0 || finalData.access.needsVpn || finalData.services.wireguard,
  desiredUsers: finalData.users,
};
```

Lectura humana:

- estamos creando el objetivo técnico de la instalación
- tomamos partes de varios objetos (`finalData`, `scan`, `mode`)
- calculamos algunas propiedades, no solo las copiamos

Esto es muy típico en este proyecto:

- coger estado de varias fuentes
- combinarlo
- producir un artefacto nuevo

---

## 8. Cómo seguir el flujo de una funcionalidad

Supongamos que quieres entender:

- cómo se decide si se instala WireGuard

No empieces leyendo todo el repo.

Sigue este camino:

1. mira en `conversation.ts` cómo se recoge si hay remotos
2. mira en `conversation-semantics.ts` cómo se interpreta eso
3. mira en `types.ts` qué campo representa esa decisión
4. mira en `plan-generator.ts` cómo ese dato genera pasos `vpn-*`
5. mira en `executor.ts` cómo se ejecutan y verifican

Ese método sirve para casi todo.

No leas “por archivo”.
Lee “por pregunta”.

---

## 9. Errores mentales muy típicos al empezar a leer este código

## Error 1 — Pensar que una interfaz hace cosas

No.

La interfaz solo describe datos.

## Error 2 — Pensar que si un archivo es largo, todo tiene la misma importancia

No.

En archivos grandes suele haber:

- helpers secundarios
- constantes
- utilidades
- y 1 o 2 funciones realmente centrales

Busca esas funciones primero.

## Error 3 — Ver una cadena larga y pensar que es “magia”

Tampoco.

Normalmente una cadena como:

```ts
Object.entries(...).filter(...).map(...)
```

se entiende si la rompes en pasos intermedios.

## Error 4 — Pensar que `async` significa “todo a la vez”

No.

Significa que el código trabaja con operaciones que tardan, pero sigue teniendo una lógica secuencial muy clara cuando usas `await`.

## Error 5 — Pensar que si un comando terminó, todo está bien

En LAIA eso es justamente lo que se intenta evitar.

Por eso existen verificaciones explícitas.

---

## 10. Orden recomendado para estudiar el proyecto

Si quieres avanzar de forma inteligente, este orden es muy bueno:

1. `contextLaiaProyect/02-proyecto-laia.md`
2. `contextLaiaProyect/01-estado-actual.md`
3. `contextLaiaProyect/06-como-funciona-por-dentro.md`
4. `contextLaiaProyect/07-guia-programacion-para-entender-laia.md`
5. `src/installer/types.ts`
6. `src/installer/index.ts`
7. `src/installer/conversation.ts`
8. `src/installer/conversation-semantics.ts`
9. `src/installer/plan-generator.ts`
10. `src/installer/executor.ts`

### Por qué este orden

Porque primero entiendes:

- la visión
- el estado real
- la arquitectura
- el lenguaje

Y solo después te metes en el código con detalle.

---

## 11. Qué deberías ser capaz de reconocer después de esta guía

Después de esta guía, ya deberías poder reconocer:

- qué es TypeScript
- qué hace Node.js en este proyecto
- cómo se leen imports y exports
- qué es una interfaz
- qué es un tipo unión
- qué hace `async/await`
- cómo se leen objetos grandes
- cómo se leen arrays encadenados con `map` y `filter`
- qué diferencia hay entre datos, contrato, estado y comportamiento
- cómo se mueve la información dentro de `Laia Arch`

No hace falta que sepas implementar todo.

Hace falta que el código deje de parecerte una pared.

---

## 12. Glosario mínimo para LAIA

- **runtime**: entorno donde corre el programa
- **Node.js**: runtime que ejecuta JavaScript y TypeScript en terminal o servidor
- **TypeScript**: lenguaje basado en JavaScript con sistema de tipos
- **interface**: descripción formal de la forma de un objeto
- **type**: definición o alias de tipo
- **object literal**: objeto escrito directamente con `{ ... }`
- **array**: lista ordenada
- **function**: bloque de lógica reutilizable
- **module**: archivo que exporta e importa piezas
- **async**: indica que una función trabaja con operaciones que pueden tardar
- **await**: espera el resultado de una operación asíncrona
- **Promise**: resultado futuro de una operación
- **JSON**: formato textual para datos estructurados
- **estado**: situación actual del sistema o del proceso
- **contrato**: estructura estable que varios módulos comparten
- **heurística**: regla práctica para inferir algo
- **verificación**: comprobación de que algo quedó realmente bien
- **persistencia**: guardado de estado en disco
- **fallback**: camino de seguridad si el principal falla

---

## 13. Idea final importante

La forma correcta de aprender este proyecto no es memorizar sintaxis suelta.

La forma correcta es esta:

1. entender el vocabulario
2. entender los tipos principales
3. seguir el flujo de datos
4. mirar cómo una decisión se convierte en pasos
5. mirar cómo esos pasos se ejecutan y se verifican

Cuando haces eso, el proyecto deja de ser “código raro” y pasa a ser una máquina con piezas reconocibles.

Ese es el verdadero objetivo de esta guía.
