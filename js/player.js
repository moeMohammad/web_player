

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
    let statusPanel = null;
    let statusTitle = null;
    let statusMessage = null;
    let statusCloseBtn = null;


    let currentFile = null;
    let processedMkvData = null;
    let currentVideoUrl = null;
    let activeLoadId = 0;
    let suppressVideoErrors = false;
    let mseState = null;
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
        statusPanel = document.getElementById('status-panel');
        statusTitle = document.getElementById('status-title');
        statusMessage = document.getElementById('status-message');
        statusCloseBtn = document.getElementById('status-close-btn');


        SubtitleRenderer.init(video, document.getElementById('subtitle-overlay'));

        PGSRenderer.init(video, document.getElementById('pgs-canvas'));


        setupVideoEvents();
        setupControlEvents();
        setupKeyboardShortcuts();
        setupSubtitleSettings();
        setupStatusEvents();

    }


    function setupStatusEvents() {
        if (statusCloseBtn) {
            statusCloseBtn.addEventListener('click', hideStatus);
        }
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
            if (suppressVideoErrors) {
                return;
            }

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
            showStatus(
                'Playback failed',
                `${errorMessage}. If this is an MKV with H.265/x265 video, browser playback is intentionally deferred in this version. H.264/x264 MP4 and MKV are the primary target.`,
                'error'
            );
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

                    if (!streamInfo.isPgs) {
                        PGSRenderer.stop();
                        showStatus(
                            'Bitmap subtitle unsupported',
                            `${(streamInfo.codec || 'bitmap').toUpperCase()} subtitles are not supported in this version. PGS bitmap subtitles are supported; DVD/DVB/XSub bitmap rendering is deferred.`,
                            'warning'
                        );
                        subtitleSelect.value = '-1';
                        return;
                    }

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
                                    showStatus('PGS subtitle failed', 'Failed to parse PGS subtitle data. The stream may use unsupported bitmap features.', 'warning');
                                    subtitleSelect.value = '-1';
                                    return;
                                }
                            } else {
                                hideLoading();
                                showStatus('PGS subtitle failed', 'Failed to extract the selected PGS subtitle stream.', 'warning');
                                subtitleSelect.value = '-1';
                                return;
                            }
                        } catch (e) {
                            console.error('Failed to extract PGS subtitle:', e);
                            hideLoading();
                            showStatus('PGS subtitle failed', e.message, 'warning');
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
                        showStatus('Subtitle extraction failed', e.message, 'warning');
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
                        showStatus(
                            'Audio track unavailable',
                            `Audio format "${codecName}" is not supported in direct browser playback. Use the streaming remux fallback or convert audio to AAC for this track.`,
                            'warning'
                        );

                        // Reset selection to previous track
                        audioSelect.value = '0';
                        return;
                    }

                    // Audio track switching in direct mode not fully supported
                    showStatus(
                        'Audio switching needs remux',
                        'This file is playing directly, so browser-level audio track switching is limited. Reopen the file after converting alternate tracks to AAC if you need a different track.',
                        'warning'
                    );
                    return;
                }

                // Standard mode - transmux with selected audio track
                showLoading('Switching audio track...');


                const newUrl = await FFmpegHandler.transmuxToMp4(
                    currentFile,
                    audioIndex,
                    (msg) => showLoading(msg)
                );

                processedMkvData.videoUrl = newUrl;
                setVideoUrl(newUrl);


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
                showStatus('Audio switch failed', error.message, 'error');
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
        await cleanupCurrentPlayback();
        const loadId = ++activeLoadId;

        currentFile = file;
        processedMkvData = null;


        document.getElementById('drop-zone').classList.add('hidden');
        playerContainer.classList.remove('hidden');


        SubtitleRenderer.clearTracks();
        resetTrackSelectors();
        hideStatus();


        fileNameEl.textContent = file.name;


        const isMkv = FFmpegHandler.isMkvFile(file);

        if (isMkv) {
            await loadMkvFile(file, loadId);
        } else {
            await loadDirectFile(file);
        }
    }


    async function loadMkvFile(file, loadId) {
        const directUrl = URL.createObjectURL(file);

        try {
            showLoading('Opening video...');
            const canPlayDirectly = await tryVideoSource(directUrl, 2500);

            if (!isCurrentLoad(loadId)) {
                URL.revokeObjectURL(directUrl);
                return;
            }

            if (canPlayDirectly) {
                currentVideoUrl = directUrl;
                processedMkvData = createMkvData(file, directUrl, {
                    isDirectPlayback: true,
                    videoCodec: 'h264',
                });
                hideLoading();
                playWhenAllowed();
                analyzeMkvInBackground(file, loadId, true);
                return;
            }

            clearVideoSource();
            URL.revokeObjectURL(directUrl);
            await loadMkvFallback(file, loadId);
        } catch (error) {
            URL.revokeObjectURL(directUrl);
            console.error('Error loading MKV:', error);
            hideLoading();
            showStatus('MKV playback failed', error.message, 'error');
        }
    }


    async function loadMkvFallback(file, loadId) {
        showLoading('Analyzing MKV...');

        const support = FFmpegHandler.checkSupport();
        if (!support.crossOriginIsolated) {
            throw new Error('Cross-Origin Isolation is not enabled. Run this app with: node server.js');
        }

        await FFmpegHandler.loadFFmpeg((msg) => showLoading(msg));
        const probe = await FFmpegHandler.analyzeStreams(file, (msg) => showLoading(msg));

        if (!isCurrentLoad(loadId)) return;

        const strategy = FFmpegHandler.choosePlaybackStrategy({
            container: 'mkv',
            videoStreams: probe.videoStreams,
            audioStreams: probe.audioStreams,
            subtitleStreams: probe.subtitleStreams,
        }, {
            directPlaybackWorks: false,
            mediaSourceSupported: isMediaSourceAvailable(),
        });

        if (strategy.mode === 'unsupported') {
            hideLoading();
            showUnsupportedStrategy(strategy, file);
            return;
        }

        if (strategy.mode === 'mse-remux') {
            try {
                await loadMseRemux(file, probe, loadId);
                return;
            } catch (mseError) {
                console.warn('MSE remux failed, falling back to full remux:', mseError);
                await cleanupMsePlayback();
                clearVideoSource();
                showStatus(
                    'Streaming remux failed',
                    'Falling back to a full MP4 remux. Startup will be slower for this file.',
                    'warning'
                );
            }
        }

        await loadFullRemuxFallback(file, loadId);
    }


    async function loadFullRemuxFallback(file, loadId) {
        showLoading('Converting to MP4...');
        processedMkvData = await FFmpegHandler.processMkvFile(file, (msg) => {
            showLoading(msg);
        });

        if (!isCurrentLoad(loadId)) return;

        setVideoUrl(processedMkvData.videoUrl);
        applyMkvTrackData(processedMkvData);
        hideLoading();
        playWhenAllowed();
    }


    async function loadDirectFile(file) {
        showLoading('Loading video...');


        const url = URL.createObjectURL(file);
        setVideoUrl(url);


        document.getElementById('subtitle-selector-container').style.display = 'none';
        document.getElementById('audio-selector-container').style.display = 'none';


        try {
            await video.play();
        } catch (e) {
        } finally {
            hideLoading();
        }
    }


    async function cleanupCurrentPlayback() {
        activeLoadId++;
        hideLoading();
        hideStatus();
        PGSRenderer.stop();
        SubtitleRenderer.clearTracks();
        await cleanupMsePlayback();

        video.pause();
        clearVideoSource();
        revokeCurrentVideoUrl();

        currentFile = null;
        processedMkvData = null;
    }


    function setVideoUrl(url) {
        if (currentVideoUrl && currentVideoUrl !== url) {
            URL.revokeObjectURL(currentVideoUrl);
        }

        currentVideoUrl = url;
        video.src = url;
    }


    function clearVideoSource() {
        video.removeAttribute('src');
        video.load();
    }


    function revokeCurrentVideoUrl() {
        if (currentVideoUrl) {
            URL.revokeObjectURL(currentVideoUrl);
            currentVideoUrl = null;
        }
    }


    function isCurrentLoad(loadId) {
        return loadId === activeLoadId && !!currentFile;
    }


    function tryVideoSource(url, timeout = 2500) {
        return new Promise((resolve) => {
            let settled = false;
            suppressVideoErrors = true;

            const cleanup = () => {
                video.removeEventListener('loadedmetadata', onLoaded);
                video.removeEventListener('error', onError);
                clearTimeout(timer);
                suppressVideoErrors = false;
            };

            const finish = (result) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(result);
            };

            const onLoaded = () => finish(true);
            const onError = () => finish(false);
            const timer = setTimeout(() => finish(false), timeout);

            video.addEventListener('loadedmetadata', onLoaded);
            video.addEventListener('error', onError);
            video.src = url;
            video.load();
        });
    }


    async function playWhenAllowed() {
        try {
            await video.play();
        } catch (e) {
        }
    }


    function createMkvData(file, videoUrl, overrides = {}) {
        return {
            videoUrl,
            videoCodec: overrides.videoCodec || 'unknown',
            audioTracks: [],
            subtitleStreams: [],
            subtitles: [],
            originalFile: file,
            isDirectPlayback: !!overrides.isDirectPlayback,
            isMsePlayback: !!overrides.isMsePlayback,
        };
    }


    function normalizeAudioTracks(audioStreams) {
        return audioStreams.map((track, i) => ({
            index: i,
            label: track.language || `Audio ${i + 1}`,
            language: track.language || 'und',
            codec: track.codec,
            unsupported: FFmpegHandler.isAudioCodecUnsupported(track.codec),
        }));
    }


    function normalizeSubtitleStreams(subtitleStreams) {
        return subtitleStreams.map((stream, i) => ({
            index: i,
            label: stream.language || `Track ${i + 1}`,
            language: stream.language || 'und',
            codec: stream.codec,
            isBitmap: stream.isBitmap || false,
            isPgs: stream.isPgs || FFmpegHandler.isPgsSubtitle(stream.codec),
            extracted: false,
        }));
    }


    function applyMkvTrackData(data) {
        if (data.audioTracks.length > 1) {
            populateAudioSelectorWithCodecs(data.audioTracks);
            document.getElementById('audio-selector-container').style.display = '';
        } else {
            document.getElementById('audio-selector-container').style.display = 'none';
        }

        if (data.subtitleStreams && data.subtitleStreams.length > 0) {
            populateSubtitleSelectorLazy(data.subtitleStreams);
            document.getElementById('subtitle-selector-container').style.display = '';
        } else {
            document.getElementById('subtitle-selector-container').style.display = 'none';
        }
    }


    async function analyzeMkvInBackground(file, loadId, directPlaybackWorks) {
        showStatus(
            'Reading tracks',
            'Video playback has started. Audio and subtitle track details are loading in the background.',
            'info'
        );

        try {
            await FFmpegHandler.loadFFmpeg((msg) => {
                if (isCurrentLoad(loadId)) {
                    showStatus('Reading tracks', msg, 'info');
                }
            });

            const probe = await FFmpegHandler.analyzeStreams(file, (msg) => {
                if (isCurrentLoad(loadId)) {
                    showStatus('Reading tracks', msg, 'info');
                }
            });

            if (!isCurrentLoad(loadId) || !processedMkvData) return;

            const videoCodec = probe.videoStreams[0]?.codec || 'unknown';
            const strategy = FFmpegHandler.choosePlaybackStrategy({
                container: 'mkv',
                videoStreams: probe.videoStreams,
                audioStreams: probe.audioStreams,
                subtitleStreams: probe.subtitleStreams,
            }, {
                directPlaybackWorks,
                mediaSourceSupported: isMediaSourceAvailable(),
            });

            processedMkvData.videoCodec = videoCodec;
            processedMkvData.audioTracks = normalizeAudioTracks(probe.audioStreams);
            processedMkvData.subtitleStreams = normalizeSubtitleStreams(probe.subtitleStreams);
            applyMkvTrackData(processedMkvData);

            const unsupportedAudio = processedMkvData.audioTracks.filter(track => track.unsupported);
            if (strategy.reason === 'hevc-deferred') {
                showStatus(
                    'H.265/x265 detected',
                    'This browser is playing the file directly, but x265 support is not the optimized path yet. H.264/x264 remains the primary target.',
                    'warning'
                );
            } else if (unsupportedAudio.length > 0) {
                showStatus(
                    'Some audio may be unavailable',
                    `Unsupported browser audio codec detected: ${unsupportedAudio.map(t => (t.codec || 'unknown').toUpperCase()).join(', ')}.`,
                    'warning'
                );
            } else {
                hideStatus();
            }
        } catch (error) {
            if (!isCurrentLoad(loadId)) return;
            console.warn('Background MKV analysis failed:', error);
            showStatus(
                'Track reading failed',
                'The video can keep playing, but embedded audio/subtitle track details could not be loaded.',
                'warning'
            );
        }
    }


    function isMediaSourceAvailable() {
        return typeof MediaSource !== 'undefined' && typeof MediaSource.isTypeSupported === 'function';
    }


    function getMseMimeType() {
        if (!isMediaSourceAvailable()) return null;

        const candidates = [
            'video/mp4; codecs="avc1.640028, mp4a.40.2"',
            'video/mp4; codecs="avc1.4d401f, mp4a.40.2"',
            'video/mp4; codecs="avc1.42e01e, mp4a.40.2"',
            'video/mp4'
        ];

        return candidates.find(type => MediaSource.isTypeSupported(type)) || null;
    }


    async function loadMseRemux(file, probe, loadId) {
        const mimeType = getMseMimeType();
        if (!mimeType) {
            throw new Error('Media Source Extensions are not available for H.264/AAC MP4 on this browser.');
        }

        showLoading('Preparing streaming remux...');
        await cleanupMsePlayback();

        const mediaSource = new MediaSource();
        const mseUrl = URL.createObjectURL(mediaSource);
        const abortController = new AbortController();
        const audioTrackIndex = 0;
        const videoCodec = probe.videoStreams[0]?.codec || 'h264';

        mseState = {
            mediaSource,
            url: mseUrl,
            sourceBuffer: null,
            abortController,
            segmentDuration: 20,
            nextStart: 0,
            pumping: false,
            ended: false,
            onTimeUpdate: null,
        };

        setVideoUrl(mseUrl);

        await new Promise((resolve, reject) => {
            mediaSource.addEventListener('sourceopen', resolve, { once: true });
            mediaSource.addEventListener('error', () => reject(new Error('MediaSource failed to open')), { once: true });
        });

        if (!isCurrentLoad(loadId)) return;

        const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        mseState.sourceBuffer = sourceBuffer;

        const initSegment = await FFmpegHandler.generateInitSegment(file, audioTrackIndex, videoCodec, (msg) => showLoading(msg));
        await appendMseBuffer(sourceBuffer, initSegment);

        const firstSegment = await FFmpegHandler.generateSegment(
            file,
            0,
            mseState.segmentDuration,
            audioTrackIndex,
            videoCodec,
            (msg) => showLoading(msg),
            abortController.signal
        );

        if (!firstSegment) {
            throw new Error('No playable media segment was produced.');
        }

        await appendMseBuffer(sourceBuffer, firstSegment);
        mseState.nextStart = mseState.segmentDuration;

        processedMkvData = createMkvData(file, mseUrl, {
            isMsePlayback: true,
            videoCodec,
        });
        processedMkvData.audioTracks = normalizeAudioTracks(probe.audioStreams);
        processedMkvData.subtitleStreams = normalizeSubtitleStreams(probe.subtitleStreams);
        applyMkvTrackData(processedMkvData);

        mseState.onTimeUpdate = () => {
            const bufferedEnd = getBufferedEnd();
            if (bufferedEnd - video.currentTime < 45) {
                pumpMseSegments(file, videoCodec, audioTrackIndex, loadId);
            }
        };
        video.addEventListener('timeupdate', mseState.onTimeUpdate);

        hideLoading();
        playWhenAllowed();
        pumpMseSegments(file, videoCodec, audioTrackIndex, loadId);
    }


    async function pumpMseSegments(file, videoCodec, audioTrackIndex, loadId) {
        if (!mseState || mseState.pumping || mseState.ended || !isCurrentLoad(loadId)) return;

        mseState.pumping = true;
        try {
            while (
                mseState &&
                !mseState.abortController.signal.aborted &&
                getBufferedEnd() - video.currentTime < 80
            ) {
                const segment = await FFmpegHandler.generateSegment(
                    file,
                    mseState.nextStart,
                    mseState.segmentDuration,
                    audioTrackIndex,
                    videoCodec,
                    null,
                    mseState.abortController.signal
                );

                if (!segment) {
                    mseState.ended = true;
                    if (mseState.mediaSource.readyState === 'open') {
                        mseState.mediaSource.endOfStream();
                    }
                    break;
                }

                await appendMseBuffer(mseState.sourceBuffer, segment);
                mseState.nextStart += mseState.segmentDuration;
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.warn('MSE segment pump failed:', error);
                showStatus('Streaming remux stopped', error.message, 'warning');
            }
        } finally {
            if (mseState) {
                mseState.pumping = false;
            }
        }
    }


    function appendMseBuffer(sourceBuffer, data) {
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                sourceBuffer.removeEventListener('updateend', onUpdateEnd);
                sourceBuffer.removeEventListener('error', onError);
            };
            const onUpdateEnd = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                cleanup();
                reject(new Error('SourceBuffer append failed'));
            };

            sourceBuffer.addEventListener('updateend', onUpdateEnd, { once: true });
            sourceBuffer.addEventListener('error', onError, { once: true });
            sourceBuffer.appendBuffer(data);
        });
    }


    function getBufferedEnd() {
        if (!video.buffered || video.buffered.length === 0) return 0;
        return video.buffered.end(video.buffered.length - 1);
    }


    async function cleanupMsePlayback() {
        if (!mseState) return;

        const state = mseState;
        mseState = null;

        if (state.onTimeUpdate) {
            video.removeEventListener('timeupdate', state.onTimeUpdate);
        }

        state.abortController.abort();

        try {
            if (state.mediaSource.readyState === 'open') {
                state.mediaSource.endOfStream();
            }
        } catch (e) {}

        try {
            await FFmpegHandler.unmountMSEFile();
        } catch (e) {}
    }


    function showUnsupportedStrategy(strategy, file) {
        if (strategy.reason === 'hevc-deferred') {
            showStatus(
                'H.265/x265 is deferred',
                `${file.name} uses H.265/x265. Browser-side x265 transcode is too slow for the instant-loading goal, so this version focuses on H.264/x264.`,
                'error'
            );
            return;
        }

        showStatus(
            'Unsupported video codec',
            `This file uses ${strategy.videoCodec || 'an unsupported codec'}. H.264/x264 MP4 and MKV are the optimized formats for this version.`,
            'error'
        );
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
                option.textContent = stream.isPgs ? `${stream.label} (PGS)` : `${stream.label} (${stream.codec || 'bitmap'})`;
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


    function showStatus(title, message, type = 'info') {
        if (!statusPanel) return;

        statusTitle.textContent = title || '';
        statusMessage.textContent = message || '';
        statusPanel.classList.remove('hidden', 'status-warning', 'status-error');

        if (type === 'warning') {
            statusPanel.classList.add('status-warning');
        } else if (type === 'error') {
            statusPanel.classList.add('status-error');
        }
    }


    function hideStatus() {
        if (statusPanel) {
            statusPanel.classList.add('hidden');
        }
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


    async function goBack() {
        await cleanupCurrentPlayback();

        document.getElementById('drop-zone').classList.remove('hidden');
        playerContainer.classList.add('hidden');
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
        showStatus,
        hideStatus,
        goBack,
        getVideoElement
    };
})();


if (typeof module !== 'undefined' && module.exports) {
    module.exports = VideoPlayer;
}
