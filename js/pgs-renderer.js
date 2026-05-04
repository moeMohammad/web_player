const PGSRenderer = (function() {
    'use strict';

    let canvas = null;
    let ctx = null;
    let video = null;
    let subtitles = [];
    let currentSubtitle = null;
    let isActive = false;
    let animationFrame = null;
    let videoWidth = 1920;
    let videoHeight = 1080;
    const DEBUG = false;

    function debug(...args) {
        if (DEBUG) console.log(...args);
    }

    function init(videoElement, canvasElement) {
        video = videoElement;
        canvas = canvasElement;
        ctx = canvas.getContext('2d');
        
        video.addEventListener('loadedmetadata', updateCanvasSize);
        video.addEventListener('resize', updateCanvasSize);
        window.addEventListener('resize', updateCanvasSize);
        
        document.addEventListener('fullscreenchange', () => {
            setTimeout(updateCanvasSize, 100);
        });
        
        debug('[PGSRenderer] Initialized');
    }

    function getVideoDisplayArea() {
        if (!video) return null;
        
        const rect = video.getBoundingClientRect();
        const containerWidth = rect.width;
        const containerHeight = rect.height;
        
        const vidWidth = video.videoWidth || videoWidth;
        const vidHeight = video.videoHeight || videoHeight;
        
        if (vidWidth === 0 || vidHeight === 0) {
            return { x: 0, y: 0, width: containerWidth, height: containerHeight };
        }
        
        const videoAspect = vidWidth / vidHeight;
        const containerAspect = containerWidth / containerHeight;
        
        let displayWidth, displayHeight, offsetX, offsetY;
        
        if (videoAspect > containerAspect) {
            displayWidth = containerWidth;
            displayHeight = containerWidth / videoAspect;
            offsetX = 0;
            offsetY = (containerHeight - displayHeight) / 2;
        } else {
            displayHeight = containerHeight;
            displayWidth = containerHeight * videoAspect;
            offsetX = (containerWidth - displayWidth) / 2;
            offsetY = 0;
        }
        
        return {
            x: offsetX,
            y: offsetY,
            width: displayWidth,
            height: displayHeight
        };
    }

    function updateCanvasSize() {
        if (!video || !canvas) return;
        
        const rect = video.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        
        debug(`[PGSRenderer] Canvas resized: ${rect.width}x${rect.height} (dpr: ${dpr})`);
        
        if (currentSubtitle && isActive) {
            renderSubtitle(currentSubtitle);
        }
    }
    function loadSubtitles(supData, videoDuration) {
        try {
            subtitles = PGSParser.parse(supData);
            subtitles = PGSParser.setEndTimes(subtitles, videoDuration || Infinity);
            subtitles.sort((a, b) => a.startTime - b.startTime);
            
            if (subtitles.length > 0 && subtitles[0].width) {
                videoWidth = subtitles[0].width;
                videoHeight = subtitles[0].height;
            }
            
            debug(`[PGSRenderer] Loaded ${subtitles.length} PGS subtitles`);
            return subtitles.length;
        } catch (e) {
            console.error('[PGSRenderer] Failed to parse PGS:', e);
            return 0;
        }
    }

    function start() {
        if (isActive) return;
        isActive = true;
        updateCanvasSize();
        tick();
        debug('[PGSRenderer] Started');
    }

    function stop() {
        isActive = false;
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
        clear();
        debug('[PGSRenderer] Stopped');
    }

    function clear() {
        if (ctx && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        currentSubtitle = null;
    }

    function tick() {
        if (!isActive) return;
        
        const currentTime = video ? video.currentTime : 0;
        
        const subtitle = findSubtitle(currentTime);
        
        if (subtitle !== currentSubtitle) {
            currentSubtitle = subtitle;
            if (subtitle && !subtitle.clear) {
                renderSubtitle(subtitle);
            } else {
                clear();
            }
        }
        
        animationFrame = requestAnimationFrame(tick);
    }

    function findSubtitle(time) {
        let low = 0;
        let high = subtitles.length - 1;
        let latestStartedIndex = -1;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (subtitles[mid].startTime <= time) {
                latestStartedIndex = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        if (latestStartedIndex === -1) {
            return null;
        }

        for (let i = latestStartedIndex; i >= 0; i--) {
            const sub = subtitles[i];
            if (sub.endTime < time) break;
            if (time >= sub.startTime && time < sub.endTime) {
                return sub;
            }
        }

        return null;
    }

    function renderSubtitle(subtitle) {
        if (!ctx || !canvas || !subtitle.images) return;
        
        const rect = video.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        const expectedWidth = Math.round(rect.width * dpr);
        const expectedHeight = Math.round(rect.height * dpr);
        if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
            debug(`[PGSRenderer] Canvas size mismatch, resizing from ${canvas.width}x${canvas.height} to ${expectedWidth}x${expectedHeight}`);
            updateCanvasSize();
        }
        
        ctx.clearRect(0, 0, rect.width, rect.height);
        
        const displayArea = getVideoDisplayArea();
        if (!displayArea) return;
        
        const subWidth = subtitle.width || videoWidth;
        const subHeight = subtitle.height || videoHeight;
        
        debug(`[PGSRenderer] Rendering: sub ${subWidth}x${subHeight}, display ${Math.round(displayArea.width)}x${Math.round(displayArea.height)} at (${Math.round(displayArea.x)},${Math.round(displayArea.y)}), canvas ${Math.round(rect.width)}x${Math.round(rect.height)}`);
        
        const scaleX = displayArea.width / subWidth;
        const scaleY = displayArea.height / subHeight;
        
        for (const img of subtitle.images) {
            const expectedSize = img.width * img.height * 4;
            if (img.imageData.length !== expectedSize) {
                console.warn(`[PGSRenderer] Image data size mismatch: got ${img.imageData.length}, expected ${expectedSize}`);
            }
            
            const drawable = getDrawableImage(img);
            
            const destX = displayArea.x + (img.x * scaleX);
            const destY = displayArea.y + (img.y * scaleY);
            const destW = drawable.width * scaleX;
            const destH = drawable.height * scaleY;
            
            const isScaled = Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01;
            ctx.imageSmoothingEnabled = isScaled;
            ctx.imageSmoothingQuality = 'high';
            
            ctx.drawImage(drawable.canvas, destX, destY, destW, destH);
        }
    }

    function getDrawableImage(img) {
        if (img._canvas) {
            return {
                canvas: img._canvas,
                width: img._canvas.width,
                height: img._canvas.height
            };
        }

        const imageData = new ImageData(new Uint8ClampedArray(img.imageData), img.width, img.height);
        const cachedCanvas = document.createElement('canvas');
        cachedCanvas.width = img.width;
        cachedCanvas.height = img.height;
        cachedCanvas.getContext('2d').putImageData(imageData, 0, 0);
        img._canvas = cachedCanvas;

        return {
            canvas: cachedCanvas,
            width: cachedCanvas.width,
            height: cachedCanvas.height
        };
    }

    function getSubtitleCount() {
        return subtitles.length;
    }

    function isRendering() {
        return isActive;
    }

    return {
        init,
        loadSubtitles,
        start,
        stop,
        clear,
        getSubtitleCount,
        isRendering,
        updateCanvasSize
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PGSRenderer;
}
