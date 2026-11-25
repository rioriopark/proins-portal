// 브라우저에서 임금명세서 PDF를 읽어 텍스트 조각(위치 포함)을 뽑는다. pdfjs는 크기가 커서 일괄 등록을
// 실제로 쓸 때만 불러온다(dynamic import). 한글 글꼴(Adobe-Korea1)을 읽으려면 CMap 파일이 필요해서,
// pdfjs-dist에 들어 있는 cmaps를 Vite 에셋으로 묶어 두고 필요한 것만 받아 온다.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { parseWageItems, type ParsedWage, type PdfTextItem } from './wagePdfParse'

const cmapUrls = import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>

class BundledCMapFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    if (kind !== 'cMapUrl') throw new Error(`지원하지 않는 PDF 리소스: ${kind}`)
    const loader = cmapUrls[`/node_modules/pdfjs-dist/cmaps/${filename}`]
    if (!loader) throw new Error(`CMap 없음: ${filename}`)
    const res = await fetch(await loader())
    if (!res.ok) throw new Error(`CMap 로드 실패: ${filename}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    })
  }
  return pdfjsPromise
}

export async function readWagePdf(file: File): Promise<ParsedWage> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    BinaryDataFactory: BundledCMapFactory,
    useWorkerFetch: false,
  })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const content = await page.getTextContent()
    const items: PdfTextItem[] = []
    for (const it of content.items) {
      if (!('str' in it)) continue
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width })
    }
    return parseWageItems(items)
  } finally {
    await task.destroy()
  }
}
