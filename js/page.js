// Runs the LookHere! page: the six states and wording in designFldr/screenDesign.md.
(function () {
    "use strict";

    // Longer messages don't fit the feedback box, so they move to smallPrint.
    var FEEDBACK_LIMIT = 100;

    // Which buttons are on in each state (screenDesign.md, button states table).
    var BUTTONS = {
        start:        { reset: false, save: false, find: false },
        loaded:       { reset: true,  save: false, find: true },
        analysing:    { reset: true,  save: false, find: false },
        token:        { reset: true,  save: true,  find: false },
        noClearToken: { reset: true,  save: true,  find: false },
        none:         { reset: true,  save: false, find: false },
        problem:      { reset: true,  save: false, find: false }
    };

    var MESSAGES = {
        start: "Load an image to begin.",
        loaded: "Image ready. Press Find token.",
        analysing: "Analysing…",
        token: "Token found. The boundary of greatest contrast is marked in gold.",
        none: "No token found. No light and dark shapes meet clearly in this image.",
        notPng: "Image can't be used. LookHere! accepts PNG files only. Press Reset to try another image.",
        unreadable: "Image can't be used. The file could not be read. Press Reset to try another image.",
        details: "Image can't be used. Details below."
    };

    var COUNT_WORDS = { 2: "Two", 3: "Three" };

    var body = document.body;
    var resetButton = document.getElementById("resetButton");
    var saveButton = document.getElementById("saveButton");
    var findButton = document.getElementById("findButton");
    var chooseButton = document.getElementById("chooseButton");
    var fileInput = document.getElementById("fileInput");
    var dropArea = document.getElementById("dropArea");
    var startPanels = document.getElementById("startPanels");
    var canvas = document.getElementById("imageCanvas");
    var feedback = document.getElementById("feedback");
    var errorDetails = document.getElementById("errorDetails");

    var current = { image: null, name: null, result: null };

    function setState(name, message) {
        var on = BUTTONS[name];
        body.setAttribute("data-state", name);
        resetButton.disabled = !on.reset;
        saveButton.disabled = !on.save;
        findButton.disabled = !on.find;
        startPanels.hidden = name !== "start";
        canvas.hidden = name === "start" || name === "problem";
        showMessage(message);
    }

    function showMessage(message) {
        if (message.length > FEEDBACK_LIMIT) {
            feedback.textContent = MESSAGES.details;
            errorDetails.textContent = message;
            errorDetails.hidden = false;
        } else {
            feedback.textContent = message;
            errorDetails.textContent = "";
            errorDetails.hidden = true;
        }
    }

    function problemMessage(answer) {
        if (answer.problem === "tooSmall") {
            return "Image can't be used. It is " + answer.longerSide.toLocaleString("en-GB") +
                " pixels on its longer side, and LookHere! needs at least " +
                LookHereLoader.MIN_LONGER_SIDE.toLocaleString("en-GB") +
                ". Press Reset to try another image.";
        }
        return MESSAGES[answer.problem] || MESSAGES.unreadable;
    }

    function noClearTokenMessage(count) {
        return "No clear token. " + (COUNT_WORDS[count] || count) +
            " boundaries compete for attention.";
    }

    function loadFile(file) {
        // Only one image at a time; Reset is the way to start again.
        if (!file || body.getAttribute("data-state") !== "start") {
            return;
        }
        LookHereLoader.load(file).then(function (answer) {
            if (!answer.ok) {
                setState("problem", problemMessage(answer));
                return;
            }
            current.image = answer.image;
            current.name = answer.name;
            current.result = null;
            LookHereDrawing.draw(canvas, answer.image, null);
            setState("loaded", MESSAGES.loaded);
        });
    }

    function findToken() {
        setState("analysing", MESSAGES.analysing);
        // A short pause lets the browser show "Analysing…" before the work blocks the page.
        setTimeout(function () {
            var result = LookHereAnalysis.analyse(current.image).result;
            current.result = result;
            LookHereDrawing.draw(canvas, current.image, result);
            if (result.status === "token") {
                setState("token", MESSAGES.token);
            } else if (result.status === "noClearToken") {
                setState("noClearToken", noClearTokenMessage(result.boundaries.length));
            } else {
                setState("none", MESSAGES.none);
            }
        }, 50);
    }

    function reset() {
        current = { image: null, name: null, result: null };
        // Clearing the input lets the same file be chosen again straight after Reset.
        fileInput.value = "";
        setState("start", MESSAGES.start);
    }

    chooseButton.addEventListener("click", function () {
        fileInput.click();
    });

    fileInput.addEventListener("change", function () {
        loadFile(fileInput.files[0]);
    });

    dropArea.addEventListener("dragover", function (event) {
        event.preventDefault();
        dropArea.classList.add("drag-over");
    });

    dropArea.addEventListener("dragleave", function () {
        dropArea.classList.remove("drag-over");
    });

    dropArea.addEventListener("drop", function (event) {
        event.preventDefault();
        dropArea.classList.remove("drag-over");
        loadFile(event.dataTransfer.files[0]);
    });

    // A file dropped anywhere else would make the browser open it and leave LookHere!.
    window.addEventListener("dragover", function (event) {
        event.preventDefault();
    });
    window.addEventListener("drop", function (event) {
        event.preventDefault();
    });

    findButton.addEventListener("click", findToken);
    resetButton.addEventListener("click", reset);
    saveButton.addEventListener("click", function () {
        LookHereDrawing.save(canvas, current.name);
    });

    // Lets the test run load a file without the file dialog, which can't be driven automatically.
    window.LookHerePage = { loadFile: loadFile };

    setState("start", MESSAGES.start);
})();
