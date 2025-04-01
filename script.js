'use strict';

// --- Configuración PDF.js ---
if (typeof pdfjsLib === 'undefined') {
    console.error("Error crítico: PDF.js (pdfjsLib) no se ha cargado correctamente.");
    alert("Error: No se pudo cargar la librería PDF. Asegúrate de tener conexión a internet.");
} else {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
}

// --- Elementos del DOM (cacheados) ---
const uploadSection = document.getElementById('upload-section');
const viewerSection = document.getElementById('viewer-section');
const pdfUploadInput = document.getElementById('pdf-upload');
const pdfUploadCollapsedInput = document.getElementById('pdf-upload-collapsed');
const statusDisplay = document.getElementById('status');
const loadedPdfNameDisplay = document.getElementById('loaded-pdf-name');

const prevPageButton = document.getElementById('prev-page');
const nextPageButton = document.getElementById('next-page');
const pageNumInput = document.getElementById('page-num-input');
const totalPagesDisplay = document.getElementById('total-pages-display');
const gotoPageButton = document.getElementById('goto-page');
const pdfViewer = document.getElementById('pdf-viewer');
const pdfCanvas = document.getElementById('pdf-canvas');
const textLayerDiv = document.getElementById('text-layer');
const prevSectionButton = document.getElementById('prev-section');
const nextSectionButton = document.getElementById('next-section');
const playPauseButton = document.getElementById('play-pause');
const sectionInfoDisplay = document.getElementById('section-info');
const voiceSelect = document.getElementById('voice-select');
const rateSlider = document.getElementById('rate-slider');
const rateValueDisplay = document.getElementById('rate-value');
const highlightIndicatorBar = document.getElementById('highlight-indicator-bar'); // Indicador lateral (de la versión nueva)
const DEFAULT_VOICE_NAME = "Microsoft Jorge Online (Natural) - Spanish (Mexico)"; // Puedes cambiar esto si prefieres otra voz

// --- Estado Global de la Aplicación ---
let pdfDoc = null;
let currentPageNum = 1;
let totalPages = 0;
let pageRendering = false; // Flag para evitar renderizados concurrentes
let pageSections = []; // Array de objetos { text: string, elements: HTMLElement[] }
let currentSectionIndex = -1; // Índice de la sección actual (-1 = ninguna)
let isPlaying = false; // Estado de reproducción TTS
let currentUtterance = null; // Referencia al objeto SpeechSynthesisUtterance actual
let availableVoices = []; // Voces TTS disponibles
let selectedVoice = null; // Voz TTS seleccionada
let currentRate = 1.0; // Velocidad de reproducción TTS
let currentFile = null; // Referencia al objeto File del PDF cargado
let pdfViewport = null; // Guardar el viewport actual para cálculos

// --- Lógica de Cambio de Vista (Expandir/Colapsar Secciones) ---
function showViewer(show = true) {
    if (show) {
        uploadSection.classList.remove('expanded');
        uploadSection.classList.add('collapsed');
        viewerSection.classList.remove('collapsed');
        viewerSection.classList.add('expanded');
    } else {
        uploadSection.classList.remove('collapsed');
        uploadSection.classList.add('expanded');
        viewerSection.classList.remove('expanded');
        viewerSection.classList.add('collapsed');
    }
}

// --- Manejo de Carga de Archivo PDF ---
function handleFileSelectionEvent(event) {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') {
        statusDisplay.textContent = "Por favor, selecciona un archivo PDF válido.";
        event.target.value = null; // Limpiar input si no es válido
        currentFile = null;
        resetApp(); // Resetear si el archivo no es válido
        return;
    }

    currentFile = file;
    processSelectedFile();
}

async function processSelectedFile() {
    if (!currentFile) return;

    statusDisplay.textContent = "Cargando PDF...";
    loadedPdfNameDisplay.textContent = currentFile.name;
    showViewer(true);
    resetViewerState(); // Limpia visor, estado y resetea indicador

    const fileReader = new FileReader();
    fileReader.onload = async function() {
        const typedarray = new Uint8Array(this.result);
        try {
            const loadingTask = pdfjsLib.getDocument({ data: typedarray });
            pdfDoc = await loadingTask.promise;
            totalPages = pdfDoc.numPages;
            statusDisplay.textContent = ``; // Nombre ya visible arriba
            currentPageNum = 1;

            // Actualizar UI y habilitar controles
            totalPagesDisplay.textContent = totalPages;
            pageNumInput.max = totalPages;
            pageNumInput.value = currentPageNum;
            pageNumInput.disabled = false;
            gotoPageButton.disabled = false;
            rateSlider.disabled = false;
            voiceSelect.disabled = availableVoices.length === 0;

            await renderPage(currentPageNum); // Renderizar la primera página

        } catch (error) {
            console.error("Error al cargar o procesar el PDF:", error);
            statusDisplay.textContent = "Error al cargar PDF.";
            loadedPdfNameDisplay.textContent = "Error";
            resetViewerState(); // Resetear si falla
            showViewer(false); // Volver a mostrar upload
            alert(`Error al procesar el PDF: ${error.message}`);
        } finally {
            updatePageButtons(); // Asegurar estado correcto de botones de página
        }
    };
    fileReader.onerror = () => {
        console.error("Error al leer el archivo PDF.");
        statusDisplay.textContent = "Error al leer el archivo.";
        loadedPdfNameDisplay.textContent = "Error";
        resetViewerState();
        showViewer(false);
        alert("Ocurrió un error al intentar leer el archivo PDF.");
    };
    fileReader.readAsArrayBuffer(currentFile);
}

// --- Renderizado de Página PDF ---
async function renderPage(num) {
    // (Esta función es la misma de la versión NUEVA)
    if (pageRendering || !pdfDoc) {
        return Promise.reject(pageRendering ? "Renderizado en progreso" : "Documento PDF no cargado");
    }

    pageRendering = true;
    currentPageNum = num;
    pageNumInput.value = currentPageNum;
    updatePageButtons(); // Deshabilitar botones durante renderizado

    // Limpiar contenido anterior y resetear indicador
    textLayerDiv.innerHTML = '';
    pageSections = [];
    currentSectionIndex = -1;
    removeHighlight(); // Resetear indicador al cambiar de página

    try {
        const page = await pdfDoc.getPage(num);

        // Calcular escala basada en el ancho del CONTENEDOR del visor
        const containerWidth = pdfViewer.clientWidth;
        const initialViewport = page.getViewport({ scale: 1 });
        const scale = containerWidth > 0 ? containerWidth / initialViewport.width : 1;
        pdfViewport = page.getViewport({ scale: scale }); // Guardar viewport

        // Configurar Canvas y TextLayer Div
        const canvasContext = pdfCanvas.getContext('2d');
        pdfCanvas.height = Math.ceil(pdfViewport.height);
        pdfCanvas.width = Math.ceil(pdfViewport.width);
        textLayerDiv.style.width = `${pdfCanvas.width}px`;
        textLayerDiv.style.height = `${pdfCanvas.height}px`;

        // Iniciar tareas de renderizado
        const renderContext = { canvasContext, viewport: pdfViewport };
        const renderTask = page.render(renderContext);
        const textContentTask = page.getTextContent();

        // Esperar ambas tareas
        await Promise.all([renderTask.promise, textContentTask]);

        // Renderizar capa de texto después de que el canvas esté listo
        const textContent = await textContentTask; // Ya resuelta arriba, pero la obtenemos
        await pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: pdfViewport,
            textDivs: [] // PDF.js v3+ necesita este array vacío
        }).promise;

        extractSectionsFromTextLayer(); // <<-- LLAMA A LA VERSIÓN ANTIGUA/CORREGIDA

        // *** Mostrar indicador en la primera seccion si existe ***
        if (pageSections.length > 0) {
            currentSectionIndex = 0; 
            // Establecer la primera seccion como actual
            highlightSection(currentSectionIndex, false)
            // Resaltar sin scroll
        } else{
            removeHighlight();
            // Asegurar que no haya highlight si la página está vacía
        }

    } catch (error) {
        console.error(`Error al renderizar página ${num}:`, error);
        // Mostrar error al usuario podría ser útil aquí
        alert(`Error renderizando página ${num}: ${error.message}`);
        // Podríamos intentar resetear o dejar la página anterior
    } finally {
        pageRendering = false;
        // Actualizar UI después de renderizar (o fallar)
        updatePageButtons();
        updateSectionButtons();
        updateSectionUI();
    }
}

// --- Extracción de Secciones de Texto ---
/**
 * Extrae bloques de texto (secciones) de los spans en textLayerDiv.
 * (ESTA ES LA FUNCIÓN DE LA VERSIÓN ANTIGUA - La que funcionaba bien)
 */
function extractSectionsFromTextLayer() {
    pageSections = [];
    const textElements = Array.from(textLayerDiv.querySelectorAll('span'));
    if (!textElements.length) {
        console.log("No se encontraron elementos de texto en la capa.");
        currentSectionIndex = -1;
        updateSectionUI(); // Actualizar UI aunque no haya secciones
        return;
    }

    // Ordenar elementos visualmente (arriba->abajo, izq->der)
    textElements.sort((a, b) => {
        const topA = parseFloat(a.style.top);
        const topB = parseFloat(b.style.top);
        const verticalTolerance = 1; // Píxeles de tolerancia (valor de la versión antigua)
        if (Math.abs(topA - topB) > verticalTolerance) {
            return topA - topB;
        } else {
            const leftA = parseFloat(a.style.left);
            const leftB = parseFloat(b.style.left);
            return leftA - leftB;
        }
    });

    let currentSection = null;
    const sentenceEndRegex = /[\.\?\!]$/; // Fin de frase simple (de la versión antigua)

    textElements.forEach(span => {
        const text = span.textContent.trim();
        if (!text) return; // Ignorar spans vacíos

        const spanTop = parseFloat(span.style.top);
        // Estimación simple de altura (de la versión antigua)
        const spanHeight = span.offsetHeight || parseFloat(span.style.fontSize) || 10;

        let startNewSection = false;

        if (!currentSection) {
            startNewSection = true;
        } else {
            const lastSectionSpan = currentSection.elements[currentSection.elements.length - 1];
            const lastSectionSpanBottom = parseFloat(lastSectionSpan.style.top) + (lastSectionSpan.offsetHeight || parseFloat(lastSectionSpan.style.fontSize) || 10);
            // Umbral de la versión antigua
            const verticalGapThreshold = spanHeight * 0.5;

            if (spanTop > lastSectionSpanBottom + verticalGapThreshold) {
                startNewSection = true; // Salto vertical significativo
            } else {
                // Misma línea o cercana: ¿termina frase anterior? (lógica antigua)
                const previousSpanText = lastSectionSpan.textContent.trim();
                if (sentenceEndRegex.test(previousSpanText)) {
                    startNewSection = true;
                }
            }
        }

        if (startNewSection) {
            // Limpiar texto de la sección anterior antes de crear la nueva
            if (currentSection) {
                 currentSection.text = currentSection.text.trim();
            }
            currentSection = { text: text, elements: [span] };
            pageSections.push(currentSection);
        } else {
            // Añadir espacio si es necesario (lógica antigua)
            const needsSpace = currentSection.text.length > 0 && !/\s$/.test(currentSection.text) && !/^\s/.test(text);
            currentSection.text += (needsSpace ? " " : "") + text;
            currentSection.elements.push(span);
        }
    });

    // Limpiar última sección y filtrar vacías
     if (currentSection) {
        currentSection.text = currentSection.text.trim();
     }
    pageSections = pageSections.filter(section => section.text.length > 0);

    currentSectionIndex = pageSections.length > 0 ? 0 : -1;
    console.log(`Extracción (v. antigua) completada: ${pageSections.length} secciones encontradas en página ${currentPageNum}.`);
    updateSectionUI(); // Actualizar UI con el número de secciones
}


// --- Navegación (Páginas y Secciones) ---
// (Funciones de la versión NUEVA, sin cambios)
function goToPrevPage() {
    if (currentPageNum <= 1 || pageRendering) return;
    stopSpeech(); // Detiene habla y resetea indicador
    renderPage(currentPageNum - 1).catch(err => console.error("Error al ir a página anterior:", err));
}

function goToNextPage() {
    if (currentPageNum >= totalPages || pageRendering) return;
    stopSpeech(); // Detiene habla y resetea indicador
    renderPage(currentPageNum + 1).catch(err => console.error("Error al ir a página siguiente:", err));
}

function goToPage() {
    if (pageRendering || !pdfDoc) return;
    const targetPage = parseInt(pageNumInput.value, 10);
    if (!isNaN(targetPage) && targetPage >= 1 && targetPage <= totalPages && targetPage !== currentPageNum) {
        stopSpeech(); // Detiene habla y resetea indicador
        renderPage(targetPage).catch(err => console.error(`Error al ir a página ${targetPage}:`, err));
    } else if (targetPage === currentPageNum) {
        console.log("Ya estás en esa página.");
    } else {
        console.warn("Número de página inválido:", pageNumInput.value);
        pageNumInput.value = currentPageNum; // Restaurar valor actual
    }
}

function goToPrevSection() {
    if (currentSectionIndex <= 0 || pageRendering || pageSections.length === 0) return;

    const wasPlaying = isPlaying;
    if (wasPlaying) {
        stopSpeech(); // Detener si estaba sonando
    }

    currentSectionIndex--;
    updateSectionUI(); // Actualizar display "Sección X / Y"

    // Decidir cómo llamar a highlightSection
    if (wasPlaying) {
        // Si acabamos de detener el habla, esperar al siguiente frame
        requestAnimationFrame(() => {
             console.log("Highlighting prev section (after stop)");
            highlightSection(currentSectionIndex, false);
        });
    } else {
        // Si no estaba sonando, resaltar inmediatamente
         console.log("Highlighting prev section (no stop)");
        highlightSection(currentSectionIndex, false);
    }

    // Opcional: Reiniciar habla si se desea (actualmente comentado)
    // if (wasPlaying) {
    //     speakSection(currentSectionIndex);
    // }

}

function goToNextSection() {
    if (pageRendering || pageSections.length === 0 || currentSectionIndex >= pageSections.length - 1) return;

    const wasPlaying = isPlaying;
    if (wasPlaying) {
         stopSpeech(); // Detener si estaba sonando
    }

    currentSectionIndex++;
    updateSectionUI(); // Actualizar display "Sección X / Y"

    // Decidir cómo llamar a highlightSection
    if (wasPlaying) {
        // Si acabamos de detener el habla, esperar al siguiente frame
        requestAnimationFrame(() => {
             console.log("Highlighting next section (after stop)");
            highlightSection(currentSectionIndex, false);
        });
    } else {
        // Si no estaba sonando, resaltar inmediatamente
         console.log("Highlighting next section (no stop)");
        highlightSection(currentSectionIndex, false);
    }

    // Opcional: Reiniciar habla si se desea (actualmente comentado)
    // if (wasPlaying) {
    //     speakSection(currentSectionIndex);
    // }

}


// --- Control de Text-to-Speech (TTS) ---
// (Funciones de la versión NUEVA, sin cambios)
function populateVoiceList() {
    if (!('speechSynthesis' in window)) {
        console.warn("Speech Synthesis no soportado.");
        voiceSelect.disabled = true;
        playPauseButton.disabled = true; // Deshabilitar play si no hay TTS
        return;
    }

    availableVoices = speechSynthesis.getVoices();
    if (availableVoices.length === 0 && 'onvoiceschanged' in speechSynthesis) {
        // A veces las voces tardan en cargar, esperar al evento
        console.log("Esperando a que carguen las voces del sistema...");
        return;
    }
     if (availableVoices.length === 0) {
        console.warn("No se encontraron voces de TTS en el sistema.");
         voiceSelect.disabled = true;
         playPauseButton.disabled = true;
         return;
    }


    const previousValue = voiceSelect.value;
    voiceSelect.innerHTML = ''; // Limpiar opciones existentes

    let defaultVoiceFound = false;
    let firstSpanishVoiceOption = null;

    availableVoices.forEach(voice => {
        const option = document.createElement('option');
        option.textContent = `${voice.name} (${voice.lang})`;
        option.value = voice.voiceURI; // Usar voiceURI como valor único
        option.setAttribute('data-lang', voice.lang);
        option.setAttribute('data-name', voice.name);
        voiceSelect.appendChild(option);

        // Intentar seleccionar default o primer español
        if (DEFAULT_VOICE_NAME && voice.name === DEFAULT_VOICE_NAME) {
            option.selected = true;
            defaultVoiceFound = true;
        }
        if (!firstSpanishVoiceOption && voice.lang.startsWith('es')) {
            firstSpanishVoiceOption = option;
        }
    });

    if (defaultVoiceFound) {
        console.log(`Voz predeterminada "${DEFAULT_VOICE_NAME}" encontrada y seleccionada.`);
    } else if (previousValue && voiceSelect.querySelector(`option[value="${previousValue}"]`)) {
        // Restaurar selección previa si aún existe
        voiceSelect.value = previousValue;
    } else if (firstSpanishVoiceOption) {
        // Usar la primera voz en español como fallback
        firstSpanishVoiceOption.selected = true;
        console.log("Voz predeterminada no encontrada. Usando primera voz en español.");
    } else if (voiceSelect.options.length > 0) {
        // Usar la primera voz disponible si no hay español
        voiceSelect.options[0].selected = true;
        console.log("Voz predeterminada ni en español encontradas. Usando primera voz disponible.");
    } else {
         console.warn("No hay voces disponibles para seleccionar.");
         voiceSelect.disabled = true; // Deshabilitar si no hay opciones
    }

    voiceSelect.disabled = pageRendering || !pdfDoc || availableVoices.length === 0;
    updateSelectedVoice();
    updateSectionButtons(); // Actualizar estado disabled basado en si hay documento
}

function updateSelectedVoice() {
    selectedVoice = availableVoices.find(voice => voice.voiceURI === voiceSelect.value) || null;
    // console.log("Voz seleccionada:", selectedVoice ? selectedVoice.name : 'Ninguna (usará default del navegador)');
}

function togglePlayPause() {
    if (!pdfDoc || pageSections.length === 0) return; // No hacer nada si no hay doc/secciones

    if (isPlaying) {
        stopSpeech(); // Detiene habla y resetea indicador
    } else {
        if (currentSectionIndex === -1 && pageSections.length > 0) { // Si no hay sección seleccionada, empezar por la primera
             currentSectionIndex = 0;
             updateSectionUI();
        }
        if (currentSectionIndex !== -1) {
            isPlaying = true; // Marcar como reproduciendo ANTES de llamar a speakSection
            updatePlayPauseButton();
            speakSection(currentSectionIndex); // speakSection se encarga de highlight/scroll
        } else {
            console.warn("No hay sección válida para reproducir.");
        }
    }
}

function speakSection(index) {
    if (index < 0 || index >= pageSections.length || !('speechSynthesis' in window)) {
        console.warn("Índice de sección inválido, TTS no soportado o no hay secciones.");
        stopSpeech(); // Asegurar estado detenido
        return;
    }
    if (pageRendering) {
        console.log("Esperando a que termine el renderizado para hablar...");
        // Podríamos reintentar después de un timeout si es necesario
        stopSpeech();
        return;
    }

    window.speechSynthesis.cancel(); // Cancelar habla anterior explícitamente

    const section = pageSections[index];
    if (!section || !section.text) {
        console.error(`Error: Sección ${index} no encontrada o sin texto.`);
        stopSpeech();
        return;
    }
    currentUtterance = new SpeechSynthesisUtterance(section.text);

    // Configurar voz y velocidad
    currentUtterance.voice = selectedVoice || undefined;
    currentUtterance.lang = selectedVoice ? selectedVoice.lang : 'es'; // Fallback a español general
    currentUtterance.rate = currentRate;

    // Event Handlers
    currentUtterance.onstart = () => {
        if (!isPlaying) return; // Si se detuvo justo antes de empezar
        console.log(`Iniciando habla sección ${index + 1}/${pageSections.length}`);
        highlightSection(index, true); // Aplicar INDICADOR y scroll al iniciar (TRUE para SCROLL)
    };

    currentUtterance.onend = () => {
        console.log(`Fin habla sección ${index + 1}`);
        currentUtterance = null;
        if (!isPlaying) return; // Si se llamó a stopSpeech() durante el habla

        // Avanzar a la siguiente sección
        currentSectionIndex++;

        if (currentSectionIndex < pageSections.length) {
            updateSectionUI();
            // Programar siguiente sección para evitar bloqueos
            setTimeout(() => { if (isPlaying) speakSection(currentSectionIndex); }, 50); // Pequeña pausa
        } else {
            // Fin de página -> intentar pasar a la siguiente
            console.log("Fin de página alcanzado durante lectura.");
            if (currentPageNum < totalPages) {
                autoTurnPageAndPlay();
            } else {
                console.log("Fin del documento alcanzado.");
                stopSpeech(); // Detener y quitar indicador final
            }
        }
    };

    currentUtterance.onerror = (event) => {
        console.error("Error en SpeechSynthesis:", event.error);
        removeHighlight(); // Quitar indicador
        currentUtterance = null;
        stopSpeech(); // Detener todo
        alert(`Error al reproducir voz: ${event.error}`);
    };

    // Asegurarse de que isPlaying sigue siendo true antes de hablar
    if (isPlaying) {
        window.speechSynthesis.speak(currentUtterance);
    } else {
        // Si isPlaying se puso a false mientras preparábamos, cancelar
        currentUtterance = null;
        removeHighlight();
        updatePlayPauseButton();
    }
}

async function autoTurnPageAndPlay() {
    if (pageRendering || currentPageNum >= totalPages) {
        console.log("No se puede pasar de página automáticamente.");
        stopSpeech();
        return;
    }

    const nextPage = currentPageNum + 1;
    console.log(`Pasando automáticamente a página ${nextPage}...`);
    try {
        await renderPage(nextPage); // Renderiza y actualiza currentPageNum internamente

        if (!isPlaying) return; // Si se detuvo mientras cargaba la página

        if (pageSections.length > 0) {
            currentSectionIndex = 0; // Empezar desde el inicio de la nueva página
            updateSectionUI();
            // Iniciar habla después de un pequeño respiro para asegurar que todo esté listo
            setTimeout(() => { if (isPlaying) speakSection(currentSectionIndex); }, 100);
        } else {
            // Página sin texto, intentar la siguiente si es posible
            console.warn(`Página ${currentPageNum} sin texto extraíble. Intentando siguiente...`);
            if (currentPageNum < totalPages) {
                 // Esperar un poco antes de intentar la siguiente página automáticamente
                 setTimeout(() => { if (isPlaying) autoTurnPageAndPlay(); }, 200);
            } else {
                console.log("Fin del documento (última página vacía).");
                stopSpeech();
            }
        }
    } catch (error) {
        console.error("Error durante el cambio de página automático:", error);
        stopSpeech();
    }
}

function stopSpeech() {
    const wasPlayingBeforeStop = isPlaying; // Recordar si estaba sonando
    isPlaying = false; // Marcar como detenido INMEDIATAMENTE

    if (window.speechSynthesis) {
        if (currentUtterance) {
            // Quitar listeners para evitar ejecución post-cancelación (importante)
            currentUtterance.onstart = null;
            currentUtterance.onend = null;
            currentUtterance.onerror = null;
            currentUtterance = null; // Limpiar referencia
        }
        window.speechSynthesis.cancel(); // Detener cualquier habla pendiente o activa
    }

    if (wasPlayingBeforeStop) { // Solo actuar sobre UI si realmente estaba sonando
        console.log("Reproducción detenida.");
        //removeHighlight(); // Resetear INDICADOR
    }
    updatePlayPauseButton(); // Actualizar botón a estado 'Leer'
}

// --- Funciones de UI y Estado (Indicador, Botones, Info) ---
// (Funciones de la versión NUEVA, usan highlightIndicatorBar)

/**
 * Aplica el indicador lateral a la sección indicada y opcionalmente hace scroll.
 * @param {number} index - Índice de la sección.
 * @param {boolean} [shouldScroll=false] - Si debe hacer scroll para centrar la sección.
 */
function highlightSection(index, shouldScroll = false) {
    if (!highlightIndicatorBar || !pdfViewer || !pdfDoc || pageSections.length === 0) {
        removeHighlight(); // Asegurar que no hay indicador si algo falta
        return;
    }

    // Validar índice
    if (index < 0 || index >= pageSections.length) {
        console.warn(`Índice de sección inválido para highlight: ${index}`);
        removeHighlight();
        return;
    }

    const section = pageSections[index];
    if (!section || !section.elements || section.elements.length === 0) {
         console.warn(`Sección ${index} no tiene elementos para resaltar.`);
         removeHighlight();
         return;
    }

    const firstElement = section.elements[0];
    const lastElement = section.elements[section.elements.length - 1];

    // Obtener rectángulos relativos al viewport de la ventana
    const viewerRect = pdfViewer.getBoundingClientRect();
    const firstRect = firstElement.getBoundingClientRect();
    const lastRect = lastElement.getBoundingClientRect();

    // Calcular posiciones Top y Bottom relativas al CONTENEDOR pdfViewer
    // Sumamos pdfViewer.scrollTop para coordenadas dentro del contenido scrolleable del visor
    // (si el propio visor tuviera scroll interno, si no, es 0)
    const relativeTop = firstRect.top - viewerRect.top + (pdfViewer.scrollTop || 0);
    const relativeBottom = lastRect.bottom - viewerRect.top + (pdfViewer.scrollTop || 0);


    // Calcular altura
    let highlightHeight = relativeBottom - relativeTop;

    // Validar dimensiones calculadas
    if (highlightHeight <= 0 || isNaN(relativeTop) || isNaN(highlightHeight)) {
        console.warn(`Dimensiones de indicador inválidas: Top=${relativeTop}, Height=${highlightHeight}. Elementos:`, firstElement, lastElement);
        removeHighlight();
        return;
    }

    // Asegurar que Top no sea negativo (puede pasar con elementos muy arriba)
    const finalTop = Math.max(0, relativeTop);
    // Ajustar altura si top fue clampeado
    if (finalTop > relativeTop) {
        highlightHeight -= (finalTop - relativeTop);
        if (highlightHeight <= 0) {
             removeHighlight(); return;
        }
    }
    // Asegurar que el indicador no se salga por abajo del canvas/textLayer
    const maxIndicatorBottom = pdfCanvas.height; // Usar altura del canvas como límite
    if (finalTop + highlightHeight > maxIndicatorBottom) {
        highlightHeight = Math.max(1, maxIndicatorBottom - finalTop); // Asegurar altura mínima
    }


    // Aplicar estilos al indicador
    highlightIndicatorBar.style.top = `${finalTop}px`;
    highlightIndicatorBar.style.height = `${highlightHeight}px`;
    highlightIndicatorBar.classList.add('active'); // Hacer visible/opaco

    // console.log(`Highlighting Section ${index + 1}: Top=${finalTop.toFixed(1)}px, Height=${highlightHeight.toFixed(1)}px`);


    // --- Scroll para centrar la sección en la ventana del NAVEGADOR ---
    if (shouldScroll) {
        // Centro vertical del indicador DENTRO del pdfViewer (relativo a su contenido scrolleable si lo tuviera)
        const indicatorCenterInViewer = finalTop + (highlightHeight / 2);
        // Centro vertical del indicador RELATIVO al DOCUMENTO de la página web
        const indicatorCenterDocumentY = viewerRect.top + window.scrollY + indicatorCenterInViewer - (pdfViewer.scrollTop || 0);

        // Calcular la posición Y a la que debe scrollear la VENTANA
        const targetScrollY = indicatorCenterDocumentY - (window.innerHeight / 2);

        // console.log(`Scrolling: viewerRect.top=${viewerRect.top.toFixed(1)}, scrollY=${window.scrollY.toFixed(1)}, finalTop=${finalTop.toFixed(1)}, scrollTop=${pdfViewer.scrollTop.toFixed(1)}, targetScrollY=${targetScrollY.toFixed(1)}`);

        window.scrollTo({
            top: Math.max(0, targetScrollY), // Evitar scroll negativo
            behavior: 'smooth'
        });
    }
}

/**
 * Resetea el indicador lateral (lo oculta).
 */
function removeHighlight() {
     if (!highlightIndicatorBar) return;
    // console.log("Removing highlight (hiding indicator bar)");
    highlightIndicatorBar.style.height = '0';
    highlightIndicatorBar.style.top = '0'; // Resetear top también
    highlightIndicatorBar.classList.remove('active'); // Quitar opacidad
}

/**
 * Habilita/Deshabilita los botones de navegación de página.
 */
function updatePageButtons() {
    const docLoaded = pdfDoc !== null;
    prevPageButton.disabled = pageRendering || !docLoaded || currentPageNum <= 1;
    nextPageButton.disabled = pageRendering || !docLoaded || currentPageNum >= totalPages;
    pageNumInput.disabled = pageRendering || !docLoaded;
    gotoPageButton.disabled = pageRendering || !docLoaded;
}

/**
 * Habilita/Deshabilita los botones de navegación de sección y controles TTS.
 */
function updateSectionButtons() {
    const docLoaded = pdfDoc !== null;
    const sectionsAvailable = pageSections.length > 0;
    const ttsAvailable = 'speechSynthesis' in window && availableVoices.length > 0;

    // Navegación de Sección
    prevSectionButton.disabled = pageRendering || !docLoaded || !sectionsAvailable || currentSectionIndex <= 0;
    nextSectionButton.disabled = pageRendering || !docLoaded || !sectionsAvailable || currentSectionIndex >= pageSections.length - 1;

    // Controles TTS Principales
    playPauseButton.disabled = pageRendering || !docLoaded || !sectionsAvailable || !ttsAvailable;
    voiceSelect.disabled = pageRendering || !docLoaded || !ttsAvailable;
    rateSlider.disabled = pageRendering || !docLoaded || !ttsAvailable; // Depende de si hay algo que leer
}

/**
 * Actualiza el texto y título del botón Play/Pause.
 */
function updatePlayPauseButton() {
    playPauseButton.textContent = isPlaying ? '⏹️ Detener' : '▶️ Leer';
    playPauseButton.title = isPlaying ? 'Detener Lectura' : 'Iniciar Lectura Continua';
}

/**
 * Actualiza el display de información de la sección actual.
 */
function updateSectionUI() {
    if (pageSections.length > 0 && currentSectionIndex >= 0 && currentSectionIndex < pageSections.length) {
        sectionInfoDisplay.textContent = `Sección ${currentSectionIndex + 1} / ${pageSections.length}`;
    } else {
        sectionInfoDisplay.textContent = `Sección 0 / ${pageSections.length}`;
    }
    updateSectionButtons(); // Siempre actualizar estado de botones al cambiar sección
}

/**
 * Resetea el estado relacionado específicamente con el visor de PDF y TTS.
 */
function resetViewerState() {
    stopSpeech(); // Detiene habla y llama a removeHighlight()

    pdfDoc = null; currentPageNum = 1; totalPages = 0; pageRendering = false;
    pageSections = []; currentSectionIndex = -1; isPlaying = false; currentUtterance = null;
    pdfViewport = null; // Limpiar viewport guardado

    // Limpiar UI del visor
    textLayerDiv.innerHTML = '';
    try {
        const ctx = pdfCanvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
        }
        pdfCanvas.width = 1; pdfCanvas.height = 1; // Reducir tamaño
    } catch (e) { console.warn("No se pudo limpiar el canvas:", e); }

    totalPagesDisplay.textContent = '0'; pageNumInput.value = ''; pageNumInput.max = '1';
    sectionInfoDisplay.textContent = "Sección 0 / 0";

    // Deshabilitar/Resetear botones del visor
    updatePageButtons(); updateSectionButtons(); updatePlayPauseButton();
    removeHighlight(); // Asegurar que el indicador se oculte al resetear
}

/**
 * Resetea la aplicación completa a su estado inicial.
 */
function resetApp() {
    showViewer(false); // Mostrar sección de carga
    resetViewerState(); // Limpiar estado/UI del visor
    statusDisplay.textContent = "No hay PDF cargado.";
    loadedPdfNameDisplay.textContent = "Ninguno";
    currentFile = null;
    // Limpiar inputs de archivo para permitir recargar mismo archivo
    if (pdfUploadInput) pdfUploadInput.value = null;
    if (pdfUploadCollapsedInput) pdfUploadCollapsedInput.value = null;
}


// --- Inicialización y Asignación de Event Listeners ---
// (Funciones de la versión NUEVA, sin cambios)
function setupEventListeners() {
    // Carga de archivo
    pdfUploadInput.addEventListener('change', handleFileSelectionEvent);
    pdfUploadCollapsedInput.addEventListener('change', handleFileSelectionEvent);

    // Navegación de página
    prevPageButton.addEventListener('click', goToPrevPage);
    nextPageButton.addEventListener('click', goToNextPage);
    gotoPageButton.addEventListener('click', goToPage);
    pageNumInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); goToPage(); }
    });
     pageNumInput.addEventListener('change', () => { // Opcional: ir al cambiar si pierde foco
         // Solo ir a página si el input pierde el foco y NO es el botón de ir
         if (document.activeElement !== pageNumInput && document.activeElement !== gotoPageButton) {
             goToPage();
         }
     });


    // Navegación de sección
    prevSectionButton.addEventListener('click', goToPrevSection);
    nextSectionButton.addEventListener('click', goToNextSection);

    // Control TTS
    playPauseButton.addEventListener('click', togglePlayPause);

    // Cambio de voz
    voiceSelect.addEventListener('change', () => {
        const wasPlaying = isPlaying;
        if (wasPlaying) stopSpeech(); // Detener antes de cambiar
        updateSelectedVoice();
        if (wasPlaying && currentSectionIndex !== -1 && pageSections.length > 0) { // Reiniciar si estaba sonando y hay secciones válidas
             setTimeout(() => { // Dar tiempo a que se asiente el cambio
                 isPlaying = true; // Marcar de nuevo
                 updatePlayPauseButton();
                 speakSection(currentSectionIndex);
             }, 50);
        } else {
            // Si no estaba sonando o no hay sección válida, solo actualizar la voz seleccionada
            // y dejar los botones en el estado correcto (probablemente deshabilitado o 'Leer')
             updatePlayPauseButton(); // Asegurar que el botón refleje el estado isPlaying=false
             updateSectionButtons(); // Re-evaluar la disponibilidad de botones
        }
    });

    // Cambio de velocidad
    rateSlider.addEventListener('input', (event) => {
        currentRate = parseFloat(event.target.value);
        rateValueDisplay.textContent = currentRate.toFixed(1);

        // Intenta ajustar la velocidad en caliente si hay una locución activa
        if (isPlaying && currentUtterance) {
            // Cancelar y reiniciar la sección actual con la nueva velocidad puede ser más fiable
            const currentIndex = currentSectionIndex; // Guardar índice
             window.speechSynthesis.cancel(); // Cancelar habla actual
             // Pequeña pausa antes de reiniciar para evitar problemas de timing
             setTimeout(() => {
                 if(isPlaying && currentIndex === currentSectionIndex) { // Re-confirmar estado y que no se haya cambiado de sección
                     console.log(`Reiniciando habla sección ${currentIndex + 1} con nueva velocidad ${currentRate}`);
                     speakSection(currentIndex);
                 }
             }, 50);

        }
    });

    // Voces del sistema
    if ('speechSynthesis' in window && 'onvoiceschanged' in speechSynthesis) {
        speechSynthesis.onvoiceschanged = populateVoiceList;
    } else {
         // Si onvoiceschanged no está disponible, intenta cargar las voces una vez
         populateVoiceList();
    }
}

/**
 * Función de inicialización principal.
 */
function initializeApp() {
    console.log("DOM cargado. Inicializando aplicación...");
    if (!pdfjsLib) {
        console.error("PDF.js no disponible. La aplicación no puede funcionar.");
        statusDisplay.textContent = "Error crítico: Falta librería PDF.";
        alert("Error crítico: No se pudo cargar la librería PDF.js.");
        return; // Detener inicialización
    }
    populateVoiceList(); // Intentar cargar voces (puede ser asíncrono)
    setupEventListeners(); // Configurar listeners
    resetApp(); // Establecer estado inicial UI
    console.log("Aplicación inicializada.");
}

// --- Ejecución Inicial ---
// Esperar a que el DOM esté completamente cargado
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // DOM ya cargado
    initializeApp();
}