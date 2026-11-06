// LookHere! token analysis (designFldr/tokenRules.md).
// A plain script rather than a module, so the page still works when opened by double-clicking.
var LookHereAnalysis = (function () {
    "use strict";

    // Starting values from tokenRules.md, Part 1. Thresholds are the 8-bit values that
    // Krita's levels-then-threshold steps (part G3-G4 and G6-G7) work out to.
    // Lightness greyscale matches the owner's Krita "HSV/HSL adjustment" desaturate.
    // A stronger blur (÷ 34.1) tidies still 04 but erases the swimmer in still 01,
    // so the original ÷ 51.2 stays. Extra candidates are left for the scoring to rank.
    var DEFAULTS = {
        greyMethod: "lightness",
        blurDivisor: 51.2,
        blurMode: "krita",
        darkAtOrBelow: 123,
        brightAtOrAbove: 154,
        bandDivisor: 68.27,
        bandMode: "krita",
        // Part 2: sharpness compares edge steepness with the contrast in the "grey"
        // (unblurred) or "soft" image. Contrast counts this many times in the score:
        // in build stage 2 testing, 3 was needed for the child in still 04 to beat
        // small specks between the fence pickets.
        sharpnessBase: "grey",
        contrastPower: 3,
        // Part 3: a runner-up at this share of the winner's score means "no clear token".
        rivalShare: 0.8,
        maxBoundaries: 3
    };

    function toGrey(rgba, width, height, method) {
        var count = width * height;
        var grey = new Float32Array(count);
        for (var i = 0; i < count; i++) {
            var r = rgba[i * 4];
            var g = rgba[i * 4 + 1];
            var b = rgba[i * 4 + 2];
            var v;
            switch (method) {
                case "bt601":
                    v = 0.299 * r + 0.587 * g + 0.114 * b;
                    break;
                case "lightness":
                    v = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
                    break;
                case "average":
                    v = (r + g + b) / 3;
                    break;
                default:
                    v = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            }
            grey[i] = v;
        }
        return grey;
    }

    // Krita converts a blur "radius" to a Gaussian sigma with 0.3 * radius + 0.3.
    // The other modes are there in case Krita's output turns out to match them better.
    function sigmaFromRadius(radius, mode) {
        if (mode === "half") {
            return radius / 2;
        }
        if (mode === "third") {
            return radius / 3;
        }
        return 0.3 * radius + 0.3;
    }

    function gaussianKernel(sigma) {
        var reach = Math.max(1, Math.ceil(sigma * 3));
        var kernel = new Float32Array(reach * 2 + 1);
        var sum = 0;
        for (var i = -reach; i <= reach; i++) {
            var weight = Math.exp(-(i * i) / (2 * sigma * sigma));
            kernel[i + reach] = weight;
            sum += weight;
        }
        for (var k = 0; k < kernel.length; k++) {
            kernel[k] /= sum;
        }
        return kernel;
    }

    // Rows first, then columns. Pixels past the frame repeat the nearest edge pixel,
    // so the border of the still isn't darkened by imaginary black outside it.
    function gaussianBlur(src, width, height, sigma) {
        var kernel = gaussianKernel(sigma);
        var reach = (kernel.length - 1) / 2;
        var temp = new Float32Array(src.length);
        var out = new Float32Array(src.length);
        var x, y, k, sum, n;

        for (y = 0; y < height; y++) {
            var row = y * width;
            for (x = 0; x < width; x++) {
                sum = 0;
                for (k = -reach; k <= reach; k++) {
                    n = Math.min(width - 1, Math.max(0, x + k));
                    sum += src[row + n] * kernel[k + reach];
                }
                temp[row + x] = sum;
            }
        }
        for (x = 0; x < width; x++) {
            for (y = 0; y < height; y++) {
                sum = 0;
                for (k = -reach; k <= reach; k++) {
                    n = Math.min(height - 1, Math.max(0, y + k));
                    sum += temp[n * width + x] * kernel[k + reach];
                }
                // Krita stores the softened image as 8-bit, so round to match its thresholds.
                out[y * width + x] = Math.round(sum);
            }
        }
        return out;
    }

    function maskWhere(src, test) {
        var mask = new Uint8Array(src.length);
        for (var i = 0; i < src.length; i++) {
            mask[i] = test(src[i]) ? 1 : 0;
        }
        return mask;
    }

    // Pixels on either side of a mask's edge. The frame border is not an edge,
    // because a shape cut by the frame has no boundary there.
    function outline(mask, width, height) {
        var edge = new Uint8Array(mask.length);
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var i = y * width + x;
                var v = mask[i];
                if ((x > 0 && mask[i - 1] !== v) ||
                        (x < width - 1 && mask[i + 1] !== v) ||
                        (y > 0 && mask[i - width] !== v) ||
                        (y < height - 1 && mask[i + width] !== v)) {
                    edge[i] = 1;
                }
            }
        }
        return edge;
    }

    // Approximate distance in pixels to the nearest seed pixel, and which seed that is
    // (two-pass 3-4 chamfer). Knowing the nearest seed lets a shape's outline borrow
    // the measurements of the candidate boundary beside it.
    function nearestSeed(seeds, width, height) {
        var far = 1e9;
        var d = new Float32Array(seeds.length);
        var near = new Int32Array(seeds.length);
        var x, y, i;

        function pull(i, j, step) {
            if (d[j] + step < d[i]) {
                d[i] = d[j] + step;
                near[i] = near[j];
            }
        }

        for (i = 0; i < seeds.length; i++) {
            d[i] = seeds[i] ? 0 : far;
            near[i] = seeds[i] ? i : -1;
        }
        for (y = 0; y < height; y++) {
            for (x = 0; x < width; x++) {
                i = y * width + x;
                if (x > 0) {
                    pull(i, i - 1, 3);
                }
                if (y > 0) {
                    pull(i, i - width, 3);
                    if (x > 0) {
                        pull(i, i - width - 1, 4);
                    }
                    if (x < width - 1) {
                        pull(i, i - width + 1, 4);
                    }
                }
            }
        }
        for (y = height - 1; y >= 0; y--) {
            for (x = width - 1; x >= 0; x--) {
                i = y * width + x;
                if (x < width - 1) {
                    pull(i, i + 1, 3);
                }
                if (y < height - 1) {
                    pull(i, i + width, 3);
                    if (x < width - 1) {
                        pull(i, i + width + 1, 4);
                    }
                    if (x > 0) {
                        pull(i, i + width - 1, 4);
                    }
                }
            }
        }
        for (i = 0; i < d.length; i++) {
            d[i] /= 3;
        }
        return { distance: d, nearest: near };
    }

    function distanceFrom(seeds, width, height) {
        return nearestSeed(seeds, width, height).distance;
    }

    // Stands in for Krita's Sobel edge detection: on a black-and-white image its
    // response is a band either side of each edge, as wide as the filter reaches.
    function edgeBand(mask, width, height, reach) {
        var dist = distanceFrom(outline(mask, width, height), width, height);
        var band = new Uint8Array(mask.length);
        for (var i = 0; i < mask.length; i++) {
            band[i] = dist[i] <= reach ? 1 : 0;
        }
        return band;
    }

    // Part 1 of the token rules: everywhere a dark shape directly meets a bright one.
    function findCandidates(image, overrides) {
        var s = Object.assign({}, DEFAULTS, overrides || {});
        var width = image.width;
        var height = image.height;
        var longer = Math.max(width, height);

        var blurRadius = longer / s.blurDivisor;
        var sigma = sigmaFromRadius(blurRadius, s.blurMode);
        var bandRadius = longer / s.bandDivisor;
        // "krita" assumes Krita sizes the Sobel filter the same way as its blur;
        // "full" uses the whole radius. Matching the Krita images decides which is right.
        var bandReach = s.bandMode === "full" ?
            bandRadius : Math.ceil(sigmaFromRadius(bandRadius, "krita"));

        var grey = toGrey(image.data, width, height, s.greyMethod);
        var soft = gaussianBlur(grey, width, height, sigma);
        var darks = maskWhere(soft, function (v) { return v <= s.darkAtOrBelow; });
        var brights = maskWhere(soft, function (v) { return v >= s.brightAtOrAbove; });
        var darkBand = edgeBand(darks, width, height, bandReach);
        var brightBand = edgeBand(brights, width, height, bandReach);

        var candidates = new Uint8Array(darkBand.length);
        var count = 0;
        for (var i = 0; i < candidates.length; i++) {
            if (darkBand[i] && brightBand[i]) {
                candidates[i] = 1;
                count++;
            }
        }

        return {
            width: width,
            height: height,
            settings: s,
            measures: {
                blurRadius: blurRadius,
                sigma: sigma,
                bandRadius: bandRadius,
                bandReach: bandReach,
                candidatePixels: count
            },
            grey: grey,
            soft: soft,
            darks: darks,
            brights: brights,
            darkBand: darkBand,
            brightBand: brightBand,
            candidates: candidates
        };
    }

    // How closely two masks agree, allowing a small tolerance for lines a few pixels apart.
    function compareMasks(ours, theirs, width, height, tolerance) {
        var nearOurs = distanceFrom(ours, width, height);
        var nearTheirs = distanceFrom(theirs, width, height);
        var oursCount = 0;
        var oursConfirmed = 0;
        var theirsCount = 0;
        var theirsFound = 0;
        for (var i = 0; i < ours.length; i++) {
            if (ours[i]) {
                oursCount++;
                if (nearTheirs[i] <= tolerance) {
                    oursConfirmed++;
                }
            }
            if (theirs[i]) {
                theirsCount++;
                if (nearOurs[i] <= tolerance) {
                    theirsFound++;
                }
            }
        }
        return {
            theirsFound: theirsCount ? theirsFound / theirsCount : null,
            oursConfirmed: oursCount ? oursConfirmed / oursCount : null
        };
    }

    // Splits a mask into separate shapes (4-connected). Label 0 means "not in the mask".
    function labelShapes(mask, width, height) {
        var labels = new Int32Array(mask.length);
        var areas = [0];
        var stack = [];
        var next = 1;
        for (var start = 0; start < mask.length; start++) {
            if (!mask[start] || labels[start]) {
                continue;
            }
            var area = 0;
            labels[start] = next;
            stack.push(start);
            while (stack.length) {
                var i = stack.pop();
                area++;
                var x = i % width;
                var neighbours = [
                    x > 0 ? i - 1 : -1,
                    x < width - 1 ? i + 1 : -1,
                    i >= width ? i - width : -1,
                    i < mask.length - width ? i + width : -1
                ];
                for (var n = 0; n < 4; n++) {
                    var j = neighbours[n];
                    if (j >= 0 && mask[j] && !labels[j]) {
                        labels[j] = next;
                        stack.push(j);
                    }
                }
            }
            areas.push(area);
            next++;
        }
        return { labels: labels, areas: areas, count: next - 1 };
    }

    // Edge steepness of the unblurred greyscale (3 x 3 Sobel). A clean step of
    // size D gives 4 x D, which the sharpness measure relies on.
    function gradientMagnitude(grey, width, height) {
        var mag = new Float32Array(grey.length);
        for (var y = 1; y < height - 1; y++) {
            for (var x = 1; x < width - 1; x++) {
                var i = y * width + x;
                var gx = grey[i - width + 1] + 2 * grey[i + 1] + grey[i + width + 1] -
                    grey[i - width - 1] - 2 * grey[i - 1] - grey[i + width - 1];
                var gy = grey[i + width - 1] + 2 * grey[i + width] + grey[i + width + 1] -
                    grey[i - width - 1] - 2 * grey[i - width] - grey[i - width + 1];
                mag[i] = Math.sqrt(gx * gx + gy * gy);
            }
        }
        return mag;
    }

    function windowRange(values, width, height, i, radius) {
        var cx = i % width;
        var cy = (i - cx) / width;
        var lo = Infinity;
        var hi = -Infinity;
        for (var y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y++) {
            for (var x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x++) {
                var v = values[y * width + x];
                if (v < lo) {
                    lo = v;
                }
                if (v > hi) {
                    hi = v;
                }
            }
        }
        return { lo: lo, hi: hi };
    }

    // Contrast and sharpness for every candidate pixel, measured once and shared by
    // whichever shapes it borders.
    function measureCandidates(found) {
        var w = found.width;
        var h = found.height;
        var contrast = new Float32Array(found.candidates.length);
        var sharpness = new Float32Array(found.candidates.length);
        var gradient = gradientMagnitude(found.grey, w, h);
        // Wide enough to reach both sides of the softened transition.
        var rangeRadius = Math.max(2, Math.round(2 * found.measures.sigma));
        for (var i = 0; i < found.candidates.length; i++) {
            if (!found.candidates[i]) {
                continue;
            }
            var soft = windowRange(found.soft, w, h, i, rangeRadius);
            var steep = windowRange(gradient, w, h, i, 3);
            var step = Math.max(1, soft.hi - soft.lo);
            contrast[i] = step / 255;
            // The blur shrinks small shapes' contrast, which would make them look sharper
            // than they are, so by default steepness is compared with the unblurred change.
            var base = step;
            if (found.settings.sharpnessBase === "grey") {
                var raw = windowRange(found.grey, w, h, i, rangeRadius);
                base = Math.max(1, raw.hi - raw.lo);
            }
            // 1 for a crisp step; lower when the same change is spread over several pixels.
            sharpness[i] = Math.min(1, steep.hi / (4 * base));
        }
        return { contrast: contrast, sharpness: sharpness };
    }

    // Part 2: score every dark and bright shape on contrast x sharpness x completeness.
    function scoreShapes(found) {
        var w = found.width;
        var h = found.height;
        var count = w * h;
        var reach = found.measures.bandReach + 1;
        var near = nearestSeed(found.candidates, w, h);
        var measured = measureCandidates(found);
        // Ignore specks the blur left behind: a hundredth of a percent of the frame.
        var minArea = Math.max(20, Math.round(count * 0.0001));
        var shapes = [];

        [["dark", found.darks], ["bright", found.brights]].forEach(function (pair) {
            var labelled = labelShapes(pair[1], w, h);
            var labels = labelled.labels;
            var n = labelled.count + 1;
            var outline = new Int32Array(n);
            var covered = new Int32Array(n);
            var sumContrast = new Float64Array(n);
            var sumSharpness = new Float64Array(n);

            for (var i = 0; i < count; i++) {
                var L = labels[i];
                if (!L) {
                    continue;
                }
                var x = i % w;
                var onFrame = x === 0 || x === w - 1 || i < w || i >= count - w;
                var onEdge = onFrame ||
                    labels[i - 1] !== L || labels[i + 1] !== L ||
                    labels[i - w] !== L || labels[i + w] !== L;
                if (!onEdge) {
                    continue;
                }
                outline[L]++;
                // Outline along the frame never counts as covered, so cropped shapes score lower.
                if (!onFrame && near.distance[i] <= reach) {
                    var c = near.nearest[i];
                    covered[L]++;
                    sumContrast[L] += measured.contrast[c];
                    sumSharpness[L] += measured.sharpness[c];
                }
            }

            for (var s = 1; s < n; s++) {
                if (!covered[s] || labelled.areas[s] < minArea) {
                    continue;
                }
                var completeness = covered[s] / outline[s];
                var contrast = sumContrast[s] / covered[s];
                var sharpness = sumSharpness[s] / covered[s];
                shapes.push({
                    kind: pair[0],
                    label: s,
                    labels: labels,
                    area: labelled.areas[s],
                    contrast: contrast,
                    sharpness: sharpness,
                    completeness: completeness,
                    score: Math.pow(contrast, found.settings.contrastPower) * sharpness * completeness
                });
            }
        });

        shapes.sort(function (a, b) {
            return b.score - a.score;
        });
        return { shapes: shapes, near: near, reach: reach };
    }

    // The stretch of candidate boundary along a shape's covered outline: what gets drawn.
    function boundaryOf(shape, found, scored) {
        var w = found.width;
        var count = w * found.height;
        var labels = shape.labels;
        var stretch = new Uint8Array(count);
        for (var i = 0; i < count; i++) {
            if (labels[i] !== shape.label) {
                continue;
            }
            var x = i % w;
            var onFrame = x === 0 || x === w - 1 || i < w || i >= count - w;
            if (onFrame || scored.near.distance[i] > scored.reach) {
                continue;
            }
            if (labels[i - 1] !== shape.label || labels[i + 1] !== shape.label ||
                    labels[i - w] !== shape.label || labels[i + w] !== shape.label) {
                stretch[i] = 1;
            }
        }
        var toStretch = distanceFrom(stretch, w, found.height);
        var boundary = new Uint8Array(count);
        var pixels = 0;
        for (var j = 0; j < count; j++) {
            if (found.candidates[j] && toStretch[j] <= scored.reach) {
                boundary[j] = 1;
                pixels++;
            }
        }
        return { mask: boundary, pixels: pixels };
    }

    // Part 3: the winner, and any rivals scoring at least rivalShare of it.
    function chooseToken(found) {
        var s = found.settings;
        var scored = scoreShapes(found);
        var shapes = scored.shapes;
        if (!shapes.length) {
            return { status: "none", boundaries: [], shapes: shapes };
        }

        var chosen = [{ shape: shapes[0], boundary: boundaryOf(shapes[0], found, scored) }];
        var taken = chosen[0].boundary.mask.slice();
        for (var k = 1; k < shapes.length && chosen.length < s.maxBoundaries; k++) {
            if (shapes[k].score < s.rivalShare * shapes[0].score) {
                break;
            }
            var b = boundaryOf(shapes[k], found, scored);
            // A boundary is shared by the shapes on both sides of it; only count it once.
            var shared = 0;
            for (var i = 0; i < taken.length; i++) {
                if (b.mask[i] && taken[i]) {
                    shared++;
                }
            }
            if (!b.pixels || shared / b.pixels > 0.5) {
                continue;
            }
            chosen.push({ shape: shapes[k], boundary: b });
            for (var j = 0; j < taken.length; j++) {
                taken[j] = taken[j] || b.mask[j];
            }
        }

        return {
            status: chosen.length === 1 ? "token" : "noClearToken",
            boundaries: chosen,
            shapes: shapes
        };
    }

    // The full analysis: Part 1 (candidates) then Parts 2 and 3 (scoring and choosing).
    function analyse(image, overrides) {
        var found = findCandidates(image, overrides);
        found.result = chooseToken(found);
        return found;
    }

    return {
        DEFAULTS: DEFAULTS,
        findCandidates: findCandidates,
        analyse: analyse,
        compareMasks: compareMasks,
        distanceFrom: distanceFrom
    };
})();
