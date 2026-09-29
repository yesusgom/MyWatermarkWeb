# htmlTest — Marca de Agua (web adaptable)

Editor de marca de agua **100 % en el navegador**: cargas una o muchas fotos,
añades una marca de agua (imagen o texto) y te devuelve las fotos ya marcadas
para guardarlas donde quieras.

**No hay servidor, no hay librerías y no hay internet.** Todo el trabajo
(leer, dibujar y exportar) lo hace JavaScript dentro de la pestaña. Ni una
sola petición de red: los archivos no salen de tu ordenador.

---

## Se adapta sola al dispositivo

Es **la misma web** en móvil, tableta y escritorio: cambia la distribución
según el ancho de la ventana, sin recargar y sin tener dos versiones.

| | Escritorio (≥ 861 px) | Móvil (≤ 860 px) |
|---|---|---|
| Ajustes | Barra lateral, todo a la vista | Hoja deslizante con 4 bloques: Fotos · Marca · Colocar · Salida |
| Barra inferior | Botones en línea | Botones grandes + navegación de 4 iconos |
| Entrar fotos | Arrastrar o elegir | Botón *Elegir fotos* y botón *Cámara* |
| Cambiar de foto | Clic en la miniatura | Tira de fotos bajo el lienzo |
| Atajos de teclado | Sí (flechas, `+`, `R`, `0`) | Ocultos: no hay teclado físico |
| Toasts | Abajo a la derecha | Arriba, para no tapar la tira ni los botones |
| Tamaño de la vista previa | 1500 px | 1000 px (menos memoria) |
| Límite de fotos | 200 | 200 (avisa a partir de 24 MB por foto) |

Entre 861 y 1200 px (tableta) el panel lateral se estrecha y la cabecera
recorta el subtítulo.

El truco está en `app.js`: el bloque `#controls` es el mismo siempre y se
**traslada de sitio** con `appendChild` — a la barra lateral en escritorio, a
la hoja deslizante en móvil. `matchMedia` escucha el cambio de ancho, así que
al girar el móvil o al mover la ventana del navegador los controles viajan
 solos, sin recargar y sin perder lo que tenías cargado.

---

## Cómo abrirlo

Opción 1 — doble clic:
`doble clic en index.html` y se abre en tu navegador.

Opción 2 — con un servidor local (sigue siendo local):

```bash
cd htmlTest
python -m http.server 8000
# y abre http://localhost:8000
```

Para probarlo en el móvil, ábrelo desde el teléfono con la IP del PC en la
misma wifi: `http://IP-DEL-PC:8000`.

Navegadores recomendados: Chrome, Edge, Firefox o Safari actualizados.

---

## Estructura

```
htmlTest/
├── index.html          Interfaz (una sola, se reorganiza sola)
├── css/
│   └── styles.css      Estilos: escritorio / tableta / móvil
├── js/
│   ├── utils.js        Decodificar, escalar, exportar, nombres
│   ├── zip.js          Escritor de ZIP propio (método "store")
│   ├── renderer.js     Cálculo y dibujado de la marca de agua
│   └── app.js          Estado, eventos y adaptación de la pantalla
└── README.md
```

Los scripts se cargan de forma clásica (sin módulos ES) a propósito: así la
página funciona también con el protocolo `file://`, donde los módulos están
bloqueados por el navegador.

---

## Uso

1. **Fotos** — pulsa la zona punteada o arrastra los archivos (también
   funciona soltarlos en cualquier punto de la ventana). Se admiten varias a
   la vez. Clic en una miniatura para verla en la vista previa.
2. **Marca de agua** — elige *Imagen* (logo o foto) o *Texto*.
   - Texto: admite varias líneas con `\n`, 8 fuentes del sistema, color,
     negrita, cursiva y contorno.
3. **Colocación** — botón de 9 posiciones, o **arrastra la marca directamente
   sobre la foto**. Ajusta tamaño (% del ancho de la foto), opacidad,
   rotación, margen de seguridad y mosaico repetido.
   - **Una sola posición para todas** (por defecto): mueves la marca en
     cualquier foto y se aplica igual en el resto del lote.
   - **Posición propia de cada foto**: desmarca *"La misma posición en todas las
     fotos"* y cada miniatura guarda la suya (se marca con la etiqueta
     *posición propia*). Las que no edites se quedan en el centro.
     Con **"Copiar esta posición a todas"** vuelves a igualarlas en un clic.
   - Las posiciones se recuerdan entre ejecuciones (se guardan con el nombre,
     el tamaño y la fecha del archivo), así que al volver a cargar las mismas
     fotos cada una recupera donde la dejaste.
4. **Salida** — formato (JPEG / PNG / WebP), calidad, color de fondo para
   JPEG, ancho máximo y prefijo/sufijo del nombre.
5. **Aplicar marca de agua** — procesa todas las fotos una a una (no se cuelga
   la interfaz) y cada una usa su posición. Al terminar puedes:
   - pulsar **Guardar** en cada resultado, o
   - pulsar **Descargar todo (.zip)** y llevárselo todo en un único archivo.

### Atajos de teclado

| Tecla | Acción |
|---|---|
| `←` `→` `↑` `↓` | Mover la marca (con `Shift`, saltos más grandes) |
| `+` / `−` | Tamaño de la marca |
| `R` | Rotar 5° |
| `0` | Centrar |

---

## Detalles técnicos

| Tema | Solución |
|---|---|
| Memoria | Las fotos se procesan **de una en una**; el bitmap se cierra con `close()` en cuanto deja de usarse. La vista previa se reduce a 1500 px de ancho. |
| Orientación EXIF | `createImageBitmap(file, { imageOrientation: 'from-image' })` respeta la rotación de la cámara, con copia de seguridad a `<img>`. |
| JPEG y transparencia | Se rellena el fondo antes de dibujar, porque JPEG no admite canal alfa. |
| Formato no soportado | Si el navegador no sabe codificar WebP, se avisa y se guarda en PNG (con la extensión correcta). |
| ZIP propio | Como las fotos ya vienen comprimidas, el ZIP se genera con el método *store*: sin recomprimir y sin dependencias. |
| Ajustes | Se guardan en `localStorage` (preferencias y posiciones). Las fotos nunca se guardan en ningún sitio. |
| Nombres duplicados | Si dos fotos se llaman igual, se añade `_2`, `_3`… |

---

## Privacidad

- Las fotos se leen con `createImageBitmap` / `<img>` sobre un `blob:` URL.
- No hay `fetch`, ni `XMLHttpRequest`, ni fuentes, ni scripts de terceros.
- Puedes comprobarlo tú mismo: abre las **herramientas de desarrollo → Red**
  y verás cero peticiones al cargar y usar la página.
- Al cerrar o recargar la pestaña se pierde todo (salvo los ajustes).

---

## Límites conocidos

- Formatos que el navegador no sabe abrir (HEIC/HEIF de iPhone, RAW) no se
  pueden cargar: hay que convertirlos antes a JPG.
- La marca de agua es **texto o imagen**: no hay dibujo libre a mano.
- El tamaño se controla como porcentaje del ancho, no en píxeles exactos.
- Con fotos muy grandes (varias de 50 MP) el navegador puede ir justo de
  memoria: baja el "ancho máximo de la foto" si notas que va lento.
- El proceso es secuencial a propósito: es lo que evita que la pestaña se
  congele con muchas fotos a la vez.
