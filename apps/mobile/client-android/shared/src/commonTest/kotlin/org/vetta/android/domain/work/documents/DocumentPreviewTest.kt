package org.vetta.android.domain.work.documents

import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DocumentPreviewTest {
    private val labels = DocumentLabels(emptySheet = "Empty sheet", rowsShown = { shown, total -> "First $shown of $total rows" })

    private fun zip(vararg parts: Pair<String, String>, binary: Map<String, ByteArray> = emptyMap()): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            for ((name, text) in parts) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(text.encodeToByteArray())
                zip.closeEntry()
            }
            for ((name, bytes) in binary) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(bytes)
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }

    private val png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
    private val rootRels = { target: String ->
        """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="$target"/></Relationships>"""
    }
    private val w = """xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing""""

    @Test
    fun showsAWordDocumentWithItsHeadingsListsTablesLinksAndPictures() {
        val document =
            """<w:document $w><w:body>
            <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>季度报告</w:t></w:r></w:p>
            <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t>要点</w:t></w:r><w:r><w:t xml:space="preserve"> 与 &lt;细节&gt;</w:t></w:r></w:p>
            <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>第一项</w:t></w:r></w:p>
            <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>第二项</w:t></w:r></w:p>
            <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>要点项</w:t></w:r></w:p>
            <w:p><w:hyperlink r:id="rLink"><w:r><w:t>官网</w:t></w:r></w:hyperlink></w:p>
            <w:p><w:r><w:drawing><wp:inline><wp:extent cx="1270000" cy="1270000"/><a:graphic><a:graphicData><a:blip r:embed="rImg"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
            <w:tbl>
              <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>合并标题</w:t></w:r></w:p></w:tc></w:tr>
              <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>纵向</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc></w:tr>
              <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>
            </w:tbl>
            </w:body></w:document>"""
        val docx =
            zip(
                "_rels/.rels" to rootRels("word/document.xml"),
                "word/document.xml" to document,
                "word/_rels/document.xml.rels" to
                    """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                    <Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://vetta.org/" TargetMode="External"/>
                    <Relationship Id="rImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
                    <Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
                    <Relationship Id="rNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
                    </Relationships>""",
                "word/styles.xml" to """<w:styles $w><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>""",
                "word/numbering.xml" to
                    """<w:numbering $w>
                    <w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
                    <w:abstractNum w:abstractNumId="20"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val=""/></w:lvl></w:abstractNum>
                    <w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num>
                    </w:numbering>""",
                binary = mapOf("word/media/image1.png" to png),
            )
        val html = assertNotNull(DocumentPreview.html("报告.docx", docx, labels))
        assertTrue("<h1 style=\"\">季度报告</h1>" in html)
        assertTrue("text-align:center" in html)
        assertTrue("<span style=\"color:#FF0000;\"><b>要点</b></span> 与 &lt;细节&gt;" in html, "formatting kept, text escaped")
        assertTrue(">1.</span>第一项" in html && ">2.</span>第二项" in html, "numbered as the list goes")
        assertTrue(">•</span>要点项" in html, "a symbol-font bullet shown as a bullet")
        assertTrue("<a href=\"https://vetta.org/\">官网</a>" in html)
        assertTrue("<img src=\"data:image/png;base64," in html && "width:100pt" in html)
        assertTrue("<td colspan=\"2\">" in html && "<td rowspan=\"2\">" in html, "merged cells span")
        assertEquals(3, Regex("<tr>").findAll(html).count())
        assertEquals(4, Regex("<td").findAll(html).count(), "a continued cell is not drawn again")
    }

    @Test
    fun showsAWorkbookWithFormattedValuesMergedCellsAndItsVisibleSheets() {
        val ns = """xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""""
        val xlsx =
            zip(
                "_rels/.rels" to rootRels("xl/workbook.xml"),
                "xl/workbook.xml" to
                    """<workbook $ns><sheets>
                    <sheet name="销售" sheetId="1" r:id="rId1"/><sheet name="隐藏" sheetId="2" state="hidden" r:id="rId2"/><sheet name="备注" sheetId="3" r:id="rId3"/>
                    </sheets></workbook>""",
                "xl/_rels/workbook.xml.rels" to
                    """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
                    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
                    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet3.xml"/>
                    <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
                    <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
                    </Relationships>""",
                "xl/sharedStrings.xml" to """<sst $ns><si><t>产品</t></si><si><r><t>销</t></r><r><t>量</t></r></si><si><t>合计</t></si></sst>""",
                "xl/styles.xml" to
                    """<styleSheet $ns><numFmts><numFmt numFmtId="164" formatCode="&quot;¥&quot;#,##0.00"/></numFmts>
                    <fonts><font/><font><b/></font></fonts><fills><fill/><fill/></fills>
                    <cellXfs><xf numFmtId="0" fontId="0"/><xf numFmtId="164" fontId="0"/><xf numFmtId="10" fontId="0"/><xf numFmtId="14" fontId="0"/><xf numFmtId="0" fontId="1"/></cellXfs></styleSheet>""",
                "xl/worksheets/sheet1.xml" to
                    """<worksheet $ns><sheetData>
                    <row r="1"><c r="A1" t="s" s="4"><v>0</v></c><c r="B1" t="s" s="4"><v>1</v></c></row>
                    <row r="2"><c r="A2" t="inlineStr"><is><t>键盘</t></is></c><c r="B2" s="1"><v>1234.5</v></c><c r="C2" s="2"><v>0.125</v></c><c r="D2" s="3"><v>45000</v></c></row>
                    <row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3" t="b"><v>1</v></c><c r="D3"><f>SUM(B2:B2)</f><v></v></c></row>
                    </sheetData><mergeCells><mergeCell ref="A3:B3"/></mergeCells></worksheet>""",
                "xl/worksheets/sheet2.xml" to """<worksheet $ns><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>秘密</t></is></c></row></sheetData></worksheet>""",
                "xl/worksheets/sheet3.xml" to """<worksheet $ns><sheetData/></worksheet>""",
            )
        val html = assertNotNull(DocumentPreview.html("sales.xlsx", xlsx, labels))
        assertTrue("<label for=\"t0\">销售</label>" in html && "<label for=\"t1\">备注</label>" in html)
        assertFalse("秘密" in html, "a hidden sheet is left out")
        assertTrue("font-weight:bold;" in html && ">销量</td>" in html, "rich text joined, bold kept")
        assertTrue(">¥1,234.50</td>" in html, "a currency format")
        assertTrue(">12.50%</td>" in html)
        assertTrue(">2023-03-15</td>" in html, "a date serial as a date")
        assertTrue("colspan=\"2\"" in html && ">合计</td>" in html)
        assertTrue(">TRUE</td>" in html)
        assertTrue(">=SUM(B2:B2)</td>" in html, "a formula never calculated shows as written")
        assertTrue("Empty sheet" in html)
        assertTrue("<th>D</th>" in html && "<th>3</th>" in html, "lettered columns, numbered rows")
    }

    @Test
    fun formatsNumbersAsTheWorkbookAsks() {
        assertEquals("42", NumberFormats.format(42.0, "General"))
        assertEquals("0.1", NumberFormats.format(0.1, "General"))
        assertEquals("3.141592654", NumberFormats.format(Math.PI, "General"))
        assertEquals("1,234,568", NumberFormats.format(1234567.8, "#,##0"))
        assertEquals("-12.30", NumberFormats.format(-12.3, "0.00"))
        assertEquals("7%", NumberFormats.format(0.07, "0%"))
        assertEquals("1900-01-01", NumberFormats.format(1.0, "yyyy-mm-dd"))
        assertEquals("1900-03-01", NumberFormats.format(61.0, "yyyy-mm-dd"))
        assertEquals("2023-03-15 12:00", NumberFormats.format(45000.5, "yyyy/m/d h:mm"))
        assertEquals("18:30:00", NumberFormats.format(0.7708333333, "h:mm:ss"))
        assertEquals("2027-03-16", NumberFormats.format(45000.0, "yyyy-mm-dd", date1904 = true))
        assertEquals("$5.00", NumberFormats.format(5.0, "[\$\$-409]#,##0.00"))
    }

    private fun rels(vararg entries: Triple<String, String, String>) =
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            entries.joinToString("") { (id, type, target) -> "<Relationship Id=\"$id\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/$type\" Target=\"$target\"/>" } +
            "</Relationships>"

    @Test
    fun drawsSlidesWithWhatTheyInheritFromTheLayoutMasterAndTheme() {
        val ns = """xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""""
        val pptx =
            zip(
                "_rels/.rels" to rootRels("ppt/presentation.xml"),
                "ppt/presentation.xml" to """<p:presentation $ns><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>""",
                "ppt/_rels/presentation.xml.rels" to rels(Triple("rId2", "slide", "slides/slide1.xml")),
                "ppt/slides/slide1.xml" to
                    """<p:sld $ns><p:cSld><p:spTree>
                    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
                      <p:txBody><a:bodyPr/><a:p><a:r><a:t>年度回顾</a:t></a:r></a:p></p:txBody></p:sp>
                    <p:sp><p:nvSpPr><p:cNvPr id="3" name="Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
                      <p:spPr><a:xfrm><a:off x="6096000" y="3429000"/><a:ext cx="3048000" cy="1714500"/></a:xfrm><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr>
                      <p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>增长 30%</a:t></a:r></a:p></p:txBody></p:sp>
                    <p:pic><p:nvPicPr><p:cNvPr id="4" name="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rImg"/></p:blipFill>
                      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1219200" cy="685800"/></a:xfrm></p:spPr></p:pic>
                    </p:spTree></p:cSld></p:sld>""",
                "ppt/slides/_rels/slide1.xml.rels" to rels(Triple("rLayout", "slideLayout", "../slideLayouts/slideLayout1.xml"), Triple("rImg", "image", "../media/logo.png")),
                "ppt/slideLayouts/slideLayout1.xml" to
                    """<p:sldLayout $ns><p:cSld><p:spTree>
                    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
                      <p:spPr><a:xfrm><a:off x="1219200" y="685800"/><a:ext cx="9753600" cy="1371600"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>单击此处编辑标题</a:t></a:r></a:p></p:txBody></p:sp>
                    </p:spTree></p:cSld></p:sldLayout>""",
                "ppt/slideLayouts/_rels/slideLayout1.xml.rels" to rels(Triple("rMaster", "slideMaster", "../slideMasters/slideMaster1.xml")),
                "ppt/slideMasters/slideMaster1.xml" to
                    """<p:sldMaster $ns><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F4F1EA"/></a:solidFill></p:bgPr></p:bg><p:spTree/></p:cSld>
                    <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1"/>
                    <p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle></p:txStyles>
                    </p:sldMaster>""",
                "ppt/slideMasters/_rels/slideMaster1.xml.rels" to rels(Triple("rTheme", "theme", "../theme/theme1.xml")),
                "ppt/theme/theme1.xml" to
                    """<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Vetta">
                    <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
                    <a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme></a:themeElements></a:theme>""",
                binary = mapOf("ppt/media/logo.png" to png),
            )
        val html = assertNotNull(DocumentPreview.html("review.pptx", pptx, labels))
        assertTrue("height:calc(var(--w) * 0.5625)" in html, "16:9 slides")
        assertTrue("background:#f4f1ea;" in html, "the master's background")
        assertTrue("left:10%;top:10%;width:80%;height:20%" in html, "the title where the layout places it")
        assertTrue("color:#1f3864;" in html && ">年度回顾</span>" in html, "the title in the master's color, from the theme")
        assertFalse("单击此处编辑标题" in html, "the layout's prompt text is not shown")
        assertTrue("background:#4472c4;" in html && "justify-content:center;" in html && "font-weight:bold;" in html)
        assertTrue("<img class=\"shape\" src=\"data:image/png;base64," in html)
        assertTrue("1 / 1" in html)
    }

    @Test
    fun showsDelimitedTablesWithQuotesSeparatorsAndChineseEncodings() {
        val csv = "名称,说明,数量\r\n\"键盘\",\"带, 逗号\n和换行\",\"1,200\"\r\n鼠标,\"他说\"\"好\"\"\",3\r\n"
        val html = assertNotNull(DocumentPreview.html("stock.csv", csv.encodeToByteArray(), labels))
        assertTrue(">带, 逗号\n和换行</td>" in html)
        assertTrue(">他说&quot;好&quot;</td>" in html)
        assertTrue("text-align:right;\">1,200</td>" in html, "numbers line up on the right")
        assertTrue("<th>3</th>" in html && !html.contains("<th>4</th>"))

        val semicolons = assertNotNull(DocumentPreview.html("eu.csv", "a;b\n1,5;2\n".encodeToByteArray(), labels))
        assertTrue(">1,5</td>" in semicolons, "a decimal comma stays in its field")

        val gbk = assertNotNull(DocumentPreview.html("gbk.csv", "姓名,城市\n张三,北京\n".toByteArray(charset("GBK")), labels))
        assertTrue(">北京</td>" in gbk)

        val tsv = assertNotNull(DocumentPreview.html("a.tsv", "x\ty, z\n".encodeToByteArray(), labels))
        assertTrue(">y, z</td>" in tsv)
    }

    @Test
    fun saysHowManyRowsItShowsOfALongTable() {
        val csv = (1..3500).joinToString("\n") { "row$it" }
        val html = assertNotNull(DocumentPreview.html("long.csv", csv.encodeToByteArray(), labels))
        assertTrue("First 3000 of 3500 rows" in html)
        assertFalse(">row3001<" in html)
    }

    @Test
    fun givesUpOnWhatIsNotADocumentItCanRead() {
        assertNull(DocumentPreview.html("fake.docx", "not a zip".encodeToByteArray(), labels))
        assertNull(DocumentPreview.html("empty.xlsx", zip("readme.txt" to "hi"), labels))
        assertNull(DocumentPreview.html("old.doc", byteArrayOf(1, 2, 3), labels))
        val withDoctype =
            zip(
                "_rels/.rels" to rootRels("word/document.xml"),
                "word/document.xml" to """<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document $w><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>""",
            )
        val html = DocumentPreview.html("x.docx", withDoctype, labels)
        assertTrue(html == null || "root:" !in html, "an entity is never resolved")
    }
}
