const PGSParser = (function() {
    'use strict';

    const SEGMENT_TYPE = {
        PDS: 0x14,
        ODS: 0x15,
        PCS: 0x16,
        WDS: 0x17,
        END: 0x80
    };
    function parse(buffer) {
        const data = new DataView(buffer);
        const subtitles = [];
        let offset = 0;
        
        let currentPalette = null;
        let currentObjects = {};
        let currentComposition = null;
        let currentWindows = {};

        while (offset < buffer.byteLength - 13) {
            const magic1 = data.getUint8(offset);
            const magic2 = data.getUint8(offset + 1);
            
            if (magic1 !== 0x50 || magic2 !== 0x47) {
                offset++;
                continue;
            }

            const pts = readPTS(data, offset + 2);
            const dts = readPTS(data, offset + 6);
            const segmentType = data.getUint8(offset + 10);
            const segmentLength = data.getUint16(offset + 11);
            
            const segmentStart = offset + 13;
            const segmentEnd = segmentStart + segmentLength;

            if (segmentEnd > buffer.byteLength) {
                console.warn('PGS: Segment extends beyond buffer, stopping');
                break;
            }

            try {
                switch (segmentType) {
                    case SEGMENT_TYPE.PCS:
                        currentComposition = parsePCS(data, segmentStart, segmentLength);
                        currentComposition.pts = pts;
                        break;
                        
                    case SEGMENT_TYPE.WDS:
                        const windows = parseWDS(data, segmentStart, segmentLength);
                        windows.forEach(w => currentWindows[w.id] = w);
                        break;
                        
                    case SEGMENT_TYPE.PDS:
                        currentPalette = parsePDS(data, segmentStart, segmentLength);
                        break;
                        
                    case SEGMENT_TYPE.ODS:
                        const obj = parseODS(data, segmentStart, segmentLength, buffer);
                        if (obj) {
                            if (!currentObjects[obj.id]) {
                                currentObjects[obj.id] = obj;
                            } else {
                                const existing = currentObjects[obj.id];
                                const combined = new Uint8Array(existing.rleData.length + obj.rleData.length);
                                combined.set(existing.rleData);
                                combined.set(obj.rleData, existing.rleData.length);
                                existing.rleData = combined;
                                if (obj.width > 0) existing.width = obj.width;
                                if (obj.height > 0) existing.height = obj.height;
                            }
                        }
                        break;
                        
                    case SEGMENT_TYPE.END:
                        if (currentComposition && currentPalette) {
                            const subtitle = compileDisplaySet(
                                currentComposition,
                                currentPalette,
                                currentObjects,
                                currentWindows
                            );
                            if (subtitle) {
                                subtitles.push(subtitle);
                            }
                        }
                        currentObjects = {};
                        currentComposition = null;
                        currentWindows = {};
                        break;
                }
            } catch (e) {
                console.warn('PGS: Error parsing segment:', e);
            }

            offset = segmentEnd;
        }

        console.log(`[PGS] Parsed ${subtitles.length} subtitle frames`);
        return subtitles;
    }

    function readPTS(data, offset) {
        const b1 = data.getUint8(offset);
        const b2 = data.getUint8(offset + 1);
        const b3 = data.getUint8(offset + 2);
        const b4 = data.getUint8(offset + 3);
        const pts = (b1 << 24) | (b2 << 16) | (b3 << 8) | b4;
        return pts / 90000;
    }
    function parsePCS(data, offset, length) {
        const width = data.getUint16(offset);
        const height = data.getUint16(offset + 2);
        const frameRate = data.getUint8(offset + 4);
        const compositionNumber = data.getUint16(offset + 5);
        const compositionState = data.getUint8(offset + 7);
        const paletteUpdateFlag = data.getUint8(offset + 8);
        const paletteId = data.getUint8(offset + 9);
        const objectCount = data.getUint8(offset + 10);
        
        const objects = [];
        let objOffset = offset + 11;
        
        for (let i = 0; i < objectCount && objOffset < offset + length; i++) {
            const objectId = data.getUint16(objOffset);
            const windowId = data.getUint8(objOffset + 2);
            const cropped = data.getUint8(objOffset + 3);
            const x = data.getUint16(objOffset + 4);
            const y = data.getUint16(objOffset + 6);
            
            objects.push({ objectId, windowId, x, y, cropped });
            objOffset += (cropped & 0x80) ? 16 : 8;
        }

        console.log(`PGS PCS: screen ${width}x${height}, ${objects.length} objects at positions: ${objects.map(o => `(${o.x},${o.y})`).join(', ')}`);
        
        return {
            width,
            height,
            compositionState,
            paletteId,
            objects
        };
    }

    function parseWDS(data, offset, length) {
        const windowCount = data.getUint8(offset);
        const windows = [];
        let winOffset = offset + 1;
        
        for (let i = 0; i < windowCount; i++) {
            windows.push({
                id: data.getUint8(winOffset),
                x: data.getUint16(winOffset + 1),
                y: data.getUint16(winOffset + 3),
                width: data.getUint16(winOffset + 5),
                height: data.getUint16(winOffset + 7)
            });
            winOffset += 9;
        }
        
        return windows;
    }

    function parsePDS(data, offset, length) {
        const paletteId = data.getUint8(offset);
        const version = data.getUint8(offset + 1);
        
        const palette = new Uint8Array(256 * 4);
        let palOffset = offset + 2;
        let colorCount = 0;
        
        while (palOffset + 4 < offset + length) {
            const index = data.getUint8(palOffset);
            const y = data.getUint8(palOffset + 1);
            const cr = data.getUint8(palOffset + 2);
            const cb = data.getUint8(palOffset + 3);
            const alpha = data.getUint8(palOffset + 4);
            
            const rgb = ycbcrToRgb(y, cb, cr);
            
            palette[index * 4] = rgb.r;
            palette[index * 4 + 1] = rgb.g;
            palette[index * 4 + 2] = rgb.b;
            palette[index * 4 + 3] = alpha;
            
            palOffset += 5;
            colorCount++;
        }
        
        console.log(`PGS: Parsed palette ${paletteId} with ${colorCount} colors`);
        
        return { id: paletteId, data: palette };
    }

    function parseODS(data, offset, length, buffer) {
        const objectId = data.getUint16(offset);
        const version = data.getUint8(offset + 2);
        const sequenceFlag = data.getUint8(offset + 3);
        
        const isFirst = (sequenceFlag & 0x80) !== 0;
        const isLast = (sequenceFlag & 0x40) !== 0;
        
        let width = 0, height = 0, rleStart = offset + 4;
        let dataLength = 0;
        
        if (isFirst) {
            dataLength = (data.getUint8(offset + 4) << 16) | 
                        (data.getUint8(offset + 5) << 8) | 
                        data.getUint8(offset + 6);
            width = data.getUint16(offset + 7);
            height = data.getUint16(offset + 9);
            rleStart = offset + 11;
            console.log(`PGS ODS: id=${objectId}, ${width}x${height}, dataLen=${dataLength}, isFirst=${isFirst}, isLast=${isLast}`);
        }
        
        const rleLength = length - (rleStart - offset);
        const rleData = new Uint8Array(buffer, rleStart, rleLength);
        
        return {
            id: objectId,
            width,
            height,
            isFirst,
            isLast,
            rleData: new Uint8Array(rleData)
        };
    }

    function compileDisplaySet(composition, palette, objects, windows) {
        if (composition.objects.length === 0) {
            return {
                startTime: composition.pts,
                endTime: null,
                clear: true
            };
        }

        const canvases = [];
        
        for (const compObj of composition.objects) {
            const obj = objects[compObj.objectId];
            if (!obj) {
                console.warn(`PGS: Object ${compObj.objectId} not found`);
                continue;
            }
            if (!obj.width || !obj.height) {
                console.warn(`PGS: Object ${compObj.objectId} has no dimensions: ${obj.width}x${obj.height}`);
                continue;
            }
            
            try {
                const decoded = decodeRLE(obj.rleData, obj.width, obj.height, palette.data);
                const imageData = decoded.data;
                const actualHeight = decoded.height;
                
                let opaquePixels = 0;
                for (let p = 3; p < imageData.length; p += 4) {
                    if (imageData[p] > 0) opaquePixels++;
                }
                
                if (actualHeight !== obj.height) {
                    console.warn(`PGS: Object ${compObj.objectId} height mismatch: ODS says ${obj.height}, decoded ${actualHeight}`);
                }
                
                console.log(`PGS: Decoded object ${compObj.objectId}: ${obj.width}x${actualHeight} (claimed ${obj.height}) at (${compObj.x},${compObj.y}), RLE: ${obj.rleData.length} bytes, opaque pixels: ${opaquePixels}/${obj.width * actualHeight}`);
                
                canvases.push({
                    x: compObj.x,
                    y: compObj.y,
                    width: obj.width,
                    height: actualHeight,
                    imageData
                });
            } catch (e) {
                console.warn('PGS: Failed to decode object:', e);
            }
        }

        if (canvases.length === 0) return null;

        return {
            startTime: composition.pts,
            endTime: null,
            width: composition.width,
            height: composition.height,
            images: canvases
        };
    }

    function decodeRLE(rleData, width, expectedHeight, palette) {
        const MAX_HEIGHT = 4096;
        if (width > 4096) throw new Error(`PGS width too large: ${width}`);
        
        const pixels = new Uint8Array(width * MAX_HEIGHT * 4);
        let x = 0;
        let y = 0;
        let i = 0;
        let pixelsWritten = 0;
        let linesCompleted = 0;
        
        const linePixelCounts = new Array(MAX_HEIGHT).fill(0);
        
        while (i < rleData.length && y < MAX_HEIGHT) {
            const byte1 = rleData[i++];
            
            if (byte1 === 0) {
                if (i >= rleData.length) break;
                const byte2 = rleData[i++];
                
                if (byte2 === 0) {
                    linesCompleted++;
                    x = 0;
                    y++;
                } else if ((byte2 & 0xC0) === 0x00) {
                    const count = byte2 & 0x3F;
                    x += count;
                } else if ((byte2 & 0xC0) === 0x40) {
                    if (i >= rleData.length) break;
                    const count = ((byte2 & 0x3F) << 8) | rleData[i++];
                    x += count;
                } else if ((byte2 & 0xC0) === 0x80) {
                    const count = byte2 & 0x3F;
                    if (i >= rleData.length) break;
                    const color = rleData[i++];
                    const written = fillPixels(pixels, palette, color, x, y, count, width, MAX_HEIGHT);
                    pixelsWritten += written;
                    if (y < MAX_HEIGHT) linePixelCounts[y] += written;
                    x += count;
                } else {
                    if (i + 1 >= rleData.length) break;
                    const count = ((byte2 & 0x3F) << 8) | rleData[i++];
                    const color = rleData[i++];
                    const written = fillPixels(pixels, palette, color, x, y, count, width, MAX_HEIGHT);
                    pixelsWritten += written;
                    if (y < MAX_HEIGHT) linePixelCounts[y] += written;
                    x += count;
                }
            } else {
                const written = fillPixels(pixels, palette, byte1, x, y, 1, width, MAX_HEIGHT);
                pixelsWritten += written;
                if (y < MAX_HEIGHT) linePixelCounts[y] += written;
                x++;
            }
            
            while (x >= width && y < MAX_HEIGHT) {
                x -= width;
                y++;
            }
        }
        
        let actualHeight = (x > 0) ? y + 1 : y;
        
        actualHeight = Math.max(expectedHeight, actualHeight);
        
        actualHeight = Math.min(actualHeight, MAX_HEIGHT);

        console.log(`PGS RLE: decoded ${linesCompleted} EOLs (claimed=${expectedHeight}, actual=${actualHeight}), wrote ${pixelsWritten} colored pixels, processed ${i}/${rleData.length} bytes`);
        
        if (i < rleData.length) {
             console.warn(`PGS RLE: Still have ${rleData.length - i} bytes after hitting MAX_HEIGHT=${MAX_HEIGHT}. Subtitle may be truncated.`);
        } else if (actualHeight > expectedHeight) {
            console.log(`PGS RLE: Auto-extended height from ${expectedHeight} to ${actualHeight} to fit content.`);
        }

        const resultData = pixels.slice(0, width * actualHeight * 4);

        return {
            data: resultData,
            height: actualHeight
        };
    }

    function fillPixels(pixels, palette, colorIndex, startX, startY, count, width, height) {
        const r = palette[colorIndex * 4];
        const g = palette[colorIndex * 4 + 1];
        const b = palette[colorIndex * 4 + 2];
        const a = palette[colorIndex * 4 + 3];
        
        let x = startX;
        let y = startY;
        let written = 0;
        
        for (let n = 0; n < count && y < height; n++) {
            if (x >= width) {
                x = 0;
                y++;
                if (y >= height) break;
            }
            
            const idx = (y * width + x) * 4;
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = a;
            x++;
            written++;
        }
        
        return written;
    }

    function ycbcrToRgb(y, cb, cr) {
        const r = Math.max(0, Math.min(255, Math.round(y + 1.402 * (cr - 128))));
        const g = Math.max(0, Math.min(255, Math.round(y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128))));
        const b = Math.max(0, Math.min(255, Math.round(y + 1.772 * (cb - 128))));
        return { r, g, b };
    }

    function setEndTimes(subtitles, videoDuration = Infinity) {
        for (let i = 0; i < subtitles.length; i++) {
            if (subtitles[i].endTime === null) {
                if (i + 1 < subtitles.length) {
                    subtitles[i].endTime = subtitles[i + 1].startTime;
                } else {
                    subtitles[i].endTime = videoDuration;
                }
            }
        }
        return subtitles;
    }

    return {
        parse,
        setEndTimes
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PGSParser;
}
