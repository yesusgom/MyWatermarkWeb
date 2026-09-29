# htmlTest2 — Marca de Agua (móvil)

Misma aplicación que [`htmlTest`](../htmlTest/README.md) pero **diseñada para
téléfono**: una sola columna, hojas deslizantes en lugar de panel lateral,
tira de fotos para saltar de una a otra, botón de cámara, vibración y
"Compartir" al WhatsApp o al correo.

**Sin servidor, sin librerías y sin internet.** Todo se procesa en el
teléfono: las fotos no se suben a ninguna parte.

---

## Cómo abrirlo en el teléfono

**Opción A — sin instalar nada (archivo local)**
Pasa la carpeta al móvil y abre `index.html` con el navegador. Funciona, pero
algunos navegadores de Android bloquean los ficheros locales.

**Opción B — como web (recomendado)**
Deja la carpeta en un sitio web estático (GitHub Pages, Netlify, tu servidor…)
y ábrela con `https://...`. Así se puede **añadir a la pantalla de inicio** y
funciona sin cobertura gracias al service worker.

**Opción C — probar en el PC en la red local**

```bash
cd htmlTest2
python -m http.server 8000
```

y desde el móvil, `http://IP-DEL-PC:8000` (misma wifi).

---

## Diferencias respecto a la versión de escritorio

| | Escritorio (`htmlTest`) | Móvil (`htmlTest2`) |
|---|---|---|
| Distribución | Panel lateral + lienzo | Una columna; ajustes en **hojas deslizantes** |
| Cambiar de foto | Clic en la miniatura | **Tira de fotos** bajo el lienzo |
| Entrar fotos | Arrastrar o elegir | Botón **Fotos** + botón **Cámara** |
| Ajustes | Siempre visibles | 4 botones abajo: Fotos · Marca · Colocar · Salida |
| Resultados | Rejilla | Rejilla de 2 columnas + **Compartir** |
| Extra | — | Vibración, atajos a la pantalla de inicio, funciona sin cobertura |
| Límite | 200 fotos | 100 fotos y aviso a partir de 24 MB por foto |
| Vista previa | 1500 px | 1000 px (menos memoria en el móvil) |

Todo lo demás es idéntico: marca de imagen o texto, 9 posiciones, arrastre con
el dedo, tamaño, opacidad, rotación, margen, mosaico, JPEG/PNG/WebP, calidad,
ancho máximo, nombres, posición compartida o propia por foto y ZIP propio.

---

## Estructura

```
htmlTest2/
├── index.html             Interfaz móvil
├── manifest.webmanifest   Datos para "añadir a pantalla de inicio"
├── sw.js                  Service worker (uso sin conexión)
├── icon.svg               Icono de la app
├── css/styles.css         Estilos (diseño móvil primero)
├── js/
│   ├── utils.js           Utilidades (copiado de htmlTest, sin UI)
│   ├── zip.js             Escritor de ZIP propio (copiado de htmlTest)
│   ├── renderer.js        Dibujado de la marca de agua (copiado de htmlTest)
│   └── app.js             Lógica móvil: hojas, tira de fotos, cámara, compartir
└── README.md
```

`utils.js`, `zip.js` y `renderer.js` son **idénticos** a los de `htmlTest`:
no dependen de la interfaz, así que ambas versiones se comportan igual al
procesar. Solo cambian `index.html`, `styles.css` y `app.js`.

Los ajustes se guardan en `localStorage` con la clave `wm.settings.v2` (la de
escritorio es `wm.settings.v1`), así que se pueden tener las dos versiones en
el mismo dispositivo sin pisarse.

---

## Detalles pensados para el móvil

- **La página no hace scroll**: solo lo hacen las hojas. El dedo siempre mueve
  la marca de agua, nunca la pantalla (`touch-action: none` en el lienzo).
- **Botones de 48 px** como mínimo y letra de 16 px en los campos, para que no
  salte el zoom automático de iOS.
- **`env(safe-area-inset-*)`**: respeta la muesca y la barra de gestos del
  iPhone.
- **Liberación de memoria**: cada foto se decodifica, se dibuja y se cierra
  antes de pasar a la siguiente; la vista previa se reduce a 1000 px.
- **Sin conexión**: el service worker guarda una copia de la app (solo los
  ficheros del programa, nunca tus fotos).
- **Compartir**: usa la API nativa para mandar las fotos a otras apps. Si el
  móvil no la soporta, avisa y te deja usar "Guardar".

---

## Límites

- HEIC/HEIF (fotos de iPhone sin convertir) y RAW: solo si el navegador los
  sabe abrir. Conviene pasarlos a JPG antes.
- La marca es texto o imagen; no hay dibujo a mano alzada.
- El tamaño se controla como porcentaje del ancho, no en píxeles exactos.
