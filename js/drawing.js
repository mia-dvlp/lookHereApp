// Draws the analysis result onto the image (brandGuide.md, "In the tool").
var LookHereDrawing = (function () {
    "use strict";

    var LEAF_GOLD = [201, 162, 39];
    var SILVER_BARK = [185, 187, 182];
    var BARK_DARK = [43, 29, 20];

    function paint(data, i, rgb) {
        data[i * 4] = rgb[0];
        data[i * 4 + 1] = rgb[1];
        data[i * 4 + 2] = rgb[2];
        data[i * 4 + 3] = 255;
    }

    // A Bark Dark edge round a band, so the line shows on any image.
    function drawEdge(data, mask, width, height) {
        var edge = Math.max(2, Math.round(Math.max(width, height) / 512));
        var toBand = LookHereAnalysis.distanceFrom(mask, width, height);
        for (var i = 0; i < mask.length; i++) {
            if (!mask[i] && toBand[i] <= edge) {
                paint(data, i, BARK_DARK);
            }
        }
    }

    // The band itself: gold for the token, dashed silver when it is one of several rivals.
    function drawBand(data, mask, width, height, muted) {
        var dash = Math.max(6, Math.round(Math.max(width, height) / 128));
        for (var i = 0; i < mask.length; i++) {
            if (!mask[i]) {
                continue;
            }
            if (!muted) {
                paint(data, i, LEAF_GOLD);
                continue;
            }
            var x = i % width;
            var y = (i - x) / width;
            // Diagonal stripes read as dashes whichever way the boundary runs.
            var dashOn = Math.floor((x + y) / dash) % 2 === 0;
            paint(data, i, dashOn ? SILVER_BARK : BARK_DARK);
        }
    }

    // Shows the still, with the token or rival boundaries over it when there is a result.
    function draw(canvas, image, result) {
        canvas.width = image.width;
        canvas.height = image.height;
        var ctx = canvas.getContext("2d");
        ctx.putImageData(image, 0, 0);
        if (!result || !result.boundaries.length) {
            return;
        }
        var marked = ctx.getImageData(0, 0, image.width, image.height);
        var muted = result.status !== "token";
        // All edges first, then all bands, so one boundary's edge never covers another's band.
        result.boundaries.forEach(function (b) {
            drawEdge(marked.data, b.boundary.mask, image.width, image.height);
        });
        result.boundaries.forEach(function (b) {
            drawBand(marked.data, b.boundary.mask, image.width, image.height, muted);
        });
        ctx.putImageData(marked, 0, 0);
    }

    // "testImage_1024_01.png" becomes "testImage_1024_01_lookHere.png" (screenDesign.md, Saved file).
    function savedName(originalName) {
        var base = (originalName || "image").replace(/\.png$/i, "");
        return base + "_lookHere.png";
    }

    // Saves the canvas at full size, so the copy matches the original still pixel for pixel.
    // A temporary download link is used because it works without a server, even when the
    // page is opened by double-clicking.
    function save(canvas, originalName) {
        canvas.toBlob(function (blob) {
            var url = URL.createObjectURL(blob);
            var link = document.createElement("a");
            link.href = url;
            link.download = savedName(originalName);
            document.body.appendChild(link);
            link.click();
            link.remove();
            // Give the browser a moment to start the download before releasing the copy.
            setTimeout(function () {
                URL.revokeObjectURL(url);
            }, 1000);
        }, "image/png");
    }

    return {
        draw: draw,
        save: save,
        savedName: savedName
    };
})();
