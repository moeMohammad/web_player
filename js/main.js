

(function() {
    'use strict';

    
    let dropZone = null;
    let fileInput = null;
    let fileSelectBtn = null;

    
    function init() {
        
        dropZone = document.getElementById('drop-zone');
        fileInput = document.getElementById('file-input');
        fileSelectBtn = document.getElementById('file-select-btn');

        
        VideoPlayer.init();

        
        setupFileInput();

        
        setupDragAndDrop();

        console.log('Local Media Player initialized');
    }

    
    function setupFileInput() {
        
        fileSelectBtn.addEventListener('click', () => {
            fileInput.click();
        });

        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleFile(file);
            }
            
            fileInput.value = '';
        });
    }

    
    function setupDragAndDrop() {
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.addEventListener(eventName, preventDefaults, false);
        });

        
        dropZone.addEventListener('dragenter', handleDragEnter);
        dropZone.addEventListener('dragover', handleDragOver);
        dropZone.addEventListener('dragleave', handleDragLeave);
        dropZone.addEventListener('drop', handleDrop);
    }

    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    
    function handleDragEnter(e) {
        dropZone.classList.add('drag-over');
    }

    
    function handleDragOver(e) {
        dropZone.classList.add('drag-over');
    }

    
    function handleDragLeave(e) {
        
        if (!dropZone.contains(e.relatedTarget)) {
            dropZone.classList.remove('drag-over');
        }
    }

    
    function handleDrop(e) {
        dropZone.classList.remove('drag-over');

        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length > 0) {
            handleFile(files[0]);
        }
    }

    
    function handleFile(file) {
        
        if (!isValidVideoFile(file)) {
            alert('Please select a valid video file (MP4, MKV, or WebM)');
            return;
        }

        const isMkv = file.name.toLowerCase().endsWith('.mkv');
        const fileSizeGB = file.size / (1024 * 1024 * 1024);
        
        
        if (isMkv && file.size > 2.5 * 1024 * 1024 * 1024) { 
            console.log(`Large MKV file: ${fileSizeGB.toFixed(1)} GB - will try direct playback first`);
        } else if (!isMkv && file.size > 4 * 1024 * 1024 * 1024) { 
            const proceed = confirm(
                'This file is larger than 4GB. Playback may be slow. Continue?'
            );
            if (!proceed) return;
        }

        console.log('Loading file:', file.name, 'Size:', formatFileSize(file.size));

        
        VideoPlayer.loadFile(file);
    }

    
    function isValidVideoFile(file) {
        const validExtensions = ['.mp4', '.mkv', '.webm', '.m4v', '.mov'];
        const validMimeTypes = [
            'video/mp4',
            'video/x-matroska',
            'video/webm',
            'video/quicktime',
            'video/x-m4v'
        ];

        const fileName = file.name.toLowerCase();
        const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));
        const hasValidMimeType = validMimeTypes.includes(file.type) || file.type.startsWith('video/');

        return hasValidExtension || hasValidMimeType;
    }

    
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

