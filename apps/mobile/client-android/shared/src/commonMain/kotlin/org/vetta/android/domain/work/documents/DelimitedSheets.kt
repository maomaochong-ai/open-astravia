package org.vetta.android.domain.work.documents

/** CSV and TSV as a sheet: quoted fields, line breaks inside quotes, and `;` separated files from locales that use a decimal comma. */
internal object DelimitedSheets {
    fun read(name: String, text: String, tabs: Boolean): Sheet {
        val body = text.removePrefix("﻿")
        val separator = if (tabs) '\t' else separatorOf(body)
        val cells = HashMap<Long, SheetCell>()
        var row = 0
        var column = 0
        var totalRows: Int? = null
        val field = StringBuilder()
        var quoted = false
        var i = 0

        fun endField() {
            if (row < Sheet.MAX_ROWS && column < Sheet.MAX_COLUMNS && field.isNotEmpty()) {
                val value = field.toString()
                val numeric = value.trim().replace(",", "").toDoubleOrNull() != null
                cells[Sheet.key(row, column)] = SheetCell(value, if (numeric) "text-align:right;" else "")
            }
            field.setLength(0)
            column++
        }

        fun endRow() {
            endField()
            row++
            column = 0
        }
        while (i < body.length) {
            val c = body[i]
            when {
                quoted && c == '"' && body.getOrNull(i + 1) == '"' -> {
                    field.append('"')
                    i++
                }
                c == '"' && (quoted || field.isEmpty()) -> quoted = !quoted
                quoted -> field.append(c)
                c == separator -> endField()
                c == '\r' -> {
                    if (body.getOrNull(i + 1) == '\n') i++
                    endRow()
                }
                c == '\n' -> endRow()
                else -> field.append(c)
            }
            i++
        }
        if (field.isNotEmpty() || column > 0) endRow()
        if (row > Sheet.MAX_ROWS) totalRows = row
        return Sheet(name, cells, totalRows = totalRows)
    }

    /** `,` unless the first line has more `;` outside quotes. */
    private fun separatorOf(text: String): Char {
        var commas = 0
        var semicolons = 0
        var quoted = false
        for (c in text) {
            when (c) {
                '"' -> quoted = !quoted
                ',' -> if (!quoted) commas++
                ';' -> if (!quoted) semicolons++
                '\n' -> if (!quoted) break
            }
        }
        return if (semicolons > commas) ';' else ','
    }
}
