/**
 * Shared OOXML formatting utilities for Excel workbook post-processing.
 *
 * Used by templateGenerator, dataExporter, and metadataExporter to inject
 * header styles, freeze panes, conditional formatting, data validations, etc.
 *
 * Operates on fflate zip objects (unzipSync/zipSync).
 */
import { strToU8, strFromU8 } from 'fflate'

// --- Color constants ---

/** Standard enrollment/TEI header color (blue) */
export const ENROLLMENT_COLOR = '4472C4'

/** Stage header colors, cycled for multi-stage programs */
export const STAGE_COLORS = ['548235', 'BF8F00', 'C55A11', '7030A0', '2E75B6']

/** Data entry header color (same as enrollment blue) */
export const DATA_ENTRY_COLOR = '4472C4'

// --- Column helpers ---

/** Convert 0-based column index to Excel column letter (0→A, 25→Z, 26→AA). */
export function colLetter(idx) {
    let s = ''
    let n = idx + 1
    while (n > 0) {
        n--
        s = String.fromCharCode(65 + (n % 26)) + s
        n = Math.floor(n / 26)
    }
    return s
}

/** Convert Excel column letters to 0-based index (A→0, Z→25, AA→26). */
export function colRefToIndex(colRef) {
    let idx = 0
    for (let i = 0; i < colRef.length; i++) {
        idx = idx * 26 + (colRef.charCodeAt(i) - 64)
    }
    return idx - 1
}

/** Sort all <c> elements inside a row's content by column index (OOXML requirement). */
export function sortRowCells(rowContent) {
    const cells = []
    const cellRegex = /<c\s+r="([A-Z]+)\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g
    let m
    while ((m = cellRegex.exec(rowContent)) !== null) {
        cells.push({ col: colRefToIndex(m[1]), xml: m[0] })
    }
    cells.sort((a, b) => a.col - b.col)
    return cells.map((c) => c.xml).join('')
}

/** Escape special XML characters. */
export function escapeXml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

// --- Worksheet helpers ---

/** Set column widths on a worksheet based on header text lengths. */
export function setColumnWidths(ws, headers, { minWidth = 10, maxWidth = 30 } = {}) {
    ws['!cols'] = headers.map((h) => {
        const len = String(h).length
        const wch = Math.max(minWidth, Math.min(len + 2, maxWidth))
        return { wch }
    })
}

// --- OOXML Injection Functions ---

/**
 * Inject colored header styles (white bold font, colored fills, wrap text) via OOXML.
 *
 * sheetColors: { sheetIdx: [{ startCol, endCol, color }] }
 *
 * For each target sheet, styles rows 1 and 2 with the specified colors,
 * sets row heights (30 for row 1, 40 for row 2), and injects freeze panes.
 */
export function injectHeaderStyles(zip, sheetColors) {
    const stylesPath = 'xl/styles.xml'
    if (!zip[stylesPath]) return

    let stylesXml = strFromU8(zip[stylesPath])

    const uniqueColors = []
    for (const ranges of Object.values(sheetColors)) {
        for (const r of ranges) {
            if (!uniqueColors.includes(r.color)) uniqueColors.push(r.color)
        }
    }
    if (uniqueColors.length === 0) return

    // Add white bold font for colored header cells
    const fontCountMatch = stylesXml.match(/<fonts[^>]*count="(\d+)"/)
    const oldFontCount = fontCountMatch ? parseInt(fontCountMatch[1]) : 1
    const whiteFontId = oldFontCount
    stylesXml = stylesXml.replace(
        /(<fonts[^>]*count=")(\d+)(")/,
        `$1${oldFontCount + 1}$3`
    )
    stylesXml = stylesXml.replace(
        '</fonts>',
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
    )

    // Add solid fills for each color
    const fillCountMatch = stylesXml.match(/<fills[^>]*count="(\d+)"/)
    const oldFillCount = fillCountMatch ? parseInt(fillCountMatch[1]) : 2
    const colorToFillId = {}
    uniqueColors.forEach((c, i) => { colorToFillId[c] = oldFillCount + i })

    stylesXml = stylesXml.replace(
        /(<fills[^>]*count=")(\d+)(")/,
        `$1${oldFillCount + uniqueColors.length}$3`
    )
    const fillsXml = uniqueColors.map((c) =>
        `<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`
    ).join('')
    stylesXml = stylesXml.replace('</fills>', fillsXml + '</fills>')

    // Add cellXf entries referencing the new font + fill
    const xfCountMatch = stylesXml.match(/<cellXfs[^>]*count="(\d+)"/)
    const oldXfCount = xfCountMatch ? parseInt(xfCountMatch[1]) : 1
    const colorToStyleIdx = {}
    uniqueColors.forEach((c, i) => { colorToStyleIdx[c] = oldXfCount + i })

    stylesXml = stylesXml.replace(
        /(<cellXfs[^>]*count=")(\d+)(")/,
        `$1${oldXfCount + uniqueColors.length}$3`
    )
    const xfsXml = uniqueColors.map((c) =>
        `<xf numFmtId="0" fontId="${whiteFontId}" fillId="${colorToFillId[c]}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>`
    ).join('')
    stylesXml = stylesXml.replace('</cellXfs>', xfsXml + '</cellXfs>')

    zip[stylesPath] = strToU8(stylesXml)

    // Update cells in row 1 (and row 2 for flat template) of each target sheet
    for (const [sheetIdx, ranges] of Object.entries(sheetColors)) {
        const sheetPath = `xl/worksheets/sheet${sheetIdx}.xml`
        if (!zip[sheetPath]) continue

        let sheetXml = strFromU8(zip[sheetPath])

        const colStyleMap = {}
        for (const { startCol, endCol, color } of ranges) {
            for (let c = startCol; c <= endCol; c++) {
                colStyleMap[c] = colorToStyleIdx[color]
            }
        }

        const rowRegex = /(<row r="1"[^>]*>)([\s\S]*?)(<\/row>)/
        const rowMatch = sheetXml.match(rowRegex)
        if (!rowMatch) continue

        let rowContent = rowMatch[2]
        const existingCols = new Set()

        // Update s= attribute on existing cells
        rowContent = rowContent.replace(
            /<c r="([A-Z]+)1"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g,
            (match, colRef, attrs, closePart) => {
                const colIdx = colRefToIndex(colRef)
                existingCols.add(colIdx)
                if (colIdx in colStyleMap) {
                    const cleanAttrs = attrs.replace(/\s*s="\d+"/, '')
                    return `<c r="${colRef}1" s="${colStyleMap[colIdx]}"${cleanAttrs}${closePart}`
                }
                return match
            }
        )

        // Create cells for columns that have no existing element
        for (const [colStr, styleIdx] of Object.entries(colStyleMap)) {
            const colIdx = parseInt(colStr)
            if (!existingCols.has(colIdx)) {
                rowContent += `<c r="${colLetter(colIdx)}1" s="${styleIdx}"/>`
            }
        }

        sheetXml = sheetXml.replace(rowRegex, rowMatch[1] + sortRowCells(rowContent) + rowMatch[3])

        // Also style row 2 (header row in flat templates with category + header rows)
        const row2Regex = /(<row r="2"[^>]*>)([\s\S]*?)(<\/row>)/
        const row2Match = sheetXml.match(row2Regex)
        if (row2Match) {
            let row2Content = row2Match[2]
            const existingCols2 = new Set()
            row2Content = row2Content.replace(
                /<c r="([A-Z]+)2"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g,
                (match, colRef, attrs, closePart) => {
                    const colIdx = colRefToIndex(colRef)
                    existingCols2.add(colIdx)
                    if (colIdx in colStyleMap) {
                        const cleanAttrs = attrs.replace(/\s*s="\d+"/, '')
                        return `<c r="${colRef}2" s="${colStyleMap[colIdx]}"${cleanAttrs}${closePart}`
                    }
                    return match
                }
            )
            for (const [colStr, styleIdx] of Object.entries(colStyleMap)) {
                const colIdx = parseInt(colStr)
                if (!existingCols2.has(colIdx)) {
                    row2Content += `<c r="${colLetter(colIdx)}2" s="${styleIdx}"/>`
                }
            }
            sheetXml = sheetXml.replace(row2Regex, row2Match[1] + sortRowCells(row2Content) + row2Match[3])
        }

        // Set custom row height on header rows so wrapped text is visible
        if (!/r="1"[^>]*ht=/.test(sheetXml)) {
            sheetXml = sheetXml.replace(/<row r="1"/, '<row r="1" ht="30" customHeight="1"')
        }
        if (!/r="2"[^>]*ht=/.test(sheetXml)) {
            sheetXml = sheetXml.replace(/<row r="2"/, '<row r="2" ht="40" customHeight="1"')
        }

        // Inject freeze panes — freeze after row 2 (for flat) or row 1 (for multi-sheet)
        const hasRow2 = sheetXml.includes('<row r="2"')
        const freezeRow = hasRow2 ? 2 : 1
        const paneXml =
            `<sheetViews><sheetView tabSelected="1" workbookViewId="0">` +
            `<pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/>` +
            `<selection pane="bottomLeft" activeCell="A${freezeRow + 1}" sqref="A${freezeRow + 1}"/>` +
            `</sheetView></sheetViews>`
        if (sheetXml.includes('<sheetViews>')) {
            sheetXml = sheetXml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, paneXml)
        } else if (sheetXml.includes('<sheetFormatPr')) {
            sheetXml = sheetXml.replace('<sheetFormatPr', paneXml + '<sheetFormatPr')
        } else if (sheetXml.includes('<cols>')) {
            sheetXml = sheetXml.replace('<cols>', paneXml + '<cols>')
        } else {
            sheetXml = sheetXml.replace('<sheetData', paneXml + '<sheetData')
        }

        zip[sheetPath] = strToU8(sheetXml)
    }
}

/**
 * Inject freeze panes on data sheets that weren't already handled by injectHeaderStyles.
 * Skips Instructions and Validation sheets. Freezes row 1 for multi-sheet, row 2 for flat.
 */
export function injectFreezePanes(zip, sheetNames, alreadyHandled) {
    const skipSheets = new Set(['Instructions', 'Validation'])
    for (let i = 0; i < sheetNames.length; i++) {
        const sheetIdx = i + 1
        if (alreadyHandled.includes(sheetIdx)) continue
        if (skipSheets.has(sheetNames[i])) continue

        const path = `xl/worksheets/sheet${sheetIdx}.xml`
        if (!zip[path]) continue

        let xml = strFromU8(zip[path])
        if (xml.includes('<pane ')) continue // already has freeze panes

        const paneXml =
            `<sheetViews><sheetView workbookViewId="0">` +
            `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
            `<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>` +
            `</sheetView></sheetViews>`

        if (xml.includes('<sheetViews>')) {
            xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, paneXml)
        } else if (xml.includes('<sheetFormatPr')) {
            xml = xml.replace('<sheetFormatPr', paneXml + '<sheetFormatPr')
        } else if (xml.includes('<cols>')) {
            xml = xml.replace('<cols>', paneXml + '<cols>')
        } else {
            xml = xml.replace('<sheetData', paneXml + '<sheetData')
        }

        zip[path] = strToU8(xml)
    }
}
