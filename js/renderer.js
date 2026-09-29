/* =============================================================
 * renderer.js — cálculo y dibujado de la marca de agua
 *
 * Todo el trabajo ocurre sobre un <canvas>: la misma función
 * sirve para la vista previa y para la exportación final, así que
 * lo que ves es exactamente lo que se guarda.
 *
 * Sistema de coordenadas: la marca se dimensiona como un
 * porcentaje del ANCHO de la foto y se coloca según un ancla
 * (fracción 0..1 del centro), respetando un margen de seguridad.
 * ============================================================= */
(function (global) {
    'use strict';

    var WM = (global.WM = global.WM || {});
    var utils = WM.utils;
    var clamp = utils.clamp;

    var renderer = {};

    /* Fuentes del sistema: nada de webfonts, todo es local. */
    renderer.FONTS = [
        { label: 'Sans del sistema', value: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
        { label: 'Serif clásica', value: 'Georgia, "Times New Roman", Times, serif' },
        { label: 'Monoespaciada', value: '"Courier New", ui-monospace, Consolas, monospace' },
        { label: 'Impact / Arial Black', value: 'Impact, "Arial Black", sans-serif' },
        { label: 'Verdana', value: 'Verdana, Geneva, Tahoma, sans-serif' },
        { label: 'Trebuchet MS', value: '"Trebuchet MS", Tahoma, sans-serif' },
        { label: 'Palatino', value: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
        { label: 'Manuscrita', value: '"Brush Script MT", "Segoe Script", "Comic Sans MS", cursive' }
    ];

    var REFERENCE_FONT_SIZE = 100; // tamaño con el que se rasteriza el texto

    /**
     * Rasteriza un texto (con salto de línea) en un canvas propio.
     * Se dibuja siempre a un tamaño de referencia y luego se escala,
     * de forma que el resultado es nítido a cualquier tamaño.
     */
    renderer.textWatermark = function (text, options) {
        var lines = String(text).split('\n');
        var size = REFERENCE_FONT_SIZE;
        var font = (options.italic ? 'italic ' : '') +
                   (options.bold ? '700 ' : '400 ') +
                   size + 'px ' + (options.font || renderer.FONTS[0].value);

        var probe = document.createElement('canvas').getContext('2d');
        probe.font = font;
        var maxWidth = 1;
        for (var i = 0; i < lines.length; i++) {
            maxWidth = Math.max(maxWidth, probe.measureText(lines[i]).width);
        }

        var lineHeight = size * 1.2;
        var stroke = options.stroke !== false;
        var pad = stroke ? Math.max(3, size * 0.05) : 0;

        var canvas = document.createElement('canvas');
        canvas.width = Math.ceil(maxWidth + pad * 2);
        canvas.height = Math.ceil(lineHeight * lines.length + pad * 2);

        var ctx = canvas.getContext('2d');
        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = options.color || '#ffffff';

        if (stroke) {
            ctx.lineJoin = 'round';
            ctx.lineWidth = pad * 2;
            ctx.strokeStyle = options.strokeColor || '#000000';
        }

        for (var j = 0; j < lines.length; j++) {
            var y = pad + lineHeight * (j + 0.5);
            if (stroke) ctx.strokeText(lines[j], canvas.width / 2, y);
            ctx.fillText(lines[j], canvas.width / 2, y);
        }

        return canvas;
    };

    /**
     * Tamaño final de la marca sobre una foto de W x H.
     * El ancho es sizePct% del ancho de la foto; la altura sale de la
     * proporción original, con topes para que no se salga nunca.
     */
    renderer.size = function (source, W, H, sizePct) {
        var sw = source.width || source.naturalWidth || 1;
        var sh = source.height || source.naturalHeight || 1;

        var width = (W * sizePct) / 100;
        var height = (width * sh) / sw;

        var maxHeight = H * 0.9;
        if (height > maxHeight) {
            var k = maxHeight / height;
            height = maxHeight;
            width *= k;
        }

        var maxWidth = W * 0.98;
        if (width > maxWidth) {
            var k2 = maxWidth / width;
            width = maxWidth;
            height *= k2;
        }

        return { width: Math.max(1, width), height: Math.max(1, height) };
    };

    /**
     * Coloca la marca según el ancla y el margen de seguridad.
     * Devuelve además el centro real (ya acotado) para poder dibujar
     * el marco de selección y recuperar el ancla exacta.
     */
    renderer.placement = function (W, H, size, options) {
        var margin = (Math.min(W, H) * (options.marginPct || 0)) / 100;
        var x = W * options.anchorX - size.width / 2;
        var y = H * options.anchorY - size.height / 2;

        x = clamp(x, margin, Math.max(margin, W - margin - size.width));
        y = clamp(y, margin, Math.max(margin, H - margin - size.height));

        return {
            x: x,
            y: y,
            cx: x + size.width / 2,
            cy: y + size.height / 2,
            margin: margin
        };
    };

    function drawOne(ctx, source, x, y, width, height, rotation, opacity) {
        ctx.save();
        ctx.globalAlpha = clamp(opacity, 0, 1);
        ctx.translate(x + width / 2, y + height / 2);
        if (rotation) ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(source, -width / 2, -height / 2, width, height);
        ctx.restore();
    }

    /**
     * Dibuja la marca de agua sobre un contexto de 2D.
     * @returns {{size: Object, place: Object}} geometría usada por hitTest y por el marco
     */
    renderer.draw = function (ctx, W, H, source, options) {
        var size = renderer.size(source, W, H, options.sizePct);
        var place = renderer.placement(W, H, size, options);
        var opacity = clamp(options.opacity, 0, 1);

        if (options.repeat) {
            var gap = (Math.min(W, H) * (options.gapPct || 0)) / 100;
            var stepX = Math.max(1, size.width + gap);
            var stepY = Math.max(1, size.height + gap);
            // Fase del mosaico: se toma la posición acotada como origen
            var offX = (((place.x % stepX) + stepX) % stepX) - stepX;
            var offY = (((place.y % stepY) + stepY) % stepY) - stepY;

            for (var y = offY; y < H; y += stepY) {
                for (var x = offX; x < W; x += stepX) {
                    drawOne(ctx, source, x, y, size.width, size.height, options.rotation, opacity);
                }
            }
        } else {
            drawOne(ctx, source, place.x, place.y, size.width, size.height, options.rotation, opacity);
        }

        return { size: size, place: place };
    };

    /** ¿El punto (en píxeles del canvas) cae sobre la marca? */
    renderer.hitTest = function (point, info, options) {
        if (!info || options.repeat) return false;

        var halfW = Math.max(info.size.width / 2, 26);  // zona de agarre mínima
        var halfH = Math.max(info.size.height / 2, 26);
        var angle = -((options.rotation || 0) * Math.PI) / 180;
        var dx = point.x - info.place.cx;
        var dy = point.y - info.place.cy;
        var rx = dx * Math.cos(angle) - dy * Math.sin(angle);
        var ry = dx * Math.sin(angle) + dy * Math.cos(angle);

        return Math.abs(rx) <= halfW && Math.abs(ry) <= halfH;
    };

    /** Marco punteado alrededor de la marca (solo vista previa). */
    renderer.drawSelection = function (ctx, info, active) {
        if (!info) return;
        ctx.save();
        ctx.translate(info.place.cx, info.place.cy);
        ctx.lineWidth = Math.max(1.5, info.size.width / 220);
        ctx.setLineDash([7, 5]);
        ctx.strokeStyle = active ? '#38bdf8' : 'rgba(255, 255, 255, .8)';
        ctx.strokeRect(-info.size.width / 2, -info.size.height / 2, info.size.width, info.size.height);
        ctx.restore();
    };

    WM.renderer = renderer;

})(window);
