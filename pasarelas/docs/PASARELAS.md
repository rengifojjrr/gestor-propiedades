# Pasarelas

Pasarelas es un libro de cuentas privado: anota cada cobro, calcula lo que se llevan la pasarela y la plataforma,
reparte lo que queda entre los beneficiarios y estima qué día cae el dinero en el banco. Este documento explica qué
hace, cómo se usa, cómo calcula cada cifra, qué hace cumplir la base de datos, qué decisiones quedan por confirmar,
qué falta y cómo se conectaría con las pasarelas (fase C, solo diseño). Todas las empresas, personas y montos son
inventados.

Cómo se escribe el dinero aquí: en el texto, con coma decimal (90,30). Entre comillas o en bloques de código, tal
como está guardado, con punto (`"90.30"`).

## Índice

1. [Qué es y qué no es](#qué-es-y-qué-no-es)
2. [Cómo se usa](#cómo-se-usa)
3. [Las piezas](#las-piezas)
4. [Las reglas del dinero](#las-reglas-del-dinero)
5. [Cómo se calcula un cobro](#cómo-se-calcula-un-cobro) (ejemplos E1 a E9)
6. [Cuándo cae el dinero](#cuándo-cae-el-dinero) (ejemplos F1 a F3)
7. [Lo que se congela y lo que lo cambia](#lo-que-se-congela-y-lo-que-lo-cambia)
8. [Estados de un cobro](#estados-de-un-cobro)
9. [Repartos y liquidaciones](#repartos-y-liquidaciones)
10. [La base de datos](#la-base-de-datos)
11. [Seguridad](#seguridad)
12. [Decisiones tomadas y por confirmar](#decisiones-tomadas-y-por-confirmar)
    - [Lo que el dueño tiene que decidir](#lo-que-el-dueño-tiene-que-decidir)
13. [Lo que queda](#lo-que-queda)
14. [Fase C: conectar con las pasarelas](#fase-c-conectar-con-las-pasarelas) (diseño, sin construir)
    - [1. Qué cambia y qué no](#1-qué-cambia-y-qué-no)
    - [2. Leer con claves restringidas de solo lectura](#2-leer-con-claves-restringidas-de-solo-lectura)
    - [3. Webhooks](#3-webhooks)
    - [4. Dónde guardar los secretos](#4-dónde-guardar-los-secretos)
    - [5. Leer comprobantes con IA](#5-leer-comprobantes-con-ia)
    - [6. Vista de solo lectura para un socio](#6-vista-de-solo-lectura-para-un-socio)
    - [7. Cambios en la base](#7-cambios-en-la-base)
    - [8. Orden sugerido y esfuerzo](#8-orden-sugerido-y-esfuerzo)
    - [9. Lo que el dueño tiene que decidir](#9-lo-que-el-dueño-tiene-que-decidir)
    - [Fuentes](#fuentes)

Las partes 1, 2, 5, 6, 12 y 13 se leen sin saber programar. Las partes 10 y 11 son para quien mantenga el código.

## Qué es y qué no es

Pasarelas es un libro de cuentas **privado** para un dueño que cobra con varias empresas y por varias pasarelas de
pago. Por cada cobro:

1. Guarda cuánto se cobró, con qué empresa, por qué canal y por qué pasarela.
2. Calcula lo que se llevan la pasarela, sus opciones (por ejemplo, un «pago rápido») y la plataforma de venta.
3. Reparte lo que queda entre los beneficiarios, según un esquema de porcentajes.
4. Estima qué día cae el dinero en el banco, y después anota el día en que cayó de verdad.
5. Lo resume: por mes, por empresa, por pasarela, por cuenta destino y por beneficiario.

Un ejemplo, que se repite en todo el documento: «Escuela Demo» cobra 100,00 por Stripe. Entre la pasarela, el pago
rápido y la plataforma se van 9,70. Quedan 90,30, que se reparten 45,15 · 27,09 · 18,06 entre los Grupos A, B y C.

**Para quién.** Para una sola persona: el dueño. Cada fila de la base pertenece a un usuario y solo él la ve.

**Lo que no hace:**

- No procesa pagos. No se conecta a ninguna pasarela: los cobros se registran a mano o se importan del archivo CSV
  que descarga la pasarela.
- No mueve dinero. Una «liquidación» es una anotación de que ya se pagó, no una transferencia.
- No guarda números de tarjeta, CVV, números de cuenta completos, claves ni contraseñas. De una cuenta destino
  solo guarda un alias y los últimos 4 dígitos.
- No guarda datos de compradores (ni nombres ni correos).

**Estado (2026-11-10).** Está todo construido: el motor, la base, la entrada con segundo factor, todas las
pantallas, el importador de CSV, «Exportar todo» y una semilla de ejemplo. Hay pruebas del motor (cubren el 100 %
de su código), de la base y del servidor contra un Supabase **local**, y de punta a punta con un navegador, en celular
y en escritorio. Está publicada desde el 10 de noviembre de 2026, en Vercel y en un proyecto de Supabase compartido
con otras apps del dueño: dónde, con qué migraciones y qué saber de ese proyecto, en
[«Dónde está publicada hoy»](../README.md#dónde-está-publicada-hoy), en el README. Lo que falta está en
[Lo que queda](#lo-que-queda).

## Cómo se usa

Pasos cortos para lo de todos los días. En el celular, la barra de abajo lleva a Resumen, Cobros y Repartos, con
el botón **«Registrar cobro»** en medio; lo demás está detrás de **«Más»**. En escritorio, todo está en la barra
lateral.

**Entrar.** En `/login`, correo y contraseña, y **«Entrar»**. No hay registro: la cuenta del dueño se crea en el
panel de Supabase. En local, `npm run seed` crea `demo@example.com` con datos de ejemplo e imprime su contraseña.

**Activar el segundo factor (el primer día).** Ajustes → Seguridad → **«Activar segundo factor»**. Se escanea el
código QR con una app de autenticación (o se escribe la clave), se escribe el código de 6 dígitos y **«Verificar y
activar»**. Desde ahí, cada entrada pide el código. Conviene **«Agregar otro dispositivo»**: no hay códigos de
respaldo. Mientras no esté activo, todas las pantallas lo avisan.

**Mirar el Resumen.** Es la primera pantalla: bruto, comisiones, neto, «Por caer» y «Depositado» del período, los
avisos (atrasados, disputas abiertas, cobros sin comprobante, empresas sin esquema de reparto activo por defecto,
feriados que faltan) y los próximos depósitos, en una moneda a la vez (ver la fila
[(x)](#decisiones-tomadas-y-por-confirmar)). En el celular, los filtros van plegados tras «Filtros» para que las
cifras se vean primero.

**Crear una pasarela con su pago rápido.** Pasarelas → **«Agregar pasarela»**:

1. Datos: nombre, días al depósito, tipo de días (hábiles o corridos), si devuelve la comisión al reembolsar y el
   costo por disputa.
2. Tarifa: comisión (por ejemplo 2,9) y cuota fija (0,30). Rige desde el inicio.
3. Opciones → **«Agregar opción»**: «Pago rápido», porcentaje 1,5, «Sobre el bruto», días al depósito con esta
   opción 0 y, si se usa casi siempre, «Encendida por defecto».
4. **«Crear pasarela»**. Si la tarifa cambia después, en su ficha se agrega otra en «Tarifas», con su «Vigente
   desde»: lo ya registrado no cambia.

**Preparar una empresa.** Cuentas destino → **«Agregar cuenta»** (alias y últimos 4 dígitos). Empresas → **«Nueva
empresa»** → **«Crear empresa»**. En su ficha: «Canales de venta» → **«Agregar canal»** (lo que cobra la
plataforma), y «Pasarelas de la empresa» → **«Agregar pasarela»** (a qué cuenta va el dinero, días propios y
opciones encendidas por defecto).

**Armar un esquema 50/30/20.** Repartos → **«Agregar beneficiario»** tres veces (Grupo A, B y C). Luego **«Nuevo
esquema»**: nombre, «Se reparte» «Sobre el neto», tres líneas con **«Agregar línea»** (50, 30 y 20), «Resto»
«Nadie», «Vigente desde» «Desde el inicio» y **«Guardar esquema»**. Para que se use solo, en la empresa: **«Editar
ficha»** → «Esquema de reparto por defecto».

**Registrar un cobro.** **«Registrar cobro»**: empresa, canal, pasarela y sus opciones, monto, moneda, fecha y hora
(de Nueva York) y referencia. El comprobante, con **«Tomar foto»** o **«Elegir archivo»** (foto o PDF, hasta
10 MB). Al lado (en el celular, debajo) se ve la cuenta: comisiones, neto, reparto y fecha estimada. En «Más
opciones» van el esquema, la cuenta destino, la fecha estimada a mano, el estado inicial y la nota. **«Guardar»**.
**«Repetir el último»** vuelve a poner la empresa, el canal, la pasarela, las opciones, quién paga la comisión, la
moneda, el esquema y quién no paga comisión del cobro anterior.

**¿Quién paga la comisión?** Al registrar (y al editar) se elige **«Nosotros»** o **«El comprador»**:

- **«Nosotros»** es lo de siempre y la opción por defecto. El monto es lo cobrado, la comisión es un costo del negocio
  y se resta.
- **«El comprador»** sirve cuando al cliente se le cobró de más para cubrir la comisión. El monto que se escribe es
  **lo que pagó el comprador**, por ejemplo 1040.
  - La comisión se calcula con la tarifa real: con Stripe (2,9 % + 0,30), 1040 da 30,46, no 40. Te quedan 1009,54.
  - El reparto se hace sobre esos 1009,54, aunque el esquema diga «Sobre el bruto».
  - En el Resumen esa comisión no cuenta como costo del negocio: sale aparte, como «Además, los compradores pagaron
    $X en comisiones».
  - Si se reembolsa o se disputa, el costo del reembolso y el de la disputa sí son del negocio (ver
    [E8](#e8--reembolsos-y-disputas-de-un-cobro-del-comprador)).

  En la lista de cobros, los del comprador llevan una marca; en el detalle, «Comisión pagada por». Al importar, «Las
  comisiones las pagaron los compradores» vale para todo el archivo.

  Si se quiere que el comprador cubra exactamente la comisión, el recargo sobre 1000 es 30,96, no 40: con 40 queda un
  extra, que cuenta como venta y se reparte.

**Una parte que no paga comisión.** Sirve cuando alguien del reparto (por ejemplo, el Grupo C) cobra su parte entera,
sin que le descuenten la comisión. Solo vale con «Nosotros» y un esquema «Sobre el neto». Con «El comprador» o «Sobre
el bruto», la marca no cambia nada.

- **En el esquema.** En «Nuevo esquema» o en la «Versión nueva» de un esquema, con «Se reparte» «Sobre el neto», cada
  línea trae la casilla **«No paga comisión»**. El «Resto» no se marca. En el esquema, esa línea lleva «no paga
  comisión».
- **En un cobro.** Al registrar con «Nosotros» y un esquema sobre el neto, sale **«¿Alguien no paga comisión?»**: una
  casilla por línea, marcadas como dice el esquema. Lo que se cambie vale solo para ese cobro; el esquema no cambia.
  Al editar sale lo mismo, marcado como quedó el cobro. «Repetir el último» repite también las marcas. Al importar
  valen las del esquema.
- **La cuenta.** Quien no paga comisión recibe su parte del bruto, como si no hubiera comisión. Los demás se reparten
  lo que queda del neto, en proporción a sus porcentajes (ver [E9](#e9--una-parte-que-no-paga-comisión)). En el
  detalle del cobro, esa parte lleva «no paga comisión» y una frase lo explica: «Grupo C no paga comisión: su parte
  es el 20 % del bruto. La comisión la pagan los demás.»
- **Alguien tiene que pagarla.** Con todas las líneas marcadas no se guarda ni el esquema ni el cobro: «Alguien tiene
  que pagar la comisión: deja al menos una parte sin marcar.» Si el esquema tiene «Resto» y le toca algo, la paga el
  «Resto».

**Cambiar el estado de un cobro desde la lista.** En Cobros, cada cobro tiene el botón **«Cambiar estado ▾»**. Abre
un menú con solo los cambios que ese cobro admite, los mismos que en su detalle salvo uno: la fecha de un depósito
ya hecho se cambia solo en el detalle del cobro. Son «Pasar a en tránsito», «Marcar depositado…» (pide la fecha),
«Revertir el depósito», «Marcar como fallido» y «Reabrir». «Revertir el depósito» y «Marcar como fallido» piden
confirmar antes. Al terminar, la lista se actualiza con los mismos filtros. En la papelera no hay menú.

**Marcar depositados varios cobros.** Cobros → «Más filtros» → Estado «Por caer» → marcar las casillas →
**«Marcar depositado»** → la fecha en que llegó el dinero. O desde el Resumen, en «Próximos depósitos», el botón
**«Marcar depositado»** de cada grupo. Solo se marca lo que está por caer (fila
[(w)](#decisiones-tomadas-y-por-confirmar)); la fecha de un depósito ya hecho se cambia en el detalle del cobro,
con **«Cambiar la fecha del depósito»**.

**Registrar un reembolso o una disputa.** En Cobros, abrir el cobro. Arriba van el monto, el estado y la acción más
esperada; las demás quedan plegadas en **«Más acciones»**, y debajo vienen los datos y el desglose:

- **«Registrar reembolso»**: monto y fecha. Antes de confirmar se ve el antes y el después. Si ya hubo un
  reembolso parcial, dentro se elige entre «Agregar un reembolso» y «Corregir el total reembolsado» (fija el total
  en vez de sumar). Con el cobro ya reembolsado del todo, ese botón no sale: sale **«Corregir reembolso»** (salvo
  con la disputa perdida, que deja el reembolso total fijo).
- **«Abrir disputa»**: la fecha. Al terminar, **«Resolver disputa»**: ganada, perdida o anulada.

**Registrar una liquidación.** Repartos → el beneficiario → «Registrar liquidación»: tipo («Pago al beneficiario»
o «Devolución a la empresa»), monto, moneda, fecha, medio, nota y comprobante → **«Registrar liquidación»**. El
saldo se actualiza.

**Importar un CSV.** Importar → empresa, pasarela, canal y opciones (por ejemplo, «Pago rápido»; valen para todo
el archivo) → el archivo. Reconoce por sí mismo los formatos de Stripe (informe de saldo y exportación de pagos) y la
descarga de actividad de PayPal; con otro, se eligen las columnas a mano y la pasarela lo recuerda. Lo importado se
reparte con el esquema por defecto de la empresa, si está activo; si no, queda sin reparto. Antes de escribir nada,
**«Así lo entendí»** dice con qué esquema se reparte y cuántos son nuevos, repetidos (también los de la papelera),
omitidos y con error, y lista los «posibles repetidos»: cobros registrados a mano con la misma empresa, pasarela,
moneda y monto, a un día como mucho. Esos solo se importan si se marca «Son otros cobros: importar también…». Con
«Estos cobros ya se depositaron», los cobros cuya fecha estimada ya llegó entran depositados en esa fecha estimada;
los que todavía no la alcanzan entran por caer. Al final, **«Importar N cobros»**. Lo que ya existe no se repite
aunque se importe dos veces. Los reembolsos del archivo no se importan: se registran en el detalle de cada cobro.

**Exportar todo.** Ajustes → «Exportar todo» → **«Descargar copia (JSON)»**: todas las filas de lo registrado, sin
ningún archivo (ni los comprobantes ni los logos de las empresas). Para una lista filtrada, Cobros → **«Exportar
CSV»**.

**Si se corta la red al guardar**, la pantalla no da nada por hecho: dice que no se sabe si se guardó y, en los
diálogos y botones, ofrece **«Ver cómo quedó»**, que vuelve a leer lo guardado. Lo escrito no se pierde. En
Registrar cobro y en una liquidación, reenviar el mismo formulario no duplica nada. Si antes de reenviarlo se cambió
un dato, avisa de que ya se había guardado con los datos del primer intento, pero no con cualquier dato:

- En Registrar cobro avisa si cambió el monto, la moneda, la fecha, la empresa, el canal, la pasarela, las opciones,
  quién paga la comisión, quién no paga comisión, el esquema, la referencia, el estado inicial, la fecha del
  depósito, la fecha estimada a mano o la nota, o si se eligió otra cuenta destino. Quitar la cuenta elegida (dejar
  la que pone la app) no se detecta: se toma como el mismo envío y ese cambio se pierde.
- En una liquidación avisa si cambió el beneficiario, la fecha, la moneda o el monto, o si se puso o se quitó el
  comprobante. Un cambio en el medio de pago o en la nota no se detecta y se pierde.

Lo mismo pasa al entrar, al escribir el código y en Ajustes → Seguridad. Entrar y el código piden repetir, que es
seguro. Al entrar se conserva el correo, pero la contraseña y los códigos de 6 dígitos hay que escribirlos otra vez.
Para cambiar la contraseña, el aviso dice cómo saber si cambió: se vuelve a intentar, y si responde que la actual no
es correcta, es que ya se cambió y vale la nueva.

## Las piezas

Es una aplicación Next 16.4 con Supabase (Postgres, Auth y Storage). Vive en la carpeta `pasarelas/` del repositorio,
con su propio `package.json`. No comparte código con el otro proyecto que está en la raíz.

| Pieza | Qué hace |
|---|---|
| **Motor** | Funciones puras que hacen todas las cuentas. No tocan la red, la base ni el reloj: la fecha de «hoy» les llega como parámetro. Por eso se prueban solas y dan lo mismo en el servidor y en el navegador |
| **Base** | Postgres en Supabase: 17 tablas `pay_*`, sus reglas, tres funciones que guardan varias tablas a la vez y cuatro vistas de totales |
| **Capa de servidor** | Lee con la sesión del usuario y escribe llamando al motor y a las funciones de la base. Es la que manda: no se fía de lo que calculó el navegador |
| **Pantallas** | Formularios y listas, pensadas primero para el celular. Usan el motor para la vista previa |
| **Pruebas** | Del motor (junto al código), de la base y de la capa de servidor (contra el Supabase local) y de punta a punta (con un navegador) |

### El recorrido de un cobro

1. **Pantalla.** El dueño llena el formulario. El navegador le enseña una vista previa calculada con el motor.
2. **Acción del servidor.** Verifica la sesión y valida lo que llegó.
3. **Motor.** El servidor vuelve a leer la configuración (tarifas, opciones, esquema, feriados) y calcula de nuevo.
   El resultado es una «escritura» lista para guardar: las columnas del cobro, su reparto y el evento del historial.
4. **Base.** La función `pay_save_transactions` guarda el cobro, el reparto y el evento en una sola transacción.
5. **La base vuelve a comprobar los cuadres.** Dos se comprueban en el momento de escribir la fila: que el neto
   sea el bruto vigente menos las comisiones, y que la base del reparto sea ese neto (o ese bruto vigente). El
   tercero, que el reparto sume exactamente su base, se comprueba al confirmar la transacción. El resultado es el
   mismo: si algo no cuadra, no se guarda nada. El detalle está en
   [Lo que la base hace cumplir](#lo-que-la-base-hace-cumplir).
6. La pantalla dice «Cobro guardado.» y deja el formulario listo para el siguiente.

En el código: el formulario es `RegisterForm`, la acción `createTransaction` (en `actions/transactions.ts`) y la
operación `createTx` (en `ops/transactions.ts`). Las demás pantallas siguen el mismo camino.

Una lectura va al revés: la pantalla pide, el servidor consulta con la sesión del usuario (la base solo le deja ver
lo suyo), convierte el dinero a texto en la frontera y el motor suma lo que haga falta.

### Carpetas

| Carpeta | Qué hay |
|---|---|
| `src/lib/pasarelas/` | **El motor** y sus pruebas al lado. `types.ts` es el contrato; `index.ts`, la puerta única |
| `src/server/pasarelas/` | **La capa de servidor**: lecturas (`queries/`), operaciones (`ops/`), las acciones del servidor que llaman las pantallas (`actions/`) y lo que comparten |
| `src/lib/supabase/` | Los clientes de Supabase (navegador, servidor y proxy) y los tipos generados de la base |
| `src/lib/auth/`, `src/proxy.ts` | La sesión verificada de cada petición y el refresco de la sesión |
| `src/app/` | La entrada (`/login`), Ajustes (con «Exportar todo»), la galería del kit y las pantallas del libro, bajo `/pasarelas` |
| `src/components/ui/`, `src/components/shell/` | Kit propio de interfaz y marco de navegación |
| `src/components/pasarelas/` | Las piezas de cada pantalla del libro |
| `supabase/migrations/` | El esquema de la base: cinco migraciones aditivas, de `20261110120000_las_pasarelas_de_pago.sql` a `20261114120000_pasarelas_5_partes_sin_comision.sql` |
| `supabase/config.toml` | El Supabase local: registro público apagado, segundo factor TOTP encendido |
| `scripts/` | El arranque del Supabase local (`stack.sh`), la semilla de ejemplo (`npm run seed`) y las capturas |
| `tests/integration/` | Pruebas contra el Supabase local: RLS, cuadres, funciones, Storage, sesiones, borrado de usuario y cada parte del libro |
| `e2e/` | Pruebas de punta a punta (celular 390×844 y escritorio 1280×800, con axe): cada pantalla y el recorrido del encargo |
| `docs/superpowers/` | El diseño (`specs/`) y el plan (`plans/`) |
| `docs/capturas/` | Una captura de cada pantalla en el celular, con datos de la semilla (el Resumen, también en oscuro), más la entrada y el código del segundo factor, vacíos. Se rehacen con `scripts/capturas.ts` cada vez que cambia una pantalla |

### Los archivos del motor

| Archivo | Qué resuelve |
|---|---|
| `decimal.ts` | La única puerta a decimal.js: redondeo y montos canónicos |
| `money.ts` | Leer lo que escribe una persona, mostrar, sumar por moneda |
| `allocate.ts` | El reparto por mayor resto: sobre el 100 % (`allocate`) o en proporción a unos pesos (`allocateInProportion`) |
| `breakdown.ts` | El cálculo de un cobro y el desglose que se congela |
| `rules.ts` | De la configuración a las reglas de un cobro, y los días que tarda el depósito |
| `versions.ts` | Qué versión (tarifa o esquema) rige en una fecha |
| `dates.ts`, `holidays.ts` | Fechas, días hábiles y feriados bancarios |
| `status.ts` | El estado que se muestra, «por caer» y «atrasado» |
| `write.ts` | Cada cambio sobre un cobro (crear, editar, reembolsar, disputar, depositar…), planeado como una escritura |
| `stats.ts` | Resumen por moneda, tiempos reales de depósito y próximos depósitos |
| `schemes.ts` | Validar un esquema de reparto antes de guardarlo |
| `guards.ts` | Guardas para textos libres: tarjetas, números largos y enlaces |
| `csv.ts` | Armar un CSV para descargar, protegido contra fórmulas |
| `import/` | Leer el CSV de una pasarela: reconocer el formato, convertir cada fila y separar repetidos y posibles repetidos |

### Los archivos de la capa de servidor

| Archivo | Qué resuelve |
|---|---|
| `dto.ts` | La frontera con la base: qué columnas pide cada lectura (el dinero, como texto) y cómo se pasan a los tipos del motor |
| `zod.ts` | La validación que comparten las acciones: montos, porcentajes, fechas, monedas, enlaces y textos libres |
| `errors.ts` | De un error (de la base, de Storage o del motor) a un mensaje en español para la persona |
| `tx-save.ts` | Manda las escrituras del motor a `pay_save_transactions`, en lotes de 500 |
| `action.ts` | `runAction`: la envoltura de cada acción del servidor (sesión, validación, error en español, revalidar) |
| `queries/config.ts`, `queries/session-config.ts` | Lee toda la configuración del usuario (`loadPayConfig`, `getPayConfig`) y siembra los feriados (`ensureHolidays`) |
| `queries/transactions.ts` | Los filtros, la lista por páginas, las filas para totales y el detalle de un cobro |
| `queries/…` | Una lectura por pantalla: resumen, empresas, pasarelas, cuentas, feriados, repartos, liquidaciones, importar y exportar |
| `ops/transactions.ts` | Registrar, editar, reembolsar, disputar, depositar, recalcular, fechas estimadas, papelera y borrado definitivo |
| `ops/receipts.ts` | Registrar y quitar un comprobante, y firmar su URL |
| `ops/…` | Las escrituras de cada parte: empresas, pasarelas, cuentas, feriados, repartos, liquidaciones e importar |
| `actions/…` | Las acciones del servidor que llaman las pantallas, cada una con su esquema de validación. Delgadas: sesión, validación y la `op` que toca |

## Las reglas del dinero

1. **El dinero nunca pasa por `number`.** El tipo numérico de JavaScript guarda fracciones en binario y pierde
   centavos: `0.1 + 0.2` da `0.30000000000000004`. En un libro de cuentas un centavo de más o de menos es un error.
2. **El dinero viaja como texto.** Un monto es una cadena con punto y exactamente dos decimales: `"90.30"`,
   `"-3.20"`, `"0.00"`. Un porcentaje es una cadena sin ceros de relleno: `"2.9"`, `"33.3333"`, `"50"`. En Postgres
   los montos son `numeric(14,2)` y los porcentajes `numeric(7,4)`. La API de Supabase devuelve `numeric` como número
   JSON, así que el dinero se lee pidiéndolo como texto (`gross_amount::text`) y se escribe como cadena.
3. **Toda la aritmética se hace con decimal.js**, con una instancia propia: 40 dígitos de precisión y redondeo
   **mitad hacia arriba** (0,025 pasa a 0,03). Es la misma regla para todas las pasarelas. Si una redondea de otro
   modo, su comisión real puede diferir en un centavo de la calculada.
4. **Cada línea se redondea a centavos antes de sumar.** Así el total de comisiones es siempre la suma de las líneas
   que se ven, al centavo. Si se sumara primero y se redondeara después, el total podría diferir en un centavo de
   lo que muestra el desglose.
5. **Nunca se suman monedas distintas.** Todo total sale por moneda: en el motor (`sumByCurrency`, `summarize`), en
   las vistas de la base (agrupan por `currency`) y en los saldos de los beneficiarios. No hay tipos de cambio.
6. **Las cuotas fijas van en la moneda del cobro.** Un «+ 0,30» es 0,30 de la moneda en que se cobró.
7. **No existe el «-0,00».** Un monto se redondea antes de escribirse; un cero sale sin signo.

Para mostrar, `formatMoney` escribe miles con punto y decimales con coma: `$1.234,56`, `-$3,20`, `1.234,56 MXN` (las
monedas sin símbolo llevan su código detrás). No usa `Intl`, para que servidor y navegador den exactamente lo mismo.

Para leer lo que escribe una persona, `parseMoney` acepta `1,234.56`, `1.234,56` y `100,5`. Si hay coma y punto, el
último es el decimal. Lo ambiguo no se adivina: `0,500` se rechaza, porque adivinar podría multiplicar el monto por
mil.

## Cómo se calcula un cobro

El cálculo recibe tres cosas: las **reglas** (tarifa de la pasarela, opciones encendidas, plataforma y esquema), el
**estado** (lo cobrado, lo reembolsado, la disputa, si falló y quién pagó la comisión) y la moneda. Devuelve el
**desglose**.

Los nombres que se usan en todo el documento:

- **Cobrado**: el monto original (el bruto original). Tiene que ser mayor que cero.
- **Reembolsado**: el total devuelto al comprador. Va de cero a lo cobrado.
- **Bruto vigente**: cobrado menos reembolsado. Es sobre lo que se calcula casi todo. Cuando una opción o un
  esquema dicen «sobre el bruto», es sobre el bruto vigente. Sin reembolso, bruto vigente y cobrado son lo mismo.
- **Comisiones**: todo lo que se descuenta: pasarela, opciones, plataforma, y los costos de reembolso y de disputa.
- **Neto**: bruto vigente menos comisiones.

«Redondear» es siempre a centavos, mitad hacia arriba.

### Paso a paso

1. **Cobro fallido.** No hay líneas de comisión. Bruto vigente, comisiones y neto valen 0,00, y a cada beneficiario
   le toca 0,00. Ahí termina.
2. **Comisión original de la pasarela.** Cobrado × porcentaje + cuota fija, redondeado. Si la pasarela informó la
   comisión real (ver [La comisión informada](#la-comisión-informada)), se usa esa en lugar de la calculada.
3. **Línea «pasarela».** Es lo que la pasarela cobra por el bruto vigente:
   - sin reembolso: la comisión original;
   - con reembolso parcial: bruto vigente × porcentaje + cuota fija, redondeado;
   - con reembolso total (bruto vigente 0,00): 0,00;
   - con comisión informada y reembolso parcial: la parte proporcional, comisión original × bruto vigente ÷ cobrado,
     redondeada.
4. **Línea «costo del reembolso».** Solo aparece si hay reembolso y la pasarela **no** devuelve la comisión. Vale la
   comisión original menos la línea «pasarela»: lo que la pasarela se queda de la parte reembolsada. Así, entre las
   dos líneas, la pasarela retiene siempre la comisión original. Si la pasarela sí devuelve la comisión, esta línea
   no existe.
5. **Cada opción encendida.** Su base es el bruto vigente o, si la opción es «después de la comisión», el bruto
   vigente menos la línea «pasarela» y menos el costo del reembolso (nunca menos de cero). El monto es base ×
   porcentaje + cuota fija, redondeado. Con bruto vigente 0,00 la opción vale 0,00, cuota fija incluida. Las
   opciones no se encadenan: cada una se calcula sobre su base, no sobre lo que dejó la anterior.
6. **Plataforma o canal.** Bruto vigente × porcentaje + cuota fija, redondeado. Con bruto vigente 0,00 vale 0,00.
   Si el cobro no tiene canal, esta línea no existe.
7. **Costo de disputa.** El costo fijo de disputa de la pasarela, mientras la disputa esté abierta o si se perdió.
   Si se ganó, nada. Perder una disputa implica además el reembolso total.
8. **Comisiones** = suma de todas las líneas. **Neto** = bruto vigente − comisiones. El neto puede ser negativo.
9. **Reparto.** La base es el neto o el bruto vigente, según diga el esquema. Si la comisión la pagó el comprador,
   siempre el neto ([E7](#e7--la-comisión-la-pagó-el-comprador)). Si la pagamos nosotros, el esquema va sobre el neto
   y una parte no paga comisión, esa parte sale del bruto vigente y las demás se reparten lo que queda del neto; la
   base sigue siendo el neto ([E9](#e9--una-parte-que-no-paga-comisión)). Sin esquema no hay reparto.

Las líneas quedan siempre en este orden: pasarela, costo del reembolso, opciones, plataforma, disputa.

### El reparto por mayor resto

El reparto tiene que sumar **exactamente** la base, al centavo. Redondear cada parte por separado no lo garantiza,
así que se hace de otro modo:

1. Si las líneas del esquema suman menos de 100 %, se añade al final la línea «Resto» con lo que falta.
2. Se pasa la base a centavos enteros.
3. A cada línea le toca centavos × su porcentaje. Se **trunca** al centavo (no se redondea) y se guarda el resto.
4. Los centavos que sobran se dan uno a uno a las líneas de mayor resto. En empate gana la que está primero.
5. Si la base es negativa, se reparte su valor absoluto y se cambia el signo a todas las partes.

Un esquema que no cubre exactamente el 100 % (se pasa, o le falta y no tiene «Resto») no se calcula: el motor lo
rechaza, y la base tampoco deja guardarlo.

Si una parte no paga comisión, el mayor resto se usa dos veces: sobre el bruto, para esa parte, y sobre lo que queda
del neto, para las demás ([E9](#e9--una-parte-que-no-paga-comisión)).

### Límites del modelo

- Una opción tiene porcentaje y cuota fija, pero **no tiene mínimo**. Si una pasarela cobra «1,5 %, mínimo 0,50», el
  mínimo no se aplica.
- El costo de disputa es **uno solo** y desaparece si la disputa se gana.

Los dos están en la tabla de [decisiones por confirmar](#decisiones-tomadas-y-por-confirmar), filas (n) y (o).

### E1 · Cobro normal

Entrada: 100,00 por Stripe (2,9 % + 0,30), opción «Pago rápido» (1,5 % sobre el bruto), plataforma 5 %, esquema
50 / 30 / 20 sobre el neto.

| Línea | Base | Cuenta | Monto |
|---|---|---|---|
| Pasarela | 100,00 | 100,00 × 2,9 % = 2,90; más 0,30 | **3,20** |
| Pago rápido | 100,00 | 100,00 × 1,5 % | **1,50** |
| Plataforma | 100,00 | 100,00 × 5 % | **5,00** |
| Comisiones | | 3,20 + 1,50 + 5,00 | **9,70** |
| Neto | | 100,00 − 9,70 | **90,30** |

Reparto de 90,30, que son 9030 centavos:

| Beneficiario | Cuenta | Centavos | Monto |
|---|---|---|---|
| Grupo A (50 %) | 9030 × 50 % | 4515 | **45,15** |
| Grupo B (30 %) | 9030 × 30 % | 2709 | **27,09** |
| Grupo C (20 %) | 9030 × 20 % | 1806 | **18,06** |

Las tres cuentas dan centavos enteros: no sobra nada. 45,15 + 27,09 + 18,06 = 90,30.

### E2 · Tres partes casi iguales

Entrada: 33,33 por Stripe (2,9 % + 0,30), sin opciones ni plataforma, esquema 33,3333 / 33,3333 / 33,3334 sobre el
neto.

- Pasarela: 33,33 × 2,9 % = 0,96657; más 0,30 = 1,26657; redondeado, **1,27**.
- Neto: 33,33 − 1,27 = **32,06**, que son 3206 centavos.

| Beneficiario | Cuenta exacta | Truncado | Resto |
|---|---|---|---|
| Grupo A (33,3333 %) | 3206 × 33,3333 % = 1068,665598 | 1068 | 0,665598 |
| Grupo B (33,3333 %) | 3206 × 33,3333 % = 1068,665598 | 1068 | 0,665598 |
| Grupo C (33,3334 %) | 3206 × 33,3334 % = 1068,668804 | 1068 | 0,668804 |

Los truncados suman 3204. Sobran 2 centavos.

- El primero va al mayor resto: Grupo C (0,668804).
- El segundo está entre A y B, que empatan (0,665598). Gana el que está primero: Grupo A.

Resultado: **10,69 · 10,68 · 10,69**, que suma 32,06.

Por qué no otra combinación: si cada parte se redondeara por su cuenta, las tres darían 10,69 y sumarían 32,07, un
centavo que no existe. Y 10,68 · 10,69 · 10,69 le daría el centavo a B antes que a A, contra la regla del empate.

### E3 · Opción calculada después de la comisión

Entrada: 100,00 por Stripe (2,9 % + 0,30), «Pago rápido» de 1,5 % **sobre el bruto menos la comisión**, sin
plataforma.

- Pasarela: **3,20** (igual que en E1).
- Base de la opción: 100,00 − 3,20 = 96,80.
- Pago rápido: 96,80 × 1,5 % = 1,452; redondeado, **1,45**.
- Comisiones: 3,20 + 1,45 = 4,65. Neto: 100,00 − 4,65 = **95,35**.

El diseño no fija un reparto para este caso. Con el esquema 50 / 30 / 20 sirve de ejemplo del empate: 9535 centavos
dan 4767,5 · 2860,5 · 1907. Truncados suman 9534 y sobra 1 centavo. A y B empatan con resto 0,5; gana A. Queda
47,68 · 28,60 · 19,07, que suma 95,35.

### E4 · Reembolso total (la pasarela no devuelve la comisión)

Entrada: el cobro E1, con los 100,00 reembolsados.

| Línea | Cuenta | Monto |
|---|---|---|
| Bruto vigente | 100,00 − 100,00 | **0,00** |
| Comisión original | 100,00 × 2,9 % + 0,30 | 3,20 |
| Pasarela | bruto vigente 0,00 | 0,00 |
| Costo del reembolso | 3,20 − 0,00 | **3,20** |
| Pago rápido | bruto vigente 0,00 | 0,00 |
| Plataforma | bruto vigente 0,00 | 0,00 |
| Comisiones | | **3,20** |
| Neto | 0,00 − 3,20 | **−3,20** |

El costo es 3,20 y no 9,70 porque el pago rápido y la plataforma se recalculan sobre el bruto vigente, que es cero.
Solo la comisión base de la pasarela queda retenida.

Reparto de −3,20: se reparten 320 centavos y se cambia el signo.

| Beneficiario | Cuenta | Monto |
|---|---|---|
| Grupo A (50 %) | 320 × 50 % = 160 | **−1,60** |
| Grupo B (30 %) | 320 × 30 % = 96 | **−0,96** |
| Grupo C (20 %) | 320 × 20 % = 64 | **−0,64** |

**De dónde salen los saldos.** El saldo de un beneficiario es lo asignado menos lo liquidado. Supón que, antes del
reembolso, ya se le había pagado a cada uno su parte de E1. Al reembolsar, el reparto del cobro se **reemplaza**: lo
asignado deja de ser 45,15 y pasa a ser −1,60. Lo liquidado no cambia.

| Beneficiario | Asignado | Liquidado | Saldo |
|---|---|---|---|
| Grupo A | −1,60 | 45,15 | −1,60 − 45,15 = **−46,75** |
| Grupo B | −0,96 | 27,09 | −0,96 − 27,09 = **−28,05** |
| Grupo C | −0,64 | 18,06 | −0,64 − 18,06 = **−18,70** |

Un saldo negativo significa que el beneficiario recibió de más y debe devolver. El Grupo A debe 46,75: los 45,15 que
cobró y su parte de la pérdida, 1,60.

### E5 · Reembolso parcial

Entrada: el cobro E1, con 40,00 reembolsados.

| Línea | Base | Cuenta | Monto |
|---|---|---|---|
| Bruto vigente | | 100,00 − 40,00 | **60,00** |
| Comisión original | 100,00 | 100,00 × 2,9 % + 0,30 | 3,20 |
| Pasarela | 60,00 | 60,00 × 2,9 % = 1,74; más 0,30 | **2,04** |
| Costo del reembolso | | 3,20 − 2,04 | **1,16** |
| Pago rápido | 60,00 | 60,00 × 1,5 % | **0,90** |
| Plataforma | 60,00 | 60,00 × 5 % | **3,00** |
| Comisiones | | 2,04 + 1,16 + 0,90 + 3,00 | **7,10** |
| Neto | | 60,00 − 7,10 | **52,90** |

La pasarela sigue reteniendo 3,20 en total (2,04 + 1,16): no devolvió nada de su comisión.

Reparto de 52,90, que son 5290 centavos: 5290 × 50 % = 2645; × 30 % = 1587; × 20 % = 1058. No sobra nada.
Resultado: **26,45 · 15,87 · 10,58**.

Si la pasarela **sí** devolviera la comisión, no habría línea de costo del reembolso: comisiones 5,94, neto 54,06 y
reparto 27,03 · 16,22 · 10,81.

### E6 · Disputa abierta y luego ganada

Entrada: el cobro E1, con una disputa abierta. El costo de disputa de la pasarela es 15,00.

**Abierta.** A las tres líneas de E1 se suma la del costo de disputa.

- Comisiones: 3,20 + 1,50 + 5,00 + 15,00 = **24,70**.
- Neto: 100,00 − 24,70 = **75,30**, que son 7530 centavos.
- Reparto: 7530 × 50 % = 3765; × 30 % = 2259; × 20 % = 1506. Resultado: **37,65 · 22,59 · 15,06**.

**Ganada.** La línea de disputa desaparece. Vuelven las cifras de E1: comisiones 9,70, neto 90,30, reparto
45,15 · 27,09 · 18,06. El cobro conserva la marca de que tuvo una disputa ganada.

**Si se perdiera** (no es parte de E6, pero lo cubren las pruebas): reembolso total más el costo de disputa.
Comisiones 3,20 + 15,00 = 18,20; neto −18,20; reparto −9,10 · −5,46 · −3,64.

### E7 · La comisión la pagó el comprador

Entrada: Stripe 2,9 % + 0,30, sin opciones ni plataforma. Al comprador se le cobraron **1040,00** para cubrir la
comisión. El esquema es 50/30/20 «Sobre el bruto».

- Comisión: 1040 × 2,9 % + 0,30 = **30,46**. Es la tarifa real, no los 40 de recargo.
- Neto: 1040,00 − 30,46 = **1009,54**. Es lo que la pasarela deposita.
- Reparto: va sobre el **neto**, aunque el esquema diga «Sobre el bruto», porque lo que el comprador pagó de más no
  es venta del negocio. 1009,54 × 50 % = 504,77; × 30 % = 302,862; × 20 % = 201,908. Truncados suman 1009,53, y el
  centavo que falta va al de mayor resto (201,908). Resultado: **504,77 · 302,86 · 201,91**.
- Para el negocio:
  - lo facturado es 1009,54;
  - sus comisiones son 0;
  - los compradores pagaron 30,46.

**E7b**, el mismo cobro con «Nosotros»: misma comisión (30,46) y mismo neto (1009,54). El reparto va sobre el bruto:
**520,00 · 312,00 · 208,00**. Lo facturado es 1040,00, y las comisiones del negocio son 30,46.

**La regla**, en cada cobro:

- **Lo que pagaron los compradores** (`buyer_fees`): con «El comprador», las líneas que se cobran sobre lo que el
  comprador sigue pagando (pasarela, opciones y plataforma). Con «Nosotros», 0.
- **Comisiones del negocio**: todas las comisiones menos las de los compradores.
- **Lo facturado** (la venta del negocio): el bruto vigente menos lo de los compradores.

Siempre neto = facturado − comisiones del negocio. El % de las comisiones del Resumen y el costo efectivo de cada
pasarela se miden sobre lo facturado. Sin cobros del comprador, lo facturado es el bruto y todo da lo de siempre.

### E8 · Reembolsos y disputas de un cobro del comprador

El cobro E7 (1040,00 pagados por el comprador; la pasarela no devuelve la comisión al reembolsar y cobra 15,00 por
disputa). El costo del reembolso y el de la disputa los cobra la pasarela **al negocio**: nunca son del comprador.

| | Comisión de la pasarela | Costo del reembolso | Costo de disputa | Neto | Compradores | Negocio | Facturado | Reparto (sobre el neto) |
|---|---|---|---|---|---|---|---|---|
| **E8a** · reembolso total | 0,00 | 30,46 | — | −30,46 | 0,00 | 30,46 | 0,00 | −15,23 · −9,14 · −6,09 |
| **E8b** · reembolso parcial de 520 | 15,38 | 15,08 | — | 489,54 | 15,38 | 15,08 | 504,62 | 244,77 · 146,86 · 97,91 |
| **E8c** · disputa abierta o perdida, sin reembolso | 30,46 | — | 15,00 | 994,54 | 30,46 | 15,00 | 1009,54 | — |

- En **E8a** el comprador recuperó todo y los 30,46 que se quedó la pasarela los perdió el negocio. Lo facturado es 0,
  así que no hay %.
- En **E8b**, 520 × 2,9 % + 0,30 = 15,38 es lo que pagó el comprador sobre lo que sigue pagando. 30,46 − 15,38 = 15,08
  es el costo del reembolso, del negocio.
- **E8c** se calcula así dentro del motor. En la app, perder una disputa reembolsa todo: queda como E8a más los 15,00
  de la disputa (comprador 0, negocio 45,46, neto −45,46).

### E9 · Una parte que no paga comisión

Entrada: Stripe 2,9 % + 0,30, sin opciones ni plataforma (no devuelve la comisión al reembolsar). Se cobran
**1000,00** y la comisión la pagamos «Nosotros». El esquema es 50/30/20 «Sobre el neto», con el Grupo C marcado «No
paga comisión».

- Comisión: 1000 × 2,9 % + 0,30 = **29,30**. Neto: 1000,00 − 29,30 = **970,70**.
- Grupo C: su parte del bruto, como si no hubiera comisión. 1000,00 × 20 % = **200,00**.
- A y B se reparten lo que queda del neto, 970,70 − 200,00 = 770,70, en proporción 50:30. 770,70 × 50/80 =
  481,6875; × 30/80 = 289,0125. Truncados suman 770,69, y el centavo que falta va al de mayor resto (481,6875).
  Resultado: **481,69 · 289,01 · 200,00**, que suma 970,70.
- Sin la marca serían 485,35 · 291,21 · 194,14. Los 5,86 de comisión que C deja de pagar los cargan A (3,66) y B
  (2,20).

**E9b**, el mismo cobro reembolsado del todo. El bruto vigente queda en 0,00 y la pasarela se queda los 29,30 (costo
del reembolso). Neto: **−29,30**.

- Grupo C: su parte de un bruto de 0,00, **0,00**.
- A y B cargan toda la pérdida, en proporción 50:30. Como en E4, se reparten 2930 centavos (el valor absoluto) y se
  cambia el signo: 2930 × 50/80 = 1831,25 y × 30/80 = 1098,75. Truncados suman 2929, y el centavo que falta va al de
  mayor resto (1098,75). Resultado: **−18,31 · −10,99 · 0,00**.

**E9c**, el mismo esquema con las tres partes marcadas: nadie paga la comisión y se rechaza, con el mensaje «Alguien
tiene que pagar la comisión: deja al menos una parte sin marcar.» Pasa igual al guardar el esquema y al registrar o
editar el cobro.

**La regla**, en cada cobro:

- Solo cuenta si la comisión la pagamos nosotros y el reparto va sobre el neto. Con «El comprador» o «Sobre el
  bruto», la marca ni se aplica ni se rechaza.
- Quien no paga comisión recibe su parte del bruto vigente, con el reparto por mayor resto entre todas las partes,
  como en un esquema sobre el bruto.
- Las demás, «Resto» incluido, se reparten lo que queda del neto en proporción a sus porcentajes, también por mayor
  resto. Cargan entre ellas las comisiones y los costos de un reembolso o de una disputa.
- El reparto suma siempre exactamente el neto, y su base sigue siendo el neto.
- Si hay «Resto» y le toca algo, él paga la comisión aunque todas las líneas estén marcadas.

## Cuándo cae el dinero

La fecha estimada de depósito se calcula al registrar el cobro. Se puede corregir a mano.

### De dónde sale cada dato

- **Fecha de partida:** la fecha del cobro **en Nueva York** (`America/New_York`). Un cobro del viernes 13 a las
  22:30 de Nueva York ya es sábado 14 en UTC (`2026-11-14T03:30:00Z`), pero cuenta como viernes 13.
- **Cuántos días.** Se toma el primero que exista, en este orden:
  1. los de una opción encendida que cambie los días (si hay varias, la menor);
  2. los de la cuenta de esa pasarela en esa empresa;
  3. los de la pasarela.
- **Hábiles o corridos:** lo dice la pasarela, vengan los días de donde vengan.
- **Cuenta destino:** la de la cuenta de esa pasarela en esa empresa, salvo que al registrar se elija otra.

### Cómo se cuentan

- **0 días:** el mismo día del cobro, aunque sea sábado, domingo o feriado. Es el caso del pago rápido.
- **Corridos:** suma de calendario. Viernes 13 más 2 días corridos es domingo 15. No se corre al siguiente día hábil.
- **Hábiles:** se avanza día por día desde el día siguiente al cobro, y solo cuentan los que no son sábado, domingo
  ni feriado. El día del cobro no cuenta.
- Las fechas son de calendario, sin horas. El cambio de horario (8 de marzo y 1 de noviembre de 2026) no corre el día.

### Feriados

Cada usuario tiene su lista de feriados (`pay_holidays`) y la base le deja editarla. El motor sabe calcular los
once feriados **bancarios** de Estados Unidos de cualquier año entre 1900 y 2200 (`usBankHolidays`). Fuera de ese
rango, o con un año que no sea entero, la función falla con un error (`RangeError`).

**De dónde salen los feriados de un usuario.** La migración solo crea la tabla, vacía. La siembra la hace
`ensureHolidays`, de la capa de servidor: si el usuario no tiene **ningún** feriado, carga los de 2026 y 2027. Si
ya tiene alguno, no hace nada: no repone los que el usuario quitó ni agrega años nuevos. La llaman la pantalla de
Feriados y la lectura de la configuración de cada petición (`getPayConfig`). Otro año se carga en Feriados, con
«Cargar feriados bancarios de EE. UU. de…», y el Resumen avisa («Faltan los feriados de…») cuando falta el año en
curso o el siguiente.

**Si cambian los feriados o los días.** Al agregar o quitar un feriado, o al cambiar los días al depósito de una
pasarela o de su cuenta en una empresa, se vuelven a calcular las fechas estimadas **automáticas** de lo que está
[por caer](#por-caer-y-depositado). Las puestas a mano no se tocan, ni las comisiones, ni los montos. El aviso dice
cuántas fechas cambiaron, y el historial de cada cobro dice que las cambió la app.

**Mientras un año no esté cargado, el cálculo solo salta sábados y domingos.** Con la tabla vacía, F2 daría viernes
27/11 en vez de lunes 30/11, y F3 daría lunes 28/12 en vez de martes 29/12.

Es el calendario bancario, el que mueve los depósitos, no el de las oficinas federales. La diferencia está en los
feriados de fecha fija:

- Si caen en **domingo**, los bancos cierran el lunes siguiente. En la lista aparece el lunes, con «(observado)».
- Si caen en **sábado**, se quedan en su fecha y el viernes anterior los bancos **abren**. El 4 de julio de 2026 es
  sábado: el viernes 3 es día hábil.

Feriados de 2026: 1 ene, 19 ene, 16 feb, 25 may, 19 jun, 4 jul (sábado), 7 sep, 12 oct, 11 nov, 26 nov, 25 dic.
Feriados de 2027: 1 ene, 18 ene, 15 feb, 31 may, 19 jun (sábado), 5 jul (lunes, observado), 6 sep, 11 oct, 11 nov,
25 nov, 25 dic (sábado).

### F1 · Viernes 13/11/2026 + 2 días hábiles

| Día | ¿Cuenta? |
|---|---|
| vie 13 nov | día del cobro, no cuenta |
| sáb 14 nov | no: sábado |
| dom 15 nov | no: domingo |
| lun 16 nov | sí: 1 |
| **mar 17 nov** | sí: 2 |

Cae el **martes 17/11/2026**.

### F2 · Miércoles 25/11/2026 + 2 días hábiles

| Día | ¿Cuenta? |
|---|---|
| mié 25 nov | día del cobro, no cuenta |
| jue 26 nov | no: Acción de Gracias |
| vie 27 nov | sí: 1 |
| sáb 28 nov | no: sábado |
| dom 29 nov | no: domingo |
| **lun 30 nov** | sí: 2 |

Cae el **lunes 30/11/2026**.

### F3 · Jueves 24/12/2026 + 2 días hábiles

| Día | ¿Cuenta? |
|---|---|
| jue 24 dic | día del cobro, no cuenta |
| vie 25 dic | no: Navidad |
| sáb 26 dic | no: sábado |
| dom 27 dic | no: domingo |
| lun 28 dic | sí: 1 |
| **mar 29 dic** | sí: 2 |

Cae el **martes 29/12/2026**.

### Atrasado y tiempo real

**Atrasado** es un cobro que está [por caer](#por-caer-y-depositado) y cuya fecha estimada es **anterior** a hoy.
Si la fecha estimada es hoy, todavía no está atrasado. Sin fecha estimada, tampoco. Un cobro fallido, depositado,
con la disputa abierta o reembolsado por completo nunca lo está, porque no está por caer.

**Tiempo real** es lo que tardó de verdad: los días de calendario entre la fecha del cobro y la fecha del depósito
real. Solo cuentan los cobros depositados. Se da el promedio y la mediana, por pasarela y por cuenta destino. Sirve
para comparar la estimación con la realidad y ajustar los días de la pasarela.

### Límites de la estimación

La cuenta es simple a propósito, y hay pasarelas que cuentan distinto:

- Hay pasarelas que toman el día en UTC, no en Nueva York. Un cobro de la noche puede contar para ellas como del
  día siguiente.
- Hay pasarelas que, si el cobro cae en sábado, domingo o feriado, empiezan a contar desde el siguiente día hábil.
  Aquí se cuenta desde el día del cobro: un cobro del sábado 14 con 2 días hábiles da martes 17, y esa pasarela
  depositaría el miércoles 18.
- Hay pasarelas que no depositan solas: el plazo corre desde que se pide el retiro, no desde el cobro.

En esos casos la estimación puede quedar un día corta. La fecha estimada puesta a mano se respeta, y el tiempo real
muestra la diferencia. Es la fila (p) de las [decisiones por confirmar](#decisiones-tomadas-y-por-confirmar).

## Lo que se congela y lo que lo cambia

### El desglose

Cada cobro guarda su cálculo completo en la columna `breakdown` (jsonb, versión 1). Dentro van también **las reglas
que se usaron**: la tarifa, las opciones, la plataforma y el esquema con sus líneas. Este es el de E1, tal como se
guarda:

```json
{
  "v": 1,
  "currency": "USD",
  "rules": {
    "gateway": { "id": "gw-stripe", "name": "Stripe", "feeVersionId": "fv-1", "pct": "2.9", "fixed": "0.30",
                 "refundsReturnFee": false, "disputeFee": "15.00" },
    "extras": [ { "id": "ex-rapido", "name": "Pago rápido", "pct": "1.5", "fixed": "0.00", "base": "bruto",
                  "payoutDaysOverride": 0 } ],
    "platform": { "channelId": "ch-web", "name": "Tienda en línea", "pct": "5", "fixed": "0.00" },
    "scheme": { "schemeId": "sch-1", "versionId": "sv-1", "name": "Socios", "base": "neto",
                "lines": [ { "beneficiaryId": "ben-a", "name": "Grupo A", "pct": "50", "feeExempt": false },
                           { "beneficiaryId": "ben-b", "name": "Grupo B", "pct": "30", "feeExempt": false },
                           { "beneficiaryId": "ben-c", "name": "Grupo C", "pct": "20", "feeExempt": false } ],
                "remainder": null }
  },
  "state": { "grossOriginal": "100.00", "refunded": "0.00", "dispute": null, "failed": false,
             "feesPaidBy": "nosotros" },
  "gross": "100.00",
  "lines": [
    { "kind": "pasarela", "refId": "gw-stripe", "name": "Stripe", "baseKind": "bruto", "baseAmount": "100.00",
      "pct": "2.9", "fixed": "0.30", "amount": "3.20" },
    { "kind": "opcion", "refId": "ex-rapido", "name": "Pago rápido", "baseKind": "bruto", "baseAmount": "100.00",
      "pct": "1.5", "fixed": "0.00", "amount": "1.50" },
    { "kind": "plataforma", "refId": "ch-web", "name": "Tienda en línea", "baseKind": "bruto",
      "baseAmount": "100.00", "pct": "5", "fixed": "0.00", "amount": "5.00" }
  ],
  "feesTotal": "9.70",
  "net": "90.30",
  "alloc": {
    "baseKind": "neto",
    "baseAmount": "90.30",
    "lines": [
      { "beneficiaryId": "ben-a", "name": "Grupo A", "pct": "50", "amount": "45.15", "isRemainder": false,
        "feeExempt": false },
      { "beneficiaryId": "ben-b", "name": "Grupo B", "pct": "30", "amount": "27.09", "isRemainder": false,
        "feeExempt": false },
      { "beneficiaryId": "ben-c", "name": "Grupo C", "pct": "20", "amount": "18.06", "isRemainder": false,
        "feeExempt": false }
    ]
  }
}
```

Cómo leerlo:

- `rules` es lo que se congela. `state` es lo que puede cambiar: cobrado, reembolsado, disputa, fallido y quién pagó
  la comisión.
- Cada línea de `lines` dice de qué tipo es (`pasarela`, `reembolso`, `opcion`, `plataforma`, `disputa`), sobre qué
  base se calculó, con qué porcentaje y cuota fija, y cuánto dio.
- `feeExempt` en `rules.scheme.lines` es la marca «No paga comisión» congelada en ese cobro. Puede ser otra que la
  del esquema, si se cambió al registrar o al editar. En `alloc.lines`, `feeExempt` dice si la marca se aplicó (solo
  con «Nosotros» y sobre el neto: ver [E9](#e9--una-parte-que-no-paga-comisión)).
- Todo el dinero va como texto. Al leer un desglose guardado, `parseBreakdown` lo valida y rechaza otra versión o
  montos escritos como número. A uno guardado antes de existir `feeExempt` o `feesPaidBy` le pone `false` y
  `nosotros`.
- Las columnas del cobro (`gross_amount`, `fees_total`, `net_amount`, `alloc_base_amount`) y las filas de
  `pay_allocations` repiten estas cifras para poder filtrar y sumar. Salen siempre del desglose.

**Por qué las reglas viajan dentro.** Un reembolso o una disputa pueden llegar meses después. Se calculan con la
tarifa que regía al cobrar, sin consultar nada: está en el propio cobro. Cambiar una tarifa o un esquema no
reescribe ningún cobro viejo.

### Tarifas y esquemas con «vigente desde»

La tarifa de una pasarela y el reparto de un esquema no se editan: se les **agrega una versión** con su fecha
«vigente desde».

Para un cobro se elige la versión más reciente cuya fecha sea igual o anterior a la **fecha del cobro**. Así, un
cobro viejo que se registra tarde usa la tarifa y el reparto que regían ese día. **Si ninguna versión rige todavía
en la fecha del cobro, se usa la más antigua** (el cálculo no falla).

La fecha de la primera versión:

- **Tarifa.** `pay_create_gateway` crea siempre la primera tarifa de una pasarela «desde el inicio»
  (`2000-01-01`).
- **Esquema.** `2000-01-01` es solo el valor por defecto de `pay_save_scheme`. Si se le manda otra fecha, la
  primera versión empieza ese día. Un cobro anterior a esa fecha se reparte igual con esa primera versión.

Ejemplo: Stripe tiene 2,9 % + 0,30 desde el inicio y 3,5 % + 0,30 vigente desde el sábado 14/11/2026. Un cobro de
100,00 del viernes 13 paga 3,20 a la pasarela. Uno del sábado 14 paga 3,80 (comisiones 10,30, neto 89,70).

### Qué recalcula con las reglas congeladas

Estas operaciones cambian el **estado** y vuelven a calcular con las reglas que ya tiene el cobro. La configuración
de hoy no interviene.

| Operación | Qué cambia |
|---|---|
| Reembolso (sumar uno, o corregir el total) | lo reembolsado |
| Disputa: abrir, ganar, perder, anular | el estado de la disputa; al perder, además, el reembolso pasa a ser total |
| Corregir el monto (o la moneda) | lo cobrado |
| Marcar como fallido, o reabrir | si falló |

### Qué vuelve a resolver reglas

**Editar** un cobro solo vuelve a leer de la configuración la pieza que cambió. Lo demás conserva lo congelado,
aunque la configuración ya sea otra.

| Si cambia… | Se vuelve a resolver… | Y además se mueve… |
|---|---|---|
| la pasarela | la pasarela entera, con la tarifa de la fecha del cobro, y sus opciones (hay que decir cuáles lleva) | la fecha estimada y la cuenta destino |
| la empresa | la plataforma: el canal tiene que ser de la empresa nueva | la fecha estimada y la cuenta destino |
| las opciones | las opciones | la fecha estimada |
| la fecha (a otro día) | solo la tarifa de la pasarela y la versión del esquema que rigen ese día | la fecha estimada |
| el canal | la plataforma | nada |
| el esquema | el esquema, con la versión de la fecha del cobro | nada |
| quién no paga comisión | solo las marcas «No paga comisión» del esquema congelado (las de la edición, no las de la configuración), y con ellas el reparto | nada |

Cambiar la hora dentro del mismo día, la referencia, la nota o solo la cuenta destino no recalcula nada.

**Quién no paga comisión al editar.** Cambiar la fecha a otra versión del esquema conserva las marcas de ese cobro.
Solo otro esquema trae las suyas. El historial lo dice: «Editado: quién no paga comisión».

**La fecha estimada al editar.** Se vuelve a calcular cuando cambia la fecha, la empresa, la pasarela o las
opciones. Nunca si está puesta a mano.

**La cuenta destino al editar.** Es la que diga la edición. Si la edición no dice ninguna y cambia la empresa o la
pasarela, pasa a ser la de la cuenta de esa pasarela en esa empresa (o ninguna, si no la hay): la de antes era de
otra. Si la edición manda una cuenta, se respeta.

Ejemplo: un cobro del viernes 13/11 sin pago rápido tiene fecha estimada martes 17/11 (2 días hábiles) y va a la
cuenta «Principal». Se pasa a otra empresa, cuya cuenta de Stripe tiene 5 días hábiles y otra cuenta destino. La
edición escribe la empresa, la cuenta destino nueva y la fecha estimada viernes 20/11.

**Recalcular** vuelve a resolver **todas** las reglas con la configuración de ahora. Tiene dos modos:

- **Con la tarifa de hoy** (`hoy`): usa las versiones de tarifa y de esquema que rigen hoy. Es el que viene
  marcado en la pantalla; el motor y la capa de servidor exigen que se les diga cuál.
- **Con la tarifa de la fecha del cobro** (`fecha_del_cobro`): usa las versiones que corresponden a la fecha del
  cobro según la configuración actual. Sirve cuando se corrigió una tarifa mal cargada.

En los dos modos se conserva el estado (un reembolso sigue reembolsado) y quién no paga comisión en ese cobro, se
descarta la comisión informada y se omiten las opciones que ya no existen. La fecha estimada se vuelve a calcular,
salvo que esté puesta a mano. Antes de guardar se puede ver el antes y el después, fila por fila. En el ejemplo de
las tarifas, recalcular con la tarifa de hoy el cobro del viernes 13 lo pasa de 3,20 a 3,80 de pasarela, de 9,70 a
10,30 de comisiones, de 90,30 a 89,70 de neto, y el reparto a 44,85 · 26,91 · 17,94.

Marcar en tránsito, depositar, revertir un depósito, fijar la fecha estimada, mandar a la papelera y restaurar no
tocan ningún número.

Cada cambio deja un evento en el historial del cobro con una foto de antes y otra de después: bruto vigente,
comisiones, neto, reembolsado, estado, disputa, pasarela, versión de esquema, fecha estimada y fecha de depósito.

### La comisión informada

Si el CSV de la pasarela trae la comisión real de cada cobro, al importar se puede marcar «Usar la comisión del
archivo» para usarla en lugar de la calculada. Queda en las reglas del cobro como `feeOverride`, y la línea
«pasarela» se marca como «informado».

- Con un reembolso parcial se reparte en proporción. Con 4,70 informados sobre 100,00 y un reembolso de 40,00: la
  pasarela es 4,70 × 60 ÷ 100 = 2,82 y el costo del reembolso es 4,70 − 2,82 = 1,88. El desglose dice entonces de
  cuánto era la informada.
- Se conserva al corregir la fecha.
- Se descarta al corregir el monto o la moneda (era la de otro monto), al cambiar de pasarela y al recalcular: ahí
  vuelve a mandar la tarifa.
- En la exportación de pagos de Stripe, si la comisión viene en otra moneda que el cobro, no se trae, y la nota
  del cobro lo dice.

## Estados de un cobro

Un cobro lleva **tres** cosas separadas, porque pueden darse a la vez: un reembolso parcial no borra que el resto
está por caer.

1. **El ciclo del dinero** (`status`): `registrado` → `en_transito` → `depositado`, o `fallido`.
2. **El reembolso** (`refunded_amount`): de cero a lo cobrado.
3. **La disputa** (`dispute_state`): ninguna, `abierta`, `ganada` o `perdida`.

Además, un cobro puede estar en la **Papelera** (`deleted_at`).

### El estado que se muestra

En pantalla se ve y se filtra un solo estado, de seis. El motor lo decide con esta prioridad:

1. **Fallido**, si el ciclo es `fallido`.
2. **En disputa**, si hay una disputa abierta.
3. **Reembolsado**, si el reembolso es total.
4. Si no, el del ciclo: **Depositado**, **En tránsito** o **Registrado**.

Un reembolso parcial no cambia el estado: se ve como una etiqueta aparte. Una disputa ganada o perdida ya no se ve
como «en disputa».

### Por caer y depositado

- **Por caer** suma el neto de los cobros que **se ven** como «Registrado» o «En tránsito» (el
  [estado que se muestra](#el-estado-que-se-muestra)). Un cobro recién registrado también está por caer. Uno con
  la disputa abierta no lo está: la pasarela retiene ese dinero. Uno reembolsado por completo tampoco: ya se
  devolvió. Uno con reembolso parcial sí, con su neto ya rebajado. Así, lo que está por caer siempre tiene bruto
  vigente mayor que cero.
- **Depositado** suma el neto de los cobros cuyo ciclo es `depositado`, tengan o no reembolso o disputa.
- **Los fallidos** no cuentan en ningún total: el motor los deja fuera.

Es **una sola definición** (`isPending`, en `status.ts`) y la usan todos: la tarjeta «Por caer», el filtro «por
caer» de la lista de cobros, los próximos depósitos, lo [atrasado](#atrasado-y-tiempo-real) y la vista
`pay_bank_account_totals`. La lista y la vista la escriben en columnas: ciclo `registrado` o `en_transito`, disputa
que no esté abierta y bruto vigente mayor que cero.

Con los ejemplos, sin depositar: E5 (reembolso parcial) suma 52,90 en «Por caer». E4 (reembolsado del todo, neto
−3,20) no suma nada. E6 no suma mientras la disputa está abierta, y vuelve a sumar 90,30 cuando se gana.

Por eso el neto total del período ya no es siempre «por caer» más «depositado»: los cobros sin depositar con la
disputa abierta o reembolsados del todo quedan fuera de los dos. Es la fila (q) de las
[decisiones](#decisiones-tomadas-y-por-confirmar).

Los **próximos depósitos** agrupan por fecha estimada, cuenta destino y moneda los cobros por caer que tienen fecha
estimada: todo lo atrasado, más lo que cae en una ventana de 14 días **contando hoy** (de hoy a hoy + 13).

**La papelera.** El motor no sabe si un cobro está en la papelera: la fila mínima que recibe para sumar no trae
ese dato. La dejan fuera quienes le pasan las filas:

- las cuatro [vistas de totales](#vistas-de-totales) de la base;
- la lista de cobros y las filas para totales (`listTx` y `leanTx`), que pasan por `applyTxFilters`: por defecto
  solo trae cobros fuera de la papelera (y, cuando se pide la papelera, solo los de ella);
- tres lecturas más, cada una con su propio filtro de `deleted_at`: el último cobro (`lastTx`, para «Repetir el
  último»), los repartos de un beneficiario y la búsqueda de posibles repetidos al importar.

El detalle de un cobro y las lecturas por id sí traen los de la papelera: así se abren y se restauran.

Quien escriba una lectura nueva tiene que filtrar igual. Si al motor le llega una fila de la papelera, la cuenta.

### Lo que el motor permite y lo que rechaza

| Cambio | Permitido desde | Rechazado |
|---|---|---|
| Registrar | estado inicial `registrado`, `en_transito` o `depositado` (este exige la fecha del depósito) | si la fecha del cobro no es la de su instante en Nueva York; un depósito anterior al cobro |
| Pasar a en tránsito | `registrado` | desde cualquier otro |
| Depositar | `registrado` o `en_transito`. Solo en el detalle de un cobro ya depositado, cambia la fecha | fallido; un depósito anterior al cobro (o futuro: lo frena la validación del servidor). En lote, lo que no está [por caer](#por-caer-y-depositado) |
| Revertir el depósito | `depositado` (vuelve a `en_transito`) | si no está depositado |
| Marcar como fallido | `registrado` o `en_transito`, sin reembolso y sin disputa | depositado, ya fallido, con reembolso, o con cualquier disputa (aunque esté ganada) |
| Reabrir | `fallido` (vuelve a `registrado` con sus números de antes) | si no está fallido |
| Reembolsar | cualquiera menos fallido; también depositado, que sigue depositado | monto que no sea mayor que cero, o que haga pasar el total de lo cobrado |
| Corregir el total reembolsado | cualquiera menos fallido, de cero a lo cobrado | con la disputa perdida solo vale el total |
| Abrir una disputa | sin disputa, o con una ganada | con una abierta o perdida; fallido |
| Ganar, perder o anular la disputa | disputa abierta | si no hay una abierta |
| Editar | cualquiera, también fallido (sigue fallido y en cero) | si no cambia nada; si el monto baja de lo ya reembolsado; si la fecha del cobro queda después de su depósito |
| Recalcular | cualquiera menos fallido | fallido; si la pasarela ya no existe |
| Mandar a la papelera | fuera de la papelera | si ya está |
| Restaurar | en la papelera | si no está |

Un cobro en la papelera solo admite restaurarse. Cada rechazo tiene su mensaje en español (por ejemplo: «El cobro ya
está depositado: revierte el depósito primero.»). Las operaciones sobre varios cobros a la vez (depositar, pasar a
en tránsito, papelera, recalcular) se saltan los que no admiten el cambio y dicen cuántos escribieron; al depositar,
también cuántos se saltaron y por qué.

En la lista de cobros, el menú **«Cambiar estado»** de cada cobro ofrece solo lo que esta tabla permite: pasar a en
tránsito, depositar, revertir el depósito, marcar como fallido y reabrir. Lo decide `statusChanges`
(`statusChanges.ts`), que filtra la misma `allowedActions` del detalle (`allowed.ts`), y llama a las mismas acciones
del servidor que el detalle. Un cobro ya depositado no ofrece «Marcar depositado…»: cambiar la fecha de su depósito
queda en el detalle. En la papelera el cobro no tiene menú.

Dos reglas de la disputa perdida: implica el reembolso total, y así se queda. Si después se corrige el monto del
cobro, el reembolso lo sigue.

La base repite lo esencial con restricciones: solo existen esos cuatro valores de `status`; hay fecha real de
depósito si y solo si el cobro está depositado; un fallido lleva bruto vigente, comisiones y base del reparto en
cero.

## Repartos y liquidaciones

### Esquemas

Un **esquema** dice cómo se reparte un cobro. Tiene un nombre y una o más **versiones**. Cada versión tiene:

- **Líneas:** un beneficiario y su porcentaje (mayor que 0, hasta 100, con hasta 4 decimales). Un beneficiario
  aparece una sola vez. Sobre el neto, cada línea puede llevar la marca **«No paga comisión»**: su parte sale del
  bruto y la comisión la pagan las demás ([E9](#e9--una-parte-que-no-paga-comisión)). Sobre el bruto, el editor no
  la ofrece ni la guarda.
- **«Resto»** (opcional): el beneficiario que recibe lo que falte para llegar a 100 %. No puede ser además una
  línea. Si las líneas ya suman 100 %, el «Resto» no recibe nada.
- **Base:** `neto` o `bruto`. Sobre el neto se reparte lo que queda después de las comisiones. Sobre el bruto se
  reparte el bruto vigente: con E1 serían 50,00 · 30,00 · 20,00, aunque el neto sea 90,30.
  En un cobro cuya comisión pagó el comprador, el reparto va siempre sobre el neto
  ([E7](#e7--la-comisión-la-pagó-el-comprador)).
- **Vigente desde** y un número de versión.

Reglas que se cumplen dos veces, en el motor (para avisar antes, en español) y en la base (para que nadie las
rodee): las líneas no pasan de 100 %; si suman menos, tiene que haber «Resto»; el «Resto» no es una línea.

Una regla más la hacen cumplir el motor y el servidor, pero no la base: alguien tiene que quedar pagando la
comisión. Con todas las líneas marcadas «No paga comisión», el esquema no se guarda, salvo que haya «Resto» y le
toque algo.

Cambiar un esquema es agregarle una versión. Si ya hay una versión con la misma fecha «vigente desde» y ningún cobro
la usa, se reemplaza. Si algún cobro la usa, no se puede: hay que elegir otra fecha.

Cada empresa puede tener un esquema por defecto. Un cobro sin esquema no tiene reparto.

### El saldo de cada beneficiario

La vista `pay_beneficiary_balances` da, por beneficiario **y por moneda**:

- **Asignado:** la suma de lo que le tocó en cada cobro. No cuentan los cobros de la papelera ni los fallidos.
- **Liquidado:** la suma de sus liquidaciones.
- **Saldo:** asignado menos liquidado. Positivo: se le debe. Negativo: recibió de más y debe devolver.

La moneda de lo asignado es la del cobro. Los saldos nunca mezclan monedas: un beneficiario con cobros en dos
monedas tiene dos saldos.

### Liquidaciones

Una **liquidación** (`pay_settlements`) anota un pago ya hecho. Lleva beneficiario, fecha, **moneda**, monto, medio
de pago, nota y, si se quiere, un comprobante.

- Monto **positivo**: se le pagó al beneficiario.
- Monto **negativo**: el beneficiario devolvió dinero.
- El monto no puede ser cero.

Siguiendo E4: el Grupo A quedó con saldo −46,75. Cuando devuelve esos 46,75 se registra una liquidación de −46,75.
Lo liquidado pasa a 45,15 − 46,75 = −1,60, igual que lo asignado, y el saldo queda en 0,00.

## La base de datos

Todo está en migraciones aditivas (cinco, de `20261110120000` a `20261114120000`): solo crean o cambian objetos con
prefijo `pay_` y, la primera, además el esquema `private`, el bucket `comprobantes` y sus políticas. Si el proyecto
ya tiene un esquema `private` o un bucket `comprobantes`, la primera los reutiliza y les cambia permisos y políticas
(el paso 1 de [«Pasar a producción»](../README.md#pasar-a-producción) dice qué mirar antes).

Columnas comunes de las 17 tablas:

- Todas tienen `id` (uuid) y `user_id` (el dueño de la fila, que se borra en cascada con el usuario).
- Todas menos `pay_transaction_events` tienen `created_at`. El historial guarda su fecha en la columna `at`.
- Diez tienen `updated_at`, que mueve un disparador: `pay_bank_accounts`, `pay_beneficiaries`, `pay_schemes`,
  `pay_companies`, `pay_channels`, `pay_gateways`, `pay_gateway_extras`, `pay_company_gateways`, `pay_settlements`
  y `pay_transactions`.
- `pay_allocations`, `pay_transaction_receipts` y `pay_holidays` admiten actualizaciones y **no** tienen
  `updated_at`.

### Las 17 tablas

| Tabla | Qué guarda |
|---|---|
| `pay_companies` | Las empresas: nombre, web, moneda, esquema de reparto por defecto, notas y la ruta de su logo (el archivo está en Storage) |
| `pay_channels` | Los canales o páginas de venta de una empresa, con lo que cobra su plataforma (porcentaje y cuota fija) |
| `pay_gateways` | Las pasarelas: días al depósito (0–60), hábiles o corridos, si devuelve la comisión al reembolsar, costo de disputa |
| `pay_gateway_fee_versions` | Las tarifas de cada pasarela (porcentaje y cuota fija) con su «vigente desde» |
| `pay_gateway_extras` | Las opciones de una pasarela: porcentaje, cuota fija, base, si viene encendida y los días que impone |
| `pay_bank_accounts` | Las cuentas destino: alias, banco, últimos 4 dígitos, moneda |
| `pay_company_gateways` | La cuenta de una pasarela en una empresa: enlaces al panel y al pago, cuenta destino, días propios, opciones por defecto |
| `pay_beneficiaries` | Quienes reciben repartos: persona, empresa o cartera |
| `pay_schemes` | Los esquemas de reparto (nombre) |
| `pay_scheme_versions` | Las versiones de cada esquema: base, «Resto» y «vigente desde» |
| `pay_scheme_lines` | Las líneas de cada versión: beneficiario, porcentaje y si no paga comisión (`fee_exempt`) |
| `pay_transactions` | **Los cobros**, con sus montos, su estado y el desglose congelado |
| `pay_allocations` | Lo que le toca a cada beneficiario de cada cobro, con su porcentaje y su base (`neto` o `bruto`) |
| `pay_transaction_receipts` | Los comprobantes de un cobro (el archivo está en Storage; aquí, su ruta, tipo y tamaño) |
| `pay_transaction_events` | El historial de cada cobro, con el antes y el después |
| `pay_settlements` | Las liquidaciones a beneficiarios |
| `pay_holidays` | Los feriados de cada usuario |

### Lo que la base hace cumplir

**Cuadres del cobro** (restricciones de `pay_transactions`; se comprueban al escribir la fila):

- Lo cobrado es mayor que cero. Lo reembolsado va de cero a lo cobrado (`pay_transactions_refund_range`).
- El bruto vigente y las comisiones nunca son negativos. El neto sí puede serlo.
- Neto = bruto vigente − comisiones (`pay_transactions_net_check`).
- Bruto vigente = cobrado − reembolsado. En un fallido, bruto vigente, comisiones y base del reparto son cero
  (`pay_transactions_gross_check`).
- Hay fecha real de depósito si y solo si el estado es `depositado` (`pay_transactions_deposit_check`).
- **La base del reparto está atada al cobro** (`pay_transactions_alloc_base_check`): es su neto si el reparto es
  sobre el neto, o su bruto vigente si es sobre el bruto. Sin esquema no hay ni base ni monto. Así nadie guarda un
  reparto que cuadre contra una base inventada. La base del reparto solo puede decir «neto» o «bruto»
  (`pay_transactions_alloc_base_kind_check`).
- **Quién paga la comisión** es «nosotros» o «comprador» (`pay_transactions_fees_paid_by_check`). Con «comprador»
  el reparto no puede ir sobre el bruto (`pay_transactions_fees_paid_by_alloc_check`). Lo que pagaron los
  compradores (`buyer_fees`) no es negativo y es 0 si la comisión la pagamos nosotros
  (`pay_transactions_buyer_fees_check`).
- La moneda son tres letras mayúsculas. La referencia tiene de 1 a 120 caracteres y la nota hasta 280. El resumen
  de un evento del historial, de 1 a 300.

**Cuadres que se comprueban al confirmar** (disparadores diferidos). Se miran al final de la transacción, no fila
por fila, para poder guardar el cobro y su reparto juntos:

- La suma de `pay_allocations` de un cobro es exactamente su `alloc_base_amount`. Borrar o cambiar a mano una fila
  del reparto se rechaza.
- Un esquema válido: las líneas no pasan de 100 %; si suman menos hay «Resto»; el «Resto» no es además una línea.

**Partes que no pagan comisión** (migración 5, `20261114120000_pasarelas_5_partes_sin_comision.sql`):

- `pay_scheme_lines.fee_exempt` es la marca «No paga comisión» de cada línea. Vale `false` por defecto, así que las
  líneas de antes la pagan y todo esquema y todo cobro dan lo mismo que antes.
- La cuenta no la hace la base: la hace el motor y la congela en el desglose del cobro
  (`rules.scheme.lines[].feeExempt`).
- La base **no** comprueba que alguien quede pagando la comisión. Lo comprueban el motor y el servidor.
- En `pay_allocations`, la fila de una parte que no pagó comisión lleva `base = 'bruto'`, y las demás `'neto'`.
  Cada una lleva el porcentaje del esquema. La suma sigue siendo `alloc_base_amount`, que es el neto. Las
  restricciones y los disparadores de antes lo admiten tal cual: la migración no los toca.

**Nada apunta a datos de otro usuario.** Cada tabla tiene `unique (id, user_id)` y las claves foráneas son
compuestas, con `user_id`. Tres van más lejos:

- El canal de un cobro tiene que ser de **esa** empresa.
- La tarifa de un cobro tiene que ser de **esa** pasarela.
- La versión de esquema de un cobro tiene que ser de **ese** esquema.

**Nombres únicos por usuario** en empresas, pasarelas, beneficiarios y esquemas, sin distinguir mayúsculas ni
espacios de los extremos. Otro usuario sí puede usar el mismo nombre.

**Referencia única por pasarela.** La referencia de un cobro no se repite en la misma pasarela del mismo usuario. Se
guarda sin espacios en los extremos. La misma referencia en otra pasarela sí vale. Es lo que impide duplicar al
importar.

**Otros únicos.** Además de los nombres y la referencia, la base no deja repetir:

- una tarifa de la misma pasarela con la misma fecha «vigente desde». Aquí no hay función que la reemplace, a
  diferencia de los esquemas: hay que elegir otra fecha o borrar la que sobra;
- una versión de esquema con el mismo número, o con la misma fecha «vigente desde», en el mismo esquema;
- una cuenta de la misma pasarela en la misma empresa;
- un feriado del mismo usuario en el mismo día (por eso `ensureHolidays` ignora los repetidos al sembrar);
- un beneficiario en el reparto de un mismo cobro, o en las líneas de una misma versión de esquema;
- la ruta de un comprobante.

**Tablas de solo añadir:**

- **Tarifas y versiones de esquema:** no se editan. Solo se borran si ningún cobro las usa: el cobro apunta a ellas
  con una clave foránea.
- **Líneas de esquema:** no se editan, pero su dueño sí puede borrarlas o agregarlas a mano, **aunque la versión ya
  tenga cobros**. Ningún cobro apunta a una línea. Lo único que lo frena es el cuadre del esquema: no pasar de
  100 % y, si suman menos, tener «Resto». Por ejemplo, una versión 50 / 30 con «Resto» admite borrar la línea de
  30. Los cobros viejos no cambian, porque llevan sus reglas congeladas en `breakdown`, pero la versión guardada
  deja de decir lo que se usó. La aplicación no debe tocar líneas sueltas: cambia un esquema con `pay_save_scheme`.
- **Eventos del historial:** ni se editan ni se borran. Se van con su cobro.

**Lo que tiene cobros no se borra.** Una pasarela, un canal, una empresa, un beneficiario, un esquema, una tarifa o
una versión de esquema con cobros no se pueden borrar: la clave foránea lo impide. Hay pruebas para los siete.

**Dos borrados que sí pasan, con efecto:**

- Una **cuenta destino** con cobros sí se puede borrar. Sus cobros, y las cuentas de pasarela que la usaban, quedan
  sin cuenta destino, y esos cobros dejan de salir en `pay_bank_account_totals`.
- Borrar un **esquema sin cobros** deja sin esquema por defecto a las empresas que lo tenían.

**`receipts_count` está protegido.** El contador de comprobantes de un cobro solo lo mueve el disparador de la tabla
de comprobantes. Si una sentencia intenta escribirlo a mano, la base lo ignora: una inserción empieza en 0 y una
actualización conserva el valor que había. Sumar o quitar un comprobante no cuenta como edición del cobro (no mueve
`updated_at`). Dos condiciones de las que depende, para quien mantenga:

- La guarda (`pay_transactions_receipts_count_guard`) solo actúa en sentencias directas (`pg_trigger_depth() = 1`).
  Una actualización del cobro hecha desde **otro** disparador pasa sin restaurar el contador. Un disparador nuevo
  que actualice cobros tiene que tenerlo en cuenta.
- Su nombre tiene que ir alfabéticamente **antes** que `pay_transactions_touch`. Los disparadores «antes de
  escribir» de una tabla corren por orden alfabético, y `updated_at` se decide con el contador ya restaurado.
  Cambiarle el nombre rompe la protección sin que nada avise.

**Comprobantes.** La ruta de un comprobante de cobro tiene que empezar por `{user_id}/{id del cobro}/`
(`pay_transaction_receipts_path_check`). Solo JPG, PNG, WebP o PDF, de hasta 10 MB. En una liquidación, la ruta
empieza por `{user_id}/{id de la liquidación}/` (`pay_settlements_receipt_folder_check`).

**Nada que parezca un número de cuenta.** `last4` son exactamente 4 dígitos. El alias y el banco de una cuenta
destino, y el alias de cuenta de un beneficiario, no admiten 7 o más dígitos seguidos.

**Enlaces.** La web de una empresa, la URL de un canal y los enlaces al panel y al pago solo pueden empezar por
`http://` o `https://`.

**Historial.** El tipo de evento es uno de una lista cerrada. La lista incluye `disputa_anulada`, el evento de una
disputa que se anula.

**La migración se revisa a sí misma.** Al final falla si alguna tabla `pay_*` quedó sin RLS, sin la política del
segundo factor o sin su `unique (id, user_id)`, o si el bucket `comprobantes` quedó sin sus dos políticas
restrictivas.

Un detalle para quien mantenga: `pay_company_gateways.default_extra_ids` es un arreglo de ids sin clave foránea. El
motor ignora los ids que ya no existen o están inactivos.

### Funciones atómicas

Las tres corren con los permisos de quien llama (`security invoker`): la RLS y el segundo factor siguen aplicando.
Exigen una sesión de usuario.

| Función | Qué hace |
|---|---|
| `pay_save_transactions(p_items, p_skip_duplicates)` | Crea o actualiza de 1 a 500 cobros, cada uno con su reparto y su evento. Si uno falla, no queda nada de ninguno |
| `pay_save_scheme(p)` | Si no llega `scheme_id`, crea el esquema. Si llega, le cambia el nombre (si viene `name`) y las notas (si viene la clave `notes`). En los dos casos le agrega una versión con sus líneas. Cada línea trae `beneficiary_id`, `pct` y, desde la migración 5, `fee_exempt` (si no viene, `false`). Devuelve el esquema, la versión y su número |
| `pay_create_gateway(p)` | Crea una pasarela con su primera tarifa («desde el inicio») y sus opciones |

Quien llame a `pay_save_scheme` solo para agregar una versión no debe mandar `name` ni `notes`, salvo que quiera
cambiarlos.

Más sobre `pay_save_transactions`:

- En una actualización solo llegan las columnas que cambian. Nunca toca `id`, `user_id`, `created_at`, `updated_at`
  ni `receipts_count`.
- Una clave que no es una columna se ignora **en silencio**. Por eso `tx-save.ts` tiene la lista de columnas
  comprobada por el compilador.
- **Control optimista.** Quien edita manda el `updated_at` que leyó (`expected_updated_at`). Si el cobro cambió
  mientras tanto, la función se niega (`pay_tx_conflict`) y no pisa el cambio del otro. **Solo actúa si ese dato
  llega.** Si falta o es nulo, la función actualiza sin comparar y puede pisar el cambio de otro. Las escrituras
  que planea el motor lo llevan siempre; quien llame a la función por otro camino tiene que mandarlo.
- **Qué versión se compara.** Las acciones de **un solo cobro** (editar, reembolso, disputa, fallido, reabrir,
  depositar o revertir desde el detalle, fecha estimada, recalcular desde el detalle) mandan la versión que vio la
  persona (`expectedUpdatedAt`, el `updatedAt` de la pantalla). Así, una pestaña vieja o un reembolso repetido tras
  un corte dan «Este cobro cambió mientras lo editabas: vuelve a abrirlo» en vez de pisar o sumar dos veces. Si el
  cambio no toca nada, no se escribe y no hay conflicto. Las acciones **en lote** comparan contra lo que el servidor
  acaba de leer: solo frenan un choque de milisegundos.
- El reparto se reemplaza solo si llega uno nuevo. Si no llega, no se toca.
- Con `p_skip_duplicates`, un cobro nuevo cuya referencia ya existe en esa pasarela se salta, y se devuelve el id
  del que ya estaba. Es para importar.
- Devuelve, por cada cobro y en el mismo orden: su id, si se insertó y si se saltó.
- Con más de 500 escrituras, `saveTx` las manda en varios lotes. Cada lote es todo o nada, pero si falla uno, los
  anteriores ya quedaron guardados.

### Vistas de totales

Cuatro vistas para los totales de **toda la historia**. Respetan la RLS (`security_invoker`): cada usuario ve solo
lo suyo. Ninguna cuenta los cobros de la papelera ni los fallidos. Todas van por moneda.

| Vista | Qué da |
|---|---|
| `pay_beneficiary_balances` | Asignado, liquidado y saldo por beneficiario |
| `pay_company_totals` | Por empresa: cobros, bruto vigente, comisiones, neto, y la primera y la última fecha de cobro; al final, `buyer_fees` (lo que pagaron los compradores) |
| `pay_gateway_totals` | Por pasarela: cobros, bruto vigente, comisiones y neto (sin primera ni última fecha), más cuántos depositados y el promedio y la mediana de días al depósito; al final, `buyer_fees` |
| `pay_bank_account_totals` | Por cuenta destino: lo depositado, lo que está [por caer](#por-caer-y-depositado) (con la misma definición del motor) y los días al depósito. No salen los cobros sin cuenta destino |

En las dos de totales, `gross` y `fees` son todo lo cobrado y todas las comisiones, como desde la migración 1. Lo
facturado (`gross − buyer_fees`) y las comisiones del negocio (`fees − buyer_fees`) se derivan en el servidor (ver
[E7](#e7--la-comisión-la-pagó-el-comprador)).

Los totales **por período** (el Resumen, los totales de un filtro) no salen de estas vistas: los suma el motor sobre
las filas del período, traídas por páginas (`leanTx`). La API tiene las agregaciones apagadas y un tope de 1000
filas por petición. Cada página pide además el total de filas del filtro: si la respuesta llega sin ese total, la
lectura lanza un error en vez de dar por completa una suma que pudo quedarse en la primera página.

### Códigos de error

Cuando la base rechaza algo, el mensaje empieza por un código fijo. `errors.ts`, de la capa de servidor, lo
traduce a un mensaje en español. Lo que la base dice de sí misma (nombres de restricciones, ids) nunca llega a la
pantalla.

| Código | SQLSTATE | Cuándo | Mensaje para la persona |
|---|---|---|---|
| `pay_no_session` | 28000 | Se llamó a una función sin sesión de usuario | «Tu sesión terminó. Vuelve a entrar.» |
| `pay_bad_payload` | 22023 | Lo que llegó no tiene la forma esperada. En `pay_save_transactions`: no es una lista, trae menos de 1 o más de 500 cobros, falta `tx`, modo desconocido. En `pay_save_scheme`: `lines` no es una lista. En `pay_create_gateway`: falta `fee` | El general: «No se pudo guardar. Inténtalo de nuevo.» |
| `pay_tx_not_found` | P0002 | El cobro que se quiere actualizar no existe (o no es del usuario) | «Ese cobro ya no existe.» |
| `pay_tx_conflict` | 40001 | El cobro cambió mientras se editaba | «Este cobro cambió mientras lo editabas: vuelve a abrirlo» |
| `pay_scheme_not_found` | P0002 | El esquema no existe (o no es del usuario) | «Ese esquema de reparto ya no existe.» |
| `pay_scheme_version_in_use` | 23503 | Ya hay cobros con la versión de esa fecha «vigente desde» | «Ya hay cobros con la versión del esquema vigente desde esa fecha: elige otra fecha.» |
| `pay_alloc_sum_mismatch` | 23514 | El reparto no suma su base | «El reparto no suma exactamente su base. No se guardó nada.» |
| `pay_scheme_over_100` | 23514 | Las líneas del esquema pasan de 100 % | «Las líneas del esquema suman más de 100 %.» |
| `pay_scheme_under_100` | 23514 | Las líneas suman menos de 100 % y no hay «Resto» | «Las líneas del esquema suman menos de 100 %: elige quién recibe el resto.» |
| `pay_scheme_remainder_in_lines` | 23514 | El «Resto» es además una línea | «Quien recibe el resto no puede ser además una línea del esquema.» |

Otros rechazos llegan con el nombre de la restricción o del índice:

| SQLSTATE | Qué es | Nombres | Mensaje para la persona |
|---|---|---|---|
| 23514 | Un cuadre o una regla de formato que no se cumple | `pay_transactions_net_check`, `pay_transactions_gross_check`, `pay_transactions_refund_range`, `pay_transactions_deposit_check`, `pay_transactions_scheme_check`, `pay_transactions_alloc_base_check`, `pay_transactions_alloc_base_kind_check`, `pay_transaction_receipts_path_check`, `pay_settlements_receipt_folder_check`, y los nombres automáticos de las demás | Propio solo para `pay_transactions_alloc_base_check`. Para los demás: «Algún dato no cumple las reglas del libro. Revísalo e inténtalo de nuevo.» |
| 23505 | Algo repetido | `pay_transactions_reference_uq`, `pay_companies_name_uq`, `pay_gateways_name_uq`, `pay_beneficiaries_name_uq`, `pay_schemes_name_uq`, y los nombres automáticos de los [otros únicos](#lo-que-la-base-hace-cumplir) | Propio para esos cinco. Para los demás: «Ya existe un registro con esos datos.» |
| 23503 | Apunta a algo que no existe, o se quiso borrar algo en uso | claves foráneas | «Algo de lo elegido ya no existe. Vuelve a cargar la página.», o «No se puede borrar: todavía se usa en cobros o en otros registros.» |
| 42501 | Sin permiso: sin sesión, o con segundo factor y sin haber escrito el código | | «Verifica tu segundo factor para seguir» |

Un SQLSTATE que `errors.ts` no reconoce da el mensaje general («No se pudo guardar. Inténtalo de nuevo.»). Un
nombre que no reconoce, dentro de un código conocido, da el mensaje propio de ese código: el de las tablas para
23505, 23503 y 23514, y «Ese registro ya no existe.» para P0002.

Los rechazos de Storage se traducen por su código HTTP: sin segundo factor, archivo que ya no existe, nombre
repetido, más de 10 MB y tipo no admitido tienen cada uno su mensaje.

El motor tiene además sus propios errores, que ya traen el mensaje en español: `PayStateError` (el cambio no
corresponde al estado del cobro), `PayRuleError` (lo elegido no existe en la configuración, o nadie queda pagando la
comisión: `nadie_paga_comision`) y los problemas de un esquema (`validateScheme`).

## Seguridad

### Cada fila es de un usuario (RLS)

Las 17 tablas tienen seguridad por fila. Un usuario solo ve y escribe las filas cuyo `user_id` es el suyo. Quien no
ha entrado (rol `anon`) no tiene ningún permiso. Los permisos están escritos uno por uno en la migración: no se
depende de los que el proyecto dé por defecto.

Las pruebas lo comprueban tabla por tabla con dos usuarios de prueba: uno no ve, no inserta, no actualiza ni borra
lo del otro.

### El segundo factor se exige en la base

Además de la regla anterior, cada tabla tiene una política **restrictiva** que llama a `private.pay_mfa_ok()`. Una
política restrictiva se suma a las demás: hay que cumplir las dos.

| Sesión | ¿El usuario tiene un factor verificado? | ¿Pasa? |
|---|---|---|
| Con segundo factor (aal2) | sí | Sí |
| Solo contraseña (aal1) | no | Sí |
| Solo contraseña (aal1) | sí | **No**: no ve nada y no puede escribir |
| Sin sesión | | No |

En palabras: si el usuario activó el segundo factor, la contraseña sola ya no abre nada. Ni las tablas, ni las
vistas, ni las funciones, ni los archivos. Da igual lo que haga la interfaz: la exigencia está en la base.

**La sesión tiene que seguir abierta.** `pay_mfa_ok()` exige además que la sesión del token siga en
`auth.sessions`. Cambiar la contraseña cierra las sesiones de los demás dispositivos; «Cerrar sesión en todos los
dispositivos», todas; «Cerrar sesión», la de ese dispositivo. Desde ese momento la base no les da ni un dato, aunque
su token siga firmado hasta que caduca (una hora). Lo que puede tardar es que una pantalla ya abierta lo note.

**Importante:** mientras el usuario no active un factor, entra solo con la contraseña. Conviene activarlo el primer
día; la aplicación lo avisa en todas las pantallas hasta que se activa. Un factor a medio activar (sin verificar)
no cuenta.

**Por qué la función vive en el esquema `private`.** Para saber si el usuario tiene un factor hay que leer una tabla
interna de Auth que guarda los secretos del segundo factor. El usuario normal no puede leerla, así que la función
corre con permisos elevados (`security definer`). Para que eso no abra nada:

- no recibe parámetros y solo responde por el usuario de la sesión;
- vive en un esquema que la API **no expone**, así que no se puede llamar desde fuera (las pruebas lo comprueban);
- lleva el `search_path` vacío.

**No es la única con permisos elevados.** Cinco funciones de disparador que leen o escriben tablas también son
`security definer`, con `search_path` vacío: `pay_receipts_count_sync`, `pay_transactions_alloc_check`,
`pay_allocations_sum_check`, `pay_scheme_versions_check` y `pay_scheme_lines_check`. El motivo: al borrar un
usuario desde Auth, la cascada corre los disparadores con el rol del servicio de Auth, que no tiene permisos sobre
las tablas `pay_*` ni sobre el esquema `private`. Sin eso, el borrado falla. No abren nada: no reciben parámetros,
nadie tiene permiso para llamarlas a mano y solo miran la fila que las disparó. **Un disparador nuevo que lea o
escriba tablas tiene que seguir la misma regla**, o rompe el borrado de usuarios.

Las demás funciones internas viven en el mismo esquema, y nadie tiene permiso para llamarlas a mano.

### Comprobantes en Storage

- Bucket **privado** `comprobantes`. No hay URL pública. Guarda los comprobantes de los cobros y de las
  liquidaciones, y también los logos de las empresas.
- Hasta 10 MB por archivo. Solo JPG, PNG, WebP y PDF (un logo, solo JPG, PNG o WebP).
- Cada usuario solo entra a su carpeta, `{user_id}/…`, y con la misma regla del segundo factor. Dentro, una carpeta
  por registro: `{user_id}/{id del cobro}/…`, `{user_id}/{id de la liquidación}/…` y, para el logo,
  `{user_id}/{id de la empresa}/…`.
- Esa regla va también en dos políticas **restrictivas** acotadas al bucket (`pay_comprobantes_mfa` para quien
  entró y `pay_comprobantes_anon` para quien no). Las permisivas se suman entre sí: si el proyecto de Supabase ya
  tuviera otra política de Storage sin filtro de bucket, esa sola dejaría ver los comprobantes sin el segundo
  factor. Las restrictivas lo impiden. Los demás buckets del proyecto no se tocan.
- Para ver un comprobante se genera una **URL firmada que dura 60 segundos**, en el momento de abrirlo
  (`receiptSignedUrl`). No se guarda.
- Storage valida el tipo contra lo que el archivo **declara**, no contra su contenido. Por eso `registerReceipt`
  comprueba además, en el servidor, la carpeta, el tipo, el tamaño y que el archivo de verdad esté en Storage.
- **Cómo se borra.** Los archivos se borran por la API de Storage (listar y quitar), y **antes** de borrar la fila.
  No se pueden borrar con SQL. Hay que comprobar cuántos se borraron: pedir que se quite una ruta sin permiso no da
  error, simplemente no borra nada. Así lo hacen `removeReceipt`, el borrado definitivo de un cobro (`purgeTx`), el
  de una liquidación y el de una empresa, y el cambio de logo.

El navegador sube el archivo directo a Storage y antes achica las imágenes (máximo 1600 px), lo que además les quita
los metadatos, como la ubicación. Del archivo se guardan la ruta, el tipo y el tamaño; su nombre original no.

### Sin secretos en la aplicación

De Supabase, la aplicación solo lee dos variables: la URL del proyecto y la clave **publicable**. Las leen los tres
clientes de `src/lib/supabase/`, la acción de cambiar la contraseña (`src/app/(dashboard)/ajustes/actions.ts`, que
arma un cliente aparte, sin cookies, para comprobar la contraseña actual) y `next.config.ts`, que saca de la URL el
origen permitido en la política de contenido. Todo se hace con la sesión del usuario.

Hay una tercera variable, `PASARELAS_KIT`, que enciende la galería `/kit` fuera de desarrollo. No es un secreto y no
va en producción.

La clave secreta (`SUPABASE_SECRET_KEY`) existe solo para las pruebas y la semilla, y solo contra el Supabase local.
Ningún archivo de `src/` la lee. No va en producción.

### Enlaces

Los enlaces (web, panel, pago) solo pueden ser `http://` o `https://`. Se comprueba en el motor (`isHttpUrl`), en la
validación de la capa de servidor y en la base. Un `javascript:` se rechaza en las tres.

### La guarda contra números de tarjeta

`looksLikeCardNumber` revisa un texto libre y dice si trae algo con pinta de tarjeta: de 13 a 19 dígitos que pasan
la comprobación de Luhn (el dígito de control de las tarjetas). Reconoce tres formas:

1. Dígitos seguidos, o con un espacio o un guion entre ellos, se agrupen como se agrupen.
2. Un número escrito de corrido, lleve lo que lleve al lado.
3. Grupos de 4 a 6 dígitos (4-4-4-4, 4-6-5), separados por espacios, guiones o puntos, con un número corto al lado
   (el CVV, el vencimiento) o con un solo vecino de 4 a 6 dígitos.

**Dónde se aplica.** Los validadores de texto libre de la capa de servidor (`zText`, `zOptionalText` y `zAlias`, en
`zod.ts`) la llevan; `zAlias` rechaza además 7 o más dígitos seguidos, igual que la base. El de la **referencia**
de un cobro (`zReference`) no la lleva, a propósito: los identificadores largos de una pasarela son normales. Los
usan las acciones del servidor (`actions/`).

**Falsos positivos.** Lo que solo Luhn distingue de una tarjeta se marca una vez de cada diez, por azar. Es
cualquier tramo de 13 a 19 dígitos unidos por espacios o guiones:

- dos fechas seguidas con un espacio (`2026-11-03 2026-11-28`);
- un teléfono y una fecha;
- dos teléfonos de 7, 8 o 9 cifras seguidos, o tres fechas cortas (`03-11-26 28-11-26 05-12-26`);
- cuatro montos de 4 cifras seguidos (con cinco, dos veces de cada diez);
- una referencia de 14 cifras.

Si pasa, basta con reescribir el texto (separar con una coma o con «al»).

**Lo que no se marca nunca:** dos o tres teléfonos de 10 cifras (dos ya suman 20 dígitos, más del tope de 19), tres
fechas completas (`2026-11-03`) y montos con centavos.

**Lo que deja pasar.** No es infalible. No detecta una tarjeta escrita en grupos con dos o más números de 4 a 6
cifras pegados, ni una partida de forma rara que además lleve otro número al lado, ni una escondida dentro de un
número más largo. Tampoco une grupos separados por saltos de línea, barras o comas.

Es una ayuda contra el descuido, no una garantía. En la base no hay una regla equivalente para notas y referencias:
ahí solo están las reglas de los alias (7 o más dígitos seguidos) y de los últimos 4.

### Al borrar un usuario

Borrar un usuario borra en cascada **todas sus filas** de las 17 tablas. Lo de los demás usuarios queda igual. Hay
una prueba que lo comprueba.

**No borra sus archivos de Storage.** Los comprobantes y los logos quedan en el bucket y hay que quitarlos por la
API de Storage.

### Entrada y sesión

- **Entrada** con correo y contraseña, en `/login`. El mensaje de error es el mismo si falla el correo o la
  contraseña. **No hay registro**: el usuario dueño se crea desde el panel de Supabase.
- **Segundo factor TOTP** (aplicación de códigos). Se activa en Ajustes → Seguridad, con un QR o una clave. Se
  pueden agregar y quitar dispositivos. Si la cuenta tiene factor, la entrada sigue en `/login/verificar` y hasta
  escribir el código no se ve ninguna pantalla.
- **Cada pantalla con datos, cada descarga y cada acción del servidor (salvo las de la entrada) pasa por
  `requireSession()`** (`src/lib/auth/session.ts`), directo o a través de `runAction`: sin sesión manda a la
  entrada; con factor y sin el código, a la pantalla del código. Lee la sesión con `getClaims()`, que verifica la
  firma del token, no solo lee la cookie. Si Auth no responde cuando hay que saber si el usuario
  tiene factor, pide el código igual: ante la duda, cerrado.
- **El proxy (`src/proxy.ts`) solo decide «hay sesión o no»**: refresca la cookie, manda a `/login` a quien no
  tiene sesión (con la ruta de vuelta en `siguiente`) y, a quien ya la tiene y abre `/login`, a esa ruta o al
  Resumen. No mira el segundo factor ni protege una pantalla por sí solo, y el marco de navegación tampoco. Quien
  de verdad defiende los datos es la base: su política restrictiva exige `aal2` a quien tiene factor, aunque una
  pantalla se olvide de llamar a `requireSession()` (ver
  [El segundo factor se exige en la base](#el-segundo-factor-se-exige-en-la-base)).
- **Una acción del servidor es un punto de entrada público**: valida lo que recibe y no se fía de que la pantalla
  ya validó. La ruta a la que se vuelve después de entrar viene de la URL y solo se aceptan rutas de este sitio.
- **Contraseña.** Se cambia en Ajustes y exige la actual: la app la comprueba por su cuenta (entra con ella aparte)
  antes de cambiar nada. Mínimo 10 caracteres. Se puede cerrar la sesión en este dispositivo o en todos. Una sesión
  cerrada desde otro dispositivo sigue valiendo para `getClaims()` hasta que caduca su token (una hora), pero la
  base ya no le da datos (ver [El segundo factor se exige en la base](#el-segundo-factor-se-exige-en-la-base)).

### Cabeceras de seguridad

`next.config.ts` pone en **todas** las respuestas (páginas, redirecciones y archivos estáticos):

- **Política de contenido (CSP).** El navegador solo carga scripts, estilos, fuentes e imágenes del propio sitio,
  y solo habla con el propio sitio y con el proyecto de Supabase (las imágenes también de ahí, para ver un
  comprobante con su URL firmada). Ninguna otra página puede meter la aplicación en un marco, no se cargan
  plugins y los formularios solo se envían al propio sitio.
- **Una concesión:** la política lleva `script-src 'unsafe-inline'`. Next escribe scripts en línea también en
  producción y, sin una marca por petición (*nonce*), no arranca sin ese permiso. Eso debilita la defensa de la CSP
  contra un script inyectado: la protección real contra eso es que React escapa lo que pinta y que no se pinta
  HTML venido de fuera. Según la documentación de Next, un *nonce* exige que cada página se genere en cada
  petición, que es lo que ya pasa aquí (todo es privado y dinámico): se puede hacer más adelante, generando el
  *nonce* en el proxy. Los estilos en línea también están permitidos, por la misma razón.
- **Las demás:** no adivinar el tipo de un archivo, no dejarse enmarcar, no mandar la dirección completa a otros
  sitios, apagar cámara, micrófono y ubicación, y exigir siempre HTTPS (dos años, sin `includeSubDomains` ni
  `preload`, para no atar otros sitios del mismo dominio).

Aparte de las cabeceras, cada página le dice a los buscadores que no la indexen (metadatos de `layout.tsx`).

La entrada da por hechos varios ajustes de Auth (registro apagado, exigir la contraseña actual, longitud mínima,
TOTP activo). En local los pone `supabase/config.toml`. En un proyecto remoto hay que dejarlos igual: la tabla está
en `README.md`. Si «exigir la contraseña actual» queda apagado, Supabase ignora la que manda la aplicación; la
comprobación de la app sigue en pie, así que el ajuste queda como segunda barrera.

## Decisiones tomadas y por confirmar

Estas decisiones se tomaron sin preguntar, para no parar la construcción. Las filas (a) a (m) son lo que el encargo
dejaba abierto o no se podía cumplir tal cual. Las filas (n) a (p) son límites del modelo frente a cómo trabajan hoy
las pasarelas; lo que dicen de las pasarelas conviene confirmarlo en sus páginas de tarifas. La fila (q) es la
definición de «por caer». Las filas (r) a (x) se tomaron al construir las pantallas y tras la revisión final.

| Decisión | Por qué | Qué cambia si el dueño decide lo contrario |
|---|---|---|
| **(a)** En un reembolso, la plataforma y las opciones se recalculan sobre el bruto vigente. Solo la comisión base de la pasarela puede quedar retenida | Es lo único coherente con E4, que da 3,20 de costo y no 9,70 | Si la plataforma o las opciones tampoco devuelven lo suyo, el costo de un reembolso total de E1 sería 9,70. Hay que cambiar el cálculo de esas dos líneas y las cifras de E4 y E5 |
| **(b)** El costo de un reembolso o de una disputa baja el neto y se reparte como pérdida, con los mismos porcentajes, salvo las partes que no pagan comisión: su parte sale del bruto vigente y la pérdida la cargan las demás, en proporción a sus porcentajes ([E9b](#e9--una-parte-que-no-paga-comisión)) | Con el esquema sobre el neto, la pérdida es de todos los que reparten | Si la pérdida la absorbe solo la empresa, el reparto de E4 sería 0,00 para todos y los saldos −45,15 · −27,09 · −18,06. Hace falta una regla nueva para sacar esos costos de la base del reparto |
| **(c)** Las cuotas fijas van en la moneda del cobro | No hay tipos de cambio en el libro | Si una cuota fija se cobra en otra moneda, hay que guardar su moneda y un tipo de cambio por fecha |
| **(d)** Recalcular tiene dos modos. Por defecto, la tarifa vigente hoy | «Recalcular con la tarifa de hoy» era el pedido. El segundo modo sirve para corregir una tarifa mal cargada | Si el modo por defecto debe ser el de la fecha del cobro, se cambia en la pantalla. El motor ya exige que se le diga el modo |
| **(e)** Editar solo vuelve a resolver las reglas de lo que cambió | Corregir una nota o un canal no debe cambiar en silencio la tarifa de un cobro viejo | Si editar debe traer siempre la configuración de hoy, cualquier edición cambiaría comisiones y repartos. Hoy eso se hace a propósito, con «Recalcular» |
| **(f)** Calendario de feriados **bancario**, no el de oficinas federales | Los depósitos se mueven cuando los bancos abren. Con un feriado en sábado, los bancos abren el viernes | Con el calendario federal serían inhábiles también el 3/7/2026, el 18/6/2027, el 24/12/2027 y el 31/12/2027, y las estimaciones cercanas caerían un día después. Los feriados son editables: se pueden agregar sin tocar código |
| **(g)** Las liquidaciones llevan moneda y los saldos nunca mezclan monedas | Sin moneda, el saldo de un beneficiario sumaría monedas distintas | No hay alternativa sin tipos de cambio. Con ellos, haría falta una moneda de referencia y la fecha de cada conversión |
| **(h)** Nombres únicos por usuario en empresas, pasarelas, beneficiarios y esquemas | Dos con el mismo nombre no se distinguen en una lista ni en un reparto | Si se quieren permitir repetidos, una migración nueva quita esos cuatro índices únicos |
| **(i)** Una disputa perdida implica reembolso total | Es el caso normal: el comprador recupera todo | Si hay disputas por una parte del cobro, hay que guardar el monto disputado y dejar de forzar el reembolso total al perder |
| **(j)** Es una aplicación autónoma en `pasarelas/`, con su propia entrada y segundo factor. No es un módulo de otra plataforma | Lo decidió el dueño el 2026-11-09. El encargo original lo describía como módulo de una plataforma que ya tenía entrada, papelera y kit de interfaz | Para mudarlo a otra plataforma Next + Supabase: se llevan el motor, la migración y las pantallas, y se cambian la entrada y el kit por los de allá. Está preparado: rutas bajo `/pasarelas`, motor en una carpeta y todo en la base con prefijo `pay_` |
| **(k)** La rama de trabajo es la de la sesión, no `pasarelas/v1` | La sesión solo puede empujar a su propia rama (su nombre está en el diseño, spec §1) | Renombrarla o abrir `pasarelas/v1` lo hace alguien con permiso. No cambia el código |
| **(l)** Los patrones son propios | El encargo pedía copiar los de otro repositorio, y no se pudo leer | Si se consigue acceso, se ajustan nombres y estructura. El motor y la base no dependen de ellos. Las convenciones están en `AGENTS.md` |
| **(m)** Resuelta: está publicada desde el 10/11/2026, en Vercel y en un proyecto de Supabase compartido con otras apps del dueño ([«Dónde está publicada hoy»](../README.md#dónde-está-publicada-hoy), en el README) | Al construir, todo se probó contra un Supabase local y el dueño decidió elegir la base remota al final. Con el plan gratis no quedaba hueco para un proyecto propio | Para pasarla a un proyecto propio se siguen los pasos de [«Pasar a producción»](../README.md#pasar-a-producción), en el README, y además se copian las filas `pay_*` y los comprobantes |
| **(n)** El costo de disputa es uno solo y desaparece si la disputa se gana | Así lo pide el encargo, y E6: al ganar, el cobro vuelve a las cifras de E1 | Según la documentación de Stripe consultada al construir (conviene confirmarla en su página de tarifas), desde junio de 2025 Stripe cobra un costo al recibir la disputa, que **no** devuelve aunque se gane, y otro al contestarla, que sí devuelve. Con Stripe, hoy el libro da por devuelto lo que no vuelve: cada disputa ganada deja el neto más alto que el real. Para reflejarlo, por pasarela: «el costo de disputa se devuelve si se gana» (sí o no), o partir el costo en dos. Es una migración aditiva, el motor y la pantalla de pasarelas, y E6 «ganada» ya no volvería a E1 |
| **(o)** Las opciones no tienen monto mínimo | El encargo solo pedía porcentaje y cuota fija | Los depósitos instantáneos suelen tener una comisión mínima (0,50, por confirmar). En cobros chicos, el costo real del pago rápido sería mayor que el calculado. Hace falta un campo «mínimo» en la opción |
| **(p)** Los días al depósito se cuentan desde la fecha del cobro en Nueva York | Es una sola regla para todas las pasarelas, y la fecha estimada se puede corregir a mano | Hay pasarelas que cuentan en UTC, que empiezan en el siguiente día hábil o que cuentan desde el retiro. Para afinar hace falta, por pasarela, la zona de corte y cómo trata un cobro en día inhábil |
| **(q)** «Por caer» es lo que se ve como registrado o en tránsito. Un cobro sin depositar con la disputa abierta o reembolsado del todo no está por caer. Consecuencia: «neto total = por caer + depositado» deja de cuadrar exacto cuando hay cobros así | «Por caer» responde a «cuánto me va a llegar al banco». Con la disputa abierta la pasarela retiene el dinero, y un reembolso total ya se devolvió: contarlos prometería un depósito que no va a llegar. Así la tarjeta, el filtro, los próximos depósitos, lo atrasado y la vista de cuentas dan lo mismo | Si se quiere que «por caer» más «depositado» sume siempre el neto, esos cobros vuelven a contar en «por caer» (el neto de E4 restaría 3,20 a lo que se espera recibir) y hay que cambiar el motor, el filtro de la lista y la vista. La otra salida es enseñar la diferencia como una tercera cifra, «retenido o devuelto» |
| **(r)** La primera tarifa de una pasarela y la primera versión de un esquema valen «desde el inicio» (`2000-01-01`). Una versión nueva, por defecto desde mañana; se puede elegir otra fecha | Así cualquier cobro, aunque sea viejo o se registre tarde, tiene tarifa y reparto | Si un esquema nuevo debe valer solo desde su fecha, al crearlo se elige «Desde una fecha». Sin eso, recalcular un cobro viejo «con la tarifa de la fecha del cobro» le aplicaría ese esquema |
| **(s)** Al importar, cada pasarela recuerda el formato y las columnas usadas, y avisa («Ojo: puede duplicar cobros») si después llega otro formato. En el informe de saldo de Stripe la referencia es `source_id`, el id del cobro, cuando el archivo la trae | Los dos archivos de Stripe dan referencias distintas al mismo cobro (`txn_…` y `ch_…`): importar los dos lo registraría dos veces. Con `source_id`, la referencia es la misma que se suele teclear a mano (`ch_…`) | Si se cambia de formato a propósito, se marca «Son otros cobros: importar igual». Sin el aviso, ese error pasaría en silencio |
| **(t)** Los encabezados de la exportación de **pagos** de Stripe no tienen fuente oficial: se tomaron de exportaciones de ejemplo. El informe de saldo y la actividad de PayPal sí la tienen | No se encontró una página de Stripe que los publique, y no se inventan | Si no coinciden, el archivo sale como no reconocido y se eligen las columnas a mano una vez (la pasarela lo recuerda). Con la fila de encabezados de una exportación real, sin datos, se ajusta el reconocimiento |
| **(u)** No se guarda el nombre original del archivo de un comprobante. La columna ya no existe en la migración | El nombre puede traer el de un comprador u otra persona, y la regla es no guardar datos de compradores | El archivo se reconoce por tipo, tamaño y fecha. Si hace falta el nombre, vuelve con una migración aditiva |
| **(v)** Una sesión cerrada deja de leer datos al instante: lo comprueba la base, no la app | La base defiende también a quien llame a la API directo, y no suma una llamada a Auth por cada página | Comprobarlo en la app con Auth en cada página es una llamada de red más por página, y la API directa seguiría abierta hasta una hora |
| **(w)** «Marcar depositado» en lote solo marca lo que está por caer. La fecha de un depósito ya hecho se cambia solo desde el detalle del cobro | El lote pisaba en silencio fechas reales (y con ellas el tiempo real de depósito) y depositaba cobros con la disputa abierta | Si se quiere corregir fechas en lote, hoy se hace cobro por cobro |
| **(x)** El Resumen abre en la moneda con más cobros del período (a igual número, la de más empresas). Se puede elegir otra | Comparar brutos de monedas distintas no tiene sentido: un cobro de 2 300 MXN ganaba a muchos en USD | Si se prefiere una moneda fija (por ejemplo, USD si hay), es un cambio chico en el Resumen |

### Lo que el dueño tiene que decidir

Por orden de lo que más afecta al dinero:

1. **Disputas en Stripe (n).** ¿Se separa el costo que no se devuelve? Hoy cada disputa ganada deja el neto más
   alto que el real.
2. **Encabezados de pagos de Stripe (t).** Mandar la fila de encabezados de una exportación real, sin datos.
3. **Costos de un reembolso (a) y (b).** ¿La plataforma y las opciones devuelven lo suyo? ¿La pérdida la comparten
   los beneficiarios o solo la empresa?
4. **Pago rápido y días (o) y (p).** ¿El pago rápido tiene un mínimo? ¿Cómo cuenta los días cada pasarela?
5. **«Por caer» (q).** ¿Así, o con una tercera cifra para lo retenido o devuelto?

Lo que hay que decidir para la fase C está aparte, en su
[§9](#9-lo-que-el-dueño-tiene-que-decidir).

## Lo que queda

**No se construyó:**

- La [fase C](#fase-c-conectar-con-las-pasarelas): conectar con las pasarelas. Es solo diseño.
- Recuperar la contraseña por correo. Se resuelve desde el panel de Supabase.
- Códigos de respaldo del segundo factor. Si se pierde el teléfono, se quita el factor desde el panel de Supabase.
  Por eso conviene registrar un segundo dispositivo.

**Para producción.** Está publicada: dónde, con qué migraciones y qué saber del proyecto compartido, en
[«Dónde está publicada hoy»](../README.md#dónde-está-publicada-hoy), en el README. Para armarla en un proyecto nuevo,
los pasos (copia previa, aplicar las migraciones, ajustes de Auth, crear el usuario dueño y el proyecto de Vercel)
están en [«Pasar a producción»](../README.md#pasar-a-producción), en el README.

**Límites conocidos** que se notan al usar la app:

- Abrir el detalle de un cobro de otro usuario (o uno que no existe) enseña «Esta página no existe», sin ningún
  dato, pero la respuesta sale con código 200 en vez de 404.
- Sin JavaScript no se puede entrar (ni usar el resto de la app). Es el precio de que, con un corte al entrar, la
  pantalla lo diga y conserve el correo en vez de caer en una página de error.
- Al importar no se elige el esquema de reparto: va el por defecto de la empresa, si está activo, o ninguno. Para
  repartir con otro, se edita cada cobro después.
- Los reembolsos de un CSV no se importan: se registran en el detalle de cada cobro. Un pago de Stripe ya
  reembolsado entra por su monto original, con una nota que dice cuánto falta registrar.
- Con «Estos cobros ya se depositaron», solo entran depositados los cobros cuya fecha estimada ya llegó, y la fecha
  del depósito es esa estimada, no la real: así entra en el tiempo real promedio.
- Si la sesión venció, la descarga de «Exportar todo» o de «Exportar CSV» guarda la página de entrada en vez del
  archivo: entra de nuevo y repite la descarga.
- En la ficha de la empresa, la cuota fija de un canal se muestra con la moneda de la empresa, pero se cobra en la
  moneda de cada cobro (fila [(c)](#decisiones-tomadas-y-por-confirmar)).
- Una cuenta destino desactivada se sigue usando en los cobros nuevos de las empresas que la tienen, hasta que se
  cambie en cada empresa. La pantalla lo avisa al desactivarla.
- Solo se siembran los feriados de 2026 y 2027. Los años siguientes se cargan en Feriados (el Resumen avisa). Si se
  borran todos, 2026 y 2027 vuelven solos.
- «Exportar todo» lee por tramos, no de una sola vez: si se registra algo mientras se descarga, una fila puede
  salir repetida o faltar. Conviene exportar sin estar cambiando nada.
- Tras el aviso de que una liquidación ya estaba guardada, el formulario queda listo para otra: pulsar otra vez
  «Registrar liquidación» crea una segunda, sin el archivo elegido. Antes, revisar la lista.
- Para probar desde el celular contra `next dev` por la red local hace falta https (`next dev
  --experimental-https`): sin él, el navegador no da los identificadores que usan los formularios. En producción
  siempre hay https.

## Fase C: conectar con las pasarelas

Estado: **solo diseño, sin construir**. Nada de lo que sigue existe en el código ni en la base. Sirve para que el
dueño decida qué se construye, en qué orden y con qué reglas.

Cómo leer esta sección:

- Las marcas `[F1]`, `[F2]`… apuntan a la lista [Fuentes](#fuentes), al final.
- Lo que no se pudo confirmar en la documentación oficial lleva la marca **«No confirmado»**.
- «§3» remite a las partes numeradas de esta sección. «spec §3», al documento de diseño
  (`docs/superpowers/specs/2026-11-09-pasarelas-design.md`).
- Un **depósito** es el envío de dinero de la pasarela al banco. Un **movimiento de saldo** es cada entrada o
  salida en la cuenta de la pasarela (un cobro, un reembolso, una comisión, un depósito).

Resumen en cinco líneas:

- La app sigue sin cobrar y sin mover dinero. Solo **lee** lo que la pasarela ya hizo.
- Lo que más valor da con menos riesgo es **leer a pedido**: un botón «Sincronizar» que corre con la sesión del
  dueño. No necesita endpoint público ni clave de servicio de Supabase.
- Los **webhooks** aportan poco a un libro de un solo dueño y traen el riesgo más grande (escribir sin sesión).
  Van al final, o no van.
- **Stripe** deja hacer casi todo. **PayPal** deja leer cobros y comisiones, con retraso, **no** dice qué cobros
  cubre cada retiro al banco, y su credencial quizá no se puede limitar a solo lectura.
- Hay que cambiar dos reglas del proyecto, poco o mucho según lo que se elija: «la app no lee secretos» y, solo si
  hay webhooks, «el rol `anon` no puede nada».

### 1. Qué cambia y qué no

**No cambia**

- La app no procesa pagos, no crea cobros en la pasarela, no reembolsa y no ordena depósitos.
- En **Stripe**, todas las llamadas son de lectura (`GET`) y la credencial **no puede** escribir.
- El dinero sigue sin pasar por `number`, la base sigue defendiendo los cuadres y lo calculado sigue congelado en
  `pay_transactions.breakdown`.
- No se guardan tarjetas, cuentas completas ni datos de compradores (regla 6 de `AGENTS.md`).
- El registro a mano y el importador de CSV siguen igual. La conexión es opcional por empresa.

**Lo que no se puede prometer en PayPal.** El token se pide con un `POST`, y el ejemplo oficial de token trae
permisos de pagos, reembolsos y envíos de dinero `[F15]`. No está confirmado que se puedan quitar (§2.3). La app
solo hace lecturas y rechaza la credencial si su token trae permisos de más; si no se pueden quitar, PayPal se
queda sin conexión. Es una decisión del dueño (§9).

**Qué gana el dueño**

| Hoy | Con la fase C |
|---|---|
| Teclea cada cobro o importa el CSV de la pasarela | Los cobros de una cuenta conectada aparecen solos al sincronizar |
| La comisión es la **calculada** con la tarifa guardada | Se compara con la comisión **real** que cobró la pasarela y se avisa si no coinciden |
| Marca «depositado» a mano, por grupo | En Stripe, un depósito real marca sus cobros como depositados, con su fecha |
| La fecha de depósito es una estimación | Queda la fecha que informa la pasarela (y sigue midiéndose el tiempo real) |
| Los socios piden su estado de cuenta | Cada socio entra y ve lo suyo, sin poder tocar nada |

**Riesgos nuevos que entran**

1. **Secretos de terceros.** Hoy la app no lee ningún secreto
   ([Sin secretos en la aplicación](#sin-secretos-en-la-aplicación)). Con la fase C el servidor guarda claves que
   leen la actividad financiera de cada empresa. Si se filtran, alguien ve los ingresos del dueño. Con una clave
   bien restringida no puede mover dinero, pero la filtración igual es seria.
2. **Un endpoint público** (solo si hay webhooks). Cualquiera en internet puede llamarlo. Hay que verificar la
   firma, limitar lo que ese camino puede escribir y aguantar basura.
3. **Datos de compradores que hay que NO traer.** Las respuestas de las pasarelas traen nombre, correo, dirección
   y los últimos cuatro de la tarjeta dentro del propio cobro `[F7]` `[F13]`. No basta con «no guardarlos»: hay
   que pedir lo mínimo y descartar el resto antes de que toque la base o los registros del servidor.
4. **Escribir sin una persona delante.** Hoy toda escritura pasa por la sesión del dueño, con RLS y segundo
   factor. Un webhook o una tarea programada no tienen sesión. Ese es el cambio de seguridad más grande de toda
   la fase y se puede evitar (§3).
5. **Más formas de duplicar.** El mismo cobro puede llegar a mano, por CSV y por la API.
6. **Dependencia de servicios ajenos.** Límites de frecuencia, retrasos y cambios de API de terceros.

**Requisito previo.** Una pasarela no puede llamar a un equipo local: la fase C necesita la app publicada. Lo está
desde el 2026-11-10 ([«Dónde está publicada hoy»](../README.md#dónde-está-publicada-hoy), en el README).

### 2. Leer con claves restringidas de solo lectura

#### 2.1 Una conexión por empresa y pasarela

Cada cuenta de pasarela conectada es una fila nueva, `pay_gateway_connections`, atada a una fila de
`pay_company_gateways` (la cuenta de una pasarela en una empresa, que ya existe). Guarda el proveedor, el modo
(real o de prueba) y el estado de la sincronización. **No guarda el secreto ni su nombre**: el servidor deduce de
dónde leerlo a partir del identificador de la conexión (§4).

Supuesto que hay que confirmar con el dueño: **cada empresa tiene su propia cuenta** en la pasarela. Si una sola
cuenta de Stripe cobra para dos empresas, la API no dice de cuál es cada cobro sin leer datos que no queremos
traer.

Lo que la API no sabe y se resuelve con la configuración que ya existe, igual que al registrar a mano:

| Dato del cobro | De dónde sale |
|---|---|
| Empresa y pasarela | De la conexión |
| Canal | No se sabe. Queda vacío, o un canal por defecto de la conexión |
| Opciones (p. ej. «Pago rápido») | `default_extra_ids` de la cuenta de la pasarela en esa empresa |
| Esquema de reparto | El esquema por defecto de la empresa, en la versión vigente ese día |
| Cuenta destino | La de la cuenta de la pasarela en esa empresa |

#### 2.2 Stripe

**Qué pedir.** Una **clave restringida** (`rk_live_…`) por cuenta de Stripe, creada por el dueño en su panel.
Una clave restringida solo puede lo que se le marca, recurso por recurso: Ninguno, Lectura o Escritura; el valor
por defecto es Ninguno. Stripe la recomienda sobre la clave secreta, que lo puede todo `[F1]` `[F2]`. Una clave
creada por el dueño se ve **una sola vez** `[F2]`. Stripe permite además atarla a direcciones IP, redes o países
(«políticas de acceso») `[F2]`.

No se pide nunca la clave secreta (`sk_live_…`). Si alguien la pega, la app la rechaza por su prefijo.

**Permisos mínimos.** Todo en **Ninguno** salvo esto, todo en **Lectura**:

| Nivel | Permisos de lectura `[F27]` | Para qué | Datos de compradores al alcance de la clave |
|---|---|---|---|
| 1 (recomendado para empezar) | `balance_read` (saldo y movimientos de saldo) y `payout_read` (depósitos) | Cobros, comisión real, neto, depósitos y qué cobros cubre cada depósito | Pocos: el texto libre `description` del movimiento, que puede traer un correo o un nombre. Falta confirmar que no alcance más (ver abajo) |
| 2 (opcional) | Además, `charge_read` (cobros y reembolsos) y `dispute_read` (disputas) | Enlazar cada reembolso y cada disputa con su cobro | Sí: el objeto del cobro trae nombre, correo, dirección y últimos 4 `[F7]` |

El nivel 1 es el hallazgo útil de este diseño: los **movimientos de saldo** traen el bruto, la comisión, el neto,
la moneda, la fecha y el identificador del cobro, y no traen los datos del comprador como campos `[F4]`. Con eso
alcanza para el libro.

Los nombres de los permisos salen de la referencia oficial `[F27]`: `GET /v1/balance_transactions` y
`GET /v1/balance` piden `balance_read`; `GET /v1/payouts`, `payout_read`; `GET /v1/charges/{id}` y
`GET /v1/refunds/{id}`, `charge_read`; `GET /v1/disputes/{id}`, `dispute_read`; `GET /v1/events`, `event_read`.
Lo único sin confirmar es la etiqueta con la que cada permiso aparece en el panel. Si falta uno, Stripe responde
con un error que dice cuál agregar `[F1]`.

**No confirmado: qué puede expandir la clave de nivel 1.** La documentación no dice qué permiso exige
`expand[]=data.source`, que trae el cobro entero dentro del movimiento `[F5]`. Si una clave con solo `balance_read`
pudiera expandirlo, quien la robe llegaría a datos de compradores aunque la app nunca lo pida. Hay que probarlo en
un entorno de prueba antes de afirmar que el nivel 1 no alcanza ninguno.

**Comprobar la clave al conectar.** El prefijo `rk_` dice que la clave es restringida, no qué permisos tiene: una
clave restringida con Escritura en todo pasa ese filtro. Por eso, al conectar:

- La app hace lecturas que **deben fallar** por falta de permiso: `GET /v1/customers?limit=1` (pide
  `customer_read`) y, en el nivel 1, `GET /v1/charges?limit=1` (pide `charge_read`) `[F27]`. Solo mira si
  respondió bien o mal: el cuerpo se descarta sin leerlo.
- Si alguna responde bien, la clave tiene permisos de más y se rechaza.
- La **escritura** no se puede comprobar sin riesgo: habría que intentar escribir. Eso queda en la guía de alta,
  paso a paso.
- No se encontró en la documentación una forma de pedir por API la lista de permisos de una clave.

**Qué se lee.**

| Petición | Para qué | Nota |
|---|---|---|
| `GET /v1/balance_transactions?type=charge&created[gte]=…` | Cobros con tarjeta | Devuelve primero lo más reciente; hasta 100 por página; cursor `starting_after` `[F3]` |
| `GET /v1/balance_transactions?type=payment&created[gte]=…` | Cobros con otros medios de pago (su identificador empieza por `py_`) | `type=charge` solo trae los cobros con tarjeta `[F28]`. `type` admite un valor por petición `[F3]`: son dos lecturas, o una sin filtro que se clasifica después |
| `GET /v1/payouts?created[gte]=…` y `GET /v1/payouts/{id}` | Depósitos nuevos, y el estado de los ya guardados (§2.6) | `[F6]` `[F32]` |
| `GET /v1/balance_transactions?payout=po_…` | Qué movimientos cubre un depósito | **Solo depósitos automáticos** `[F3]` `[F5]` |
| Nivel 2: `GET /v1/refunds/{id}` | A qué cobro pertenece un reembolso | El movimiento de un reembolso trae `source = re_…`, no el cobro `[F5]`. El reembolso sí lo dice, en su campo `charge` `[F29]` |
| Nivel 2: `GET /v1/disputes/{id}` y `GET /v1/charges/{id}` | A qué cobro pertenece una disputa y cómo terminó; el total reembolsado de un cobro | El movimiento de una disputa es de tipo `adjustment` y su `source` es la disputa `[F28]`; la disputa dice su cobro en `charge` `[F30]`. Sin `expand`. Se descarta casi todo |

Dos consecuencias:

- **En el nivel 1, un reembolso o una disputa no se pueden enlazar con su cobro.** Aparecen como «movimiento sin
  cobro», para revisar, y el dueño los registra a mano como hoy.
- **Pagos que fallan después.** Un pago con un medio de aviso tardío (un débito bancario) entra como `payment`
  pendiente. Si falla, aparece otro movimiento, `payment_failure_refund` `[F28]`. En la primera versión se lista
  «para revisar» y el dueño marca el cobro como fallido. La alternativa más simple es que la primera versión cubra
  solo tarjetas (`type=charge`) y lo diga en pantalla.

**Qué se guarda y qué se descarta.**

| Objeto | Se guarda | Se descarta a propósito |
|---|---|---|
| Movimiento de saldo `[F4]` | `source` (el identificador `ch_…` o `py_…`, que es la **referencia**), `amount`, `fee`, `net`, `currency`, `created`, `available_on`, `type`, `reporting_category`; de `fee_details`, solo tipo y monto | `description` (texto libre: puede traer un correo o un nombre), `fee_details.description` |
| Depósito `[F6]` | `id` (`po_…`), `amount`, `currency`, `arrival_date`, `status`, `automatic`, `method`, `reconciliation_status` | `destination`, `trace_id`, `statement_descriptor`, `description`, `metadata` |
| Cobro (nivel 2) `[F7]` | `id`, `amount_refunded`, `refunded`, `disputed`, `status` | `billing_details` (nombre, correo, teléfono, dirección), `receipt_email`, `receipt_url`, `payment_method_details` (marca, últimos 4, huella), `customer`, `shipping`, `description`, `metadata`, `outcome` |
| Reembolso (nivel 2) `[F29]` | `id`, `charge`, `amount`, `status`, `created` | Todo lo demás (`customer`, `description`, `metadata`, `destination_details`…) |
| Disputa (nivel 2) `[F30]` | `id`, `charge`, `amount`, `status`, `created` | Todo lo demás; sobre todo `evidence`, que trae nombre, correo y dirección del comprador |

Tres reglas de implementación para que el descarte sea real:

1. Un **mapeador con lista blanca**: toma los campos permitidos y tira el resto en memoria. Un campo nuevo que
   Stripe agregue mañana queda fuera por defecto.
2. **Nunca** se escribe la respuesta cruda en la base ni en los registros del servidor. Los errores registran el
   código y el identificador, no el cuerpo.
3. **Nunca** se usa `expand[]=data.source`: trae el cobro entero con los datos del comprador `[F5]`.

**Dos avisos sobre los montos.**

- Stripe da los montos en la **unidad mínima** de la moneda (centavos) `[F4]`. La conversión a `"90.30"` se hace
  con `decimal.js` y tiene que conocer las monedas sin decimales y los casos especiales que lista Stripe (corona
  islandesa, florín húngaro, dólar taiwanés y chelín ugandés) `[F31]`. Va en el motor, con sus pruebas.
- El movimiento de saldo está en la **moneda de liquidación** de la cuenta, no en la que pagó el comprador. El
  ejemplo de Stripe: un cobro de 10,00 EUR entra como 12,34 USD `[F4]`. Para un libro de «lo que cae al banco» eso
  es lo correcto, pero no coincide con registrar a mano «lo cobrado». Hay que decidirlo (§9).

**Cómo enlaza Stripe un movimiento con su depósito.** Cada depósito automático junta varios movimientos. Cuando el
depósito tiene `reconciliation_status = completed`, la lista de movimientos filtrada por `payout` devuelve todos
los que cubre: cobros, reembolsos, comisiones sueltas y el propio depósito `[F5]` `[F6]`. Lo que **no** se puede:

- **Depósitos manuales**: Stripe no sabe qué movimientos incluyen; conciliarlos es responsabilidad del dueño
  `[F5]`.
- **Depósitos instantáneos** y cualquier otro con `reconciliation_status = not_applicable`: Stripe solo da la lista
  para los depósitos automáticos estándar `[F6]`. Si el dueño usa «pago rápido», justo esos depósitos no se pueden
  enlazar solos.

En esos casos queda lo de hoy: marcar «depositado» por grupo, ahora con una sugerencia.

#### 2.3 PayPal

Hay que decirlo sin adornos: **PayPal no tiene un equivalente a la clave restringida de Stripe.**

**Qué pedir.** El **identificador de cliente y el secreto** de una aplicación REST creada en la cuenta de PayPal de
la empresa. Con ellos se pide un token temporal (`POST /v1/oauth2/token`, credenciales de cliente). La respuesta
dice cuántos segundos vale y trae un campo `scope` con los permisos concedidos `[F15]`.

**Permiso mínimo.** La búsqueda de transacciones pide el permiso
`https://uri.paypal.com/services/reporting/search/read` `[F13]`. El diseño es:

1. Crear una aplicación REST **solo para esto**, con la función de búsqueda de transacciones activada y las demás
   apagadas.
2. Al conectar y en cada sincronización, mirar el `scope` del token. Si trae un permiso que no sea de lectura de
   informes (pagos, reembolsos, envíos de dinero), la app **se niega a usar esa credencial** y lo dice.

**No confirmado:** que apagar las demás funciones de la aplicación quite de verdad sus permisos del token. El
ejemplo oficial de token trae permisos de pagos, reembolsos y envíos `[F15]`, así que no hay que darlo por hecho:
la comprobación del punto 2 es la defensa. Si resulta que no se pueden quitar, esa regla deja a PayPal sin
conexión, y el dueño tiene que elegir entre aceptar un secreto que puede mover dinero o seguir con PayPal por CSV
(§9). Tampoco se pudo abrir la guía oficial con los pasos para activar la búsqueda de transacciones ni el tiempo
que tarda en activarse.

**Qué se lee.** `GET /v1/reporting/transactions` `[F13]`, con estas condiciones:

| Límite de PayPal | Consecuencia en el diseño |
|---|---|
| Una transacción tarda **hasta tres horas** en aparecer `[F13]` | PayPal nunca está «al momento». La ventana de lectura termina en «ahora − 3 h» o en `last_refreshed_datetime` |
| Rango máximo de **31 días** por petición `[F13]` | La carga inicial va por ventanas de 31 días |
| Historia de los **últimos tres años** `[F13]` | No hay más atrás |
| Hasta **500** por página `[F13]` | Coincide con el tope de 500 cobros por llamada de `pay_save_transactions` |
| PayPal rechaza una consulta con demasiados resultados (`RESULTSET_TOO_LARGE`) `[F34]`. La cifra del tope (se habla de 10 000) no está en la especificación: **no confirmada** | Si una ventana se pasa, se achica |
| PayPal **no publica** sus límites de frecuencia; responde 429 `RATE_LIMIT_REACHED` y pide no sondear y reutilizar el token `[F16]` | Sincronizar pocas veces al día, un token por corrida, y reintentar con espera |

**Qué se guarda y qué se descarta.** El parámetro `fields` decide qué bloques vienen. Por defecto solo
`transaction_info`; `payer_info` trae correo, nombre, teléfono y dirección `[F13]`.

- Se pide **solo** `transaction_info`. Nunca `payer_info`, `shipping_info`, `cart_info` ni `all`. Así **viajan
  menos datos**: no llegan correo, nombre ni dirección.
- Aun así, `transaction_info` trae cosas del comprador: `paypal_account_id`, que es el identificador de la cuenta
  de la contraparte, y los textos libres `transaction_subject`, `transaction_note`, `custom_field` e `invoice_id`
  `[F34]`. Viajan; la lista blanca los descarta al llegar.
- Se guarda: `transaction_id` (la referencia), `transaction_event_code`, `transaction_initiation_date`,
  `transaction_amount`, `fee_amount`, `transaction_status` y `paypal_reference_id` (para enlazar un reembolso con
  su cobro).
- Se descarta: `paypal_account_id`, `transaction_subject`, `transaction_note`, `custom_field`, `invoice_id` y
  cualquier otro texto libre, los saldos y `bank_reference_id`.

Los códigos de evento separan los tipos: `T00nn` son pagos, `T11nn` reversos y reembolsos (`T1107`, reembolso de un
pago), `T12nn` ajustes y contracargos, `T01nn` comisiones y `T04nn` **retiros al banco** (`T0400` retiro general,
`T0401` barrido automático, `T0403` retiro manual) `[F14]`. PayPal avisa que un mismo identificador puede aparecer
en un movimiento que afecta el saldo y en otro que no `[F13]`: se lee con `balance_affecting_records_only=Y`, que
es el valor por defecto `[F34]`.

**Lo que PayPal no permite.**

- **No hay enlace entre un retiro y sus cobros.** El saldo de PayPal es una bolsa: un retiro `T04nn` saca un monto,
  no una lista de ventas. No se encontró en la documentación ninguna forma de saber qué cobros cubre. La app
  **no** puede marcar cobros de PayPal como depositados con certeza.
- Lo honesto es **proponer**: «Retiro de 500,00 el 12/11: ¿qué cobros cubre?», con los más antiguos sin depositar
  ya marcados, y que el dueño confirme. Es el «marcar depositado por grupo» de hoy, con una sugerencia.
- No hay clave de solo lectura por recurso, ni límites publicados, ni datos al momento.

#### 2.4 Cómo se evita duplicar

Lo que ya existe y alcanza para el caso principal:

- El índice único `pay_transactions_reference_uq` sobre `(user_id, gateway_id, reference)` cuando hay referencia.
- `pay_save_transactions(items, skip_duplicates)`, que salta la referencia repetida y devuelve el `id` del cobro
  que ya estaba.

Sincronizar dos veces, o sincronizar después de importar el mismo período, no duplica **si la referencia es la
misma cadena**. De ahí salen cuatro cuidados:

1. **Una referencia canónica por pasarela, decidida antes de la primera importación real.** Stripe: el
   identificador del cobro (`ch_…` o `py_…`), que es el `source` del movimiento de saldo. PayPal:
   `transaction_id`. El importador de CSV ya sigue esta regla con el informe de saldo de Stripe: toma `source_id`
   cuando el archivo la trae y avisa cuando no. Pero deja elegir otra columna de referencia: si alguien mapea el
   identificador del movimiento (`txn_…`) y la API usa `ch_…`, el mismo cobro entra dos veces y el índice no lo ve.
2. **Cobros a mano sin referencia.** El índice no cubre las filas con referencia vacía. Antes de crear, la
   sincronización busca un cobro de la misma empresa y pasarela, misma moneda, mismo bruto, fecha a un día de
   distancia y sin referencia. Si lo hay, **no crea**: lo muestra como «posible repetido» y el dueño decide si son
   el mismo (y entonces solo se le pone la referencia). El importador de CSV ya hace esa búsqueda, aunque allí solo
   se elige importar o no.
3. **Papelera.** Un cobro en la papelera conserva su referencia, así que la sincronización no lo revive. Si se
   borra del todo, la próxima sincronización lo vuelve a crear. Hay que elegir: aceptar eso, o guardar una lista de
   referencias descartadas por conexión.
4. **Pasarela compartida.** `pay_gateways` es por usuario, no por empresa: dos empresas pueden usar la misma fila
   «Stripe». Los identificadores de Stripe y de PayPal no se repiten entre cuentas, así que el índice sigue
   sirviendo.

Antes de escribir, la sincronización muestra la misma pantalla «Así lo entendí» del importador: nuevos,
repetidos, posibles repetidos y con error. La primera vez de cada conexión, siempre. Después se puede dejar en
automático.

#### 2.5 Comisión real frente a comisión calculada

El motor ya tiene la pieza: la [comisión informada](#la-comisión-informada) (`feeOverride`). Si existe, reemplaza a
porcentaje + cuota fija en la línea «pasarela», que queda marcada como «informado».

- **Cobro nuevo desde la API**: nace con la comisión informada igual a la comisión real. Las opciones, la
  plataforma y el reparto se calculan como siempre.
- **Cobro que ya existía** (a mano o por CSV): se compara la línea «pasarela» congelada con la comisión real.
  - Si coinciden al centavo: no se toca nada. Se anota que está conciliado.
  - Si difieren: se muestra el antes y el después y el dueño decide. Al aceptar, se recalcula con **las mismas
    reglas congeladas** más la comisión informada, y queda un evento `recalculado` en el historial.

Ejemplo con el caso E1. Calculado: pasarela 3,20, neto 90,30, reparto 45,15 · 27,09 · 18,06. Si la pasarela cobró
en realidad 3,49: comisiones 9,99, neto 90,01, reparto 45,01 · 27,00 · 18,00. La diferencia de 0,29 se reparte con
los mismos porcentajes. Si el reparto ya se liquidó, el saldo de cada beneficiario se mueve: por eso **no** se
aplica solo.

Cuatro límites que hay que conocer:

1. **Falta una operación en el motor.** Recalcular hoy **descarta** la comisión informada. Hace falta una
   operación nueva, «conciliar comisión», que conserve las reglas congeladas y solo agregue la comisión informada.
   Y hay que avisar en pantalla que «recalcular con la tarifa de hoy» borra la comisión real.
2. **Solo se concilia la línea «pasarela».** La pasarela no conoce la comisión de la plataforma o del canal. Y la
   comisión de un depósito instantáneo no viene en el movimiento del cobro. Esas líneas siguen siendo calculadas.
3. **Con reembolso parcial**, el motor reparte la comisión informada en proporción. La pasarela puede haber hecho
   otra cosa. En la primera versión se concilia la comisión original y lo demás se marca «para revisar».
4. **Qué incluye `fee`.** En Stripe es todo lo cobrado por ese movimiento; `fee_details` lo separa por tipo
   (comisión de Stripe, impuesto, comisión de una aplicación) `[F4]`. Se guarda el total.

Un beneficio lateral: si la comisión real difiere de la calculada en muchos cobros seguidos, la tarifa guardada
está vieja. La app puede avisar: «la tarifa de esta pasarela parece haber cambiado».

#### 2.6 Un depósito real marca varios cobros

Tabla nueva `pay_payouts` (un depósito de la pasarela) y columna nueva `pay_transactions.payout_id`.

| Lo que dice Stripe | Lo que hace la app (con piezas del motor que ya existen) |
|---|---|
| Depósito `in_transit` | Nada todavía: aún no se sabe qué cobros cubre |
| Depósito `paid` y `reconciliation_status = completed` | Lista sus movimientos, busca cada cobro por referencia y los marca depositados con `planDeposit(cobro, fecha)`, todos en **una sola transacción**, cada uno con su evento `depositado` |
| Depósito `failed` o `canceled` después de `paid` | `planRevertDeposit` en esos cobros. Stripe avisa que un depósito puede verse `paid` y luego fallar `[F6]` |
| Un movimiento del depósito que no es un cobro conocido | Se lista como «movimiento sin cobro» para revisar. No se inventa un cobro |

**Un cobro que no admite el depósito no frena a los demás.** `planDeposit` rechaza un cobro que está en la papelera
o es fallido. Esos cobros se saltan y se listan «para revisar»; el resto del depósito se guarda. Es lo que ya hace
la capa de servidor cuando deposita varios cobros a la vez.

**Cómo se entera la app de que un depósito falló.** Pedir la lista de depósitos por fecha de creación no vuelve a
traer uno viejo que cambió de estado. Por eso cada sincronización relee, uno por uno (`GET /v1/payouts/{id}`), los
depósitos guardados que no estén cerrados (`pending`, `in_transit`) y los que lleven menos de cinco días hábiles
como `paid`: Stripe da ese plazo para que un depósito pase a `failed` o `canceled` `[F6]`.

**La fecha.** Es el **día de calendario en UTC** de `arrival_date`, sin pasarlo por ninguna zona horaria. En el
ejemplo oficial, `arrival_date` vale `1680652800`: el 5 de abril de 2023 a las 00:00 UTC. Convertido a Nueva York
daría el 4 de abril, un día antes `[F6]`. La documentación no dice de forma expresa que siempre sea la medianoche
UTC: hay que comprobarlo en un entorno de prueba. Stripe define `arrival_date` como la fecha en que **se espera**
que el dinero llegue al banco `[F6]`. No es una confirmación del banco: la app debe llamarla «fecha de depósito
según la pasarela».

**Control cruzado.** La suma del neto de los movimientos de un depósito, **sin contar el del propio depósito**
(`type = payout`, que va con signo negativo), es el monto del depósito `[F5]`. Si la app encuentra todos los cobros
y la suma no da, hay un movimiento que el libro no conoce (un reembolso, una comisión suelta, una disputa). El neto
del libro puede ser distinto del de Stripe, porque el libro además resta plataforma y opciones: se compara «bruto
menos línea pasarela», no el neto.

#### 2.7 Sincronización por pasos, con cursor, reintentos y límites

- **Por pasos.** Un paso lee hasta 500 cobros (5 páginas de 100 en Stripe, 1 de 500 en PayPal), los guarda en una
  sola transacción y solo después mueve el cursor. Si quedan más, devuelve «hay más» y la pantalla pide el
  siguiente. Ningún paso se acerca al tiempo máximo de una función de Vercel, 300 s en el plan gratis `[F23]`.
- **Con qué se guarda.** Con una función nueva que **envuelve** a `pay_save_transactions`: la llama (su tope es
  500) y, en la misma transacción, escribe las columnas nuevas de esos cobros, que la función actual no conoce
  (§7).
- **Cursor: dos datos por conexión.**
  - La **marca alta**: hasta qué fecha está todo leído. Solo avanza cuando una ventana se leyó **entera**.
  - El **cursor del paso en curso**: los límites de la ventana y el `starting_after` de la página siguiente, para
    retomar.

  Stripe lista de lo más nuevo a lo más viejo `[F3]`. Si hubiera un solo dato y avanzara en cada paso, una corrida
  cortada a la mitad dejaría sin leer la parte vieja de la ventana, y la siguiente no volvería por ella.
- **Solape.** Cada corrida relee además los últimos días ya leídos (7, a decidir), porque los estados cambian: un
  cobro pasa de pendiente a disponible, llega un reembolso. Releer es inocuo porque escribir es idempotente por
  referencia. Los depósitos tienen su propia relectura (§2.6).
- **Carga inicial.** Desde la fecha que el dueño elija («desde enero»), hacia atrás por ventanas, con una barra de
  avance. Se puede cortar y retomar.
- **Reintentos.** Ante 429 o 5xx: espera exponencial con azar, pocos intentos, y si no sale, el paso termina en
  «se retoma después» sin mover el cursor. Stripe indica el motivo en la cabecera `Stripe-Rate-Limited-Reason`
  `[F12]`.
- **Límites de Stripe.** 100 peticiones por segundo en real y 25 en prueba; 25 por segundo por endpoint; y un cupo
  de lecturas de 500 por transacción de media en 30 días, con un mínimo de 10 000 al mes `[F12]`. Un libro que
  sincroniza unas veces al día queda muy lejos. Las listas y los `expand` son las peticiones más pesadas `[F12]`:
  otra razón para no expandir.
- **Un candado por conexión**, para que dos pestañas no sincronicen a la vez. Los pasos son peticiones separadas,
  así que un bloqueo de la base que dure una transacción no alcanza. El candado es un dato de la fila de la
  conexión: quién lo tiene (el identificador de la corrida) y hasta cuándo. Se toma con una actualización
  condicionada («solo si está libre o ya caducó»), cada paso lo renueva y al terminar se suelta. Caduca a los
  pocos minutos, para que una pestaña cerrada no deje la conexión trabada.
- **Si aun así dos corridas chocan.** `pay_save_transactions` primero busca la referencia y después inserta. Si
  dos corridas insertan el mismo cobro a la vez, la segunda choca con el índice único y **cae su lote entero**
  (hasta 500 cobros). Falla seguro: no se duplica nada. El paso se reintenta y, la segunda vez, encuentra los
  cobros ya guardados y los salta.
- **Registro de corridas** (`pay_sync_runs`): cuándo, cuántos nuevos, repetidos y con error, y el mensaje del
  último fallo. Sin cuerpos de respuesta. La fila se inserta **al terminar** cada paso, ya completa; nunca se
  actualiza.

**Quién escribe.** En esta parte, **la sesión del dueño**. El botón «Sincronizar» es una acción del servidor:
verifica la sesión, lee el secreto en el servidor, llama a la pasarela y escribe con funciones `security invoker`.
RLS y segundo factor siguen aplicando tal cual. No hace falta clave de servicio.

Sincronizar **sin** que el dueño abra la app (una tarea programada) es otra cosa: no hay sesión. Se trata en §3.
Además, en el plan gratis de Vercel una tarea programada corre como mucho una vez al día y sin hora exacta
`[F24]`.

### 3. Webhooks

Un webhook es un aviso que la pasarela manda a una dirección pública de la app cuando pasa algo.

Primero la crítica: **para un libro de un solo dueño, los webhooks aportan poco.** Avisan al instante de algo que
la sincronización a pedido va a encontrar igual cuando el dueño abra la app. No hay nadie mirando a las tres de la
mañana, y la app no manda notificaciones. A cambio obligan a tener un endpoint público y a resolver quién escribe
sin sesión. La recomendación es dejarlos para el final, o no construirlos. Si se construyen, así:

#### 3.1 Endpoint

- Un **Route Handler** de Next: `src/app/pasarelas/webhooks/[proveedor]/[conexion]/route.ts`, con `POST`. La
  dirección lleva el identificador opaco de la conexión (un uuid), no el nombre de la empresa. Al construirlo
  hay que comprobar en la compilación que la ruta no choca con las pantallas de `/pasarelas`.
- Queda **fuera de la sesión**: una pasarela no trae cookie. Hoy `src/proxy.ts` manda a `/login` todo lo que llega
  sin sesión: hay que agregarle esta ruta como excepción.
- Corre en Node. Solo acepta `POST`, con un tope de tamaño de cuerpo.

**Cómo sabe qué secreto de firma usar, sin sesión.** Cada endpoint registrado en la pasarela tiene su propio
secreto de firma `[F8]`. El manejador no puede leer la fila de la conexión antes de verificar: sin sesión, la RLS
no le deja nada al rol `anon`. Por eso el nombre de la variable sale del propio uuid de la dirección, igual que
la clave (§4):

1. Si ese tramo de la dirección no tiene forma de uuid: responde 400.
2. Busca la variable de entorno del secreto de firma de ese uuid. Si no existe, responde **lo mismo** que ante una
   firma inválida (400), sin decir si la conexión existe.
3. Verifica la firma (§3.2).
4. Encola el evento (§3.3).

#### 3.2 Verificar la firma sobre el cuerpo crudo

En un Route Handler el cuerpo crudo se lee con `await request.text()`; no hace falta ninguna configuración extra
`[F26]`. **No** se llama a `request.json()` antes: la firma se calcula sobre los bytes tal como llegaron.

**Stripe** `[F8]`:

- Cabecera `Stripe-Signature`, con una marca de tiempo (`t=`) y una o más firmas (`v1=`).
- La firma es HMAC-SHA256 del texto `marca_de_tiempo.cuerpo_crudo`, con el secreto del endpoint (`whsec_…`).
- Se compara en tiempo constante y se rechaza si la marca tiene más de 5 minutos, que es la tolerancia por defecto
  de las librerías de Stripe. Eso corta las repeticiones de un mensaje viejo.
- Stripe recomienda usar su librería oficial para esto. Sería una dependencia nueva. La verificación manual está
  documentada y son pocas líneas. Decisión menor, para cuando se construya.
- El secreto se puede rotar dejando el anterior activo hasta 24 horas: durante ese tiempo hay dos válidos.
- **Stripe pide dos protecciones, no una**: la firma y aceptar solo las direcciones IP desde las que envía
  webhooks `[F8]`. Publica la lista, también como archivo, y avisa de los cambios con siete días `[F33]`. Se puede
  filtrar en el cortafuegos de la plataforma (**no confirmado** que el plan lo permita) o en el propio manejador,
  comparando la dirección de origen que informa la plataforma con la lista. La lista hay que mantenerla al día: si
  queda vieja se pierden avisos, que la sincronización recupera. Se recomienda ponerla. Si se decide no hacerlo,
  hay que dejar escrito por qué.

**PayPal** `[F17]`:

- Cabeceras `paypal-transmission-id`, `paypal-transmission-time`, `paypal-transmission-sig` y `paypal-cert-url`.
- Se firma el texto `id_de_transmisión|hora|id_del_webhook|CRC32_del_cuerpo_crudo`, y se verifica con la clave
  pública del certificado. El identificador del webhook no viene en el mensaje: se guarda al registrarlo.
- Alternativa: devolverle el mensaje a PayPal (`POST /v1/notifications/verify-webhook-signature`) y que PayPal diga
  si es suyo. No sirve con los mensajes de prueba del simulador.
- **PayPal prefiere la verificación propia** («self cryptographic verification is the preferred method») `[F17]`.
  Este diseño elegiría la devolución a propósito, por un riesgo de la otra: `paypal-cert-url` llega **en la
  petición**. Si se verifica en local, hay que comprobar que esa dirección es de PayPal antes de bajar el
  certificado. Si no, un atacante firma con el suyo.
- La devolución tiene su costo: es otro `POST`, necesita un token y, previsiblemente, un permiso que no es de
  informes (**no confirmado** cuál). Choca con la regla de §2.3 de rechazar los permisos de más.

Si la firma no vale: 400, y no se registra nada del cuerpo.

#### 3.3 Idempotencia, orden y respuesta rápida

- **Tabla de eventos recibidos** (`pay_webhook_events`), con único por `(conexión, id_del_evento)`. Insertar un
  evento repetido no hace nada y se responde 200. Stripe avisa que puede entregar el mismo evento más de una vez, y
  que a veces son dos eventos distintos sobre el mismo objeto `[F8]`.
- **El evento es un timbre, no un dato.** La tabla guarda el id del evento, el tipo, el id del objeto y la hora.
  **No guarda el cuerpo.** Al procesarlo, la app vuelve a leer en la API y converge al estado actual, con el mismo
  código de la sincronización. Con eso:
  - **El orden deja de importar.** Stripe no garantiza el orden de entrega `[F8]` `[F9]`. Si llega el reembolso
    antes que el cobro, da igual: se lee el estado actual.
  - **Los repetidos son inocuos**: escribir es idempotente por referencia.
  - **Un evento falso que pasara la firma no puede inventar nada**: solo provoca una lectura que no encuentra
    cambios.
  - **Los datos del comprador que vengan en el evento no se guardan nunca.**
- **Eventos ligeros de Stripe.** Stripe ofrece dos formatos. El «snapshot» trae el objeto entero dentro del evento;
  el ligero («thin») solo trae identificadores, y es el que Stripe recomienda para integraciones nuevas `[F9]`.
  Con el ligero, **los datos del comprador ni siquiera llegan al endpoint**. Existen en formato ligero los eventos
  que hacen falta (§3.4) `[F11]`. **No confirmado:** que la verificación manual de la firma sea idéntica en los dos
  formatos; con la librería oficial sí está documentada `[F8]`.
- **Responder rápido.** El manejador hace tres cosas: verifica, inserta la fila y responde 200. Stripe pide el 2xx
  antes de cualquier trabajo largo `[F8]`. Si la inserción falla, responde 500 para que la pasarela reintente:
  Stripe reintenta hasta tres días `[F8]`; PayPal, hasta 25 veces en tres días `[F17]`.
- **Proceso aparte.** La fila queda `pendiente`. Se procesa después, por uno de los caminos de §3.5. Next tiene
  `after()` para seguir trabajando tras responder, pero dura como mucho lo que dura la función `[F26]` y no
  reintenta: sirve de atajo, no de garantía.
- **Red de seguridad.** Si un webhook se pierde, la sincronización por cursor lo recupera igual. Los eventos de
  Stripe además se pueden volver a pedir por API durante 30 días `[F9]`, con el permiso que corresponda (§3.4).
- **Limpieza.** Los eventos procesados se borran pasados unos 90 días. Los borra la sesión del dueño, al
  sincronizar: la tabla le da permiso y política de borrado sobre sus propias filas. No hace falta clave de
  servicio ni una tarea sin sesión. Los eventos no llevan cuerpo, así que borrarlos no pierde nada del libro.

#### 3.4 Qué eventos escuchar

Solo los necesarios; Stripe pide no suscribirse a todo `[F8]`.

| Pasarela | Eventos | Para qué |
|---|---|---|
| Stripe, formato ligero `[F11]` | `v1.charge.succeeded` | Cobro nuevo |
| | `v1.charge.refunded` | Reembolso total o parcial |
| | `v1.charge.dispute.created`, `v1.charge.dispute.closed` | Disputa abierta y cerrada (ganada o perdida) |
| | `v1.payout.paid`, `v1.payout.failed` | Depósito hecho o fallido |
| | `v1.payout.reconciliation_completed` | Ya se puede pedir qué movimientos cubre el depósito |
| PayPal `[F18]` | `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.SALE.COMPLETED` | Cobro nuevo |
| | `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `PAYMENT.SALE.REFUNDED`, `PAYMENT.SALE.REVERSED` | Reembolso o reverso |
| | `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.RESOLVED` | Disputa |

Sobre los nombres de Stripe: en el formato ligero llevan el prefijo `v1.`. Sin prefijo (`charge.succeeded`,
`payout.paid`…) son los del formato «snapshot» `[F10]`.

El evento de un cobro fallido no se escucha: un intento fallido no mueve dinero y solo llenaría el libro de ruido.
Stripe admite hasta 16 destinos de eventos por cuenta `[F9]`; con una cuenta por empresa sobra.

**Releer un evento pide permiso sobre su recurso.** Para volver a pedir un evento por API, una clave restringida
necesita Lectura sobre el recurso del evento `[F9]`. Con la clave de nivel 1 no se pueden releer los de cobros. No
hace falta: el evento es un timbre, y lo que se lee después son los movimientos de saldo y los depósitos, que el
nivel 1 sí alcanza.

Límites de PayPal que hay que saber:

- **No hay evento para un retiro al banco** en la lista oficial `[F18]`. Los depósitos de PayPal no se enteran por
  webhook.
- Aunque llegue el aviso del cobro, la búsqueda de transacciones tarda hasta tres horas en mostrarlo `[F13]`. El
  webhook de PayPal adelanta el aviso, no el dato.
- **No confirmado:** que una aplicación REST reciba los eventos de cobros que no se crearon con esa misma
  aplicación (botones, facturas, otras integraciones). Si no los recibe, el webhook de PayPal no sirve para este
  caso y queda solo la lectura periódica.

Conclusión: **en PayPal no merece la pena el webhook.** En Stripe es opcional.

#### 3.5 RLS: quién escribe cuando no hay sesión

Un webhook no trae usuario. `auth.uid()` es nulo, y todas las políticas de las tablas `pay_*` exigen
`user_id = auth.uid()`. Hay tres salidas. En la tabla, una **ficha** es un secreto largo que solo conoce el
servidor y que presenta en cada llamada.

| | A. Clave de servicio de Supabase en el servidor | B. Función acotada + ficha del servidor | C. El webhook solo encola; procesa la sesión del dueño |
|---|---|---|---|
| Cómo | El servidor usa `SUPABASE_SECRET_KEY`. El rol `service_role` se salta la RLS `[F35]` | Una función nueva hace una sola cosa. La llama el rol `anon` con la ficha, que el servidor guarda en una variable de entorno. La base guarda solo su hash (ver abajo) | El webhook llama a una función que **solo inserta** en `pay_webhook_events`. Al abrir la app, la sesión del dueño procesa lo pendiente |
| Qué puede hacer quien robe la credencial | **Todo**: leer y escribir cualquier tabla del proyecto, los archivos, y administrar usuarios (crear, borrar, quitar el segundo factor) | Solo lo que haga la función. Si es «encolar»: meter eventos falsos, que no cambian nada. Si es «aplicar una sincronización»: escribir cobros falsos en el libro, pero no leer nada ni tocar usuarios | Meter eventos falsos en la cola. Nada más |
| RLS y segundo factor | Dejan de proteger ese camino | Siguen intactos para todo lo demás | Intactos: toda escritura de cobros pasa por el dueño con su segundo factor |
| Sirve sin que el dueño abra la app | Sí | Sí, si hay una segunda función que aplica | No: lo pendiente espera a que entre |
| Trabajo | Poco al principio, pero `pay_save_transactions` no sirve así (exige sesión: `pay_no_session`) y `user_id` no se llenaría solo. Igual hay que escribir funciones nuevas | Medio: una o dos funciones, con pruebas de que no hacen nada más | Poco |
| Reglas que cambia | «Nada de `service_role` en tiempo de ejecución» (principio 5 del spec) | «Rol `anon`: nada» pasa a tener una excepción escrita | La misma excepción, la más chica posible |

**A es mala idea aquí.** Es la llave de todo: de este libro, de cualquier otra cosa que viva en el mismo proyecto
de Supabase y de la administración de usuarios. Convertiría la filtración de una variable en la pérdida completa.
Y no ahorra el trabajo.

**Recomendación: C.** El webhook solo encola, con una función mínima. Los cobros los sigue escribiendo el dueño
con su sesión. Se pasa a B (con una función de «aplicar» acotada y su propia ficha) solo si aparece una necesidad
real de tener el libro al día sin que el dueño entre: por ejemplo, que un socio mire su saldo y el dueño lleve días
sin abrir la app.

**La función de C, en detalle.**

- **Qué hace.** Comprueba la ficha contra su hash, comprueba que la conexión existe y está activa, inserta la fila
  con el `user_id` del dueño de la conexión y no devuelve nada. Responde igual si la conexión no existe. Sus
  pruebas tienen que demostrar que no puede leer ni escribir otra cosa.
- **Dónde vive.** El rol `anon` no tiene acceso al esquema `private` (la migración solo se lo da a `authenticated`
  y a `service_role`). Una envoltura `security invoker` en `public`, llamada por `anon`, no podría ejecutar una
  función de `private`. Hay dos formas, y las dos amplían la excepción:
  1. que la función de `public` sea ella misma `security definer`, con `search_path` vacío y permiso de ejecución
     solo para `anon` (recomendada: `private` sigue cerrado para `anon`);
  2. darle a `anon` acceso al esquema `private` y permiso de ejecución sobre esa única función.

  Cualquiera de las dos cambia también otra frase del diseño: «en `public` solo quedan las tres funciones que la
  app llama» (spec §4.2). Hay que dejarlo escrito.
- **Dónde vive el hash de la ficha.** En una tabla del esquema `private`, sin ningún permiso para `anon` ni para
  `authenticated`: solo la lee la función. No es una tabla `pay_*` de `public` ni tiene dueño por fila, así que es
  una excepción escrita a «cada fila es de un usuario», y la comprobación final de la migración no la mira. El
  hash lo carga quien administra el proyecto, por SQL; la app no puede. La alternativa es guardarlo en Vault (§4).
- **Cómo se rota la ficha.** La tabla admite dos hashes a la vez, el nuevo y el anterior con fecha de caducidad:
  se carga el nuevo, se cambia la variable de entorno, se despliega y se deja caducar el viejo.

### 4. Dónde guardar los secretos

**Hoy.** La regla es «sin secretos» ([Sin secretos en la aplicación](#sin-secretos-en-la-aplicación)): de Supabase
la app solo lee la URL y la clave publicable. Nada secreto en Postgres.

**Cuántos secretos son.** Por cada cuenta conectada: en Stripe, la clave restringida y, si hay webhooks, el secreto
de firma; en PayPal, el secreto de la aplicación (el identificador de cliente y el del webhook no son secretos).
Con 5 empresas en dos pasarelas: entre 10 y 15. Más uno o dos de toda la app (la clave de la IA y, si hay
webhooks, la ficha del servidor).

**Un hecho que condiciona la comparación.** Si los secretos viven en la base y el servidor no tiene ninguna
credencial propia, la única forma de leerlos es una función que el rol `authenticated` pueda llamar. Esa función
también se puede llamar **desde el navegador** del dueño, con su sesión. Es decir, una clave de Stripe quedaría al
alcance de un script malicioso en su navegador. Para evitarlo, el servidor necesita **al menos un secreto propio en
una variable de entorno** (una ficha). La opción (b) no elimina las variables secretas: las reduce a una.

| | (a) Variables de entorno en Vercel, por empresa y pasarela | (b) Supabase Vault | (c) Gestor de secretos externo |
|---|---|---|---|
| Qué es | Una variable por secreto, de tipo «Secret» y solo en Producción. Su nombre sale del identificador de la conexión | Extensión de Postgres: los secretos se guardan cifrados en disco y se leen descifrados por la vista `vault.decrypted_secrets` `[F19]` | Un servicio aparte que guarda secretos, con permisos, versiones y registro de accesos |
| Quién puede leerlo | El código que corre en ese proyecto y ese entorno. Las personas no: un «Secret» solo se puede escribir después de guardado `[F20]` `[F21]`. Ojo: si la variable también se aplica a «Preview», el código de **cualquier rama** la lee | Quien tenga permiso sobre la vista: Supabase advierte que hay que protegerla siempre `[F19]`. En la práctica, las funciones que se escriban para eso y quien tenga acceso de administración al proyecto. **No confirmado:** qué roles la leen por defecto | Las identidades que el gestor autorice. Desde Vercel se puede entrar sin credencial fija, con fichas de corta vida (federación OIDC, en todos los planes) `[F25]` |
| A quién pertenece cada secreto | **Punto débil:** una variable de Vercel no está atada a un usuario. Es el código el que decide qué usuario usa cuál (ver «El punto débil de (a)») | La función ata el secreto al dueño de la conexión: solo se lo da a su sesión | Igual que (a): lo decide el código |
| Cómo se rota | Clave nueva en la pasarela → editar la variable → **volver a desplegar** (los cambios solo valen para despliegues nuevos) → comprobar → caducar la vieja `[F20]` `[F22]`. Stripe deja convivir las dos hasta 7 días `[F2]` | Desde una pantalla de la app (`vault.update_secret`). Sin desplegar. Vale al instante `[F19]` | En el gestor. Sin desplegar. Con historial de versiones |
| Si se filtra la base (una copia, un volcado) | **Nada**: los secretos no están ahí | La copia sale **cifrada** y la llave no vive en la base `[F19]`. Pero si lo comprometido es el **proyecto** (panel o clave de servicio), se leen todos | **Nada** |
| Si se compromete el proyecto de Vercel | Quien pueda desplegar código lee **todos** los secretos de todas las empresas de una vez | Se filtra la ficha del servidor. Con ella sola no alcanza: la función pide además la sesión del dueño con su segundo factor | Quien pueda desplegar código puede pedir los secretos que ese proyecto tenga permitidos. No hay secretos guardados en Vercel, el acceso queda registrado y se corta desde el gestor |
| Alta de una empresa nueva | Crear la conexión en la app (da su identificador), crear la clave en la pasarela, agregar 1 a 3 variables en Vercel con ese identificador y volver a desplegar. Lo hace quien administra Vercel, no el dueño desde el celular | Todo en la app: pegar la clave en un formulario. Sin desplegar | Agregar los secretos en el gestor con el nombre acordado y crear la conexión en la app. Sin desplegar |
| Límites | 64 KB en total por despliegue `[F20]`: cientos de secretos, sobra | Restaurar un volcado en **otro** proyecto no trae la llave: hay que volver a cargar los secretos o copiar la llave raíz `[F19]`. Afecta mudar de proyecto | Otra cuenta, otro proveedor, configuración de permisos, una dependencia nueva y un costo mensual (**no confirmado**: depende del proveedor) |
| Qué regla hay que cambiar | La regla 5 pasa de «la app no lee secretos» a «además, secretos de pasarela **solo en el servidor**». «Nunca en Postgres» **se mantiene**. No hace falta clave de servicio | Solo «nunca en Postgres», que pasa a «solo en Vault, nunca en tablas `pay_*`». Con sincronización a pedido no cambia «`anon`: nada» ni «nada de `service_role`» (ver «Lo justo sobre (b)») | La regla 5 pasa a «los secretos viven fuera de la app y de la base». «Sin dependencias nuevas» también cede |
| En local | `.env.local`, con claves de prueba | **No confirmado** que la extensión venga en el Supabase local: se comprueba con una consulta antes de contar con ella | Hay que simularlo o usar variables en local |

**El punto débil de (a), y cómo se cierra.** Cualquier usuario con sesión puede crear filas con su propio `user_id`:
es lo que piden las políticas actuales. Si la tabla de conexiones guardara el nombre de la variable, un usuario
que no es el dueño (un socio, §6) podría crear su propia conexión con el nombre de la variable de otra empresa,
pulsar «Sincronizar» y hacer que el servidor lea con la clave del dueño hacia su libro. Por eso:

- **El servidor nunca lee de una columna que el usuario escribe de dónde sacar un secreto.** El nombre de la
  variable se arma con el `id` de la conexión (por ejemplo, `PAY_STRIPE_KEY__` más el uuid sin guiones). El `id`
  es la clave primaria de la tabla: es único en toda la base, así que otro usuario no puede crear una conexión con
  el mismo. La alternativa es una lista fija, en el servidor, de conexión → variable.
- Antes de leer la variable, el servidor lee la fila de la conexión con la sesión del usuario. Si la RLS no se la
  deja ver, no sigue.
- Si conviven (a) y la vista del socio, la política que impide escribir a un socio (§6) deja de ser opcional: es la
  segunda barrera.

**Lo justo sobre (b).** Con sincronización a pedido, la función que lee de Vault se le da solo a `authenticated` y
exige tres cosas a la vez: la sesión del dueño de la conexión, que esa sesión sea `aal2` y la ficha del servidor.
No hace falta `anon` ni clave de servicio. `anon` solo entra si hay webhooks o tareas sin sesión, igual que en
(a). Tres cuidados:

- La ficha viaja como argumento de la función, y la clave viaja del navegador al servidor y a Postgres al
  guardarla. Hay que cuidar que no queden en ningún registro (**no confirmado** qué registra Postgres de esas
  sentencias).
- Un formulario donde se pega una clave invita a pegar la que no es: la app rechaza por prefijo todo lo que no sea
  una clave restringida, y la comprueba al conectar (§2.2).
- El secreto de firma de un webhook se necesita sin sesión (§3.1): ese se queda en una variable de entorno también
  con (b).

#### Recomendación razonada

**Empezar con (a), detrás de una sola puerta en el código.** Un módulo solo de servidor con una función del estilo
`leerSecreto(conexión, tipo)`. El resto del código no sabe de dónde sale el secreto. Cambiar después a (b) o a (c)
es tocar ese archivo.

Por qué (a) primero:

- Mantiene la regla más valiosa: **ningún secreto en la base**. Y no obliga a tener clave de servicio.
- Si se queda en sincronización a pedido (§2.7), **no agrega ninguna credencial capaz de saltarse la RLS**.
- Es lo que menos piezas tiene, y con pocas empresas el alta manual es tolerable.

Dos matices para no vender (a) de más:

- Su punto débil, el de arriba: el secreto no está atado a un usuario. Se cierra con la regla del nombre, pero
  depende de que el código la cumpla. En (b) lo hace cumplir la base.
- Stripe aconseja guardar las claves en la bóveda de secretos de la plataforma donde corre la app, y usar
  variables de entorno solo si no hay bóveda `[F1]`. Las variables «Secret» de Vercel (cifradas, de solo escritura
  para las personas) son lo más parecido que ofrece esa plataforma, pero no dan versiones ni registro de lecturas.
  Eso es justo lo que agrega (c).

Cuándo deja de servir (a): cuando el dueño quiera dar de alta empresas él mismo, sin depender de quien administra
Vercel, o cuando sean tantas que desplegar por cada una moleste. Ahí el paso natural es **(b) con una ficha propia
del servidor**, no con la clave de servicio.

**(c)** solo se justifica si llega a haber un equipo, o si alguien exige registro de quién leyó qué. Para un dueño
con unas cuantas empresas es más maquinaria que problema.

Cuidados de (a), cualquiera sea el caso:

- Variables de tipo «Secret» y **solo en Producción**. En «Preview», claves de prueba.
- El nombre de la variable no lleva el nombre real de la empresa: lleva el identificador de la conexión. El repo es
  público y los nombres de variables acaban en mensajes de error.
- La tabla de conexiones no guarda ni el secreto ni el nombre de la variable. Sus campos de texto rechazan
  cualquier cosa con forma de clave (`sk_`, `rk_`, `whsec_`).
- Rotar al menos una vez al año y cada vez que cambie quién tiene acceso a Vercel.

Lo que el dueño tiene que decidir sobre los secretos está en [§9](#9-lo-que-el-dueño-tiene-que-decidir), preguntas
3 a 5.

### 5. Leer comprobantes con IA

**Qué es.** De la foto o el PDF de un comprobante sale una **propuesta** de monto, fecha, moneda y referencia. La
persona la revisa y confirma. **Nunca se guarda sola.**

**Flujo.**

1. En «Registrar cobro», la persona adjunta el comprobante. Como ya pasa hoy, el navegador achica la imagen a
   1600 px y la vuelve a codificar, lo que le quita los metadatos.
2. Aparece un botón **«Leer comprobante»**. No se lee solo al subir: mandar el archivo fuera es una decisión de la
   persona, cada vez.
3. Una acción del servidor verifica la sesión, baja el archivo de Storage con la sesión del usuario y lo manda al
   proveedor de IA con una instrucción fija.
4. La respuesta se valida contra un esquema: cada campo trae su valor **como texto, tal como está impreso**, o «no
   encontrado». El monto se convierte con `parseMoney`. Nunca se le pide a la IA un número: sería pasar el dinero
   por `number`.
5. El formulario se llena con los campos que pasaron la validación, marcados como «propuesto», con la imagen al
   lado para comparar.
6. La persona corrige y pulsa «Registrar». De ahí en adelante todo es igual que al registrar a mano: el servidor
   vuelve a leer la configuración y recalcula.

**Qué se manda fuera y qué no.**

| Se manda | No se manda |
|---|---|
| El archivo del comprobante, solo cuando la persona lo pide | Nombres de empresas, pasarelas, socios o cuentas destino |
| Una instrucción fija, igual para todos | Otros cobros, montos del libro, configuración |
| | Quién es el usuario |

El problema de fondo: **un comprobante puede traer datos de un tercero** (el nombre de quien pagó, parte de su
cuenta, su teléfono). Mandarlo a un proveedor es compartir datos de esa persona. Cuidados:

- **Apagado por defecto.** Se enciende en Ajustes, con un texto claro de qué sale y a dónde.
- **Recortar antes de enviar** (opcional y barato): que la persona marque la zona del monto y la fecha, y solo
  salga ese recorte.
- Elegir el proveedor con tres condiciones por escrito: que **no entrene** con lo enviado por API, cuánto tiempo
  **retiene** las peticiones y en qué región procesa. **No confirmado:** ninguna de las tres se comprobó con
  ningún proveedor; hay que leerlas en su página oficial cuando se elija uno.
- La propuesta **no se guarda** en la base. El archivo ya está en Storage.
- El comprobante es contenido no confiable: puede traer texto escrito para engañar a la IA. La IA no tiene
  herramientas ni acceso a nada, su respuesta se valida contra el esquema y nunca se pinta como HTML. Lo peor que
  puede pasar es una propuesta equivocada, que la persona ve.

**Alternativa sin enviar nada:** leer el texto en el propio navegador y buscar monto y fecha con reglas. No sale
ningún dato y no cuesta por uso. Lee peor las fotos torcidas y los formatos raros, y suma una librería pesada. Vale
la pena probarla primero si los comprobantes del dueño son siempre capturas de las mismas dos o tres aplicaciones.

**Dónde vive la clave.** En una variable de entorno del servidor, de tipo «Secret» y solo en Producción. Es **una**
para toda la app, no una por empresa. Con un tope de gasto puesto en la consola del proveedor y un límite de
lecturas por día en la app.

**Dónde vive el interruptor.** En la base, no en una variable de entorno: cambiar una variable exige volver a
desplegar `[F20]`. Es una tabla nueva de ajustes por usuario, `pay_settings`, con RLS y segundo factor como las
demás: guarda si la lectura con IA está encendida y el límite de lecturas por día. Para contar las lecturas del
día hace falta la tabla `pay_ai_reads` (§7): con límite diario deja de ser opcional.

**Costo. No confirmado.** No se consultó la tarifa de ningún proveedor: no está elegido. Como orden de magnitud,
estimación propia: una imagen de ese tamaño ocupa unos pocos miles de unidades de texto de entrada y la respuesta
es corta, lo que suele costar entre una fracción de centavo y unos pocos centavos de dólar por comprobante, según
el tamaño del modelo. Un PDF de varias páginas cuesta más: cada página cuenta. Hay que calcularlo con la tarifa
oficial del proveedor que se elija antes de encender la función.

**Cómo se prueba.**

- **Sin llamar a nadie** (lo que corre siempre): el lector es una interfaz. En las pruebas se cambia por uno falso
  que devuelve respuestas preparadas: buenas, incompletas, con formato roto, con texto malicioso. Se prueba la
  validación, la conversión del monto y el llenado del formulario. La prueba de punta a punta usa el lector falso.
- **Contra el proveedor real** (a mano, no en cada cambio): un juego de comprobantes **inventados** («Tienda Demo»,
  montos inventados, `@example.com`) con su respuesta esperada. Se mide por campo el acierto exacto: el monto, al
  centavo. Nunca comprobantes reales en el repo.
- **Vara para encender la función:** que el monto acierte en casi todos los casos del juego, y que cuando falle,
  falle hacia «no encontrado» y no hacia un número equivocado. Un número equivocado que parece bueno es el peor
  resultado.

**Cuando la lectura no es fiable.**

- **Por campo, no por comprobante.** Lo que no se lee o no pasa la validación queda **vacío**, con un aviso («no
  pude leer el monto»). Nunca se rellena con una suposición.
- Validaciones que vacían el campo: monto que no se puede convertir o es cero; fecha futura o muy vieja; moneda que
  no es un código de tres letras; dos montos distintos en el mismo comprobante sin saber cuál es el total.
- Si la referencia leída ya existe en esa pasarela, se avisa **antes** de guardar. La base lo rechazaría igual.
- Se cuenta cuántas veces la persona corrige cada campo (el conteo, no el contenido). Si el monto se corrige a
  menudo, la función se apaga y se revisa.
- Se apaga desde Ajustes, sin desplegar código nuevo.
- Teclear a mano sigue siendo siempre posible. La IA ahorra tiempo; no es un requisito.

### 6. Vista de solo lectura para un socio

Un **socio** es la persona que está detrás de un beneficiario y a la que el dueño le da una cuenta para mirar lo
suyo.

**Qué ve y qué no.**

| Ve | No ve |
|---|---|
| Sus repartos: fecha del cobro, moneda, lo que le tocó, su porcentaje y si fue sobre neto o bruto | Los cobros de empresas donde no participa |
| Sus liquidaciones: fecha, monto y moneda | Lo que les toca a los demás beneficiarios, ni sus nombres |
| Su saldo por moneda (asignado, liquidado, saldo) | Las comisiones y el desglose del cobro |
| A decidir: el nombre de la empresa de cada reparto, y el bruto del cobro | Las cuentas destino, las pasarelas, los enlaces, las notas del dueño, los comprobantes |

No puede crear, editar ni borrar nada. No ve Resumen, Cobros, Empresas ni Ajustes del dueño.

**El problema con hacerlo solo con RLS.** La RLS decide **filas**, no **columnas**. Y las filas que el socio
necesita traen columnas que no debe ver:

- `pay_transactions` trae las comisiones, la cuenta destino y `breakdown`, que guarda las reglas congeladas con
  **los nombres y porcentajes de todos los beneficiarios**.
- `pay_beneficiaries` trae `notes` y `account_alias`: lo que el dueño anotó sobre ese socio.
- `pay_settlements` trae `note`, `method` y la ruta del comprobante.

Dar permisos por columna tampoco sirve: el dueño y el socio entran con el mismo rol de Postgres
(`authenticated`). Y una vista con `security_invoker`, como las de totales de hoy, respeta la RLS de quien
consulta: el socio no vería nada.

**Modelo propuesto.** No se toca ninguna política de las 17 tablas actuales. «Cada fila es de un usuario» sigue
siendo verdad sin excepciones.

1. **Tabla de accesos** `pay_partner_access`: fila **del dueño** (`user_id` del dueño, como todas), con el
   beneficiario (clave foránea compuesta con `user_id`, así no puede apuntar al beneficiario de otro usuario), el
   `uuid` del usuario invitado y las fechas de alta y de **revocación**. Lleva las políticas de siempre: solo el
   dueño la lee y la escribe, con su segundo factor.
2. **Funciones de lectura acotadas**, en vez de políticas nuevas. Viven en `private`, son `security definer`, con
   `search_path` vacío y sin parámetros que elijan de quién son los datos: miran `auth.uid()`, buscan sus accesos
   vigentes y devuelven **solo las columnas permitidas**. Serían tres: repartos, liquidaciones y saldo.
3. **Con el mismo filtro que la vista de saldos de hoy.** Las tres dejan fuera los cobros de la papelera y los
   fallidos (`deleted_at is null and status <> 'fallido'`). Si no, la lista de repartos del socio no cuadra con su
   saldo. Hay que probarlo.
4. **Cómo las llama la app.** En `public` va una envoltura `security invoker` por cada una. Aquí sí sirve, porque
   el rol `authenticated` ya tiene acceso al esquema `private`; hay que darle además permiso de ejecución sobre
   esas tres funciones. Es un patrón **nuevo**: `private.pay_mfa_ok()` no tiene envoltura en `public`, solo se
   llama desde las políticas. Que funcione igual llamado por la API hay que probarlo en local.
5. **«Vistas».** Si se prefiere una vista a una función, tiene que ser una vista que **no** sea `security_invoker`
   y que filtre ella misma por `auth.uid()`. Funciona, pero corre con los permisos de su dueño y un descuido en el
   filtro expone todo. La función es más fácil de revisar y de probar.
6. **Solo lectura por construcción.** El socio no recibe ninguna política de escritura sobre datos del dueño. Las
   funciones solo hacen `select`.

**La alternativa, y por qué no.** Agregar políticas de lectura para el socio en `pay_allocations`,
`pay_settlements` y `pay_beneficiaries` es menos código. Pero deja ver las notas del dueño y las rutas de los
comprobantes, cambia el modelo de las tablas existentes y obliga a repasar todas las pruebas de RLS. No se
recomienda.

**El segundo factor.** La regla de hoy es «aal2 si el usuario tiene un factor verificado». Un socio que nunca
active el suyo entraría solo con contraseña. Para una puerta nueva hacia datos de dinero, la recomendación es
**exigirlo siempre al socio**: las funciones de lectura comprueban `aal2` y, sin factor, la app lo lleva a
activarlo antes de mostrar nada.

**Un efecto que hay que cerrar.** Un socio es un usuario normal de Supabase. Las políticas actuales le dejan crear
**su propio** libro (filas con su `user_id`) y subir archivos a su carpeta. No ve nada del dueño, pero puede
gastar espacio y, con secretos en variables, es la puerta del punto débil de §4. Dos medidas:

- En la app: si el usuario es socio, solo existe para él la sección «Mi reparto».
- En la base: una política **restrictiva** nueva que niegue escribir a quien sea socio, en las tablas `pay_*` y en
  Storage. Es una política añadida, no cambia las del dueño. En `storage.objects` va **acotada al bucket**: solo
  niega cuando `bucket_id = 'comprobantes'`. Sin esa condición afectaría a todos los buckets del proyecto de
  Supabase, y Pasarelas tiene que poder convivir con otras cosas en el mismo proyecto (spec §2, principio 7).

**Cómo sabe la base quién es socio.** No puede salir de la tabla de accesos. Cualquier usuario puede crear en su
libro una fila de acceso con el `uuid` de otro: con eso lo convertiría en «socio» y le bloquearía la escritura de
su propio libro. La marca tiene que estar donde solo llegue quien administra el proyecto: en los datos de
aplicación de la cuenta (`app_metadata`), que el usuario no puede cambiar `[F36]`. Se pone al crear la cuenta del
socio en el panel, y la política la lee de la sesión. Las funciones de lectura exigen la misma marca: así un `uuid`
mal copiado, que resulte ser de otro dueño, no le enseña nada. Dos consecuencias:

- **Una cuenta es de dueño o es de socio, no las dos cosas.** Un dueño que además participe en el libro de otro
  necesita una segunda cuenta para mirar ese reparto.
- Hay que probarlo en local antes de darlo por bueno.

**Cómo se da el acceso.**

1. La cuenta del socio se crea como se crea la del dueño: desde el panel de Supabase, con su marca de socio. El
   registro público sigue apagado. La app no puede crear usuarios porque no tiene clave de administración, y eso
   está bien.
2. El dueño, en Repartos → beneficiario → «Dar acceso», pega el `uuid` de esa cuenta, copiado del panel. Se crea
   la fila de acceso. No hay un paso de «reclamar» la invitación.
3. En su primer ingreso, al socio se le pide activar el segundo factor.

**Por qué por `uuid` y no por correo.** Enlazar al socio por su correo deja un hueco: un usuario ya creado puede
cambiar su propio correo, poner el de otra invitación pendiente y quedarse con ese acceso. En el Supabase local,
además, la confirmación de correo está apagada (`enable_confirmations = false`); la configuración remota todavía no
existe. Si aun así se prefiere el correo, o un código de un solo uso que el dueño le pasa al socio, hacen falta
tres condiciones: correo confirmado, leerlo de `auth.users` y no del token de la sesión, y compararlo sin
distinguir mayúsculas.

Un mismo socio puede tener acceso a varios beneficiarios. Un beneficiario puede tener varios invitados (el socio y
su contador).

**Cómo se revoca.** El dueño pulsa «Quitar acceso»: se pone la fecha de revocación. Vale **al instante**, porque
las funciones miran esa fecha en cada consulta y no dependen de lo que diga la sesión. La sesión del socio puede
seguir abierta, pero ya no devuelve nada. Para cerrarla del todo, se borra el usuario en el panel.

**Qué tan al día está lo que ve.** El socio ve lo que hay en el libro. Si el libro solo se actualiza cuando el
dueño sincroniza, el socio ve datos de ese momento. Conviene mostrarle «actualizado el …».

**Pruebas.** Con el estándar de hoy, tres usuarios reales en el Supabase local (dueño, socio A, socio B): A no ve
lo de B ni lo de otro beneficiario; ninguno ve una columna fuera de la lista; un socio revocado no ve nada; sin
`aal2` no ve nada; ninguno puede escribir; un dueño marcado como socio por otro usuario sigue escribiendo en su
libro; y la suma de los repartos de un socio da su saldo asignado, con cobros fallidos y en la papelera de por
medio.

### 7. Cambios en la base

Todo **aditivo** y con prefijo `pay_`. No se escribe la migración aquí. Cada tabla nueva de `public` lleva lo mismo
que las actuales: `id`, `user_id` con `default auth.uid()`, `unique (id, user_id)`, claves foráneas compuestas con
`user_id`, RLS activada, permisos explícitos, políticas del dueño y la política restrictiva del segundo factor.

**Tablas nuevas**

| Tabla | Para qué | Campos principales | Notas |
|---|---|---|---|
| `pay_gateway_connections` | Una cuenta de pasarela conectada | cuenta de la pasarela en la empresa, proveedor (`stripe`\|`paypal`), modo (`real`\|`prueba`), id externo de la cuenta y del webhook (no son secretos), marca alta y cursor del paso en curso, candado (quién y hasta cuándo), fecha de inicio de la carga, última sincronización, último error, activa | Única por cuenta de pasarela y modo. **No guarda el secreto ni su nombre** (§4). Sus textos rechazan cualquier cosa con forma de clave |
| `pay_payouts` | Un depósito de la pasarela | conexión, id externo (`po_…`), monto, moneda, estado, fecha de llegada, método, automático, estado de conciliación, cuenta destino | Único por (conexión, id externo) |
| `pay_sync_runs` | Historial de sincronizaciones | conexión, inicio, fin, origen (`manual`\|`programada`\|`webhook`), conteos, error | Solo se agrega: la fila se inserta al terminar cada paso, ya completa. Sin cuerpos de respuesta |
| `pay_webhook_events` | Eventos recibidos (solo si hay webhooks) | conexión, id del evento, tipo, id del objeto, recibido, procesado, intentos, estado, error | Único por (conexión, id del evento). **Sin columna de cuerpo**, a propósito. El dueño puede borrar los suyos (la limpieza de §3.3) |
| `pay_partner_access` | Acceso de un socio a un beneficiario | beneficiario, usuario invitado (`uuid`), dado el, revocado el | Fila del dueño. Único por (beneficiario, usuario invitado) |
| `pay_settings` | Ajustes por usuario | lectura con IA encendida, límite de lecturas por día | Una fila por usuario |
| `pay_ai_reads` | Contar y medir la lectura con IA | cuándo, resultado, cuántos campos se corrigieron | Sin contenido del comprobante. Necesaria si hay límite diario |
| Una tabla en `private` (solo con webhooks o tareas sin sesión) | El hash de la ficha del servidor (§3.5) | hash, vigente desde, caduca el | Sin permisos para `anon` ni `authenticated`. No es de un usuario: excepción escrita a «cada fila es de un usuario» |

**Columnas nuevas** (todas opcionales, sin valor obligatorio)

| Tabla | Columna | Para qué |
|---|---|---|
| `pay_transactions` | `payout_id` (clave foránea compuesta a `pay_payouts`) | Qué depósito lo cubrió |
| `pay_transactions` | `gateway_fee_reported` | La comisión real informada, para mostrar la diferencia antes de aplicarla |
| `pay_transactions` | `source` (`manual`\|`csv`\|`api`) | De dónde salió el cobro |

Más un índice sobre `pay_transactions (payout_id)`.

**Funciones nuevas**

| Función | Tipo | Qué hace |
|---|---|---|
| Guardar cobros sincronizados (nombre por decidir) | `security invoker` | En una transacción: llama a `pay_save_transactions` y después escribe `source` y `gateway_fee_reported` de esos mismos cobros |
| `pay_apply_payout(payload)` | `security invoker` | En una transacción: guarda el depósito, llama a `pay_save_transactions` para marcar sus cobros como depositados, con su evento, y les escribe `payout_id` |
| `pay_partner_allocations()`, `pay_partner_settlements()`, `pay_partner_balance()` | Envoltura `invoker` en `public` + `definer` en `private` | Lo que ve un socio, con columnas elegidas y sin cobros fallidos ni de la papelera |
| `private.pay_is_partner()` | Lee la marca de socio de la sesión | Para la política restrictiva que impide escribir a un socio |
| `pay_ingest_webhook(…)` (solo con webhooks) | `security definer` en `public`, ejecutable solo por `anon` | Comprueba la ficha e inserta un evento recibido. Nada más |
| Lectura y escritura de Vault (solo con la opción (b) de §4) | `definer` en `private`, con envoltura para `authenticated` | Guardar y leer el secreto de una conexión. Exige la sesión de su dueño, `aal2` y la ficha del servidor |

**Políticas nuevas**

- Las de siempre en cada tabla nueva (dueño + segundo factor). `pay_sync_runs`, sin actualización ni borrado.
  `pay_webhook_events`, sin actualización para nadie más que el proceso del dueño y con borrado para el dueño.
- Una política restrictiva en las tablas `pay_*`, y en `storage.objects` solo para el bucket `comprobantes`, que
  niegue escribir a un socio. Opcional si no hay secretos en variables; obligatoria con la opción (a) de §4.
- Ninguna política existente cambia.

**Tres trampas para no romper «solo aditivo»**

1. `pay_save_transactions` nombra sus columnas una por una e ignora en silencio las claves que no conoce: las
   columnas nuevas no pasan por ella. Reemplazarla ya no sería «solo aditivo», y un segundo `update` aparte
   dejaría de ser todo o nada. La salida es que las funciones nuevas la **envuelvan**: la llaman y, en la misma
   transacción, escriben lo nuevo. Un efecto a tener en cuenta: esa segunda escritura mueve `updated_at` del
   cobro.
2. `pay_transaction_events.kind` tiene una lista cerrada. Agregar un tipo obliga a cambiar la restricción. Mejor
   **reutilizar** los que hay (`importado`, `recalculado`, `depositado`, `deposito_revertido`, `reembolso`,
   `disputa_*`) y poner el origen (`api`) dentro de `data`.
3. El diseño pide probar **todas** las tablas `pay_*` (otro usuario no ve ni escribe, `anon` nada, con factor y
   aal1 nada), y la migración actual termina comprobando RLS, política restrictiva y `unique (id, user_id)` en cada
   tabla `pay_*` de `public`. Las tablas nuevas tienen que cumplirlo también, incluida la de eventos. Conviene
   repetir esa comprobación al final de la migración nueva.

### 8. Orden sugerido y esfuerzo

Los tamaños son una estimación gruesa para una persona, con las pruebas al nivel del proyecto. No salen de ninguna
medición. Sirven para comparar pasos entre sí, no para comprometer fechas.

| # | Paso | Tamaño | Depende de | Riesgo principal |
|---|---|---|---|---|
| 0 | Publicar la app (base remota y Vercel) y confirmar la referencia canónica de cada pasarela | — | — | Sin esto no hay fase C |
| 1 | **Stripe a pedido, nivel 1**: conexiones, módulo de secretos, comprobación de la clave, lectura de movimientos de saldo, «Así lo entendí», posibles repetidos, conciliar comisión | Mediano (4–6 días) | 0 | Duplicar contra lo ya cargado; monedas sin decimales; que la clave tenga permisos de más |
| 2 | **Depósitos de Stripe**: `pay_payouts`, marcar cobros, revertir si falla | Mediano (3–4 días) | 1 | Depósitos manuales o instantáneos, que no se pueden enlazar; depósitos que fallan después de «pagado» |
| 3 | **Vista del socio** | Mediano (3–5 días) | 0 | Exponer una columna de más. Es el paso donde un error filtra datos entre personas |
| 4 | **PayPal a pedido**: credenciales, comprobación de permisos, ventanas de 31 días, retiros como sugerencia | Mediano (4–5 días) | 1 | Permisos de más en la credencial, quizá imposibles de quitar; retraso de 3 horas; expectativa de «depósito automático» que PayPal no da |
| 5 | **Reembolsos y disputas de Stripe enlazados** (nivel 2) | Chico a mediano (2–3 días) | 1 | La clave pasa a poder leer datos de compradores |
| 6 | **Leer comprobantes con IA** | Chico a mediano (3–4 días) | 0 | Privacidad de terceros; propuestas equivocadas que parecen buenas; gasto sin tope |
| 7 | **Webhooks de Stripe y sincronización programada** | Mediano a grande (4–6 días) | 1, 2 | Endpoint público; escribir sin sesión; la excepción a «`anon`: nada» |

Los pasos 3 y 6 no dependen de las pasarelas: pueden ir antes si es lo que más le sirve al dueño.

**Se puede dejar fuera sin perder lo esencial:**

- Los webhooks (paso 7) y, con ellos, toda escritura sin sesión.
- El webhook de PayPal, en cualquier caso.
- Importar cobros fallidos.
- Vault y el gestor externo, mientras las empresas sean pocas.
- La carga inicial de más de un año.
- El nivel 2 de Stripe, si los reembolsos son raros y se pueden seguir marcando a mano.

**Camino mínimo recomendado:** 0 → 1 → 2, y parar a mirar. Con eso el dueño deja de teclear los cobros de Stripe,
ve la comisión real y sus depósitos se marcan solos, sin endpoint público y sin clave de servicio.

### 9. Lo que el dueño tiene que decidir

1. **¿Cada empresa tiene su propia cuenta en cada pasarela?** Si una cuenta cobra para varias, la conexión
   automática no puede separarlas.
2. **¿Qué quiere primero:** dejar de teclear cobros (pasos 1 y 2), darle su vista a los socios (paso 3) o leer
   comprobantes (paso 6)?
3. **¿Acepta que el servidor guarde secretos de pasarela** en variables de Vercel, cambiando la regla 5 de
   `AGENTS.md`? ¿Y quién dará de alta una empresa nueva: él, desde la app, o quien administra Vercel?
4. **¿Cuántas empresas y pasarelas espera conectar en el primer año?** De eso depende cuánto dura la opción (a) de
   [§4](#4-dónde-guardar-los-secretos).
5. **¿Quiénes tienen hoy acceso al proyecto de Vercel y al de Supabase?** Esa lista es, en la práctica, quién puede
   leer los secretos.
6. **¿Webhooks sí o no?** Si no, el libro se pone al día cuando él entra y pulsa «Sincronizar». Si sí, hay que
   aceptar una excepción escrita a «el rol `anon` no puede nada».
7. **¿Los cobros de la API entran solos o siempre pasan por «Así lo entendí»?** Se recomienda revisar siempre la
   primera vez de cada conexión.
8. **Si la comisión real no coincide con la calculada y el reparto ya se liquidó, ¿qué se hace?** Aplicarla mueve
   el saldo de los beneficiarios. Se recomienda mostrarla y que él decida caso por caso.
9. **Cobros en otra moneda:** ¿se registran en la moneda en que la pasarela los liquida, o en la que pagó el
   comprador?
10. **PayPal, la credencial:** si no se pueden quitar los permisos de pagos y reembolsos, ¿acepta guardar un
    secreto de PayPal que puede mover dinero, o PayPal sigue por CSV?
11. **PayPal, los retiros:** ¿le sirve que los retiros al banco sean una sugerencia que él confirma? No hay forma de
    hacerlo automático.
12. **Stripe, otros medios de pago:** ¿cobra solo con tarjeta, o también con débito bancario u otros medios? De eso
    depende si la primera versión lee solo `charge` o también `payment`.
13. **Socios:** ¿ven el nombre de la empresa y el bruto de cada cobro, o solo lo que les tocó? ¿Se les exige
    segundo factor siempre? ¿Acepta que una cuenta sea de dueño o de socio, y no las dos cosas?
14. **IA:** ¿acepta que la imagen de un comprobante, que puede traer datos de quien pagó, salga a un proveedor
    externo cuando él pulse el botón? ¿Con qué tope de gasto al mes?

### Fuentes

Consultadas el 2026-11-10. Lo marcado «No confirmado» en el texto no salió de ninguna de estas páginas.

- `[F1]` Stripe · Claves restringidas (permisos, error que dice qué permiso falta, dónde guardarlas):
  https://docs.stripe.com/keys/restricted-api-keys
- `[F2]` Stripe · Claves de API (tipos, ver una clave una sola vez, rotación, políticas de acceso):
  https://docs.stripe.com/keys
- `[F3]` Stripe · Listar movimientos de saldo (orden, parámetros `payout`, `type`, `limit`):
  https://docs.stripe.com/api/balance_transactions/list
- `[F4]` Stripe · El objeto movimiento de saldo (`amount`, `fee`, `fee_details`, `net`, `source`, `exchange_rate`):
  https://docs.stripe.com/api/balance_transactions/object
- `[F5]` Stripe · Conciliación de depósitos: https://docs.stripe.com/payouts/reconciliation
- `[F6]` Stripe · El objeto depósito (`arrival_date`, `status`, `reconciliation_status`, `automatic`):
  https://docs.stripe.com/api/payouts/object
- `[F7]` Stripe · El objeto cobro (`billing_details`, `receipt_email`, `payment_method_details`,
  `amount_refunded`): https://docs.stripe.com/api/charges/object
- `[F8]` Stripe · Webhooks (firma, cuerpo crudo, tolerancia, reintentos, duplicados, orden, rotar el secreto,
  direcciones IP): https://docs.stripe.com/webhooks
- `[F9]` Stripe · Cómo funcionan los eventos (formato ligero y «snapshot», 16 destinos, retención de 30 días,
  permisos para leer un evento): https://docs.stripe.com/events/how-events-work
- `[F10]` Stripe · Tipos de eventos «snapshot»: https://docs.stripe.com/api/events/types
- `[F11]` Stripe · Catálogo de eventos ligeros: https://docs.stripe.com/api/v2/core/events/event-types
- `[F12]` Stripe · Límites de frecuencia: https://docs.stripe.com/rate-limits
- `[F13]` PayPal · Búsqueda de transacciones, listar transacciones (permiso, tres horas, 31 días, tres años,
  `fields`, tamaño de página): https://developer.paypal.com/api/transaction-search/v1/search-get
- `[F14]` PayPal · Códigos de evento de transacción: https://developer.paypal.com/reports/reference/t-codes
- `[F15]` PayPal · Autenticación de la API REST: https://developer.paypal.com/api/rest/authentication/
- `[F16]` PayPal · Pautas de límites de frecuencia: https://developer.paypal.com/api/rest/reference/rate-limiting
- `[F17]` PayPal · Webhooks, integración y verificación de la firma:
  https://developer.paypal.com/api/rest/webhooks/rest/
- `[F18]` PayPal · Nombres de eventos de webhook: https://developer.paypal.com/api/rest/webhooks/event-names/
- `[F19]` Supabase · Vault: https://supabase.com/docs/guides/database/vault
- `[F20]` Vercel · Variables de entorno (cifrado, entornos, 64 KB, solo despliegues nuevos):
  https://vercel.com/docs/environment-variables
- `[F21]` Vercel · Variables «Config» y «Secret»:
  https://vercel.com/docs/environment-variables/sensitive-environment-variables
- `[F22]` Vercel · Rotar variables de entorno: https://vercel.com/docs/environment-variables/rotating-secrets
- `[F23]` Vercel · Límites de las funciones (duración máxima, 4,5 MB de cuerpo):
  https://vercel.com/docs/functions/limitations
- `[F24]` Vercel · Tareas programadas, uso y precios. La página avisa que las tareas programadas son una función
  heredada que pasará a «Schedules»: los límites pueden cambiar.
  https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing
- `[F25]` Vercel · Federación OIDC: https://vercel.com/docs/oidc
- `[F26]` Next.js 16.4 · Documentación incluida en la versión instalada:
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (sección «Webhooks») y
  `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`
- `[F27]` Stripe · Referencia de permisos de las claves restringidas:
  https://docs.stripe.com/keys/permissions-reference
- `[F28]` Stripe · Tipos de movimientos de saldo (`charge`, `payment`, `payment_failure_refund`, `adjustment`):
  https://docs.stripe.com/reports/balance-transaction-types
- `[F29]` Stripe · El objeto reembolso (`charge`): https://docs.stripe.com/api/refunds/object
- `[F30]` Stripe · El objeto disputa (`charge`, `status`, `evidence`): https://docs.stripe.com/api/disputes/object
- `[F31]` Stripe · Monedas (sin decimales y casos especiales): https://docs.stripe.com/currencies
- `[F32]` Stripe · Listar depósitos: https://docs.stripe.com/api/payouts/list
- `[F33]` Stripe · Dominios y direcciones IP (las de los webhooks): https://docs.stripe.com/ips
- `[F34]` PayPal · Especificación de la búsqueda de transacciones (campos de `transaction_info`,
  `RESULTSET_TOO_LARGE`): https://developer.paypal.com/api/transaction-search/v1/schema.yaml
- `[F35]` Supabase · Claves de API y roles (la clave secreta se salta la RLS):
  https://supabase.com/docs/guides/api/api-keys
- `[F36]` Supabase · Seguridad por fila (`app_metadata` no lo puede cambiar el usuario):
  https://supabase.com/docs/guides/database/postgres/row-level-security

Del propio proyecto: el diseño `docs/superpowers/specs/2026-11-09-pasarelas-design.md`, la migración
`supabase/migrations/20261110120000_las_pasarelas_de_pago.sql`, `AGENTS.md`, `supabase/config.toml`, el motor en
`src/lib/pasarelas/` (`breakdown.ts`, `write.ts`, `types.ts`) y la capa de servidor en `src/server/pasarelas/`.
