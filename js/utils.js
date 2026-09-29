/* =============================================================
 * utils.js — utilidades compartidas (sin dependencias)
 *
 * Todo se cuelga de window.WM para poder cargar los ficheros con
 * <script> clásico. Así la web funciona incluso abriéndola con
 * doble clic (protocolo file://), donde los módulos ES están
 * bloqueados por el navegador.
 * ============================================================= */
(function (global) {
    'use strict';

    var WM = (global.WM = global.WM || {});

    var utils = {};

    /* ------------------------------------------------------------
     * DOM y números
     * ---------------------------------------------------------- */

    /** Atajo de document.querySelector: los ids se piden como '#id'. */
    utils.$ = function (selector) { return document.querySelector(selector); };

    /** Atajo de document.getElementById. */
    utils.byId = function (id) { return document.getElementById(id); };

    /** Crea un elemento; el texto se asigna con textContent (nunca innerHTML). */
    utils.el = function (tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    };

    var seq = 0;
    utils.nextId = function () { return ++seq; };

    utils.clamp = function (value, min, max) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    };

    /** Convierte bytes a texto legible (B, KB, MB, GB). */
    utils.formatBytes = function (bytes) {
        if (!isFinite(bytes) || bytes < 0) return '—';
        var units = ['B', 'KB', 'MB', 'GB'];
        var value = bytes;
        var i = 0;
        while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
        return (i === 0 ? value : value.toFixed(1)) + ' ' + units[i];
    };

    /* ------------------------------------------------------------
     * Nombres de archivo
     * ---------------------------------------------------------- */

    /** Quita los caracteres que Windows no admite en un nombre de archivo. */
    utils.sanitizeName = function (name) {
        var clean = String(name)
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/[\x00-\x1f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120);
        return clean || 'imagen';
    };

    /** Devuelve el nombre sin la extensión. */
    utils.baseName = function (name) {
        var text = String(name);
        var dot = text.lastIndexOf('.');
        return dot > 0 ? text.slice(0, dot) : text;
    };

    utils.extensionFor = function (mime) {
        if (mime === 'image/png') return 'png';
        if (mime === 'image/webp') return 'webp';
        return 'jpg';
    };

    /* ------------------------------------------------------------
     * Descargas
     * ---------------------------------------------------------- */

    /** Fuerza la descarga de un Blob con el nombre indicado. */
    utils.download = function (blob, filename) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
        // Se espera antes de liberar la URL para no cortar la descarga
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    };

    /** Marca de tiempo apta para nombres de archivo: 20260929-143205 */
    utils.stamp = function (date) {
        function pad(n) { return n < 10 ? '0' + n : '' + n; }
        var d = date || new Date();
        return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
            '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    };

    /* ------------------------------------------------------------
     * Control de flujo
     * ---------------------------------------------------------- */

    utils.debounce = function (fn, ms) {
        var timer = null;
        return function () {
            var args = arguments;
            var self = this;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(self, args); }, ms || 150);
        };
    };

    /** Cede el control al navegador un instante (mantiene la UI viva). */
    utils.yieldToUi = function () {
        return new Promise(function (resolve) { setTimeout(resolve, 0); });
    };

    /* ------------------------------------------------------------
     * Imágenes
     * ---------------------------------------------------------- */

    function closeQuietly(source) {
        if (source && typeof source.close === 'function') {
            try { source.close(); } catch (e) { /* ya estaba cerrado */ }
        }
    }
    utils.closeQuietly = closeQuietly;

    function decodeWithImageElement(file) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('El navegador no sabe decodificar este archivo'));
            };
            img.src = url;
        });
    }

    /**
     * Decodifica un File respetando la orientación EXIF.
     * createImageBitmap es la vía rápida y no bloquea la interfaz;
     * si el navegador no la soporta (SVG, formatos raros) se cae a <img>.
     */
    utils.decodeBitmap = function (file) {
        if (typeof createImageBitmap === 'function') {
            try {
                return createImageBitmap(file, { imageOrientation: 'from-image' })
                    .catch(function () { return createImageBitmap(file); })
                    .catch(function () { return decodeWithImageElement(file); });
            } catch (e) {
                // Algunos navegadores lanzan la excepción de forma síncrona
            }
        }
        return decodeWithImageElement(file);
    };

    /** Reduce una imagen a un ancho máximo. Cierra el original si es un ImageBitmap. */
    utils.shrink = function (source, maxWidth) {
        var width = source.width || source.naturalWidth || 0;
        var height = source.height || source.naturalHeight || 0;
        if (!maxWidth || !width || width <= maxWidth) return source;

        var scale = maxWidth / width;
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        closeQuietly(source);
        return canvas;
    };

    /** Exporta un canvas como Blob. */
    utils.canvasToBlob = function (canvas, type, quality) {
        return new Promise(function (resolve, reject) {
            if (canvas.toBlob) {
                canvas.toBlob(function (blob) {
                    if (blob) resolve(blob);
                    else reject(new Error('No se ha podido codificar la imagen'));
                }, type, quality);
                return;
            }
            // Navegadores muy antiguos: se recurre a dataURL
            try {
                var url = canvas.toDataURL(type, quality);
                var bin = atob(url.split(',')[1]);
                var bytes = new Uint8Array(bin.length);
                for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                resolve(new Blob([bytes], { type: type }));
            } catch (e) {
                reject(e);
            }
        });
    };

    /** Lee un Blob como Uint8Array (con FileReader como plan B). */
    utils.blobToBytes = function (blob) {
        if (blob.arrayBuffer) {
            return blob.arrayBuffer().then(function (buffer) { return new Uint8Array(buffer); });
        }
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(new Uint8Array(reader.result)); };
            reader.onerror = function () { reject(new Error('No se ha podido leer el archivo')); };
            reader.readAsArrayBuffer(blob);
        });
    };

    /** Indica si el navegador puede codificar en ese formato. */
    utils.canEncode = function (type) {
        try {
            var canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            return canvas.toDataURL(type).indexOf(type.split('/')[1]) > 0;
        } catch (e) {
            return false;
        }
    };

    WM.utils = utils;

})(window);
