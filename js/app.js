/* =============================================================
 * app.js — versión MÓVIL
 *
 * Mismas funciones que la versión de escritorio, adaptadas a
 * teléfono: una columna, hojas deslizantes en lugar de panel
 * lateral, tira de fotos para saltar de una a otra, botón de
 * cámara, vibración y "Compartir" cuando el móvil lo permite.
 *
 * Reglas de privacidad: no hay red. Las fotos se leen del disco
 * con createImageBitmap y se guardan con object URLs.
 * ============================================================= */
(function (global) {
    'use strict';

    var WM = global.WM;
    var utils = WM.utils;
    var renderer = WM.renderer;
    var zip = WM.zip;
    var $ = utils.$;
    var clamp = utils.clamp;

    var STORAGE_KEY = 'wm.settings.v2';   // distinto del de escritorio: ajustes propios
    var MAX_PHOTOS = 100;
    var PREVIEW_MAX_WIDTH = 1000;         // en móvil menos pixeles = menos memoria
    var BIG_FILE = 24 * 1024 * 1024;      // avisar a partir de 24 MB
    var ZIP_WARN_BYTES = 700 * 1024 * 1024;

    var DEFAULTS = {
        wmType: 'image',
        text: '© Mi marca',
        font: renderer.FONTS[0].value,
        color: '#ffffff',
        strokeColor: '#000000',
        bold: false,
        italic: false,
        stroke: true,
        sizePct: 25,
        opacity: 60,
        rotation: 0,
        marginPct: 3,
        repeat: false,
        gapPct: 8,
        format: 'image/jpeg',
        quality: 88,
        background: '#ffffff',
        maxWidth: 1600,
        prefix: 'wm_',
        suffix: '',
        anchorX: 0.5,
        anchorY: 0.5,
        linked: true,
        placements: {}
    };

    var state = {
        photos: [],
        results: [],
        wmImage: null,
        textCache: null,
        preview: null,
        previewPhotoId: null,
        previewToken: 0,
        previewInfo: null,
        anchor: { x: 0.5, y: 0.5 },
        dragging: false,
        dragOffset: { x: 0, y: 0 },
        selected: 0,
        busy: false,
        cancelRequested: false,
        sheet: null,
        settings: loadSettings()
    };

    var dom = {};

    /* =============================================================
     * Ajustes
     * ============================================================= */

    function loadSettings() {
        var stored = {};
        try {
            stored = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || '{}') || {};
        } catch (e) {
            stored = {};
        }
        var merged = {};
        Object.keys(DEFAULTS).forEach(function (key) {
            merged[key] = (stored[key] === undefined || stored[key] === null) ? DEFAULTS[key] : stored[key];
        });
        if (!merged.placements || typeof merged.placements !== 'object') merged.placements = {};
        return merged;
    }

    var saveSettings = utils.debounce(function () {
        try {
            state.settings.anchorX = state.anchor.x;
            state.settings.anchorY = state.anchor.y;
            global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
        } catch (e) { /* almacenamiento no disponible */ }
    }, 250);

    /* =============================================================
     * Posición: una para todas o una por foto
     * ============================================================= */

    function photoKey(photo) {
        var modified = (photo.file && photo.file.lastModified) || 0;
        return photo.name + '|' + photo.size + '|' + modified;
    }

    function currentAnchor() {
        var photo = state.photos[state.selected];
        if (state.settings.linked || !photo) return state.anchor;
        var own = state.settings.placements[photoKey(photo)];
        return own ? { x: Number(own.x), y: Number(own.y) } : state.anchor;
    }

    function setAnchor(x, y) {
        state.anchor.x = clamp(x, 0, 1);
        state.anchor.y = clamp(y, 0, 1);
        var photo = state.photos[state.selected];
        if (!state.settings.linked && photo) {
            var store = state.settings.placements;
            var keys = Object.keys(store);
            if (keys.length > 300) delete store[keys[0]];
            store[photoKey(photo)] = { x: state.anchor.x, y: state.anchor.y };
        }
    }

    function hasOwnPlacement(photo) {
        return !state.settings.linked && !!state.settings.placements[photoKey(photo)];
    }

    function copyPlacementToAll() {
        var photo = state.photos[state.selected];
        if (!photo) return;

        var key = photoKey(photo);
        var origin = state.settings.placements[key] || { x: state.anchor.x, y: state.anchor.y };
        var copied = 0;

        state.photos.forEach(function (item) {
            var k = photoKey(item);
            if (k === key) return;
            state.settings.placements[k] = { x: Number(origin.x), y: Number(origin.y) };
            copied++;
        });

        state.anchor.x = Number(origin.x);
        state.anchor.y = Number(origin.y);
        renderPhotos();
        redraw();
        toast('Posición copiada a ' + copied + ' foto' + (copied === 1 ? '' : 's') + '.', 'ok');
    }

    /* =============================================================
     * Marca de agua
     * ============================================================= */

    function textSource(settings) {
        var s = settings || state.settings;
        if (!s.text || !s.text.trim()) return null;

        var key = [s.text, s.font, s.color, s.strokeColor, s.bold, s.italic, s.stroke].join('|');
        if (state.textCache && state.textCache.key === key) return state.textCache.canvas;

        var canvas = renderer.textWatermark(s.text, {
            font: s.font,
            color: s.color,
            strokeColor: s.strokeColor,
            bold: s.bold,
            italic: s.italic,
            stroke: s.stroke
        });
        state.textCache = { key: key, canvas: canvas };
        return canvas;
    }

    function currentWatermarkSource(settings) {
        if ((settings || state.settings).wmType === 'text') return textSource(settings);
        return state.wmImage ? state.wmImage.source : null;
    }

    function drawOptions(plan) {
        var s = (plan && plan.settings) || state.settings;
        var a = (plan && plan.anchor) || currentAnchor();
        return {
            sizePct: Number(s.sizePct),
            opacity: Number(s.opacity) / 100,
            rotation: Number(s.rotation),
            marginPct: Number(s.marginPct),
            repeat: !!s.repeat,
            gapPct: Number(s.gapPct),
            anchorX: a.x,
            anchorY: a.y
        };
    }

    /** Copia los ajustes para que el lote use siempre los mismos valores. */
    function buildPlan() {
        var snapshot = {};
        Object.keys(DEFAULTS).forEach(function (key) { snapshot[key] = state.settings[key]; });
        return {
            settings: snapshot,
            anchor: { x: state.anchor.x, y: state.anchor.y },
            mark: currentWatermarkSource(snapshot)
        };
    }

    function anchorFor(photo, plan) {
        if (plan.settings.linked) return plan.anchor;
        var own = plan.settings.placements[photoKey(photo)];
        return own ? { x: Number(own.x), y: Number(own.y) } : plan.anchor;
    }

    /* =============================================================
     * Avisos, vibración y progreso
     * ============================================================= */

    function toast(message, kind) {
        var host = $('#toasts');
        var node = utils.el('div', 'toast' + (kind ? ' toast--' + kind : ''), message);
        host.appendChild(node);
        while (host.children.length > 3) host.removeChild(host.firstChild);
        setTimeout(function () {
            node.style.opacity = '0';
            node.style.transition = 'opacity .25s';
            setTimeout(function () { if (node.parentNode) node.remove(); }, 260);
        }, kind === 'err' ? 6000 : 3600);
    }

    function buzz(ms) {
        if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* no soportado */ } }
    }

    function setProgress(ratio) {
        var bar = $('#progress');
        var fill = $('#progress-bar');
        var pct = clamp(Math.round(ratio * 100), 0, 100);
        if (ratio === null) {
            bar.classList.add('is-hidden');
        } else {
            bar.classList.remove('is-hidden');
            bar.setAttribute('aria-valuenow', String(pct));
        }
        fill.style.width = pct + '%';
    }

    function setStatus(text) { $('#status').textContent = text; }

    /* =============================================================
     * Fotos
     * ============================================================= */

    function isImageFile(file) {
        if (!file) return false;
        if (file.type && file.type.indexOf('image/') === 0) return true;
        return /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name || '');
    }

    function addFiles(fileList) {
        var all = Array.prototype.slice.call(fileList || []);
        if (!all.length) return;

        var files = all.filter(isImageFile);
        if (!files.length) {
            toast('Ninguno de esos archivos es una imagen.', 'warn');
            return;
        }

        var hadPhotos = state.photos.length > 0;
        var added = 0;
        var big = 0;

        for (var i = 0; i < files.length; i++) {
            if (state.photos.length >= MAX_PHOTOS) {
                toast('Máximo ' + MAX_PHOTOS + ' fotos por lote.', 'warn');
                break;
            }
            var file = files[i];
            if (file.size > BIG_FILE) big++;
            state.photos.push({
                id: utils.nextId(),
                file: file,
                name: file.name || ('imagen-' + Date.now()),
                size: file.size || 0,
                url: URL.createObjectURL(file),
                error: null
            });
            added++;
        }

        if (!hadPhotos && added) {
            state.selected = 0;
            switchTab('preview');
        }

        renderPhotos();
        ensurePreview();
        updateUI();

        if (big) {
            toast(big + ' foto(s) son muy grandes: puede ir lento el móvil.', 'warn');
        } else if (added > 1) {
            toast(added + ' fotos cargadas.', 'ok');
        }
        buzz(12);
    }

    function removePhoto(id) {
        var index = -1;
        for (var i = 0; i < state.photos.length; i++) {
            if (state.photos[i].id === id) { index = i; break; }
        }
        if (index < 0) return;

        var photo = state.photos[index];
        URL.revokeObjectURL(photo.url);
        state.photos.splice(index, 1);

        if (state.previewPhotoId === id) {
            state.previewPhotoId = null;
            utils.closeQuietly(state.preview);
            state.preview = null;
        }
        if (state.selected >= state.photos.length) {
            state.selected = Math.max(0, state.photos.length - 1);
        }

        renderPhotos();
        ensurePreview();
        updateUI();
    }

    function clearPhotos() {
        state.photos.forEach(function (photo) { URL.revokeObjectURL(photo.url); });
        state.photos = [];
        state.selected = 0;
        state.previewPhotoId = null;
        utils.closeQuietly(state.preview);
        state.preview = null;
        renderPhotos();
        drawPreview();
        updateUI();
    }

    function selectPhoto(index) {
        if (index < 0 || index >= state.photos.length) return;
        state.selected = index;
        renderPhotos();
        ensurePreview();
        updateUI();
        var strip = $('#filmstrip');
        var active = strip.querySelector('.film.is-active');
        if (active && active.scrollIntoView) {
            active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    function renderPhotos() {
        var list = $('#photo-list');
        var strip = $('#filmstrip');
        list.textContent = '';
        strip.textContent = '';

        state.photos.forEach(function (photo, index) {
            var isActive = index === state.selected;

            // --- Item de la hoja ---
            var item = utils.el('li', 'thumb' + (isActive ? ' is-active' : '') + (photo.error ? ' is-error' : ''));
            item.tabIndex = 0;
            item.setAttribute('role', 'button');

            var img = utils.el('img', 'thumb__img');
            img.src = photo.url;
            img.alt = photo.name;
            img.loading = 'lazy';

            var body = utils.el('div', 'thumb__body');
            var nameRow = utils.el('div', 'thumb__nameRow');
            nameRow.appendChild(utils.el('span', 'thumb__name', photo.name));
            if (hasOwnPlacement(photo)) {
                var flag = utils.el('span', 'thumb__flag', 'propia');
                flag.title = 'Esta foto tiene su propia posición';
                nameRow.appendChild(flag);
            }
            body.appendChild(nameRow);
            body.appendChild(utils.el('span', 'thumb__meta',
                photo.error ? photo.error : utils.formatBytes(photo.size)));

            var remove = utils.el('button', 'icon-btn icon-btn--del', '×');
            remove.type = 'button';
            remove.title = 'Quitar';
            remove.setAttribute('aria-label', 'Quitar ' + photo.name);
            remove.addEventListener('click', function (event) {
                event.stopPropagation();
                removePhoto(photo.id);
            });

            item.appendChild(img);
            item.appendChild(body);
            item.appendChild(remove);
            item.addEventListener('click', function () {
                selectPhoto(index);
                closeSheet();
            });
            list.appendChild(item);

            // --- Foto de la tira inferior ---
            var film = utils.el('button', 'film' + (isActive ? ' is-active' : '') + (photo.error ? ' is-error' : ''));
            film.type = 'button';
            film.title = photo.name;
            film.setAttribute('aria-label', 'Foto ' + (index + 1) + ': ' + photo.name);
            var filmImg = document.createElement('img');
            filmImg.src = photo.url;
            filmImg.alt = '';
            filmImg.loading = 'lazy';
            film.appendChild(filmImg);
            film.appendChild(utils.el('span', 'film__n', String(index + 1)));
            if (hasOwnPlacement(photo)) film.appendChild(utils.el('span', 'film__dot'));
            film.addEventListener('click', function () { selectPhoto(index); });
            strip.appendChild(film);
        });

        var count = state.photos.length;
        $('#photo-count').textContent = count === 1 ? '1 foto' : count + ' fotos';
        $('#dock-count').textContent = count ? String(count) : '';
        $('#dock-count').dataset.zero = count ? '0' : '1';
        $('#clear-photos').disabled = count === 0;
    }

    /* =============================================================
     * Vista previa
     * ============================================================= */

    function ensurePreview() {
        var photo = state.photos[state.selected];

        if (!photo) {
            state.preview = null;
            state.previewPhotoId = null;
            drawPreview();
            return;
        }
        if (state.previewPhotoId === photo.id) {
            drawPreview();
            return;
        }

        state.previewPhotoId = photo.id;
        var token = ++state.previewToken;

        utils.decodeBitmap(photo.file).then(function (bitmap) {
            if (token !== state.previewToken) {
                utils.closeQuietly(bitmap);
                return;
            }
            utils.closeQuietly(state.preview);
            state.preview = utils.shrink(bitmap, PREVIEW_MAX_WIDTH);
            drawPreview();
        }).catch(function (error) {
            console.error(error);
            photo.error = error.message || 'No se ha podido abrir';
            renderPhotos();
        });
    }

    function drawPreview() {
        var canvas = dom.canvas;
        var source = state.preview;

        dom.stageEmpty.classList.toggle('is-hidden', !!source);

        if (!source) {
            canvas.width = 1;
            canvas.height = 1;
            state.previewInfo = null;
            return;
        }

        var effective = currentAnchor();
        state.anchor.x = clamp(effective.x, 0, 1);
        state.anchor.y = clamp(effective.y, 0, 1);

        var W = source.width || source.naturalWidth;
        var H = source.height || source.naturalHeight;
        if (canvas.width !== W || canvas.height !== H) {
            canvas.width = W;
            canvas.height = H;
        }

        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, W, H);

        var mark = currentWatermarkSource();
        if (!mark) {
            state.previewInfo = null;
            return;
        }

        var info = renderer.draw(ctx, W, H, mark, drawOptions());
        state.previewInfo = info;

        setAnchor(info.place.cx / W, info.place.cy / H);
        updatePositionGrid();

        renderer.drawSelection(ctx, info, state.dragging);
    }

    function redraw() {
        drawPreview();
        saveSettings();
    }

    function updatePositionGrid() {
        var col = Math.round(state.anchor.x * 2) / 2;
        var row = Math.round(state.anchor.y * 2) / 2;
        dom.posButtons.forEach(function (button) {
            var match = Math.abs(parseFloat(button.dataset.x) - col) < 0.01 &&
                        Math.abs(parseFloat(button.dataset.y) - row) < 0.01;
            button.classList.toggle('is-active', match);
        });
    }

    function canvasPoint(event) {
        var rect = dom.canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * (dom.canvas.width / rect.width),
            y: (event.clientY - rect.top) * (dom.canvas.height / rect.height)
        };
    }

    function setupCanvasInteractions() {
        var canvas = dom.canvas;

        canvas.addEventListener('pointerdown', function (event) {
            if (state.busy || !state.previewInfo) return;
            if (event.button !== undefined && event.button > 0) return;

            var point = canvasPoint(event);
            if (!renderer.hitTest(point, state.previewInfo, drawOptions())) return;

            event.preventDefault();          // evita que la página scrollee
            state.dragging = true;
            state.dragOffset = {
                x: point.x - state.previewInfo.place.cx,
                y: point.y - state.previewInfo.place.cy
            };
            if (canvas.setPointerCapture) {
                try { canvas.setPointerCapture(event.pointerId); } catch (e) { /* puntero no capturado */ }
            }
            drawPreview();
        });

        canvas.addEventListener('pointermove', function (event) {
            if (!state.preview) return;
            if (!state.dragging) return;

            event.preventDefault();
            var point = canvasPoint(event);
            setAnchor((point.x - state.dragOffset.x) / dom.canvas.width,
                      (point.y - state.dragOffset.y) / dom.canvas.height);
            drawPreview();
        });

        function endDrag(event) {
            if (!state.dragging) return;
            state.dragging = false;
            if (canvas.releasePointerCapture && event.pointerId !== undefined) {
                try { canvas.releasePointerCapture(event.pointerId); } catch (e) { /* ya liberado */ }
            }
            drawPreview();
            saveSettings();
            buzz(8);
        }

        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);
    }

    /* =============================================================
     * Procesado
     * ============================================================= */

    function buildName(photo, settings, mime) {
        var core = utils.sanitizeName(
            (settings.prefix || '') + utils.baseName(photo.name) + (settings.suffix || '')
        );
        var ext = utils.extensionFor(mime);
        var taken = {};
        state.results.forEach(function (result) { taken[result.name.toLowerCase()] = true; });

        var candidate = core + '.' + ext;
        var counter = 2;
        while (taken[candidate.toLowerCase()]) {
            candidate = core + '_' + counter + '.' + ext;
            counter++;
        }
        return candidate;
    }

    function processPhoto(photo, plan) {
        var s = plan.settings;
        if (!plan.mark) return Promise.reject(new Error('No hay marca de agua definida'));

        return utils.decodeBitmap(photo.file).then(function (bitmap) {
            try {
                var W = bitmap.width || bitmap.naturalWidth;
                var H = bitmap.height || bitmap.naturalHeight;
                if (!W || !H) throw new Error('Imagen vacía');

                var max = Number(s.maxWidth);
                var scale = (max > 0 && W > max) ? max / W : 1;
                var outW = Math.max(1, Math.round(W * scale));
                var outH = Math.max(1, Math.round(H * scale));

                var canvas = document.createElement('canvas');
                canvas.width = outW;
                canvas.height = outH;

                var ctx = canvas.getContext('2d');
                if (s.format === 'image/jpeg') {
                    ctx.fillStyle = s.background || '#ffffff';
                    ctx.fillRect(0, 0, outW, outH);
                }
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(bitmap, 0, 0, outW, outH);
                renderer.draw(ctx, outW, outH, plan.mark, drawOptions({
                    settings: plan.settings,
                    anchor: anchorFor(photo, plan)
                }));

                return utils.canvasToBlob(canvas, s.format, Number(s.quality) / 100)
                    .then(function (blob) {
                        return {
                            id: utils.nextId(),
                            name: buildName(photo, s, blob.type || s.format),
                            blob: blob,
                            url: URL.createObjectURL(blob),
                            width: outW,
                            height: outH,
                            formatOk: (blob.type || '') === s.format
                        };
                    });
            } finally {
                utils.closeQuietly(bitmap);
            }
        });
    }

    function applyWatermark() {
        if (!canApply()) return null;

        var plan = buildPlan();
        if (!plan.mark) {
            toast('Elige primero una imagen o escribe un texto.', 'warn');
            return null;
        }

        closeSheet();
        clearResults(false);
        state.busy = true;
        state.cancelRequested = false;
        updateUI();
        setProgress(0);

        var total = state.photos.length;
        var done = 0;
        var failed = 0;
        var fallbackFormat = false;
        var started = Date.now();

        function step() {
            if (state.cancelRequested || done >= total) return Promise.resolve();

            setStatus('Procesando ' + (done + 1) + ' de ' + total + '…');
            setProgress(done / total);

            var photo = state.photos[done];
            if (!photo) return Promise.resolve();

            return processPhoto(photo, plan).then(function (result) {
                state.results.push(result);
                if (!result.formatOk) fallbackFormat = true;
            }).catch(function (error) {
                failed++;
                photo.error = error.message || 'Error al procesar';
                console.error('Error con ' + photo.name, error);
            }).then(function () {
                done++;
                renderPhotos();
                renderResults();
                buzz(6);
                return utils.yieldToUi();
            });
        }

        function run() {
            return step().then(function () {
                if (state.cancelRequested || done >= total) return null;
                return run();
            });
        }

        return run().then(function () {
            state.busy = false;
            setProgress(null);
            updateUI();
            switchTab('results');

            var seconds = ((Date.now() - started) / 1000).toFixed(1);
            buzz([12, 40, 12]);
            if (state.cancelRequested) {
                toast('Cancelado (' + done + '/' + total + ').', 'warn');
            } else if (failed) {
                toast(done + ' bien y ' + failed + ' con error.', 'warn');
            } else {
                toast(done + ' foto' + (done === 1 ? '' : 's') + ' lista' +
                    (done === 1 ? '' : 's') + ' en ' + seconds + ' s.', 'ok');
            }
            if (fallbackFormat) toast('Tu navegador no codifica WebP: se ha guardado en PNG.', 'warn');
        });
    }

    /* =============================================================
     * Resultados, descarga y compartir
     * ============================================================= */

    function renderResults() {
        var grid = $('#results-grid');
        grid.textContent = '';

        state.results.forEach(function (result) {
            var card = utils.el('figure', 'result');

            var link = utils.el('a', 'result__img');
            link.href = result.url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.title = 'Abrir ' + result.name;

            var img = document.createElement('img');
            img.src = result.url;
            img.alt = result.name;
            img.loading = 'lazy';
            link.appendChild(img);

            var caption = document.createElement('figcaption');
            var name = utils.el('span', 'result__name', result.name);
            name.title = result.name;
            caption.appendChild(name);
            caption.appendChild(utils.el('span', 'result__meta',
                result.width + '×' + result.height + ' · ' + utils.formatBytes(result.blob.size)));

            var save = utils.el('a', 'btn btn--sm', 'Guardar');
            save.href = result.url;
            save.download = result.name;
            save.setAttribute('role', 'button');

            card.appendChild(link);
            card.appendChild(caption);
            card.appendChild(save);
            grid.appendChild(card);
        });

        var totalBytes = state.results.reduce(function (sum, r) { return sum + r.blob.size; }, 0);
        $('#results-head').textContent = state.results.length
            ? state.results.length + ' imagen' + (state.results.length === 1 ? '' : 'es') +
              ' · ' + utils.formatBytes(totalBytes)
            : '';

        $('#results-empty').classList.toggle('is-hidden', state.results.length > 0);
        $('#result-count').textContent = String(state.results.length);
        $('#btn-clear-results').disabled = state.results.length === 0;
        $('#btn-download-all').hidden = state.results.length === 0;
        $('#btn-share').hidden = state.results.length === 0;
    }

    function clearResults(notify) {
        state.results.forEach(function (result) { URL.revokeObjectURL(result.url); });
        state.results = [];
        renderResults();
        if (notify) toast('Resultados descartados.');
    }

    function downloadAll() {
        if (!state.results.length || state.busy) return null;

        if (state.results.length === 1) {
            utils.download(state.results[0].blob, state.results[0].name);
            return null;
        }

        var totalBytes = state.results.reduce(function (sum, r) { return sum + r.blob.size; }, 0);
        if (totalBytes > ZIP_WARN_BYTES) {
            toast('El paquete es muy grande: puede que el móvil se quede sin memoria. ' +
                  'Guárdalas por partes.', 'warn');
        }

        state.busy = true;
        updateUI();
        setStatus('Empaquetando…');
        setProgress(0);

        var files = [];
        var index = 0;
        var chain = Promise.resolve();

        state.results.forEach(function (result) {
            chain = chain.then(function () {
                setProgress(index / state.results.length);
                index++;
                return utils.blobToBytes(result.blob).then(function (bytes) {
                    files.push({ name: result.name, data: bytes });
                });
            });
        });

        return chain.then(function () {
            setProgress(1);
            var blob = zip.create(files);
            utils.download(blob, 'marca-agua-' + utils.stamp() + '.zip');
            toast('ZIP listo (' + utils.formatBytes(blob.size) + ').', 'ok');
        }).catch(function (error) {
            console.error(error);
            toast('No se ha podido crear el ZIP: ' + error.message, 'err');
        }).then(function () {
            state.busy = false;
            setProgress(null);
            updateUI();
        });
    }

    /** Comparte los resultados con WhatsApp, correo, etc. (si el móvil lo permite). */
    function shareResults() {
        if (!state.results.length) return;

        var files = state.results.slice(0, 10).map(function (result) {
            return new File([result.blob], result.name, { type: result.blob.type });
        });

        if (!navigator.canShare || !navigator.canShare({ files: files })) {
            toast('Este navegador no permite compartir. Usa "Guardar".', 'warn');
            return;
        }

        navigator.share({
            files: files,
            title: 'Fotos con marca de agua'
        }).catch(function (error) {
            if (error && error.name === 'AbortError') return;   // el usuario canceló
            toast('No se ha podido compartir.', 'err');
        });
    }

    /* =============================================================
     * Interfaz
     * ============================================================= */

    function canApply() {
        return !state.busy && state.photos.length > 0 && !!currentWatermarkSource();
    }

    function updateUI() {
        var apply = $('#btn-apply');
        apply.disabled = !canApply();
        apply.textContent = state.busy ? 'Procesando…' : 'Aplicar marca de agua';
        $('#btn-download-all').hidden = state.results.length === 0;
        $('#btn-cancel').hidden = !state.busy;

        var s = state.settings;
        $('#wm-size').value = s.sizePct;
        $('#wm-opacity').value = s.opacity;
        $('#wm-rotation').value = s.rotation;
        $('#wm-margin').value = s.marginPct;
        $('#wm-gap').value = s.gapPct;
        $('#out-size').textContent = s.sizePct + ' %';
        $('#out-opacity').textContent = s.opacity + ' %';
        $('#out-rotation').textContent = s.rotation + '°';
        $('#out-margin').textContent = s.marginPct + ' %';
        $('#out-gap').textContent = s.gapPct + ' %';

        $('#gap-field').classList.toggle('is-hidden', !s.repeat);
        $('#quality-field').classList.toggle('is-hidden', s.format === 'image/png');
        $('#bg-field').classList.toggle('is-hidden', s.format !== 'image/jpeg');
        $('#out-quality').textContent = s.quality + ' %';
        $('#out-quality-range').value = s.quality;

        $('#wm-image-clear').disabled = !state.wmImage;
        $('#wm-linked').checked = s.linked !== false;
        $('#btn-copy-placement').classList.toggle('is-hidden', s.linked !== false);
        $('#placement-hint').textContent = s.linked
            ? 'Mueve la marca en cualquier foto: se aplicará igual en todas.'
            : 'Cada foto guarda su posición. Usa la tira de abajo para saltar de una a otra.';

        var photo = state.photos[state.selected];
        $('#preview-hint').textContent = photo
            ? 'Foto ' + (state.selected + 1) + ' de ' + state.photos.length +
              (s.linked ? '' : ' · posición propia') +
              ' · arrastra la marca con el dedo'
            : '';

        if (state.busy) return;

        if (!state.photos.length) {
            setStatus('Toca «Fotos» para elegir imágenes');
        } else if (!currentWatermarkSource()) {
            setStatus('Falta la marca de agua: ve a «Marca»');
        } else {
            setStatus(state.photos.length + ' foto' + (state.photos.length === 1 ? '' : 's') +
                ' · marca del ' + s.sizePct + ' % del ancho');
        }
    }

    function switchTab(name) {
        dom.tabs.forEach(function (tab) {
            var active = tab.dataset.tab === name;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        dom.panes.forEach(function (pane) {
            var active = pane.dataset.pane === name;
            pane.classList.toggle('is-active', active);
            pane.classList.toggle('is-hidden', !active);
        });
        updateUI();
    }

    function setWatermarkType(type) {
        state.settings.wmType = type;
        document.querySelectorAll('.seg').forEach(function (seg) {
            var active = seg.dataset.wm === type;
            seg.classList.toggle('is-active', active);
            seg.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        document.querySelectorAll('.wm-pane').forEach(function (pane) {
            pane.classList.toggle('is-hidden', pane.dataset.pane !== type);
        });
        redraw();
        updateUI();
    }

    /* =============================================================
     * Hojas deslizantes
     * ============================================================= */

    var SHEET_TITLES = {
        photos: 'Fotos',
        mark: 'Marca de agua',
        place: 'Colocación',
        output: 'Salida'
    };

    function openSheet(name) {
        if (!SHEET_TITLES[name]) return;
        state.sheet = name;
        $('#sheet-title').textContent = SHEET_TITLES[name];
        dom.sheetPanes.forEach(function (pane) {
            pane.classList.toggle('is-hidden', pane.dataset.sheet !== name);
        });
        $('#sheet').classList.remove('is-hidden');
        $('#sheet-backdrop').classList.remove('is-hidden');
        document.body.classList.add('sheet-open');
    }

    function closeSheet() {
        if (!state.sheet) return;
        state.sheet = null;
        $('#sheet').classList.add('is-hidden');
        $('#sheet-backdrop').classList.add('is-hidden');
        document.body.classList.remove('sheet-open');
    }

    /** Cierra la hoja arrastrando el tirador superior. */
    function setupSheetDrag() {
        var sheet = $('#sheet');
        var grab = $('#sheet-grab');
        var startY = 0;
        var dragging = false;

        grab.addEventListener('pointerdown', function (event) {
            dragging = true;
            startY = event.clientY;
            sheet.style.transition = 'none';
            if (grab.setPointerCapture) {
                try { grab.setPointerCapture(event.pointerId); } catch (e) { /* no capturado */ }
            }
        });

        grab.addEventListener('pointermove', function (event) {
            if (!dragging) return;
            var dy = Math.max(0, event.clientY - startY);
            sheet.style.transform = 'translateY(' + dy + 'px)';
        });

        function end(event) {
            if (!dragging) return;
            dragging = false;
            var dy = Math.max(0, event.clientY - startY);
            sheet.style.transition = '';
            sheet.style.transform = '';
            if (dy > 90) closeSheet();
        }

        grab.addEventListener('pointerup', end);
        grab.addEventListener('pointercancel', end);
    }

    /* =============================================================
     * Eventos
     * ============================================================= */

    function bindValue(id, key, cast) {
        var input = $(id);
        var handler = function () {
            state.settings[key] = cast ? cast(input.value, input) : input.value;
            redraw();
            updateUI();
        };
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
    }

    function bindCheck(id, key) {
        var input = $(id);
        input.addEventListener('change', function () {
            state.settings[key] = input.checked;
            state.textCache = null;
            redraw();
            updateUI();
        });
    }

    function pickWatermarkImage(file) {
        if (!file) return;
        utils.decodeBitmap(file).then(function (source) {
            if (state.wmImage) {
                URL.revokeObjectURL(state.wmImage.url);
                utils.closeQuietly(state.wmImage.source);
            }

            state.wmImage = {
                source: source,
                url: URL.createObjectURL(file),
                name: file.name,
                width: source.width || source.naturalWidth,
                height: source.height || source.naturalHeight
            };

            var img = $('#wm-image-preview');
            img.src = state.wmImage.url;
            img.hidden = false;
            var meta = $('#wm-image-meta');
            meta.hidden = true;
            meta.textContent = state.wmImage.width + '×' + state.wmImage.height +
                ' · ' + utils.formatBytes(file.size);

            setWatermarkType('image');
            toast('Marca de agua cargada.', 'ok');
        }).catch(function (error) {
            console.error(error);
            toast('No se ha podido cargar: ' + error.message, 'err');
        });
    }

    function clearWatermarkImage() {
        if (state.wmImage) {
            URL.revokeObjectURL(state.wmImage.url);
            utils.closeQuietly(state.wmImage.source);
            state.wmImage = null;
        }
        var img = $('#wm-image-preview');
        img.removeAttribute('src');
        img.hidden = true;
        var meta = $('#wm-image-meta');
        meta.hidden = false;
        meta.textContent = 'Ninguna imagen seleccionada';
        redraw();
        updateUI();
    }

    function setupPickers() {
        $('#photo-pick').addEventListener('click', function () { $('#photo-input').click(); });
        $('#photo-pick-cam').addEventListener('click', function () { $('#cam-input').click(); });

        ['#photo-input', '#cam-input'].forEach(function (sel) {
            var input = $(sel);
            input.addEventListener('change', function () {
                addFiles(input.files);
                input.value = '';
                closeSheet();
            });
        });

        $('#wm-pick').addEventListener('click', function () { $('#wm-input').click(); });
        $('#wm-input').addEventListener('change', function () {
            pickWatermarkImage(this.files && this.files[0]);
            this.value = '';
        });
        $('#wm-image-clear').addEventListener('click', clearWatermarkImage);

        document.querySelectorAll('.seg').forEach(function (seg) {
            seg.addEventListener('click', function () { setWatermarkType(seg.dataset.wm); });
        });
    }

    function setupDragAndDrop() {
        var overlay = $('#drop-overlay');
        var depth = 0;

        global.addEventListener('dragenter', function (event) {
            var types = event.dataTransfer ? Array.prototype.slice.call(event.dataTransfer.types || []) : [];
            if (types.indexOf('Files') < 0) return;
            event.preventDefault();
            depth++;
            overlay.classList.remove('is-hidden');
        });
        global.addEventListener('dragover', function (event) { event.preventDefault(); });
        global.addEventListener('dragleave', function () {
            depth = Math.max(0, depth - 1);
            if (depth === 0) overlay.classList.add('is-hidden');
        });
        global.addEventListener('drop', function (event) {
            event.preventDefault();
            depth = 0;
            overlay.classList.add('is-hidden');
            if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
                addFiles(event.dataTransfer.files);
            }
        });
    }

    function cacheDom() {
        dom.canvas = $('#preview-canvas');
        dom.stageEmpty = $('#stage-empty');
        dom.tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
        dom.panes = Array.prototype.slice.call(document.querySelectorAll('.tab-pane'));
        dom.posButtons = Array.prototype.slice.call(document.querySelectorAll('.pos'));
        dom.sheetPanes = Array.prototype.slice.call(document.querySelectorAll('.sheet-pane'));
    }

    function fillFontSelect() {
        var select = $('#wm-font');
        select.textContent = '';
        renderer.FONTS.forEach(function (font) {
            var option = document.createElement('option');
            option.value = font.value;
            option.textContent = font.label;
            select.appendChild(option);
        });
        select.value = state.settings.font;
    }

    function applySettingsToForm() {
        var s = state.settings;
        var anchorX = Number(s.anchorX);
        var anchorY = Number(s.anchorY);
        state.anchor.x = isFinite(anchorX) ? clamp(anchorX, 0, 1) : 0.5;
        state.anchor.y = isFinite(anchorY) ? clamp(anchorY, 0, 1) : 0.5;

        $('#wm-text').value = s.text;
        $('#wm-color').value = s.color;
        $('#wm-stroke-color').value = s.strokeColor;
        $('#wm-bold').checked = !!s.bold;
        $('#wm-italic').checked = !!s.italic;
        $('#wm-stroke').checked = !!s.stroke;
        $('#wm-repeat').checked = !!s.repeat;
        $('#wm-linked').checked = s.linked !== false;
        $('#out-format').value = s.format;
        $('#out-bg').value = s.background;
        $('#out-max').value = String(s.maxWidth);
        $('#name-prefix').value = s.prefix;
        $('#name-suffix').value = s.suffix;

        setWatermarkType(s.wmType === 'text' ? 'text' : 'image');
        updateUI();
        updatePositionGrid();
    }

    function bindForm() {
        setupPickers();
        setupDragAndDrop();

        $('#clear-photos').addEventListener('click', clearPhotos);

        bindValue('#wm-text', 'text');
        bindValue('#wm-color', 'color');
        bindValue('#wm-stroke-color', 'strokeColor');
        bindValue('#wm-font', 'font');
        bindValue('#wm-size', 'sizePct', Number);
        bindValue('#wm-opacity', 'opacity', Number);
        bindValue('#wm-rotation', 'rotation', Number);
        bindValue('#wm-margin', 'marginPct', Number);
        bindValue('#wm-gap', 'gapPct', Number);
        bindValue('#out-format', 'format');
        bindValue('#out-quality-range', 'quality', Number);
        bindValue('#out-bg', 'background');
        bindValue('#out-max', 'maxWidth', Number);
        bindValue('#name-prefix', 'prefix');
        bindValue('#name-suffix', 'suffix');
        bindCheck('#wm-bold', 'bold');
        bindCheck('#wm-italic', 'italic');
        bindCheck('#wm-stroke', 'stroke');
        bindCheck('#wm-repeat', 'repeat');

        $('#wm-linked').addEventListener('change', function () {
            state.settings.linked = this.checked;
            renderPhotos();
            redraw();
            updateUI();
        });
        $('#btn-copy-placement').addEventListener('click', copyPlacementToAll);

        dom.posButtons.forEach(function (button) {
            button.addEventListener('click', function () {
                setAnchor(parseFloat(button.dataset.x), parseFloat(button.dataset.y));
                redraw();
                buzz(6);
            });
        });

        dom.tabs.forEach(function (tab) {
            tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
        });

        document.querySelectorAll('.dock-btn').forEach(function (button) {
            button.addEventListener('click', function () {
                if (state.sheet === button.dataset.sheet) closeSheet();
                else openSheet(button.dataset.sheet);
            });
        });

        $('#sheet-backdrop').addEventListener('click', closeSheet);
        $('#sheet-close').addEventListener('click', closeSheet);
        setupSheetDrag();

        $('#btn-apply').addEventListener('click', applyWatermark);
        $('#btn-download-all').addEventListener('click', downloadAll);
        $('#btn-share').addEventListener('click', shareResults);
        $('#btn-clear-results').addEventListener('click', function () { clearResults(true); });
        $('#btn-cancel').addEventListener('click', function () {
            state.cancelRequested = true;
            setStatus('Cancelando…');
        });
    }

    function init() {
        cacheDom();
        fillFontSelect();
        applySettingsToForm();
        bindForm();
        setupCanvasInteractions();

        renderPhotos();
        renderResults();
        drawPreview();
        updateUI();

        if (!utils.canEncode('image/webp')) {
            $('#out-format option[value="image/webp"]').disabled = true;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})(window);
