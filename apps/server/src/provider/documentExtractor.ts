/**
 * Document text extraction service.
 *
 * Extracts plain-text content from various document formats so provider
 * adapters that don't natively support binary documents (e.g. Codex) can
 * include file content as text in the AI prompt.
 *
 * @module documentExtractor
 */
import { readFileSync } from "node:fs";

import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";

/**
 * Read a document file and return its text representation.
 *
 * Supports: PDF, DOCX, DOC, XLSX, XLS, CSV, TXT, Markdown.
 * Returns `null` when text extraction fails or the format is unrecognised.
 */
export async function extractTextFromDocument(
  filePath: string,
  mimeType: string,
): Promise<string | null> {
  const mime = mimeType.toLowerCase();

  try {
    switch (mime) {
      case "text/plain":
      case "text/csv":
      case "text/markdown":
        return readFileSync(filePath, "utf-8");

      case "application/pdf":
        return await extractPdfText(filePath);

      case "application/msword":
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return await extractWordText(filePath);

      case "application/vnd.ms-excel":
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return extractExcelText(filePath);

      default:
        return null;
    }
  } catch {
    return null;
  }
}

async function extractPdfText(filePath: string): Promise<string> {
  const buffer = readFileSync(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractWordText(filePath: string): Promise<string> {
  const buffer = readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function extractExcelText(filePath: string): string {
  const workbook = XLSX.readFile(filePath);
  const parts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim().length > 0) {
      parts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
    }
  }

  return parts.join("\n\n");
}
