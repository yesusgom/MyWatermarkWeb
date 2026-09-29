# htmlTest2 — Marca de Agua ( adaptable )

Editor de marca de agua **sin servidor, sin librerías y sin internet**:
cargas fotos, añades la marca y te las guardas en el mismo
dispositivo. Las fotos no se suben a ninguna parte.

La interfaz **se adapta sola al dispositivo**: nace pensada para el
teléfono (una columna, hojas deslizantes al alcance del pulgar) y se
reorganiza en tableta y escritorio (lienzo grande con panel lateral).

---

## Cómo abrirlo

**Opción A — sin instalar nada (archivo local)**
Pasa la carpeta al móvil y abre `index.html` con el navegador. Funciona, pero
algunos navegadores de Android bloquean los ficheros locales.

**Opción B — como web (recomendado)**
Deja la carpeta en un sitio web estático (GitHub Pages, Netlify, tu servidor…)
y ábrela con `https://...`. Así se puede **añadir a la pantalla de inicio**
y funciona sin cobertura gracias al service worker.

**Opción C — probar en el PC en la red local**

```bash
cd htmlTest2
python -m http.server 8000
```

y desde el móvil, `http://IP-DEL-PC:8000` (misma wifi).

---

## Cómo se adapta a cada pantalla

Todo el reparto se decide con `grid-template-areas` en `css/styles.css`:
el mismo HTML sirve para el móvil y para el escritorio, solo cambia la
rejilla.

| Pantalla | Cómo se ve |
|---|---|
| **Teléfono vertical** (≤ 400 px incluidos los pequeños) | Una columna. Márgenes y letra más apretados para que el lienzo mande. |
| **Teléfono horizontal** (poco alto) | El lienzo se queda a la izquierda y la **tira de fotos pasa a vertical** a su derecha. La barra inferior se aplana en dos bloques (navegación \| acciones) para no comerse la altura. |
| **Tableta / portátil** (≥ 900 px) | **Dos columnas**: lienzo a la izquierda y los ajustes pasan a un **panel lateral fijo**. La hoja deslizante se convierte en un **cajón** por la derecha. Los resultados se reparten en rejilla automática. |
| **Escritorio grande** (≥ 1280 px) | Todo más ancho, panel y cajón de 420 px y más columnas en la rejilla de resultados. |

Además, en cualquier tamaño:

- **`env(safe-area-inset-*)`**: respeta la muesca y la barra de gestos,
  también en horizontal.
- **`100dvh`**: la app ocupa justo lo que se ve cuando la barra del
  navegador se oculta o aparece.
- **Vista previa adaptativa**: 700 px en móvil táctil, 1100 px en
  tableta y 1800 px en escritorio con ratón (menos memoria donde
  importa, más detalle donde sobra).
- **Ratón**: la marca se arrastra también con el cursor, los botones
  tienen estados `hover` y `Ctrl+Enter` aplica la marca.
- **Sin zoom accidental** en iOS: los campos mantienen 16 px.
- **`prefers-reduced-motion`** y **`forced-colors`** respetados.

---

## Qué hace

Marca de **imagen** o de **texto**, 9 posiciones, arrastre con el dedo o
el ratón, tamaño, opacidad, rotación, margen de seguridad, mosaico,
formato JPEG/PNG/WebP, calidad, ancho máximo, nombres de archivo,
posición compartida o propia para cada foto, ZIP propio y
compartir con el WhatsApp o el correo.

En ordenador además se pueden **arrastrar y soltar** las fotos sobre la
ventana.

---

## Estructura

```
htmlTest2/
├── index.html             Interfaz (el mismo HTML para todos los tamaños)
├── manifest.webmanifest   Datos para "añadir a la pantalla de inicio"
├── sw.js                  Service worker (uso sin conexión)
├── icon.svg               Icono de la app
├── icon-maskable.svg      Icono recortado para los lanzadores de Android
├── css/styles.css         Estilos: móvil primero + capas por pantalla
├── js/
│   ├── utils.js           Utilidades (copiado de htmlTest, sin UI)
│   ├── zip.js             Escritor de ZIP propio (copiado de htmlTest)
│   ├── renderer.js        Dibujado de la marca de agua (copiado de htmlTest)
│   └── app.js             Lógica: hojas, tira de fotos, cámara, compartir
└── README.md
```

Los nombres de los ficheros son **minúsculas y sin espacios**, que es lo
que necesitan GitHub Pages y cualquier servidor en Linux. Si añades
ficheros, mantenlo.

`utils.js`, `zip.js` y `renderer.js` son **idénticos** a los de `htmlTest`:
no dependen de la interfaz, así que ambas versiones se comportan igual al
procesar. Solo cambian `index.html`, `styles.css`, `app.js` y el manifest.

Los ajustes se guardan en `localStorage` con la clave `wm.settings.v2` (la de
escritorio es `wm.settings.v1`), así que se pueden tener las dos versiones en
el mismo dispositivo sin pisarse.

Si cambias algún fichero, sube también `sw.js`: la copia sin conexión
guarda la lista de ficheros en `ASSETS` y su nombre de versión (`CACHE`)
para saber cuándo hay que recargar.

---

## Detalles pensados para el móvil

- **La página no hace scroll**: solo lo hacen las hojas y la tira de
  fotos. El dedo siempre mueve la marca de agua, nunca la pantalla
  (`touch-action: none` en el lienzo).
- **Botones de 44-48 px** como mínimo y letra de 16 px en los campos.
- **Tira de fotos** para saltar de una a otra sin abrir la hoja.
- **Botón de cámara** y **vibración** al tocar.
- **Liberación de memoria**: cada foto se decodifica, se dibuja y se cierra
  antes de pasar a la siguiente.
- **Sin conexión**: el service worker guarda una copia de la app (solo los
  ficheros del programa, nunca tus fotos).
- **Compartir**: usa la API nativa para mandar las fotos a otras apps. Si el
  dispositivo no la soporta, avisa y deja usar "Guardar".

---

## Límites

- 100 fotos por lote (200 en la versión de escritorio) y aviso a partir de
  24 MB por foto.
- HEIC/HEIF (fotos de iPhone sin convertir) y RAW: solo si el navegador los
  sabe abrir. Conviene pasarlos a JPG antes.
- La marca es texto o imagen; no hay dibujo a mano alzada.
- El tamaño se controla como porcentaje del ancho, no en píxeles exactos.
- El icono de la app es SVG; algunos navegadores muy antiguos al
  instalarla piden además un PNG.
