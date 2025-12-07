

const SubtitleRenderer = (function() {
    'use strict';

    let subtitleOverlay = null;
    let video = null;
    let subtitleTracks = [];  
    let activeTrackIndex = -1;
    let updateInterval = null;

    
    function init(videoElement, overlayElement) {
        video = videoElement;
        subtitleOverlay = overlayElement;
        
        console.log('[SubtitleRenderer] Initialized with video:', !!video, 'overlay:', !!subtitleOverlay);
        
        
        if (updateInterval) clearInterval(updateInterval);
        updateInterval = setInterval(updateSubtitleDisplay, 100); 
        
        
        video.addEventListener('seeked', updateSubtitleDisplay);
    }

    
    function parseVttCues(vttContent) {
        const cues = [];
        const lines = vttContent.split('\n');
        let i = 0;
        
        
        while (i < lines.length && !lines[i].includes('-->')) {
            i++;
        }
        
        while (i < lines.length) {
            const line = lines[i].trim();
            
            if (line.includes('-->')) {
                
                const timingMatch = line.match(/(\d{1,2}:)?(\d{1,2}:\d{2}[.,]\d{2,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}:\d{2}[.,]\d{2,3})/);
                if (timingMatch) {
                    
                    const startFull = (timingMatch[1] || '00:') + timingMatch[2];
                    const endFull = (timingMatch[3] || '00:') + timingMatch[4];
                    
                    const startTime = parseTimestamp(startFull);
                    const endTime = parseTimestamp(endFull);
                    
                    
                    const textLines = [];
                    i++;
                    while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
                        textLines.push(lines[i]);
                        i++;
                    }
                    
                    if (textLines.length > 0) {
                        cues.push({
                            startTime,
                            endTime,
                            text: textLines.join('\n')
                        });
                    }
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }
        
        return cues;
    }

    
    function parseTimestamp(timestamp) {
        
        const normalized = timestamp.replace(',', '.');
        const parts = normalized.split(':');
        
        if (parts.length === 3) {
            
            const hours = parseFloat(parts[0]) || 0;
            const minutes = parseFloat(parts[1]) || 0;
            const seconds = parseFloat(parts[2]) || 0;
            return hours * 3600 + minutes * 60 + seconds;
        } else if (parts.length === 2) {
            
            const minutes = parseFloat(parts[0]) || 0;
            const seconds = parseFloat(parts[1]) || 0;
            return minutes * 60 + seconds;
        }
        return 0;
    }

    
    function srtToVtt(srtContent) {
        let vtt = 'WEBVTT\n\n';
        const content = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const blocks = content.trim().split(/\n\n+/);
        
        for (const block of blocks) {
            const lines = block.split('\n');
            if (lines.length < 2) continue;
            
            let timingLineIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('-->')) {
                    timingLineIndex = i;
                    break;
                }
            }
            
            if (timingLineIndex === -1) continue;
            
            const timing = lines[timingLineIndex].replace(/,/g, '.');
            const text = lines.slice(timingLineIndex + 1).join('\n');
            
            if (text.trim()) {
                vtt += `${timing}\n${text}\n\n`;
            }
        }
        
        return vtt;
    }

    
    function assToVtt(assContent) {
        let vtt = 'WEBVTT\n\n';
        const content = assContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = content.split('\n');
        
        let inEventsSection = false;
        let formatFields = [];
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine.toLowerCase() === '[events]') {
                inEventsSection = true;
                continue;
            }
            
            if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
                inEventsSection = false;
                continue;
            }
            
            if (!inEventsSection) continue;
            
            if (trimmedLine.toLowerCase().startsWith('format:')) {
                formatFields = trimmedLine.substring(7).split(',').map(f => f.trim().toLowerCase());
                continue;
            }
            
            if (trimmedLine.toLowerCase().startsWith('dialogue:')) {
                const dialogueContent = trimmedLine.substring(9);
                const fields = parseAssFields(dialogueContent, formatFields.length);
                
                if (formatFields.length === 0 || fields.length < formatFields.length) continue;
                
                const startIndex = formatFields.indexOf('start');
                const endIndex = formatFields.indexOf('end');
                const textIndex = formatFields.indexOf('text');
                
                if (startIndex === -1 || endIndex === -1 || textIndex === -1) continue;
                
                const start = convertAssTime(fields[startIndex]);
                const end = convertAssTime(fields[endIndex]);
                const text = fields.slice(textIndex).join(',');
                const cleanText = removeAssTags(text);
                
                if (cleanText.trim()) {
                    vtt += `${start} --> ${end}\n${cleanText}\n\n`;
                }
            }
        }
        
        return vtt;
    }

    function parseAssFields(content, expectedFields) {
        const fields = [];
        let current = '';
        let fieldCount = 0;
        
        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            if (char === ',' && fieldCount < expectedFields - 1) {
                fields.push(current.trim());
                current = '';
                fieldCount++;
            } else {
                current += char;
            }
        }
        fields.push(current.trim());
        return fields;
    }

    function convertAssTime(assTime) {
        const parts = assTime.trim().split(':');
        if (parts.length !== 3) return '00:00:00.000';
        
        const hours = parts[0].padStart(2, '0');
        const minutes = parts[1].padStart(2, '0');
        const secParts = parts[2].split('.');
        const seconds = secParts[0].padStart(2, '0');
        const centiseconds = (secParts[1] || '0').padEnd(2, '0').substring(0, 2);
        const milliseconds = centiseconds + '0';
        
        return `${hours}:${minutes}:${seconds}.${milliseconds}`;
    }

    function removeAssTags(text) {
        let cleaned = text.replace(/\{[^}]*\}/g, '');
        cleaned = cleaned.replace(/\\N/g, '\n').replace(/\\n/g, '\n');
        cleaned = cleaned.split('\n').map(l => l.trim()).join('\n');
        return cleaned;
    }

    function convertToVtt(content, filename) {
        const lowerFilename = filename.toLowerCase();
        
        if (lowerFilename.endsWith('.vtt') || content.trim().startsWith('WEBVTT')) {
            return content;
        }
        
        if (lowerFilename.endsWith('.ass') || lowerFilename.endsWith('.ssa') ||
            content.includes('[Script Info]') || content.includes('[Events]')) {
            return assToVtt(content);
        }
        
        return srtToVtt(content);
    }

    
    function addTrack(vttContent, label, language = 'und') {
        const cues = parseVttCues(vttContent);
        
        subtitleTracks.push({
            label,
            language,
            cues,
            vttContent
        });
        
        console.log(`[SubtitleRenderer] Added track "${label}" with ${cues.length} cues`);
        return subtitleTracks.length - 1;
    }

    
    function enableTrack(index) {
        console.log('[SubtitleRenderer] Enabling track:', index, 'of', subtitleTracks.length, 'tracks');
        
        if (index >= 0 && index < subtitleTracks.length) {
            activeTrackIndex = index;
            const track = subtitleTracks[index];
            console.log('[SubtitleRenderer] Track has', track.cues.length, 'cues');
            updateSubtitleDisplay();
        } else {
            console.warn('[SubtitleRenderer] Invalid track index:', index);
        }
    }

    
    function disableAllTracks() {
        activeTrackIndex = -1;
        hideSubtitle();
    }

    
    function getTracks() {
        return subtitleTracks.map((track, index) => ({
            index,
            label: track.label,
            language: track.language,
            mode: index === activeTrackIndex ? 'showing' : 'hidden'
        }));
    }

    
    function clearTracks() {
        subtitleTracks = [];
        activeTrackIndex = -1;
        hideSubtitle();
    }

    
    function updateSubtitleDisplay() {
        if (!video || activeTrackIndex < 0 || !subtitleTracks[activeTrackIndex]) {
            return;
        }
        
        const currentTime = video.currentTime;
        const track = subtitleTracks[activeTrackIndex];
        
        
        const activeCues = track.cues.filter(cue => 
            currentTime >= cue.startTime && currentTime <= cue.endTime
        );
        
        if (activeCues.length > 0) {
            const text = activeCues.map(cue => cue.text).join('\n');
            displaySubtitle(text);
        } else {
            
            if (subtitleOverlay && subtitleOverlay.innerHTML !== '') {
                hideSubtitle();
            }
        }
    }

    
    function displaySubtitle(text) {
        if (!subtitleOverlay) {
            return;
        }
        
        if (!text) {
            subtitleOverlay.innerHTML = '';
            return;
        }
        
        
        let cleanText = text
            .replace(/<\/?[^>]+(>|$)/g, '')  
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
        
        const subtitleEl = document.createElement('div');
        subtitleEl.className = 'subtitle-text';
        subtitleEl.innerHTML = cleanText.replace(/\n/g, '<br>');
        
        subtitleOverlay.innerHTML = '';
        subtitleOverlay.appendChild(subtitleEl);
    }

    
    function hideSubtitle() {
        if (subtitleOverlay) {
            subtitleOverlay.innerHTML = '';
        }
    }

    return {
        init,
        convertToVtt,
        srtToVtt,
        assToVtt,
        addTrack,
        enableTrack,
        disableAllTracks,
        getTracks,
        clearTracks,
        displaySubtitle,
        hideSubtitle
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SubtitleRenderer;
}
