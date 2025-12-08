

const VideoPlayer = (function() {
    'use strict';

    
    let video = null;
    let playerContainer = null;
    let controls = null;
    let progressBar = null;
    let progressFill = null;
    let bufferBar = null;
    let playPauseBtn = null;
    let playIcon = null;
    let pauseIcon = null;
    let muteBtn = null;
    let volumeIcon = null;
    let mutedIcon = null;
    let volumeSlider = null;
    let currentTimeEl = null;
    let durationEl = null;
    let subtitleSelect = null;
    let audioSelect = null;
    let fullscreenBtn = null;
    let fullscreenIcon = null;
    let exitFullscreenIcon = null;
    let loadingOverlay = null;
    let loadingText = null;
    let fileNameEl = null;

    
    let currentFile = null;
    let processedMkvData = null;
    let controlsTimeout = null;
    let cursorTimeout = null;
    let isControlsVisible = false;
    let lastVolume = 1;
    
    
    let subtitleScale = 0.7;  
    let subtitlePosition = 6;

    
    function init() {
        
        video = document.getElementById('video-player');
        playerContainer = document.getElementById('player-container');
        controls = document.getElementById('controls');
        progressBar = document.getElementById('progress-bar');
        progressFill = document.getElementById('progress-fill');
        bufferBar = document.getElementById('buffer-bar');
        playPauseBtn = document.getElementById('play-pause-btn');
        playIcon = document.getElementById('play-icon');
        pauseIcon = document.getElementById('pause-icon');
        muteBtn = document.getElementById('mute-btn');
        volumeIcon = document.getElementById('volume-icon');
        mutedIcon = document.getElementById('muted-icon');
        volumeSlider = document.getElementById('volume-slider');
        currentTimeEl = document.getElementById('current-time');
        durationEl = document.getElementById('duration');
        subtitleSelect = document.getElementById('subtitle-select');
        audioSelect = document.getElementById('audio-select');
        fullscreenBtn = document.getElementById('fullscreen-btn');
        fullscreenIcon = document.getElementById('fullscreen-icon');
        exitFullscreenIcon = document.getElementById('exit-fullscreen-icon');
        loadingOverlay = document.getElementById('loading-overlay');
        loadingText = document.getElementById('loading-text');
        fileNameEl = document.getElementById('file-name');

        
        SubtitleRenderer.init(video, document.getElementById('subtitle-overlay'));
        
        PGSRenderer.init(video, document.getElementById('pgs-canvas'));

        
        setupVideoEvents();
        setupControlEvents();
        setupKeyboardShortcuts();
        setupSubtitleSettings();

        console.log('Video player initialized');
    }

    
    function setupSubtitleSettings() {
        const settingsBtn = document.getElementById('subtitle-settings-btn');
        const settingsPopup = document.getElementById('subtitle-settings-popup');
        const sizeUp = document.getElementById('sub-size-up');
        const sizeDown = document.getElementById('sub-size-down');
        const sizeValue = document.getElementById('sub-size-value');
        const posUp = document.getElementById('sub-pos-up');
        const posDown = document.getElementById('sub-pos-down');
        const posValue = document.getElementById('sub-pos-value');

        
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsPopup.classList.toggle('hidden');
        });

        
        document.addEventListener('click', (e) => {
            if (!settingsPopup.contains(e.target) && e.target !== settingsBtn) {
                settingsPopup.classList.add('hidden');
            }
        });

        
        settingsPopup.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        
        sizeUp.addEventListener('click', () => {
            subtitleScale = Math.min(2.5, subtitleScale + 0.1);
            updateSubtitleStyles();
            sizeValue.textContent = Math.round(subtitleScale * 100) + '%';
        });

        sizeDown.addEventListener('click', () => {
            subtitleScale = Math.max(0.5, subtitleScale - 0.1);
            updateSubtitleStyles();
            sizeValue.textContent = Math.round(subtitleScale * 100) + '%';
        });

        
        posUp.addEventListener('click', () => {
            subtitlePosition = Math.min(40, subtitlePosition + 2);
            updateSubtitleStyles();
            posValue.textContent = subtitlePosition + '%';
        });

        posDown.addEventListener('click', () => {
            subtitlePosition = Math.max(2, subtitlePosition - 2);
            updateSubtitleStyles();
            posValue.textContent = subtitlePosition + '%';
        });

        
        sizeValue.textContent = Math.round(subtitleScale * 100) + '%';
        posValue.textContent = subtitlePosition + '%';
        updateSubtitleStyles();
    }

    
    function updateSubtitleStyles() {
        document.documentElement.style.setProperty('--subtitle-scale', subtitleScale);
        document.documentElement.style.setProperty('--subtitle-position', subtitlePosition + '%');
    }

    
    function setupVideoEvents() {
        video.addEventListener('loadedmetadata', () => {
            durationEl.textContent = formatTime(video.duration);
            progressBar.max = video.duration;
            hideLoading();
        });

        video.addEventListener('timeupdate', () => {
            if (!isNaN(video.duration)) {
                currentTimeEl.textContent = formatTime(video.currentTime);
                progressBar.value = video.currentTime;
                const percent = (video.currentTime / video.duration) * 100;
                progressFill.style.width = `${percent}%`;
            }
        });

        video.addEventListener('progress', updateBufferBar);

        video.addEventListener('play', () => {
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
            
            if (document.fullscreenElement) {
                hideCursorDelayed();
                hideControlsDelayed();
            }
        });

        video.addEventListener('pause', () => {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
            
            showCursor();
            showControlsTemporarily();
        });

        video.addEventListener('volumechange', () => {
            updateVolumeUI();
        });

        video.addEventListener('ended', () => {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
        });

        video.addEventListener('waiting', () => {
            showLoading('Buffering...');
        });

        video.addEventListener('canplay', () => {
            hideLoading();
        });

        video.addEventListener('error', (e) => {
            hideLoading();
            const error = video.error;
            let errorMessage = 'Unknown error';
            
            if (error) {
                switch (error.code) {
                    case MediaError.MEDIA_ERR_ABORTED:
                        errorMessage = 'Playback aborted by user';
                        break;
                    case MediaError.MEDIA_ERR_NETWORK:
                        errorMessage = 'Network error while loading video';
                        break;
                    case MediaError.MEDIA_ERR_DECODE:
                        errorMessage = 'Video decoding failed. The codec may not be supported by your browser.';
                        break;
                    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorMessage = 'Video format not supported. The video codec (likely HEVC/H.265) is not supported by your browser.';
                        break;
                    default:
                        errorMessage = `Error code: ${error.code}, message: ${error.message || 'none'}`;
                }
            }
            
            console.error('Video error:', errorMessage, error);
            alert(`Error playing video: ${errorMessage}\n\nTip: If your MKV contains HEVC/H.265 video, it may not be supported. Try a video with H.264 codec.`);
        });

        
        video.addEventListener('dblclick', toggleFullscreen);

        
        video.addEventListener('click', togglePlayPause);
    }

    
    function setupControlEvents() {
        
        playPauseBtn.addEventListener('click', togglePlayPause);

        
        progressBar.addEventListener('input', () => {
            video.currentTime = progressBar.value;
            const percent = (progressBar.value / video.duration) * 100;
            progressFill.style.width = `${percent}%`;
        });

        
        muteBtn.addEventListener('click', toggleMute);
        volumeSlider.addEventListener('input', () => {
            const volume = parseFloat(volumeSlider.value);
            video.volume = volume;
            if (volume > 0) {
                video.muted = false;
            }
        });

        
        subtitleSelect.addEventListener('change', async () => {
            const trackIndex = parseInt(subtitleSelect.value);
            if (trackIndex === -1) {
                SubtitleRenderer.disableAllTracks();
                PGSRenderer.stop();
                return;
            }
            
            
            if (processedMkvData && processedMkvData.subtitleStreams) {
                const streamInfo = processedMkvData.subtitleStreams[trackIndex];
                
                if (streamInfo && streamInfo.isBitmap) {
                    SubtitleRenderer.disableAllTracks();
                    
                    if (!streamInfo.pgsExtracted) {
                        try {
                            showLoading('Extracting PGS subtitle (this may take a moment)...');
                            const pgsData = await FFmpegHandler.extractPgsSubtitle(
                                currentFile,
                                trackIndex,
                                streamInfo.language,
                                (msg) => showLoading(msg)
                            );
                            
                            if (pgsData && pgsData.supData) {
                                const count = PGSRenderer.loadSubtitles(pgsData.supData, video.duration);
                                if (count > 0) {
                                    streamInfo.pgsExtracted = true;
                                    streamInfo.pgsData = pgsData;
                                    PGSRenderer.start();
                                    hideLoading();
                                } else {
                                    hideLoading();
                                    alert('Failed to parse PGS subtitle data. The format may be unsupported.');
                                    subtitleSelect.value = '-1';
                                    return;
                                }
                            } else {
                                hideLoading();
                                alert('Failed to extract PGS subtitle.');
                                subtitleSelect.value = '-1';
                                return;
                            }
                        } catch (e) {
                            console.error('Failed to extract PGS subtitle:', e);
                            hideLoading();
                            alert('Failed to extract PGS subtitle: ' + e.message);
                            subtitleSelect.value = '-1';
                            return;
                        }
                    } else {
                        if (streamInfo.pgsData && streamInfo.pgsData.supData) {
                            PGSRenderer.loadSubtitles(streamInfo.pgsData.supData, video.duration);
                        }
                        PGSRenderer.start();
                    }
                    return;
                }
                
                PGSRenderer.stop();
                
                if (streamInfo && !streamInfo.extracted) {
                    try {
                        showLoading('Extracting subtitle...');
                        const subtitle = await FFmpegHandler.extractSubtitle(
                            currentFile,
                            trackIndex,
                            streamInfo.language,
                            (msg) => showLoading(msg),
                            streamInfo.codec
                        );
                        
                        if (subtitle) {
                            if (subtitle.isBitmap || subtitle.error) {
                                hideLoading();
                                streamInfo.isBitmap = true;
                                subtitleSelect.dispatchEvent(new Event('change'));
                                return;
                            }
                            
                            const rendererIndex = SubtitleRenderer.addTrack(subtitle.content, subtitle.label, subtitle.language);
                            streamInfo.extracted = true;
                            streamInfo.rendererIndex = rendererIndex;
                            processedMkvData.subtitles.push(subtitle);
                        }
                        hideLoading();
                    } catch (e) {
                        console.error('Failed to extract subtitle:', e);
                        hideLoading();
                        alert('Failed to extract subtitle track: ' + e.message);
                        subtitleSelect.value = '-1';
                        return;
                    }
                }
                
                
                if (streamInfo && streamInfo.extracted) {
                    SubtitleRenderer.enableTrack(streamInfo.rendererIndex);
                }
            } else {
                
                SubtitleRenderer.enableTrack(trackIndex);
            }
        });

        
        audioSelect.addEventListener('change', async () => {
            if (!processedMkvData || !currentFile) return;

            const audioIndex = parseInt(audioSelect.value);
            const currentTime = video.currentTime;
            const wasPlaying = !video.paused;

            try {
                // Check if in direct playback mode (large file)
                if (processedMkvData.isDirectPlayback) {
                    const audioTrack = processedMkvData.audioTracks[audioIndex];
                    
                    if (audioTrack && audioTrack.unsupported) {
                        // Show warning for unsupported audio
                        const codecName = audioTrack.codec?.toUpperCase() || 'Unknown';
                        alert(`Audio format "${codecName}" is not supported by your browser.\n\nTo play this audio track, please convert the file using FFmpeg or HandBrake:\n\nffmpeg -i input.mkv -c:v copy -c:a aac output.mkv`);
                        
                        // Reset selection to previous track
                        audioSelect.value = '0';
                        return;
                    }
                    
                    // Audio track switching in direct mode not fully supported
                    console.log('Audio track is browser-supported, but track switching requires remuxing');
                    return;
                }
                
                // Standard mode - transmux with selected audio track
                showLoading('Switching audio track...');

                
                if (processedMkvData.videoUrl) {
                    URL.revokeObjectURL(processedMkvData.videoUrl);
                }

                
                const newUrl = await FFmpegHandler.transmuxToMp4(
                    currentFile,
                    audioIndex,
                    (msg) => showLoading(msg)
                );

                processedMkvData.videoUrl = newUrl;
                video.src = newUrl;
                
                
                video.addEventListener('loadedmetadata', function onLoad() {
                    video.currentTime = currentTime;
                    if (wasPlaying) {
                        video.play();
                    }
                    video.removeEventListener('loadedmetadata', onLoad);
                });

                hideLoading();
            } catch (error) {
                console.error('Error switching audio track:', error);
                hideLoading();
                alert('Failed to switch audio track: ' + error.message);
            }
        });

        
        fullscreenBtn.addEventListener('click', toggleFullscreen);
        
        document.addEventListener('fullscreenchange', updateFullscreenUI);
        document.addEventListener('webkitfullscreenchange', updateFullscreenUI);

        
        document.getElementById('new-file-btn').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });

        
        playerContainer.addEventListener('mousemove', handleMouseMove);
        playerContainer.addEventListener('mouseleave', () => {
            if (!video.paused) {
                hideControlsDelayed();
            }
        });
    }

    
    function handleMouseMove() {
        showControlsTemporarily();
        showCursor();
        
        
        if (document.fullscreenElement && !video.paused) {
            hideCursorDelayed();
        }
    }

    
    function showCursor() {
        playerContainer.classList.remove('cursor-hidden');
        if (cursorTimeout) {
            clearTimeout(cursorTimeout);
            cursorTimeout = null;
        }
    }

    
    function hideCursorDelayed() {
        if (cursorTimeout) {
            clearTimeout(cursorTimeout);
        }
        cursorTimeout = setTimeout(() => {
            if (document.fullscreenElement && !video.paused) {
                playerContainer.classList.add('cursor-hidden');
            }
        }, 2500);
    }

    
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
                return;
            }

            
            if (playerContainer.classList.contains('hidden')) {
                return;
            }

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    togglePlayPause();
                    break;

                case 'ArrowLeft':
                    e.preventDefault();
                    seek(-10);
                    break;

                case 'ArrowRight':
                    e.preventDefault();
                    seek(10);
                    break;

                case 'ArrowUp':
                    e.preventDefault();
                    adjustVolume(0.1);
                    break;

                case 'ArrowDown':
                    e.preventDefault();
                    adjustVolume(-0.1);
                    break;

                case 'KeyM':
                    toggleMute();
                    break;

                case 'KeyF':
                    toggleFullscreen();
                    break;

                case 'KeyC':
                    cycleSubtitles();
                    break;

                case 'Escape':
                    if (document.fullscreenElement) {
                        document.exitFullscreen();
                    }
                    break;
            }
        });
    }

    
    async function loadFile(file) {
        currentFile = file;
        processedMkvData = null;

        
        document.getElementById('drop-zone').classList.add('hidden');
        playerContainer.classList.remove('hidden');

        
        SubtitleRenderer.clearTracks();
        resetTrackSelectors();

        
        fileNameEl.textContent = file.name;

        
        const isMkv = FFmpegHandler.isMkvFile(file);

        if (isMkv) {
            await loadMkvFile(file);
        } else {
            await loadDirectFile(file);
        }
    }

    
    async function loadMkvFile(file) {
        try {
            
            const LARGE_FILE_THRESHOLD = 2 * 1024 * 1024 * 1024; 
            const isLargeFile = file.size >= LARGE_FILE_THRESHOLD;
            
            if (isLargeFile) {
                showLoading('Analyzing file (large file mode)...');
                console.log('Large file detected (>= 2GB), using direct playback mode...');
                
                
                await FFmpegHandler.loadFFmpeg((msg) => showLoading(msg));
                const { videoStreams, audioStreams, subtitleStreams } = await analyzeFileStreams(file);
                
                
                const hasHevc = videoStreams.some(v => 
                    v.codec === 'hevc' || v.codec === 'h265' || v.codec === 'h.265'
                );
                
                if (hasHevc) {
                    hideLoading();
                    alert(
                        `This file uses HEVC/H.265 video codec and is ${(file.size / 1024 / 1024 / 1024).toFixed(1)} GB.\n\n` +
                        `HEVC files larger than 2GB cannot be converted in the browser due to memory limits.\n\n` +
                        `Options:\n` +
                        `1. Use a smaller HEVC file (< 2GB)\n` +
                        `2. Convert to H.264 using desktop FFmpeg or HandBrake`
                    );
                    return;
                }
                
                const directUrl = URL.createObjectURL(file);
                
                
                showLoading('Testing direct playback...');
                const canPlay = await testVideoPlayback(directUrl, 5000);
                
                if (canPlay) {
                    console.log('Direct playback successful!');
                    
                    // Check if ALL audio tracks are unsupported
                    const allAudioUnsupported = audioStreams.length > 0 && 
                        audioStreams.every(a => FFmpegHandler.isAudioCodecUnsupported(a.codec));
                    
                    // Show warning if audio is unsupported
                    if (allAudioUnsupported) {
                        const defaultAudioTrack = audioStreams[0];
                        const audioCodec = defaultAudioTrack?.codec?.toUpperCase() || 'Unknown';
                        console.warn(`Audio codec ${audioCodec} is not supported by browser`);
                        
                        // Show warning but continue with video playback
                        setTimeout(() => {
                            alert(
                                `⚠️ Audio format "${audioCodec}" is not supported by your browser.\n\n` +
                                `The video will play without sound.\n\n` +
                                `To get audio, convert the file using FFmpeg:\n` +
                                `ffmpeg -i input.mkv -c:v copy -c:a aac output.mkv`
                            );
                        }, 500);
                    }
                    
                    // Use direct playback
                    video.src = directUrl;
                    
                    processedMkvData = {
                        videoUrl: directUrl,
                        videoCodec: videoStreams[0]?.codec || 'h264',
                        audioTracks: audioStreams.map((track, i) => ({
                            index: i,
                            label: track.language || `Audio ${i + 1}`,
                            language: track.language || "und",
                            codec: track.codec,
                            unsupported: FFmpegHandler.isAudioCodecUnsupported(track.codec),
                        })),
                        subtitleStreams: subtitleStreams.map((stream, i) => ({
                            index: i,
                            label: stream.language || `Track ${i + 1}`,
                            language: stream.language || "und",
                            codec: stream.codec,
                            isBitmap: stream.isBitmap || false,
                            extracted: false,
                        })),
                        subtitles: [],
                        originalFile: file,
                        isDirectPlayback: true,
                    };
                    
                    
                    if (subtitleStreams.length > 0) {
                        populateSubtitleSelectorLazy(processedMkvData.subtitleStreams);
                        document.getElementById('subtitle-selector-container').style.display = '';
                    } else {
                        document.getElementById('subtitle-selector-container').style.display = 'none';
                    }
                    
                    // Show audio selector if there are multiple tracks
                    if (audioStreams.length > 1) {
                        populateAudioSelectorWithCodecs(processedMkvData.audioTracks);
                        document.getElementById('audio-selector-container').style.display = '';
                    } else {
                        document.getElementById('audio-selector-container').style.display = 'none';
                    }
                    
                    hideLoading();
                    try {
                        await video.play();
                    } catch (e) {
                        console.log('Autoplay prevented');
                    }
                    return;
                } else {
                    
                    URL.revokeObjectURL(directUrl);
                    hideLoading();
                    alert(
                        `This ${(file.size / 1024 / 1024 / 1024).toFixed(1)} GB file cannot be played directly by your browser.\n\n` +
                        `Files >= 2GB cannot be converted in the browser due to memory limits.\n\n` +
                        `Please convert to a browser-compatible format (H.264 MP4) using desktop FFmpeg or HandBrake.`
                    );
                    return;
                }
            }
            
            showLoading('Loading FFmpeg...');

            
            const support = FFmpegHandler.checkSupport();
            console.log('FFmpeg support check:', support);
            
            if (!support.crossOriginIsolated) {
                throw new Error('Cross-Origin Isolation is not enabled. Please make sure you are running the server with: node server.js');
            }

            
            processedMkvData = await FFmpegHandler.processMkvFile(file, (msg) => {
                showLoading(msg);
            });

            
            video.src = processedMkvData.videoUrl;

            
            if (processedMkvData.audioTracks.length > 1) {
                populateAudioSelector(processedMkvData.audioTracks);
                document.getElementById('audio-selector-container').style.display = '';
            } else {
                document.getElementById('audio-selector-container').style.display = 'none';
            }

            
            if (processedMkvData.subtitleStreams && processedMkvData.subtitleStreams.length > 0) {
                populateSubtitleSelectorLazy(processedMkvData.subtitleStreams);
                document.getElementById('subtitle-selector-container').style.display = '';
            } else {
                document.getElementById('subtitle-selector-container').style.display = 'none';
            }

            hideLoading();

            
            try {
                await video.play();
            } catch (e) {
                console.log('Autoplay prevented, user interaction required');
            }

        } catch (error) {
            console.error('Error loading MKV:', error);
            hideLoading();
            alert('Error processing MKV file: ' + error.message);
            goBack();
        }
    }

    
    async function loadDirectFile(file) {
        showLoading('Loading video...');

        
        const url = URL.createObjectURL(file);
        video.src = url;

        
        document.getElementById('subtitle-selector-container').style.display = 'none';
        document.getElementById('audio-selector-container').style.display = 'none';

        
        try {
            await video.play();
        } catch (e) {
            console.log('Autoplay prevented, user interaction required');
            hideLoading();
        }
    }

    
    function togglePlayPause() {
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
    }

    
    function seek(seconds) {
        const newTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
        video.currentTime = newTime;
        showControlsTemporarily();
    }

    
    function toggleMute() {
        if (video.muted || video.volume === 0) {
            video.muted = false;
            video.volume = lastVolume || 0.5;
        } else {
            lastVolume = video.volume;
            video.muted = true;
        }
    }

    
    function adjustVolume(delta) {
        const newVolume = Math.max(0, Math.min(1, video.volume + delta));
        video.volume = newVolume;
        video.muted = newVolume === 0;
        showControlsTemporarily();
    }

    
    function updateVolumeUI() {
        const isMuted = video.muted || video.volume === 0;
        const volume = video.muted ? 0 : video.volume;
        
        volumeIcon.classList.toggle('hidden', isMuted);
        mutedIcon.classList.toggle('hidden', !isMuted);
        volumeSlider.value = volume;
    }

    
    function toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            playerContainer.requestFullscreen();
        }
    }

    
    function updateFullscreenUI() {
        const isFullscreen = !!document.fullscreenElement;
        fullscreenIcon.classList.toggle('hidden', isFullscreen);
        exitFullscreenIcon.classList.toggle('hidden', !isFullscreen);
        
        
        if (!isFullscreen) {
            showCursor();
        } else if (!video.paused) {
            
            hideCursorDelayed();
        }
    }

    
    function cycleSubtitles() {
        const currentValue = parseInt(subtitleSelect.value);
        const options = subtitleSelect.options;
        let nextIndex = 0;

        for (let i = 0; i < options.length; i++) {
            if (parseInt(options[i].value) === currentValue) {
                nextIndex = (i + 1) % options.length;
                break;
            }
        }

        subtitleSelect.selectedIndex = nextIndex;
        subtitleSelect.dispatchEvent(new Event('change'));
        showControlsTemporarily();
    }

    
    function updateBufferBar() {
        if (video.buffered.length > 0) {
            const bufferedEnd = video.buffered.end(video.buffered.length - 1);
            const percent = (bufferedEnd / video.duration) * 100;
            bufferBar.style.width = `${percent}%`;
        }
    }

    
    function populateSubtitleSelector() {
        
        while (subtitleSelect.options.length > 1) {
            subtitleSelect.remove(1);
        }

        const tracks = SubtitleRenderer.getTracks();
        tracks.forEach((track, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = track.label;
            subtitleSelect.appendChild(option);
        });
    }

    
    function populateSubtitleSelectorLazy(subtitleStreams) {
        
        while (subtitleSelect.options.length > 1) {
            subtitleSelect.remove(1);
        }

        subtitleStreams.forEach((stream, index) => {
            const option = document.createElement('option');
            option.value = index;
            if (stream.isBitmap) {
                option.textContent = `${stream.label} (PGS)`;
            } else {
                option.textContent = stream.label;
            }
            subtitleSelect.appendChild(option);
        });
    }

    
    function populateAudioSelector(audioTracks) {
        audioSelect.innerHTML = '';

        audioTracks.forEach((track, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = track.label;
            audioSelect.appendChild(option);
        });
    }

    // Populate audio selector with codec info for direct playback mode
    function populateAudioSelectorWithCodecs(audioTracks) {
        audioSelect.innerHTML = '';

        audioTracks.forEach((track, index) => {
            const option = document.createElement('option');
            option.value = index;
            let label = track.label;
            // Add codec info if unsupported (will be extracted)
            if (track.unsupported) {
                const codecName = track.codec?.toUpperCase() || 'Unknown';
                label += ` (${codecName})`;
            }
            option.textContent = label;
            audioSelect.appendChild(option);
        });
    }

    
    function resetTrackSelectors() {
        subtitleSelect.innerHTML = '<option value="-1">Off</option>';
        audioSelect.innerHTML = '<option value="0">Default</option>';
    }

    
    function showLoading(message) {
        loadingText.textContent = message || 'Loading...';
        loadingOverlay.classList.remove('hidden');
    }

    
    function hideLoading() {
        loadingOverlay.classList.add('hidden');
    }

    
    function showControlsTemporarily() {
        playerContainer.classList.add('controls-visible');
        isControlsVisible = true;

        if (controlsTimeout) {
            clearTimeout(controlsTimeout);
        }

        if (!video.paused) {
            hideControlsDelayed();
        }
    }

    
    function hideControlsDelayed() {
        controlsTimeout = setTimeout(() => {
            if (!video.paused) {
                playerContainer.classList.remove('controls-visible');
                isControlsVisible = false;
            }
        }, 3000);
    }

    
    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';

        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    
    function goBack() {
        
        video.pause();
        video.src = '';

        
        if (processedMkvData && processedMkvData.videoUrl) {
            URL.revokeObjectURL(processedMkvData.videoUrl);
        }

        
        currentFile = null;
        processedMkvData = null;
        SubtitleRenderer.clearTracks();
        PGSRenderer.stop();

        
        document.getElementById('drop-zone').classList.remove('hidden');
        playerContainer.classList.add('hidden');
    }

    
    async function analyzeFileStreams(file) {
        const CHUNK_SIZE = 10 * 1024 * 1024;
        const ffmpeg = await FFmpegHandler.loadFFmpeg();
        
        // Use 10MB chunk for fast analysis
        const inputPath = "analysis" + file.name.substring(file.name.lastIndexOf('.'));
        const chunkSize = Math.min(file.size, CHUNK_SIZE);
        const chunk = file.slice(0, chunkSize);
        const chunkData = await chunk.arrayBuffer();
        await ffmpeg.writeFile(inputPath, new Uint8Array(chunkData));
        
        let logOutput = "";
        const logHandler = ({ message }) => {
            logOutput += message + "\n";
        };
        ffmpeg.on("log", logHandler);
        
        try {
            await ffmpeg.exec(["-i", inputPath, "-f", "null", "-"]);
        } catch (e) {
            // FFmpeg returns error when no output, but logs have stream info
        }
        
        ffmpeg.off("log", logHandler);
        await ffmpeg.deleteFile(inputPath);
        
        // Parse stream information
        const videoStreams = [];
        const audioStreams = [];
        const subtitleStreams = [];
        const lines = logOutput.split("\n");
        
        for (const line of lines) {
            const streamMatch = line.match(
                /Stream #(\d+):(\d+)(?:\[0x[a-f0-9]+\])?(?:\((\w+)\))?.*?: (Video|Audio|Subtitle): ([^,\n(]+)/i
            );
            
            if (streamMatch) {
                const [, fileIdx, streamIdx, language, type, codecInfo] = streamMatch;
                const codec = codecInfo.trim().split(" ")[0].toLowerCase();
                
                if (type.toLowerCase() === "video") {
                    videoStreams.push({
                        index: videoStreams.length,
                        codec: codec,
                    });
                } else if (type.toLowerCase() === "audio") {
                    audioStreams.push({
                        index: audioStreams.length,
                        language: language || "und",
                        codec: codec,
                    });
                } else if (type.toLowerCase() === "subtitle") {
                    const bitmapCodecs = ['hdmv_pgs_subtitle', 'pgssub', 'pgs', 'dvd_subtitle', 'dvdsub', 'dvb_subtitle', 'dvbsub', 'xsub'];
                    const isBitmap = bitmapCodecs.some(c => codec.includes(c));
                    
                    subtitleStreams.push({
                        index: subtitleStreams.length,
                        language: language || "und",
                        codec: codec,
                        isBitmap: isBitmap,
                    });
                }
            }
        }
        
        console.log(`[analyzeFileStreams] Found: ${videoStreams.length} video, ${audioStreams.length} audio, ${subtitleStreams.length} subtitle`);
        
        return { videoStreams, audioStreams, subtitleStreams };
    }

    
    function testVideoPlayback(url, timeout = 5000) {
        return new Promise((resolve) => {
            const testVideo = document.createElement('video');
            testVideo.muted = true;
            testVideo.preload = 'metadata';
            
            const cleanup = () => {
                testVideo.src = '';
                testVideo.load();
            };
            
            const timer = setTimeout(() => {
                cleanup();
                resolve(false);
            }, timeout);
            
            testVideo.onloadedmetadata = () => {
                clearTimeout(timer);
                cleanup();
                resolve(true);
            };
            
            testVideo.onerror = () => {
                clearTimeout(timer);
                cleanup();
                resolve(false);
            };
            
            testVideo.src = url;
        });
    }

    
    function getVideoElement() {
        return video;
    }

    
    return {
        init,
        loadFile,
        togglePlayPause,
        seek,
        toggleMute,
        adjustVolume,
        toggleFullscreen,
        cycleSubtitles,
        showLoading,
        hideLoading,
        goBack,
        getVideoElement
    };
})();


if (typeof module !== 'undefined' && module.exports) {
    module.exports = VideoPlayer;
}
