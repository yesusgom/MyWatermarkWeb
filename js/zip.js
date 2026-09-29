/* =============================================================
 * zip.js — escritor de ZIP mínimo (método "store", sin comprimir)
 *
 * Las fotos ya vienen comprimidas (JPEG/PNG/WebP), así que
 * guardarlas sin recomprimir ahorra CPU y memoria. Con esto se
 * puede ofrecer "Descargar todo" en un único .zip sin usar
 * ninguna librería externa.
 * ============================================================= */
(function (global) {
    'use strict';

    var WM = (global.WM = global.WM || {});

    /* --- Tabla CRC32 (polinomio estándar 0xEDB88320) --- */
    var CRC_TABLE = (function () {
        var table = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        var c = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) {
            c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        }
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    /** Fecha y hora en el formato funky del MS-DOS que usa el formato ZIP. */
    function dosDateTime(date) {
        return {
            time: ((date.getHours() & 0x1F) << 11) |
                  ((date.getMinutes() & 0x3F) << 5) |
                  ((date.getSeconds() / 2) & 0x1F),
            date: (((date.getFullYear() - 1980) & 0x7F) << 9) |
                  (((date.getMonth() + 1) & 0x0F) << 5) |
                  (date.getDate() & 0x1F)
        };
    }

    /**
     * Crea un Blob .zip.
     * @param {Array<{name: string, data: Uint8Array}>} files
     * @returns {Blob}
     */
    function create(files) {
        if (!files || !files.length) throw new Error('No hay archivos que empaquetar');

        var encoder = new TextEncoder();
        var stamp = dosDateTime(new Date());

        var entries = files.map(function (file) {
            var data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
            return {
                nameBytes: encoder.encode(file.name),
                data: data,
                crc: crc32(data)
            };
        });

        var localSize = entries.reduce(function (sum, e) {
            return sum + 30 + e.nameBytes.length + e.data.length;
        }, 0);
        var centralSize = entries.reduce(function (sum, e) {
            return sum + 46 + e.nameBytes.length;
        }, 0);

        var out = new Uint8Array(localSize + centralSize + 22);
        var view = new DataView(out.buffer);
        var pos = 0;
        var offsets = [];

        // --- Cabecera local + datos de cada entrada ---
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            offsets.push(pos);

            view.setUint32(pos, 0x04034B50, true);          // firma
            view.setUint16(pos + 4, 20, true);             // versión necesaria
            view.setUint16(pos + 6, 0x0800, true);         // flags: nombre en UTF-8
            view.setUint16(pos + 8, 0, true);              // método 0 = store
            view.setUint16(pos + 10, stamp.time, true);
            view.setUint16(pos + 12, stamp.date, true);
            view.setUint32(pos + 14, e.crc, true);
            view.setUint32(pos + 18, e.data.length, true);  // tamaño sin comprimir
            view.setUint32(pos + 22, e.data.length, true);  // tamaño con datos
            view.setUint16(pos + 26, e.nameBytes.length, true);
            view.setUint16(pos + 28, 0, true);             // longitud de campos extra
            pos += 30;

            out.set(e.nameBytes, pos);
            pos += e.nameBytes.length;
            out.set(e.data, pos);
            pos += e.data.length;
        }

        // --- Directorio central ---
        var centralStart = pos;
        for (var j = 0; j < entries.length; j++) {
            var c = entries[j];

            view.setUint32(pos, 0x02014B50, true);
            view.setUint16(pos + 4, 20, true);             // versión del creador
            view.setUint16(pos + 6, 20, true);             // versión necesaria
            view.setUint16(pos + 8, 0x0800, true);
            view.setUint16(pos + 10, 0, true);
            view.setUint16(pos + 12, stamp.time, true);
            view.setUint16(pos + 14, stamp.date, true);
            view.setUint32(pos + 16, c.crc, true);
            view.setUint32(pos + 20, c.data.length, true);
            view.setUint32(pos + 24, c.data.length, true);
            view.setUint16(pos + 28, c.nameBytes.length, true);
            view.setUint16(pos + 30, 0, true);             // extra
            view.setUint16(pos + 32, 0, true);             // comentario
            view.setUint16(pos + 34, 0, true);             // nº de disco
            view.setUint16(pos + 36, 0, true);             // atributos internos
            view.setUint32(pos + 38, 0, true);             // atributos externos
            view.setUint32(pos + 42, offsets[j], true);    // desplazamiento local
            pos += 46;

            out.set(c.nameBytes, pos);
            pos += c.nameBytes.length;
        }

        // --- Fin del directorio central ---
        view.setUint32(pos, 0x06054B50, true);
        view.setUint16(pos + 4, 0, true);                 // nº de disco
        view.setUint16(pos + 6, 0, true);                 // disco del directorio
        view.setUint16(pos + 8, entries.length, true);
        view.setUint16(pos + 10, entries.length, true);
        view.setUint32(pos + 12, centralSize, true);
        view.setUint32(pos + 16, centralStart, true);
        view.setUint16(pos + 20, 0, true);                // comentario

        return new Blob([out], { type: 'application/zip' });
    }

    WM.zip = { create: create, crc32: crc32 };

})(window);
