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
        
        console.log('[PGSRenderer] Initialized');
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
        
        console.log(`[PGSRenderer] Canvas resized: ${rect.width}x${rect.height} (dpr: ${dpr})`);
        
        if (currentSubtitle && isActive) {
            renderSubtitle(currentSubtitle);
        }
    }
    function loadSubtitles(supData, videoDuration) {
        try {
            subtitles = PGSParser.parse(supData);
            subtitles = PGSParser.setEndTimes(subtitles, videoDuration || Infinity);
            
            if (subtitles.length > 0 && subtitles[0].width) {
                videoWidth = subtitles[0].width;
                videoHeight = subtitles[0].height;
            }
            
            console.log(`[PGSRenderer] Loaded ${subtitles.length} PGS subtitles`);
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
        console.log('[PGSRenderer] Started');
    }

    function stop() {
        isActive = false;
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
        clear();
        console.log('[PGSRenderer] Stopped');
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
        for (const sub of subtitles) {
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
            console.log(`[PGSRenderer] Canvas size mismatch, resizing from ${canvas.width}x${canvas.height} to ${expectedWidth}x${expectedHeight}`);
            updateCanvasSize();
        }
        
        ctx.clearRect(0, 0, rect.width, rect.height);
        
        const displayArea = getVideoDisplayArea();
        if (!displayArea) return;
        
        const subWidth = subtitle.width || videoWidth;
        const subHeight = subtitle.height || videoHeight;
        
        console.log(`[PGSRenderer] Rendering: sub ${subWidth}x${subHeight}, display ${Math.round(displayArea.width)}x${Math.round(displayArea.height)} at (${Math.round(displayArea.x)},${Math.round(displayArea.y)}), canvas ${Math.round(rect.width)}x${Math.round(rect.height)}`);
        
        const scaleX = displayArea.width / subWidth;
        const scaleY = displayArea.height / subHeight;
        
        for (const img of subtitle.images) {
            const expectedSize = img.width * img.height * 4;
            if (img.imageData.length !== expectedSize) {
                console.warn(`[PGSRenderer] Image data size mismatch: got ${img.imageData.length}, expected ${expectedSize}`);
            }
            
            const linePixelCounts = [];
            let totalOpaquePixels = 0;
            for (let line = 0; line < img.height; line++) {
                let count = 0;
                for (let px = 0; px < img.width; px++) {
                    const idx = (line * img.width + px) * 4 + 3;
                    if (img.imageData[idx] > 0) count++;
                }
                linePixelCounts.push(count);
                totalOpaquePixels += count;
            }
            
            const finalImageData = new ImageData(new Uint8ClampedArray(img.imageData), img.width, img.height);
            const finalWidth = img.width;
            const finalHeight = img.height;
            
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = finalWidth;
            tempCanvas.height = finalHeight;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(finalImageData, 0, 0);
            
            const destX = displayArea.x + (img.x * scaleX);
            const destY = displayArea.y + (img.y * scaleY);
            const destW = finalWidth * scaleX;
            const destH = finalHeight * scaleY;
            
            let finalOpaquePixels = 0;
            const finalData = finalImageData.data;
            for (let p = 3; p < finalData.length; p += 4) {
                if (finalData[p] > 0) finalOpaquePixels++;
            }
            
            const clipWarning = (destY + destH > rect.height) ? ' [CLIPPED!]' : '';
            
            console.log(`[PGSRenderer] Drawing ${img.width}x${img.height} at src(${img.x},${img.y}) -> dest(${Math.round(destX)},${Math.round(destY)}) size ${Math.round(destW)}x${Math.round(destH)}, opaque: ${finalOpaquePixels}${clipWarning}`);
            
            const isScaled = Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01;
            ctx.imageSmoothingEnabled = isScaled;
            ctx.imageSmoothingQuality = 'high';
            
            ctx.drawImage(tempCanvas, destX, destY, destW, destH);
        }
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

