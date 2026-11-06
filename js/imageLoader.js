// Reads a chosen or dropped file and checks it meets the brief's limits.
var LookHereLoader = (function () {
    "use strict";

    var MIN_LONGER_SIDE = 1024;
    // Every PNG file starts with these eight bytes, whatever its name says.
    var PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

    function isPng(file) {
        return file.slice(0, 8).arrayBuffer().then(function (buffer) {
            var bytes = new Uint8Array(buffer);
            return PNG_SIGNATURE.every(function (value, i) {
                return bytes[i] === value;
            });
        });
    }

    function readPixels(file) {
        return createImageBitmap(file).then(function (bitmap) {
            var canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            var ctx = canvas.getContext("2d");
            ctx.drawImage(bitmap, 0, 0);
            return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        });
    }

    // Resolves to { ok: true, image } or { ok: false, problem, longerSide }.
    // It never rejects, so the page only has to handle one kind of answer.
    function load(file) {
        return isPng(file).then(function (png) {
            if (!png) {
                return { ok: false, problem: "notPng" };
            }
            return readPixels(file).then(function (image) {
                var longerSide = Math.max(image.width, image.height);
                if (longerSide < MIN_LONGER_SIDE) {
                    return { ok: false, problem: "tooSmall", longerSide: longerSide };
                }
                return { ok: true, image: image, name: file.name };
            });
        }).catch(function () {
            return { ok: false, problem: "unreadable" };
        });
    }

    return {
        MIN_LONGER_SIDE: MIN_LONGER_SIDE,
        load: load
    };
})();
